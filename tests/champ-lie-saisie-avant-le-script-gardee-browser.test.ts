// Ce que le visiteur tape dans la page du serveur avant que le script démarre le composant (le code de la page pas encore arrivé, ou un
// composant `:wake=view` qui attend de paraître) n'est pas perdu : chaque champ lié à une variable (champ de texte, zone de texte, case, groupe
// de boutons radio, liste) dont la valeur n'est plus celle que le serveur a écrite la donne à sa variable, et l'écran la garde. Aucun
// événement n'est envoyé aux gestionnaires de l'appli (`input`, `change`) : seule la variable change, ce qui la lit suit. Une page où
// personne n'a rien tapé démarre comme avant : aucune écriture de variable, aucun rendu de plus (le reffet qui lit les cinq variables ne
// tourne qu'une fois). Modes de rendu `ssr` (`replace`), `ssr:markers`, `ssr:positional`, `ssr:diff` et `prerender`, en développement et en
// production (un fichier par composant), dans Chromium et Firefox. Une liste dont la variable ne vaut aucune de ses options montre la
// première option, un choix du navigateur : sa variable n'est pas écrite, même quand le visiteur choisit cette première option (rien ne la
// distingue alors d'une liste intacte) ; une autre option choisie passe à la variable. Un groupe de cases ou de boutons radio lié sans
// `name` écrit par l'auteur (le nom du groupe est posé par le framework) garde sa saisie comme les autres. Cette exception ne vaut que pour
// une liste déroulante : une boîte de liste (`size`) ou une liste `multiple` ne montre aucune option choisie d'avance, et la première option
// qu'y choisit le visiteur passe à la variable. Avec `:wake=interaction`, le choix d'un groupe de radios sans `name` passe à la vue au réveil.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { prerenderPages } from '../src/server/prerender.js'

const ENVS  = ['dev', 'prod'] as const
const MODES = ['replace', 'markers', 'positional', 'diff', 'prerender'] as const
// [texte, zone, case, radio coché, liste, écho des cinq variables, case a du groupe, case b du groupe, radio du groupe sans nom, écho de la
// liste sans option écrite, du groupe de cases et du groupe de radios]
// … puis l'écho de la boîte de liste et de la liste multiple
const TAPE   = ['xy', 'zz', true, 'b', 'trois', 'xy|zz|true|b|trois', false, true, 'q', 'deux|b|q', 'un|un']
const VUE    = [...TAPE.slice(0, 9), '|b|q', 'un|un']
const DEPART = ['', '', false, 'a', 'un', '||false|a|un', true, false, 'p', '|a|p', '|']

const SOURCES: Record<string, string> = {
  'sa-champs.mjs': `<script>
  $texte = ''
  $zone = ''
  $case = false
  $choix = 'a'
  $liste = 'un'
  $sans = ''
  $cases = ['a']
  $r2 = 'p'
  $boite = ''
  $plusieurs = []
  @vu = (e) -> (window.__evts ||= []).push($quoi + ' ' + e.type)
  µeffect ->
    lus = [$texte, $zone, $case, $choix, $liste, $sans, $cases.join(','), $r2, $boite, $plusieurs.join(',')]
    window.__effets ||= {}
    window.__effets[$quoi] = (window.__effets[$quoi] or 0) + 1
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Champs {$quoi}</p>
<input class="texte" aria-label="texte" value=!{$texte} @input=@vu>
<textarea class="zone" aria-label="zone" value=!{$zone}></textarea>
<input class="case" type="checkbox" aria-label="case" checked=!{$case} @change=@vu>
<input class="ra" type="radio" name="choix" value="a" aria-label="a" :group=!{$choix}>
<input class="rb" type="radio" name="choix" value="b" aria-label="b" :group=!{$choix}>
<select class="liste" aria-label="liste" value=!{$liste}><option value="un">un</option><option value="deux">deux</option><option value="trois">trois</option></select>
<p class="echo">{$texte}|{$zone}|{$case}|{$choix}|{$liste}</p>
<select class="sans" aria-label="sans" value=!{$sans}><option value="un">un</option><option value="deux">deux</option></select>
<input type="checkbox" class="ca" aria-label="ca" value="a" :group=!{$cases}>
<input type="checkbox" class="cb" aria-label="cb" value="b" :group=!{$cases}>
<input type="radio" class="gp" aria-label="gp" value="p" :group=!{$r2}>
<input type="radio" class="gq" aria-label="gq" value="q" :group=!{$r2}>
<p class="echo2">{$sans}|{$cases.join(',')}|{$r2}</p>
<select class="boite" size="3" aria-label="boite" value=!{$boite}><option value="un">un</option><option value="deux">deux</option><option value="trois">trois</option></select>
<select class="plusieurs" multiple aria-label="plusieurs" value=!{$plusieurs}><option value="un">un</option><option value="deux">deux</option></select>
<p class="echo3">{$boite}|{$plusieurs.join(',')}</p>
`,
  'sa-page.mjs': `<style>
  .espace
    height: 2600px
</style>

<@sa-champs quoi="tot"></@sa-champs>
<div class="espace"></div>
<@sa-champs :wake=view quoi="vue"></@sa-champs>
<div class="espace"></div>
<@sa-champs :wake=interaction quoi="geste"></@sa-champs>
`
}

// posée avant tout script de la page : retrouve un composant par son texte (`Champs <quoi>`), page du serveur ou vue neuve, et lit ses champs
const SONDE = `(() => {
  window.__ordre = [];
  window.__effets = {};
  window.__evts = [];
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  window.__carte = (q) => { const r = racine(document.querySelector('mjs-sa-page')); return r && [...r.querySelectorAll('mjs-sa-champs')].find((c) => racine(c) && new RegExp('Champs ' + q + '$').test(racine(c).querySelector('.c')?.textContent.trim() || '')); };
  window.__attend = (q) => { const c = window.__carte(q); return !!c && c.hasAttribute('mjs-wake'); };
  window.__etat = (q) => { const r = racine(window.__carte(q)), d = (s) => r.querySelector(s); return [d('.texte').value, d('.zone').value, d('.case').checked, d('.rb').checked ? 'b' : d('.ra').checked ? 'a' : '', d('.liste').value, d('.echo').textContent, d('.ca').checked, d('.cb').checked, d('.gq').checked ? 'q' : d('.gp').checked ? 'p' : '', d('.echo2').textContent, d('.echo3').textContent]; };
  window.__taper = (q) => { const r = racine(window.__carte(q)), d = (s) => r.querySelector(s); d('.texte').value = 'xy'; d('.zone').value = 'zz'; d('.case').checked = true; d('.rb').checked = true; d('.liste').value = 'trois'; d('.sans').value = 'un'; d('.ca').checked = false; d('.cb').checked = true; d('.gq').checked = true; d('.boite').options[0].selected = true; d('.plusieurs').options[0].selected = true; };
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('saisie-avant-le-script')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      for (const mode of ['replace', 'markers', 'positional', 'diff']) {
        const r = await renderer.renderToString('mjs-sa-page', { ssrMode: mode } as any)
        pages[mode] = r.html + '\n' + (r.hydrateScript || '')
      }
    }
    finally {
      await renderer.close()
    }
    // la page figée au build, telle que `mjs build` l'écrit (le bloc `render` du projet)
    const config: any = { sourceDir: srcDir, outputDir: join(root, 'fige'), render: { default: 'prerender', outDir: join(root, 'pages'), routes: { '/': { component: 'mjs-sa-page' } } } }
    const rapport = await prerenderPages(config, root)
    assert.deepEqual(rapport.skipped, [], 'la page est prérendue')
    pages.prerender = readFileSync(join(root, 'pages', 'index.html'), 'utf-8')
    for (const mode of MODES) assert.match(pages[mode], /<mjs-sa-champs\b[^>]*\bmjs-wake="view"/, `le serveur écrit l'attribut du réveil (${mode})`)
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

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) describe(`la saisie faite avant le démarrage d'un champ lié : ${nom}, ${env}`, function () {
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
  async function ouvrir(corps: string, code?: Promise<void>) {
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page    = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await page.addInitScript(SONDE)
    await page.route('http://saisie.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fait.fichiers[env].get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (code && url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    if (code) {
      await page.goto('http://saisie.test/page', { waitUntil: 'commit' })
      await page.waitForFunction(`!!window.__carte('tot')`, null, { timeout: 15000 })
      return { page, erreurs }
    }
    await page.goto('http://saisie.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`!!customElements.get('mjs-sa-page') && !!customElements.get('mjs-sa-champs') && window.__ordre.includes('tot')`, null, { timeout: 15000 })
    await page.waitForTimeout(300)
    return { page, erreurs }
  }

  for (const mode of MODES) it(`${mode} : tapé avant l'arrivée du code, chaque champ lié garde sa saisie et sa variable la prend, sans événement`, async function () {
    if (!present) this.skip()
    let lacher!: () => void
    const code = new Promise<void>((r) => { lacher = r })
    const { page, erreurs } = await ouvrir(fait.pages[mode], code)
    try {
      // de vrais gestes, dans la page du serveur, avant le code
      await page.locator('mjs-sa-champs .texte').first().fill('xy')
      await page.locator('mjs-sa-champs .zone').first().fill('zz')
      await page.locator('mjs-sa-champs .case').first().check()
      await page.locator('mjs-sa-champs .rb').first().check()
      await page.locator('mjs-sa-champs .liste').first().selectOption('trois')
      await page.locator('mjs-sa-champs .sans').first().selectOption('deux')
      await page.locator('mjs-sa-champs .ca').first().uncheck()
      await page.locator('mjs-sa-champs .cb').first().check()
      await page.locator('mjs-sa-champs .gq').first().check()
      await page.locator('mjs-sa-champs .boite').first().selectOption('un')
      await page.locator('mjs-sa-champs .plusieurs').first().selectOption(['un'])
      assert.deepEqual(await page.evaluate(`window.__etat('tot')`), [...TAPE.slice(0, 5), '||false|a|un', ...TAPE.slice(6, 9), '|a|p', '|'], `la page du serveur reçoit la saisie (${mode})`)
      lacher()
      await page.waitForFunction(`window.__ordre.includes('tot')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate(`window.__etat('tot')`), TAPE, `au démarrage, l'écran garde la saisie et l'écho la lit dans les variables (${mode})`)
      assert.deepEqual(await page.evaluate('window.__evts'), [], `aucun événement envoyé aux gestionnaires de l'appli (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : tapé dans un composant :wake=view qui attend, la saisie passe à ses variables à son réveil`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      assert.ok(await page.evaluate(`window.__attend('vue')`), `le composant du bas attend son réveil (${mode})`)
      await page.evaluate(`window.__taper('vue')`)
      await page.evaluate(`window.__carte('vue').scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('vue')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate(`window.__etat('vue')`), VUE, `réveillé, l'écran garde la saisie et l'écho la lit dans les variables ; la première option de la liste sans option écrite, choisie, n'écrit rien (${mode})`)
      assert.deepEqual(await page.evaluate('window.__evts'), [], `aucun événement envoyé aux gestionnaires de l'appli (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  for (const mode of ['replace', 'markers', 'prerender'] as const) it(`${mode} : :wake=interaction, le choix d'un groupe de radios sans name, fait avant le réveil, passe à la vue`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      await page.evaluate(`window.__carte('geste').scrollIntoView({ block: 'center' })`)
      await page.waitForTimeout(200)
      assert.ok(await page.evaluate(`window.__attend('geste')`), `le composant attend le signe d'intention (${mode})`)
      await page.evaluate(`window.__taper('geste')`)
      // le pointeur entre dans le composant (sa place lue dans la page : une vue rebâtie par le client a une racine d'ombre fermée)
      const r = await page.evaluate(`(() => { const z = window.__carte('geste').getBoundingClientRect(); return { x: z.x + z.width / 2, y: z.y + 10 } })()`)
      await page.mouse.move(r.x, r.y)
      await page.waitForFunction(`window.__ordre.includes('geste')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      const etat = await page.evaluate(`window.__etat('geste')`)
      assert.deepEqual([etat[8], etat[9].split('|')[2]], ['q', 'q'], `réveillé, le radio choisi l'est encore et sa variable le dit (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })

  for (const mode of MODES) it(`${mode} : le témoin, une page où rien n'est tapé — aucune écriture de variable, aucun rendu de plus`, async function () {
    if (!present) this.skip()
    const { page, erreurs } = await ouvrir(fait.pages[mode])
    try {
      assert.deepEqual(await page.evaluate(`window.__etat('tot')`), DEPART, `les champs montrent les valeurs de départ (${mode})`)
      await page.evaluate(`window.__carte('vue').scrollIntoView()`)
      await page.waitForFunction(`window.__ordre.includes('vue')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await page.evaluate(`window.__etat('vue')`), DEPART, `réveillé, rien ne change (${mode})`)
      assert.deepEqual(await page.evaluate('window.__effets'), { tot: 1, vue: 1 }, `le reffet qui lit les cinq variables ne tourne qu'une fois par composant (${mode})`)
      assert.deepEqual(await page.evaluate('window.__evts'), [], `aucun événement (${mode})`)
      assert.deepEqual(erreurs, [], `aucune erreur dans la page (${mode})`)
    }
    finally {
      await page.close()
    }
  })
})
