// Le réveil paresseux (`@wake=view` sur la balise d'un composant) : une page rendue par le serveur ne réveille que ce qu'on voit ; la page
// du serveur reste affichée jusque-là. Chaque occurrence attend son déclencheur, même quand la balise est déjà définie pour une autre.
// Avant son réveil, un composant est la page du serveur, comme une page qui démarre : un geste n'y est pas pris (le clic n'est pas compté,
// la touche Entrée n'envoie pas le formulaire du composant), ne réveille pas plus tôt, et rien ne l'arrête ni ne l'annule (le champ reçoit
// chaque touche, la case se coche, le navigateur envoie le formulaire du serveur) ; rien n'est rejoué au réveil. Réveillé, le composant
// répond comme sans `@wake` (Entrée annulée au keydown : aucun envoi ; touche refusée : rien d'écrit). Ce que le navigateur a écrit dans la
// page du serveur avant le réveil connaît le sort qu'il connaît au démarrage d'une page sans `@wake` (même geste fait avant l'arrivée du
// code) : un champ lié à une variable (`value=!{$x}`) garde sa saisie, que sa variable prend ; en `ssr:markers`, la vue reprend les nœuds du
// serveur, un champ sans liaison garde sa saisie et la case reste cochée ; dans les autres modes, la vue est rebâtie, leur saisie est perdue. Un parent
// paresseux se réveille avec son enfant sans `@wake` ; son enfant qui a son propre `@wake` attend le sien. Une balise retirée avant son réveil ne se réveille jamais. Sans rendu serveur, l'option ne change rien.
// Modes de rendu `ssr` (`replace`), `ssr:markers`, `ssr:positional`, `ssr:diff` et `prerender`, en développement et en production (un
// fichier par composant), dans Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { prerenderPages } from '../src/server/prerender.js'
import { playTogether } from './helpers/engines-together.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['replace', 'markers', 'positional', 'diff', 'prerender'] as const
// ce que devient, au démarrage du composant, ce que le navigateur a écrit dans sa page du serveur : [champ lié à une variable, champ sans
// liaison, case cochée] ; le champ lié garde sa saisie, que sa variable prend ; seule la vue de `ssr:markers` reprend les nœuds du serveur, où
// le champ sans liaison et la case gardent la leur
const APRES = (mode: string) => mode === 'markers' ? ['xy', 'ab', true] : ['xy', '', false]

const SOURCES: Record<string, string> = {
  'rv-carte.mjs': `<script>
  $n = 0
  $s = 0
  $nom = ''
  @plus = -> $n++
  @filtre = (e) ->
    e.key == 'Enter' and e.preventDefault()
  @bloque = (e) ->
    e.preventDefault()
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Carte {$quoi} {$n} s{$s}</p>
<button type="button" class="plus" @click=@plus>plus</button>
<input class="nom" aria-label="nom" value=!{$nom}>
<b class="echo">{$nom}</b>
<form class="f" @submit.prevent={$s++}><input class="u" aria-label="u" name="u" @keydown=@filtre></form>
<input class="k" aria-label="k" @keydown=@bloque>
<input class="x" type="checkbox" aria-label="x">
`,
  'rv-boite.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<style>
  .espace
    height: 2600px
</style>

<p class="bo">Boite</p>
<@rv-carte quoi="dedans"></@rv-carte>
<div class="espace"></div>
<@rv-carte :wake=view quoi="dedans-vue"></@rv-carte>
`,
  'rv-page.mjs': `<script>
  $rangs = ['r1', 'r2']
</script>

<style>
  .espace
    height: 2600px
</style>

<@rv-carte :wake=view quoi="vue"></@rv-carte>
<@rv-carte :wake=view quoi="tenue"></@rv-carte>
<@rv-carte quoi="tot"></@rv-carte>
<div class="espace"></div>
<@rv-carte :wake=view quoi="loin"></@rv-carte>
{for q in $rangs}
  <@rv-carte :wake=view quoi={q}></@rv-carte>
{end}
<@rv-boite :wake=view quoi="boite"></@rv-boite>
`
}

// posée avant tout script de la page : retrouve une carte par son texte (`Carte <quoi>`), dans la page puis dans la boîte, page du serveur
// ou vue neuve. Page ouverte avec `?tenir` : les rapports de la vue sur la carte `tenue` (sa balise et ce qu'elle affiche) sont retenus
// jusqu'à `window.__libere()` (la carte reste à l'écran, en attente, le temps des gestes) ; ceux des autres cartes passent
const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  if (location.search.includes('tenir')) {
    const IO = window.IntersectionObserver, tenus = [];
    let libre = false;
    const tenue = (t) => { const c = t.localName === 'mjs-rv-carte' ? t : t.getRootNode().host, r = c && (c._shadow || c.shadowRoot); return !libre && !!r && /Carte tenue /.test(r.textContent); };
    window.IntersectionObserver = function(f, o) { return new IO((l, io) => { l = l.filter((e) => !tenue(e.target) || !tenus.push([io, e.target])); if (l.length) f(l, io); }, o); };
    window.__libere = () => { libre = true; tenus.splice(0).forEach(([io, t]) => { io.unobserve(t); io.observe(t); }); };
  }
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  window.__cartes = () => {
    const page = document.querySelector('mjs-rv-page'), r = racine(page);
    if (!r) return [];
    const toutes = [...r.querySelectorAll('mjs-rv-carte')], boite = r.querySelector('mjs-rv-boite');
    if (racine(boite)) toutes.push(...racine(boite).querySelectorAll('mjs-rv-carte'));
    return toutes;
  };
  window.__carte = (q) => window.__cartes().find((c) => racine(c) && new RegExp('Carte ' + q + ' ').test(racine(c).textContent));
  window.__dans = (q, sel) => { const c = window.__carte(q); return c && racine(c).querySelector(sel); };
  window.__texte = (q) => { const c = window.__carte(q); return c ? racine(c).querySelector('.c').textContent.trim() : null; };
  window.__attend = (q) => { const c = window.__carte(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__boite = () => { const page = document.querySelector('mjs-rv-page'); return racine(page) && racine(page).querySelector('mjs-rv-boite'); };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-paresseux')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      for (const mode of ['replace', 'markers', 'positional', 'diff']) {
        const r = await renderer.renderToString('mjs-rv-page', { ssrMode: mode } as any)
        pages[mode] = r.html + '\n' + (r.hydrateScript || '')
      }
    }
    finally {
      await renderer.close()
    }
    // la page figée au build, telle que `mjs build` l'écrit (le bloc `render` du projet)
    const config: any = { sourceDir: srcDir, outputDir: join(root, 'fige'), render: { default: 'prerender', outDir: join(root, 'pages'), routes: { '/': { component: 'mjs-rv-page' } } } }
    const rapport = await prerenderPages(config, root)
    assert.deepEqual(rapport.skipped, [], 'la page est prérendue')
    pages.prerender = readFileSync(join(root, 'pages', 'index.html'), 'utf-8')
    for (const mode of MODES) assert.match(pages[mode], /<mjs-rv-carte\b[^>]*\bmjs-wake="view"/, `le serveur écrit l'attribut du réveil (${mode})`)
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
    }
    return { pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const env of ENVS) playTogether(describe(`le réveil paresseux : ${nom}, ${env}`, function () {
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
  async function ouvrir(corps: string, recherche = '', attendre = 'tot', code?: Promise<void>) {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    const vu      = { navigations: 0 }
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    page.on('framenavigated', (f: any) => { if (f === page.mainFrame()) vu.navigations++ })
    await page.addInitScript(SONDE)
    await page.route('http://reveil.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (code && url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    if (code) {
      await page.goto('http://reveil.test/page' + recherche, { waitUntil: 'commit' })
      await page.waitForFunction(`!!window.__carte(${JSON.stringify(attendre)})`, null, { timeout: 15000 })
      return { page, erreurs, vu }
    }
    await page.goto('http://reveil.test/page' + recherche, { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-rv-page') && !!customElements.get('mjs-rv-carte') && window.__ordre.includes(${JSON.stringify(attendre)})`, null, { timeout: 15000 })
    await page.waitForTimeout(400)
    return { page, erreurs, vu }
  }

  // un vrai clic de souris au centre d'un élément de la carte `q`
  async function cliquer(page: any, q: string, sel: string) {
    const r = await page.evaluate(`(() => { const b = window.__dans(${JSON.stringify(q)}, ${JSON.stringify(sel)}); const z = b.getBoundingClientRect(); return { x: z.x + z.width / 2, y: z.y + z.height / 2 } })()`)
    await page.mouse.click(r.x, r.y)
  }

  async function ordre(page: any): Promise<string[]> {
    return page.evaluate('window.__ordre.slice()')
  }

  for (const mode of MODES) it(`${mode} : avant son réveil, la carte est la page du serveur — un geste n'y est pas pris, ne la réveille pas, rien ne l'arrête ; réveillée, elle répond comme sans @wake`, async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs, vu } = await ouvrir(fait.pages[mode], '?tenir')
    const ev = (s: string) => page.evaluate(s)
    try {
      // au démarrage : la carte vue et la carte sans @wake sont réveillées ; la carte `tenue` (sa vue retenue), celles du bas et la boîte
      // attendent, la page du serveur affichée
      const debut = await ordre(page)
      assert.deepEqual([...debut].sort(), ['tot', 'vue'], `cartes réveillées au démarrage (${mode}) : ${JSON.stringify(debut)}`)
      for (const q of ['tenue', 'loin', 'r1', 'r2']) {
        assert.ok(await ev(`window.__attend(${JSON.stringify(q)})`), `la carte ${q} attend son réveil (${mode})`)
        assert.equal(await ev(`window.__texte(${JSON.stringify(q)})`), `Carte ${q} 0 s0`, `la page du serveur de la carte ${q} reste affichée (${mode})`)
      }
      assert.ok(await ev(`window.__boite().hasAttribute('mjs-wake')`), `la boîte attend son réveil (${mode})`)
      await cliquer(page, 'vue', '.plus')
      await page.waitForFunction(`window.__texte('vue') === 'Carte vue 1 s0'`, null, { timeout: 5000 })
      // ce qui atteint le champ `.k` et le formulaire de la carte qui attend, et si quelqu'un l'a annulé (`!`, relevé une fois l'événement
      // passé par tous ses écouteurs) ; le test retient l'envoi du navigateur pour rester sur la page
      await ev(`(() => { const vus = []; window.__seenMark = () => vus.map((e) => e.type === 'keydown' ? e.key + (e.defaultPrevented ? '!' : '') : e.key); window.__dans('tenue', '.k').addEventListener('keydown', (e) => vus.push(e)); window.__dans('tenue', '.f').addEventListener('submit', (e) => { vus.push({ key: 'submit' + (e.defaultPrevented ? '!' : '') }); e.preventDefault(); }); })()`)
      // de vrais gestes sur la carte qui attend : un clic sur son bouton, une saisie, une touche que le composant refuserait, la case, Entrée
      // dans son formulaire ; un focus donné à une carte hors de l'écran
      await cliquer(page, 'tenue', '.plus')
      await cliquer(page, 'tenue', '.nom')
      await page.keyboard.type('xy')
      await cliquer(page, 'tenue', '.k')
      await page.keyboard.type('ab')
      await cliquer(page, 'tenue', '.x')
      await cliquer(page, 'tenue', '.u')
      await page.keyboard.press('Enter')
      await ev(`window.__dans('loin', '.plus').focus({ preventScroll: true })`)
      await page.waitForTimeout(400)
      assert.deepEqual([...await ordre(page)].sort(), ['tot', 'vue'], `aucun geste ne réveille (${mode})`)
      assert.ok(await ev(`window.__attend('tenue') && window.__attend('loin')`), `les cartes attendent toujours (${mode})`)
      assert.equal(await ev(`window.__texte('tenue')`), 'Carte tenue 0 s0', `le clic et Entrée ne sont pas pris (${mode})`)
      assert.deepEqual(await ev('window.__seenMark()'), ['a', 'b', 'submit'], `chaque touche atteint le champ, l'envoi du navigateur part, rien n'est annulé (${mode})`)
      assert.deepEqual(await ev(`[window.__dans('tenue', '.nom').value, window.__dans('tenue', '.k').value, window.__dans('tenue', '.x').checked]`), ['xy', 'ab', true], `la page du serveur garde ce que le navigateur y écrit (${mode})`)
      // la vue rapportée : la carte se réveille, rien n'est rejoué
      await ev('window.__libere()')
      await page.waitForFunction(`window.__ordre.includes('tenue')`, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      const repris = mode === 'markers'
      assert.equal(await ev(`window.__texte('tenue')`), 'Carte tenue 0 s0', `rien n'est rejoué au réveil (${mode})`)
      assert.deepEqual(await ev(`[window.__dans('tenue', '.nom').value, window.__dans('tenue', '.k').value, window.__dans('tenue', '.x').checked]`), APRES(mode), `la saisie connaît le sort du démarrage d'une page (${mode})`)
      // réveillée, elle répond comme sans @wake : Entrée annulée au keydown n'envoie rien, la touche refusée n'est pas écrite, le clic compte,
      // la liaison lit le champ
      const avant = await ev(`window.__dans('tenue', '.k').value`)
      await cliquer(page, 'tenue', '.u')
      await page.keyboard.press('Enter')
      await cliquer(page, 'tenue', '.k')
      await page.keyboard.type('cd')
      await cliquer(page, 'tenue', '.plus')
      await cliquer(page, 'tenue', '.nom')
      await page.keyboard.press('End')
      await page.keyboard.type('z')
      await page.waitForTimeout(300)
      assert.equal(await ev(`window.__texte('tenue')`), 'Carte tenue 1 s0', `réveillée : le clic compte une fois, Entrée annulée n'envoie rien (${mode})`)
      assert.equal(await ev(`window.__dans('tenue', '.k').value`), avant, `réveillée : la touche refusée n'est pas écrite (${mode})`)
      assert.equal(await ev(`window.__dans('tenue', '.echo').textContent`), 'xyz', `réveillée : la liaison lit le champ, sa saisie d'avant le réveil comprise (${mode})`)
      assert.deepEqual(await ev('window.__seenMark()'), repris ? ['a', 'b', 'submit', 'c!', 'd!'] : ['a', 'b', 'submit'], `réveillée : aucun envoi (${mode})`)
      assert.equal(vu.navigations, 1, `aucune navigation (${mode})`)
      assert.ok(await ev(`window.__attend('loin')`), `le focus donné à la carte du bas ne l'a pas réveillée (${mode})`)
      // la carte du bas se réveille quand elle paraît, la boîte aussi, avec son enfant sans @wake ; son enfant paresseux attend le sien
      await ev(`window.__carte('loin').scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('loin')`, null, { timeout: 5000 })
      await ev(`window.__boite().scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('dedans')`, null, { timeout: 5000 })
      await page.waitForTimeout(200)
      const fin = await ordre(page)
      assert.ok(fin.includes('boite') && fin.includes('dedans'), `la boîte et son enfant se réveillent ensemble (${mode}) : ${JSON.stringify(fin)}`)
      assert.ok(!fin.includes('dedans-vue') && await ev(`window.__attend('dedans-vue')`), `l'enfant paresseux de la boîte attend le sien (${mode}) : ${JSON.stringify(fin)}`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : le témoin, une page sans @wake qui démarre — la même saisie faite avant l'arrivée du code connaît le même sort`, async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const code = new Promise<void>((r) => { lacher = r })
    const { page, erreurs } = await ouvrir(fait.pages[mode], '', 'tot', code)
    try {
      await cliquer(page, 'tot', '.nom')
      await page.keyboard.type('xy')
      await cliquer(page, 'tot', '.k')
      await page.keyboard.type('ab')
      await cliquer(page, 'tot', '.x')
      assert.deepEqual(await page.evaluate(`[window.__dans('tot', '.nom').value, window.__dans('tot', '.k').value, window.__dans('tot', '.x').checked]`), ['xy', 'ab', true], `la page du serveur reçoit la saisie (${mode})`)
      lacher()
      await page.waitForFunction(`window.__ordre.includes('tot')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate(`[window.__dans('tot', '.nom').value, window.__dans('tot', '.k').value, window.__dans('tot', '.x').checked]`), APRES(mode), `au démarrage, la saisie connaît le même sort qu'au réveil (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      lacher()
      await page.close()
    }
  })

  it('une valeur autre que view et interaction, écrite à la main dans la page du serveur, se réveille au démarrage ; une carte retirée avant son réveil ne se réveille jamais, et ne garde rien', async function () {
    if (!present) { this.skip(); return }
    // la carte `tenue` porte `mjs-wake="survol"` (sa vue retenue : seul le démarrage peut la réveiller)
    const corps = fait.pages.replace.replace(/<mjs-rv-carte\b[^>]*>/g, (t) => t.includes('tenue') ? t.replace('mjs-wake="view"', 'mjs-wake="survol"') : t)
    assert.ok(corps.includes('mjs-wake="survol"'), 'la page du serveur porte la valeur écrite à la main')
    const { page, erreurs } = await ouvrir(corps, '?tenir')
    try {
      assert.ok((await ordre(page)).includes('tenue') && !(await page.evaluate(`window.__attend('tenue')`)), 'la valeur inconnue se réveille au démarrage, comme sans @wake')
      await page.evaluate(`window.__retiree = window.__carte('loin'); window.__retiree.remove()`)
      await page.evaluate(`window.__boite().scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('boite')`, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      assert.ok(!(await ordre(page)).includes('loin'), 'la carte retirée ne s\'est pas réveillée')
      assert.ok(await page.evaluate(`window.__retiree.hasAttribute('mjs-wake') && !window.__retiree.isConnected`), 'elle attend toujours, hors de la page')
      if (env === 'dev') assert.equal(await page.evaluate(`window.__retiree._mjs_wakeArmed`), false, 'son déclencheur est retiré')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })

  it('sans rendu serveur, l\'option ne change rien : toutes les cartes se construisent tout de suite', async function () {
    if (!present) { this.skip(); return }
    const { page, erreurs } = await ouvrir('<mjs-rv-page></mjs-rv-page>', '', 'dedans-vue')
    try {
      assert.deepEqual([...await ordre(page)].sort(), ['boite', 'dedans', 'dedans-vue', 'loin', 'r1', 'r2', 'tenue', 'tot', 'vue'])
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    }
    finally {
      await page.close()
    }
  })
}))
