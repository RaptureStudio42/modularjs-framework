// Le réveil à l'intention (`:wake=interaction`) sur une page rendue en `ssr` : ce que l'utilisateur a fait dans la page du serveur ne passe
// qu'à l'élément de même place qui est le même. Une liste que le serveur et le navigateur rendent dans un autre ordre : le bouton radio, la
// saisie, l'option choisis dans une ligne ne passent pas à la ligne de même rang d'un autre élément, et la console du développement le dit ;
// la ligne restée à sa place reçoit sa saisie. Un filtre tapé avant le réveil, puis une case cochée dans la liste qu'il rebâtit au réveil :
// la case retirée par le filtre ne reçoit rien, aucun gestionnaire n'est appelé pour elle, et la console le dit. Un curseur (`range`) qui garde
// le focus reçoit `input` puis `change` ; un champ de texte qui garde le focus reçoit `change` à sa sortie, une fois, que la frappe suive ou
// non ; des fichiers choisis passent ; un contenu modifiable (`contenteditable`) changé ne passe pas, et la console le dit. Un composant
// qu'on n'a pas touché ne reçoit aucun événement. En `ssr:positional`, `interaction` se réveille comme `view`, sans rien reporter. Dans
// Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

// la liste rendue par le serveur dans un ordre, par le navigateur dans un autre (des données triées ou filtrées autrement de chaque côté)
const SOURCES: Record<string, string> = {
  'vc-liste.mjs': `<script>
  $rep = if µserver then ['Paris', 'Lyon', 'Nice'] else ['Nice', 'Lyon', 'Paris']
  µmount ->
    (window.__ordre ||= []).push('liste')
</script>

<p class="c">Liste</p>
<div class="radios">
{for r in $rep}
  <label><input type="radio" name="rep" value={r} @change={window.__log.push('radio:' + r)}>{r}</label>
{end}
</div>
<div class="notes">
{for r in $rep}
  <input class="t" aria-label={r}>
{end}
</div>
<select class="sel" @change={window.__log.push('sel:' + e.target.value)}>
{for r in $rep}
  <option value={r}>{r}</option>
{end}
</select>
`,
  'vc-champs.mjs': `<script>
  µmount ->
    (window.__ordre ||= []).push($quoi)
</script>

<p class="c">Champs {$quoi} fin</p>
<input class="q" aria-label="q" @input={window.__log.push($quoi + ' q-input:' + e.target.value)} @change={window.__log.push($quoi + ' q-change:' + e.target.value)}>
<input class="r" type="range" min="0" max="10" value="5" aria-label="r" @input={window.__log.push($quoi + ' r-input:' + e.target.value)} @change={window.__log.push($quoi + ' r-change:' + e.target.value)}>
<input class="fi" type="file" aria-label="fi" @change={window.__log.push($quoi + ' fi-change:' + e.target.files.length)}>
<div class="ce" contenteditable="true">x</div>
<input class="cb" type="checkbox" aria-label="cb" @change={window.__log.push($quoi + ' cb-change:' + e.target.checked)}>
`,
  'vc-filtre.mjs': `<script>
  $f = ''
  $villes = ['Lyon', 'Nice', 'Paris']
  µmount ->
    (window.__ordre ||= []).push('filtre')
</script>

<p class="c">Filtre</p>
<input class="filtre" aria-label="filtre" @input={$f = e.target.value}>
<ul>
{for v in $villes.filter((x) -> x.toLowerCase().indexOf($f) >= 0)}
  <li><label><input type="checkbox" class="cb" aria-label={v} @change={window.__log.push('filtre:' + v + ':' + e.target.checked)}>{v}</label></li>
{end}
</ul>
`,
  'vc-page.mjs': `<@vc-liste :wake=interaction></@vc-liste>
<@vc-champs :wake=interaction quoi="a"></@vc-champs>
<@vc-champs :wake=interaction quoi="b"></@vc-champs>
<@vc-champs :wake=interaction quoi="c"></@vc-champs>
<@vc-filtre :wake=interaction></@vc-filtre>
`
}

const SONDE = `(() => {
  window.__ordre = window.__ordre || [];
  window.__log = [];
  window.__avertis = [];
  const avertir = console.warn;
  console.warn = function (...a) { window.__avertis.push(a.join(' ')); return avertir.apply(this, a); };
  const racine = (el) => el && (el._shadow || el.shadowRoot);
  const tous = (nom) => { const out = [], fouille = (r) => r.querySelectorAll('*').forEach((e) => { if (e.localName === nom) out.push(e); if (racine(e) && racine(e) !== e) fouille(racine(e)); }); fouille(document); return out; };
  window.__carte = (q) => q === 'liste' ? tous('mjs-vc-liste')[0] : q === 'filtre' ? tous('mjs-vc-filtre')[0] : tous('mjs-vc-champs').find((c) => racine(c) && racine(c).textContent.includes('Champs ' + q + ' fin'));
  window.__dans = (q, sel) => racine(window.__carte(q)).querySelector(sel);
  window.__tous = (q, sel) => Array.from(racine(window.__carte(q)).querySelectorAll(sel));
  window.__focus = () => { let a = document.activeElement; while (a && racine(a) && racine(a).activeElement) a = racine(a).activeElement; return a ? (a.className || a.localName) : null; };
  window.__liste = () => ({ radio: (window.__tous('liste', 'input[type=radio]').find((r) => r.checked) || {}).value || null, notes: window.__tous('liste', '.t').map((i) => i.getAttribute('aria-label') + '=' + i.value), sel: window.__dans('liste', '.sel').value });
  window.__filtre = () => window.__tous('filtre', '.cb').map((c) => c.getAttribute('aria-label') + ':' + c.checked);
  window.__wake = () => window.__avertis.filter((a) => a.includes(':wake'));
})()`

type Construit = { pages: Record<string, string>; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null
const CAS = [['ssr', 'replace', 'dev'], ['ssr', 'replace', 'prod'], ['ssr:positional', 'positional', 'dev']] as const

function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root   = mjsTmp('reveil-intention-contenu')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const pages: Record<string, string> = {}
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const [mode, rendu, env] of CAS) {
      if (!pages[mode]) {
        const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'rendu-' + rendu), bundlerOpts: { runtime: ['hydrate'] } } as any)
        try {
          const r = await renderer.renderToString('mjs-vc-page', { ssrMode: rendu } as any)
          pages[mode] = r.html + '\n' + (r.hydrateScript || '')
        }
        finally {
          await renderer.close()
        }
      }
      const dossier = join(root, 'out-' + rendu + '-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env, render: { default: mode } } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], `construction ${mode} ${env}`)
      fichiers[mode + ' ' + env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[mode + ' ' + env].set(n, readFileSync(join(dossier, n)))
    }
    return { pages, fichiers }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`le réveil à l'intention en ssr, contenu qui diffère et événements : ${nom}`, function () {
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

  // la page du serveur seule affichée tant que `code` n'est pas résolu
  async function ouvrir(mode: string, env: string, code: Promise<void>) {
    const fichiers = fait.fichiers[mode + ' ' + env]
    const contenu  = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.pages[mode]}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    const page     = await browser.newPage({ viewport: { width: 1000, height: 2000 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
    await page.addInitScript(SONDE)
    await page.route('http://intention-contenu.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: contenu }); return }
      const fichier = fichiers.get(url.pathname.slice(5))
      if (!fichier) { await route.fulfill({ status: 404, body: '' }); return }
      if (url.pathname === '/out/bundle.js') await code
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: fichier })
    })
    await page.goto('http://intention-contenu.test/page', { waitUntil: 'commit' })
    await page.waitForFunction(`!!window.__carte('filtre')`, null, { timeout: 15000 })
    await page.mouse.move(990, 1990)
    return { page, erreurs, ev: (s: string) => page.evaluate(s) }
  }

  for (const env of ['dev', 'prod'] as const) it(`ssr ${env}, liste dans un autre ordre au navigateur : le bouton radio, la saisie et l'option d'une ligne ne passent pas à la ligne d'un autre élément ; la ligne restée à sa place reçoit sa saisie`, async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const { page, erreurs, ev } = await ouvrir('ssr', env, new Promise<void>((r) => { lacher = r }))
    try {
      assert.deepEqual(await ev('window.__liste()'), { radio: null, notes: ['Paris=', 'Lyon=', 'Nice='], sel: 'Paris' }, 'la page du serveur')
      await ev(`window.__tous('liste', 'input[type=radio]')[0].click()`)
      await ev(`window.__tous('liste', '.t')[0].focus()`)
      await page.keyboard.type('P')
      await ev(`window.__tous('liste', '.t')[1].focus()`)
      await page.keyboard.type('L')
      await ev(`window.__dans('liste', '.sel').selectedIndex = 2`)
      await ev(`window.__dans('liste', '.sel').focus()`)
      lacher()
      await page.waitForFunction(`window.__ordre.includes('liste')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await ev('window.__liste()'), { radio: null, notes: ['Nice=', 'Lyon=L', 'Paris='], sel: 'Nice' }, 'rien ne passe à la ligne d\'un autre élément, la ligne Lyon reçoit sa saisie')
      assert.deepEqual(await ev('window.__log.slice()'), [], 'aucun gestionnaire appelé pour un autre élément')
      const avertis = await ev('window.__wake()')
      if (env === 'dev') {
        assert.equal(avertis.length, 1, JSON.stringify(avertis))
        assert.match(avertis[0], /« :wake=interaction » sur <mjs-vc-liste> : .*perdu/)
      }
      else assert.deepEqual(avertis, [], 'aucun texte en production')
      assert.deepEqual(erreurs, [])
    }
    finally {
      lacher()
      await page.close()
    }
  })

  it('ssr, filtre tapé puis case cochée dans la page du serveur : le filtre passe, la case qu\'il retire ne reçoit rien, aucun gestionnaire n\'est appelé pour elle, la console le dit', async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const { page, erreurs, ev } = await ouvrir('ssr', 'dev', new Promise<void>((r) => { lacher = r }))
    try {
      await ev(`window.__dans('filtre', '.filtre').focus()`)
      await page.keyboard.type('i')
      await ev(`window.__tous('filtre', '.cb')[2].click()`)
      assert.deepEqual(await ev('window.__filtre()'), ['Lyon:false', 'Nice:false', 'Paris:true'], 'la page du serveur')
      lacher()
      await page.waitForFunction(`window.__ordre.includes('filtre')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      const vue = await ev('window.__filtre()')
      assert.equal(vue.length, 2, 'le filtre est passé à la vue : ' + JSON.stringify(vue))
      const log = await ev('window.__log.slice()')
      // une case montrée cochée a son gestionnaire appelé, et lui seul
      for (const l of vue) if (l.endsWith(':true')) assert.ok(log.includes('filtre:' + l), JSON.stringify([vue, log]))
      for (const l of log) assert.ok(vue.includes(l.replace(/^filtre:/, '')), 'gestionnaire appelé pour une case que la vue ne montre pas : ' + JSON.stringify([vue, log]))
      if (!vue.includes('Paris:true')) assert.equal((await ev('window.__wake()')).length, 1, 'la case perdue est dite')
      assert.deepEqual(erreurs, [])
    }
    finally {
      lacher()
      await page.close()
    }
  })

  it('ssr, un curseur qui garde le focus reçoit input puis change ; un champ de texte qui garde le focus, change à sa sortie, une fois ; les fichiers passent ; un contenu modifiable changé est dit ; une carte qu\'on n\'a pas touchée ne reçoit rien', async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const { page, erreurs, ev } = await ouvrir('ssr', 'dev', new Promise<void>((r) => { lacher = r }))
    try {
      // carte a : fichiers, contenu modifiable, puis le curseur, qui garde le focus
      const fi = await page.evaluateHandle(`window.__dans('a', '.fi')`)
      await fi.setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
      await ev(`window.__dans('a', '.ce').focus()`)
      await page.keyboard.press('End')
      await page.keyboard.type('yz')
      await ev(`window.__dans('a', '.r').focus()`)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      // carte b : le champ de texte, focus gardé
      await ev(`window.__dans('b', '.q').focus()`)
      await page.keyboard.type('abc')
      lacher()
      await page.waitForFunction(`window.__ordre.includes('b')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.equal(await ev('window.__focus()'), 'q', 'le champ de texte garde le focus')
      assert.deepEqual(await ev('window.__log.slice()'), ['b q-input:abc'], 'le champ de texte qui garde le focus : input, pas encore change')
      await page.keyboard.type('d')
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
      assert.deepEqual((await ev('window.__log.slice()')).filter((l: string) => l.includes('q-change')), ['b q-change:abcd'], 'un seul change à la sortie, la frappe suivie')
      // carte a, réveillée par le focus : le curseur reçoit input puis change, les fichiers passent, le contenu modifiable est dit
      await ev(`window.__log.length = 0`)
      await ev(`window.__dans('a', '.r').focus()`)
      await page.waitForFunction(`window.__ordre.includes('a')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual((await ev('window.__log.slice()')).sort(), ['a fi-change:1', 'a r-change:7', 'a r-input:7'], 'le curseur : input puis change ; les fichiers : change')
      assert.equal(await ev(`window.__dans('a', '.fi').files.length`), 1, 'les fichiers choisis passent')
      assert.equal((await ev('window.__wake()')).filter((a: string) => a.includes('<mjs-vc-champs>')).length, 1, 'le contenu modifiable changé est dit')
      // carte c, jamais touchée : réveillée par le pointeur, aucun événement
      await ev(`window.__log.length = 0`)
      const box = await ev(`(() => { const r = window.__carte('c').getBoundingClientRect(); return [r.x + 10, r.y + 5]; })()`)
      await page.mouse.move(box[0], box[1])
      await page.waitForFunction(`window.__ordre.includes('c')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(await ev('window.__log.slice()'), [], 'aucun événement pour une carte qu\'on n\'a pas touchée')
      assert.deepEqual(erreurs, [])
    }
    finally {
      lacher()
      await page.close()
    }
  })

  it('ssr:positional : interaction se réveille comme view, rien de ce qui a été fait dans la page du serveur ne passe à une autre ligne, aucun événement', async function () {
    if (!present) { this.skip(); return }
    let lacher = () => {}
    const { page, erreurs, ev } = await ouvrir('ssr:positional', 'dev', new Promise<void>((r) => { lacher = r }))
    try {
      await ev(`window.__tous('liste', 'input[type=radio]')[0].click()`)
      await ev(`window.__tous('liste', '.t')[1].focus()`)
      await page.keyboard.type('L')
      await ev(`window.__dans('liste', '.sel').selectedIndex = 2`)
      lacher()
      await page.waitForFunction(`window.__ordre.includes('liste')`, null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.equal(await ev('window.__liste().radio'), null, 'aucun bouton radio coché dans une autre ligne')
      assert.deepEqual(await ev('window.__log.slice()'), [], 'aucun événement envoyé au réveil')
      assert.deepEqual(await ev('window.__wake()'), [], 'rien n\'est dit : rien ne passe en ssr:positional')
      assert.deepEqual(erreurs, [])
    }
    finally {
      lacher()
      await page.close()
    }
  })
})
