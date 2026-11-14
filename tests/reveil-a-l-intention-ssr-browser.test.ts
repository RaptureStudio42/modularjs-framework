// Le réveil à l'intention (`:wake=interaction`) sur une page rendue en `ssr`, où la vue du composant remplace au réveil la page du serveur,
// et en `ssr:markers`, où elle en reprend les nœuds : ce que l'utilisateur a fait dans la page du serveur avant le réveil y reste. Au
// clavier, le champ atteint par Tab garde le focus et sa saisie, la frappe suit ; le code de la page arrivé après le premier Tab, le champ
// garde aussi la position du curseur, et la carte ce qui a été changé dans sa page — un champ lié à une variable (la variable reçoit la
// saisie), une case cochée, une option choisie, un `<details>` ouvert, une zone défilée. Pour plusieurs composants (chacun attend son
// signe d'intention), un composant d'une ligne de `{for}`, un composant qui attend dans un composant qui attend. Un bloc `render` qui rend
// ses pages en `ssr` accepte `:wake=interaction`. Une page du serveur qui ne met pas à la place du champ atteint la balise qu'y met la vue
// du navigateur (un serveur construit sur une autre version du composant) : la console du développement le dit. En développement et en
// production (un fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['ssr', 'ssr:markers'] as const
// le mode que demande au serveur une page rendue dans chaque mode du bloc `render`
const RENDU: Record<string, string> = { 'ssr': 'replace', 'ssr:markers': 'markers' }

const CARTE = `<script>
  $n = 0
  $lie = ''
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Carte {$quoi} {$n}</p>
<input class="u" aria-label="u" name="u">
<input class="l" aria-label="l" value=!{$lie}>
<p class="vl">[{$lie}]</p>
<input class="x" type="checkbox" aria-label="x">
<select class="s" aria-label="s"><option>un</option><option>deux</option><option>trois</option></select>
<details class="d"><summary>plus</summary><p>dedans</p></details>
<div class="z"><div class="zz">zone</div></div>
<button type="button" class="plus" @click={$n++}>plus</button>

<style>
  :host
    display: block
    width: 400px
  .z
    height: 40px
    overflow: auto
  .zz
    height: 400px
</style>
`

const SOURCES: Record<string, string> = {
  'rs-carte.mjs': CARTE,
  // une boîte qui attend, et dans sa page une carte qui attend
  'rs-boite.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push('boite')
</script>

<p class="titre">Boite {$quoi}</p>
<@rs-carte :wake=interaction quoi="n"></@rs-carte>

<style>
  :host
    display: block
    width: 400px
</style>
`,
  'rs-page.mjs': `<script>
  $liste = ['l1', 'l2']
</script>

<@rs-carte :wake=interaction quoi="a"></@rs-carte>
<@rs-carte :wake=interaction quoi="b"></@rs-carte>
{for q in $liste}
  <@rs-carte :wake=interaction quoi={q}></@rs-carte>
{end}
<@rs-boite :wake=interaction quoi="B"></@rs-boite>
<@rs-carte quoi="tot"></@rs-carte>
`
}

// la carte telle que la construit un serveur resté sur une autre version : une zone de texte à la place du premier champ
const CARTE_DU_SERVEUR = CARTE.replace('<input class="u" aria-label="u" name="u">', '<textarea class="u" aria-label="u" name="u"></textarea>')

// posée avant tout script de la page : retrouve une carte par son texte (`Carte <quoi>`), à toute profondeur, page du serveur ou vue
// neuve ; relève les avertissements de la console
const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  window.__avertis = [];
  const avertir = console.warn;
  console.warn = function (...a) { window.__avertis.push(a.join(' ')); return avertir.apply(this, a); };
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = (nom) => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === nom) out.push(e); if (racine(e)) fouille(racine(e)); }); fouille(document); return out; };
  window.__carte = (q) => tous('mjs-rs-carte').find((c) => racine(c) && new RegExp('Carte ' + q + ' ').test(racine(c).textContent));
  window.__dans = (q, sel) => { const c = window.__carte(q); return c && racine(c).querySelector(sel); };
  window.__attend = (q) => { const c = window.__carte(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__boiteAttend = () => tous('mjs-rs-boite').some((b) => b.hasAttribute('mjs-wake'));
  // l'état de la carte : la saisie du premier champ et sa sélection, le champ lié et la variable qu'il écrit, la case, l'option choisie,
  // l'ouverture du details, le défilement de la zone
  window.__etat = (q) => { const d = (s) => window.__dans(q, s); return [d('.u').value, d('.u').selectionStart, d('.u').selectionEnd, d('.l').value, d('.vl').textContent, d('.x').checked, d('.s').value, d('.d').open, d('.z').scrollTop]; };
  // l'élément qui a le focus, au fond des racines d'ombre : la carte qui le contient et sa classe
  window.__focus = () => {
    let a = document.activeElement, q = null;
    while (a) {
      const r = racine(a);
      if (a.localName === 'mjs-rs-carte' && r) q = (r.textContent.match(/Carte (\\w+) /) || [])[1] || null;
      if (!r || !r.activeElement) break;
      a = r.activeElement;
    }
    return [q, a ? a.className || a.localName : null];
  };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>>; erreurs: Record<string, string[]> }
let construit: Promise<Construit> | null = null

async function rendre(srcDir: string, outputDir: string, mode: string): Promise<string> {
  const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
  try {
    const r = await renderer.renderToString('mjs-rs-page', { ssrMode: mode } as any)
    return r.html + '\n' + (r.hydrateScript || '')
  }
  finally {
    await renderer.close()
  }
}

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-intention-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    for (const mode of MODES) pages[mode] = await rendre(srcDir, join(root, 'rendu-' + RENDU[mode]), RENDU[mode])
    // la page rendue par le serveur construit sur l'autre version de la carte (cf. CARTE_DU_SERVEUR)
    const srcServeur = join(root, 'src-serveur')
    mkdirSync(srcServeur, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcServeur, nom), nom === 'rs-carte.mjs' ? CARTE_DU_SERVEUR : source)
    pages['ssr-autre'] = await rendre(srcServeur, join(root, 'rendu-serveur'), 'replace')
    for (const cle of Object.keys(pages)) assert.match(pages[cle], /<mjs-rs-carte\b[^>]*\bmjs-wake="interaction"/, `le serveur écrit l'attribut du réveil (${cle})`)
    assert.ok(!pages.ssr.includes('__mjs_ssrHydrate'), 'la page en ssr n\'est pas reprise par le client')
    assert.ok(pages['ssr:markers'].includes('__mjs_ssrHydrate'), 'la page en ssr:markers est reprise par le client')
    // le code du navigateur, bâti avec le bloc `render` du projet qui rend ses pages dans chaque mode
    const fichiers: Record<string, Map<string, Buffer>> = {}
    const erreurs: Record<string, string[]> = {}
    for (const mode of MODES) for (const env of ENVS) {
      const cle     = mode + ' ' + env
      const dossier = join(root, 'out-' + RENDU[mode] + '-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env, render: { default: mode } } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      erreurs[cle]  = stats.errors.map((e: any) => String(e.message ?? e))
      fichiers[cle] = new Map<string, Buffer>()
      if (!erreurs[cle].length) for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[cle].set(n, readFileSync(join(dossier, n)))
    }
    return { pages, fichiers, erreurs }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) describe(`le réveil à l'intention en ssr et en ssr:markers : ${nom}, ${env}`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let fait: Construit

  before(async function () {
    this.timeout(180000)
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // `code` : une promesse qui retient le code de la page (bundle.js) jusqu'à sa résolution, la page du serveur seule affichée
  async function ouvrir(mode: string, corps: string, code?: Promise<void>) {
    const fichiers = fait.fichiers[mode + ' ' + env]
    const contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page     = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await page.addInitScript(SONDE)
    await page.route('http://intention-ssr.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fichiers.get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (code && url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    if (code) {
      await page.goto('http://intention-ssr.test/page', { waitUntil: 'commit' })
      await page.waitForFunction(`!!window.__carte('a')`, null, { timeout: 15000 })
      return { page, erreurs }
    }
    await page.goto('http://intention-ssr.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-rs-carte') && window.__ordre.includes('tot')`, null, { timeout: 15000 })
    await page.waitForTimeout(600)
    return { page, erreurs }
  }

  // les cartes et la boîte qui attendent encore
  async function attendent(page: any, quoi: string[]): Promise<string[]> {
    return page.evaluate(`${JSON.stringify(quoi)}.filter((q) => q === 'boite' ? window.__boiteAttend() : window.__attend(q))`)
  }

  const VIERGE = ['', 0, 0, '', '[]', false, 'un', false, 0]

  for (const mode of MODES) {
    it(`${mode} : Tab jusqu'au champ d'une carte qui attend, la frappe — le focus et la saisie restent au réveil, la frappe suit ; de même pour une carte d'une ligne de {for} et une carte dans une boîte qui attend, chacune à son tour`, async function () {
      if (!present) { this.skip(); return }
      assert.deepEqual(fait.erreurs[mode + ' ' + env], [], `le bloc render en ${mode} accepte :wake=interaction`)
      const { page, erreurs } = await ouvrir(mode, fait.pages[mode])
      const ev = (s: string) => page.evaluate(s)
      try {
        // le pointeur hors des cartes : le défilement que fait le focus n'en amène aucune sous lui (elle verrait le pointeur entrer)
        await page.mouse.move(990, 690)
        assert.deepEqual(await ev('window.__ordre.slice()'), ['tot'], `au démarrage, seule la carte sans :wake est réveillée (${mode})`)
        assert.deepEqual(await attendent(page, ['a', 'b', 'l1', 'l2', 'n', 'boite']), ['a', 'b', 'l1', 'l2', 'n', 'boite'], `les cartes attendent un signe d'intention (${mode})`)
        await ev(`window.__dans('a', '.u').__serveur = 1`)
        await page.keyboard.press('Tab')
        await page.keyboard.type('zz')
        await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 5000 })
        await page.waitForTimeout(300)
        assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], `le champ atteint au clavier garde le focus au réveil (${mode})`)
        assert.deepEqual(await ev(`window.__etat('a')`), ['zz', 2, 2, ...VIERGE.slice(3)], `la saisie reste, le curseur à sa place (${mode})`)
        assert.equal(await ev(`window.__dans('a', '.u').__serveur === 1`), mode === 'ssr:markers', mode === 'ssr' ? 'la vue a remplacé la page du serveur' : 'la vue a repris le champ de la page du serveur')
        await page.keyboard.type('y')
        await page.waitForTimeout(100)
        assert.equal(await ev(`window.__dans('a', '.u').value`), 'zzy', `la frappe suit dans le champ réveillé (${mode})`)
        assert.deepEqual(await attendent(page, ['b', 'l1', 'l2', 'n', 'boite']), ['b', 'l1', 'l2', 'n', 'boite'], `les autres cartes attendent toujours (${mode})`)
        // la carte d'une ligne de {for}
        await ev(`window.__dans('l2', '.u').focus()`)
        await page.keyboard.type('q')
        await page.waitForFunction(`window.__ordre.includes('l2')`, null, { timeout: 5000 })
        await page.waitForTimeout(300)
        await page.keyboard.type('r')
        await page.waitForTimeout(100)
        assert.deepEqual([await ev('window.__focus()'), await ev(`window.__dans('l2', '.u').value`)], [['l2', 'u'], 'qr'], `la carte d'une ligne de {for} : le focus et la saisie restent, la frappe suit (${mode})`)
        assert.deepEqual(await attendent(page, ['b', 'l1', 'n', 'boite']), ['b', 'l1', 'n', 'boite'], `l'autre ligne attend toujours (${mode})`)
        // la carte qui attend dans une boîte qui attend : le focus réveille la boîte, puis la carte
        await ev(`window.__dans('n', '.u').focus()`)
        await page.keyboard.type('w')
        await page.waitForFunction(`window.__ordre.includes('boite') && window.__ordre.includes('n')`, null, { timeout: 5000 })
        await page.waitForTimeout(300)
        await page.keyboard.type('v')
        await page.waitForTimeout(100)
        assert.deepEqual([await ev('window.__focus()'), await ev(`window.__dans('n', '.u').value`)], [['n', 'u'], 'wv'], `la carte dans la boîte : le focus et la saisie restent, la frappe suit (${mode})`)
        assert.deepEqual(await attendent(page, ['b', 'l1']), ['b', 'l1'], `les cartes qu'on n'a pas touchées attendent toujours (${mode})`)
        assert.deepEqual(await ev(`window.__avertis.filter((a) => a.includes(':wake'))`), [], `aucun avertissement du réveil (${mode})`)
        assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
      }
      finally {
        await page.close()
      }
    })

    it(`${mode}, code arrivé après le premier Tab : la saisie, le curseur, le champ lié, la case, l'option, le details et la zone défilée de la page du serveur restent au réveil, la frappe suit`, async function () {
      if (!present) { this.skip(); return }
      assert.deepEqual(fait.erreurs[mode + ' ' + env], [], `le bloc render en ${mode} accepte :wake=interaction`)
      let lacher = () => {}
      const code = new Promise<void>((r) => { lacher = r })
      const { page, erreurs } = await ouvrir(mode, fait.pages[mode], code)
      const ev = (s: string) => page.evaluate(s)
      try {
        // dans la page du serveur, le code pas encore arrivé : le champ lié tapé, la case cochée, l'option choisie, le details ouvert, la
        // zone défilée, puis le premier champ tapé, son curseur entre ses deux lettres
        await ev(`window.__dans('a', '.l').focus()`)
        await page.keyboard.type('lie')
        await ev(`(() => { const d = (s) => window.__dans('a', s); d('.x').click(); d('.s').selectedIndex = 2; d('.d summary').click(); d('.z').scrollTop = 50; d('.u').focus(); })()`)
        await page.keyboard.type('zz')
        await ev(`window.__dans('a', '.u').setSelectionRange(1, 2)`)
        const avant = await ev(`window.__etat('a')`)
        assert.deepEqual(avant, ['zz', 1, 2, 'lie', '[]', true, 'trois', true, 50], `les gestes faits dans la page du serveur (${mode})`)
        lacher()
        await page.waitForFunction(`window.__ordre.includes('tot') && window.__ordre.includes('a')`, null, { timeout: 15000 })
        await page.waitForTimeout(300)
        assert.deepEqual(await ev('window.__focus()'), ['a', 'u'], `le champ garde le focus au réveil (${mode})`)
        assert.deepEqual(await ev(`window.__etat('a')`), ['zz', 1, 2, 'lie', '[lie]', true, 'trois', true, 50], `la saisie, le curseur, la case, l'option, le details et la zone restent, la variable du champ lié reçoit sa saisie (${mode})`)
        await page.keyboard.type('y')
        await page.waitForTimeout(100)
        assert.equal(await ev(`window.__dans('a', '.u').value`), 'zy', `la frappe suit, à la place du curseur (${mode})`)
        assert.deepEqual(await attendent(page, ['b']), ['b'], `l'autre carte attend toujours (${mode})`)
        assert.deepEqual(await ev(`window.__etat('b')`), VIERGE, `l'autre carte n'a rien reçu (${mode})`)
        assert.deepEqual(await ev(`window.__avertis.filter((a) => a.includes(':wake'))`), [], `aucun avertissement du réveil (${mode})`)
        assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
      }
      finally {
        lacher()
        await page.close()
      }
    })
  }

  if (env === 'dev') it('ssr, page du serveur bâtie sur une autre version de la carte : le champ atteint n\'a pas sa balise dans la vue du navigateur, la console du développement le dit', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(fait.erreurs['ssr dev'], [], 'le bloc render en ssr accepte :wake=interaction')
    const { page, erreurs } = await ouvrir('ssr', fait.pages['ssr-autre'])
    const ev = (s: string) => page.evaluate(s)
    try {
      assert.equal(await ev(`window.__dans('a', '.u').localName`), 'textarea', 'la page du serveur a une zone de texte à la place du champ')
      await page.keyboard.press('Tab')
      await page.keyboard.type('zz')
      await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      const avertis = await ev(`window.__avertis.filter((a) => a.includes(':wake'))`)
      assert.equal(avertis.length, 1, JSON.stringify(avertis))
      assert.match(avertis[0], /« :wake=interaction » sur <mjs-rs-carte> : .*page du serveur/, avertis[0])
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })
})
