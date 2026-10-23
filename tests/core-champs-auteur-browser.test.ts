// Les modules du cœur qui écrivent un champ caché dans leur balise (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>,
// <@@knob>, <@@select>) ne reprennent que le champ que le serveur a écrit pour eux : il porte l'attribut `mjs-f`, que le serveur seul écrit
// (le navigateur n'en marque aucun, il garde la référence du champ qu'il crée). Un champ caché que la page pose dans leur balise, sous le même nom, reste en place et part avec le formulaire,
// à côté du leur : c'est la forme d'un formulaire Rails, où la case est précédée d'un champ caché de valeur « 0 ».
// Dans une page en rendu client pur ET dans une page rendue par le serveur puis hydratée (quatre modes de reprise), en développement comme
// avec un vrai build de production (deux ordres d'arrivée des morceaux ; le serveur rend alors avec ce même build), dans Chromium et Firefox réels :
// - au départ, après de vrais gestes et après `form.reset()` (qui rend chaque module à son état de départ, la jauge et le bouton rotatif compris),
//   `new FormData(form)` porte le champ de la page puis celui du module ; un vrai envoi aussi ;
// - le navigateur n'écrit jamais l'état d'un module dans sa balise (`checked`, `value`, `group`) : ces attributs restent ce que la page ou le
//   serveur a écrit, avant comme après les gestes (le serveur seul les écrit, pour qu'un module chargé avant la page parte du bon état).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const MODES  = ['markers', 'replace', 'positional', 'diff'] as const
const ORDRES = ['la page d\'abord', 'les modules d\'abord'] as const

// un seul formulaire : chaque module porte un champ caché de la page, sous son propre nom (le radio `g` le porte dans son premier bouton)
const HOTE = `<script>
  $r = 'a'
</script>

<form class="f-auteur" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}><input type="hidden" name="cb" value="a-cb">case</@@checkbox>
  <@@switch class="sw" name="sw" checked={true}><input type="hidden" name="sw" value="a-sw">interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked><input type="hidden" name="g" value="a-g">x</@@radio>
  <@@radio class="r2" name="g" value="y">y</@@radio>
  <@@radio class="g1" name="h" value="a" group=!{$r}>a</@@radio>
  <@@radio class="g2" name="h" value="b" group=!{$r}>b</@@radio>
  <@@number class="n" name="n" value="3"><input type="hidden" name="n" value="a-n"></@@number>
  <@@gauge class="gg" name="gg" value="4"><input type="hidden" name="gg" value="a-gg"></@@gauge>
  <@@knob class="k" name="k" value="30"><input type="hidden" name="k" value="a-k"></@@knob>
  <@@select class="s" name="s" value="b"><input type="hidden" name="s" value="a-s"><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>
  <@@select class="m" name="m" multiple value={['a', 'c']}><input type="hidden" name="m" value="a-m"><@@option value="a">A</@@option><@@option value="b">B</@@option><@@option value="c">C</@@option></@@select>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-gauge, mjs-core-knob, mjs-core-select'

type Etat = { cb: boolean; sw: boolean; g: string; h: string; n: number; gg: number; k: number; s: string; m: string[] }

const depart = (): Etat => ({ cb: true, sw: true, g: 'x', h: 'a', n: 3, gg: 4, k: 30, s: 'b', m: ['a', 'c'] })

// ce que le formulaire DOIT envoyer pour un état : le champ de la page d'abord, puis celui du module
const formulaire = (e: Etat): string[] => [
  'cb=a-cb', ...(e.cb ? ['cb=on'] : []),
  'sw=a-sw', ...(e.sw ? ['sw=on'] : []),
  'g=a-g', 'g=' + e.g,
  'h=' + e.h,
  'n=a-n', 'n=' + e.n,
  'gg=a-gg', 'gg=' + e.gg,
  'k=a-k', 'k=' + e.k,
  's=a-s', 's=' + e.s,
  'm=a-m', ...e.m.map((v) => 'm=' + v)
]

// chaque geste de l'utilisateur et ce qu'il change à l'état
const GESTES: Array<[string, (e: Etat) => void]> = [
  ['cb', (e) => { e.cb = !e.cb }],
  ['cb', (e) => { e.cb = !e.cb }],
  ['cb', (e) => { e.cb = !e.cb }],
  ['sw', (e) => { e.sw = !e.sw }],
  ['sw', (e) => { e.sw = !e.sw }],
  ['sw', (e) => { e.sw = !e.sw }],
  ['r2', (e) => { e.g = 'y' }],
  ['g2', (e) => { e.h = 'b' }],
  ['n', (e) => { e.n++ }],
  ['gg', (e) => { e.gg++ }],
  ['k', (e) => { e.k++ }],
  ['s', (e) => { e.s = 'a' }],
  ['m', (e) => { e.m = ['a', 'c', 'b'] }]
]

// la pièce visible sur laquelle on clique, pour chaque geste
const PIECE: Record<string, [string, string]> = { cb: ['cb', '.box'], sw: ['sw', '.pill'], r2: ['r2', '.ring'], g2: ['g2', '.ring'], n: ['n', 'button.step.more'], gg: ['gg', 'button.btn'] }

// les attributs d'état que porte la balise de chaque module (null : absent)
const ATTRIBUTS = `window.__attributs = () => Array.from(__q('.f-auteur').querySelectorAll('${MODULES}')).map((m) => m.classList[0] + ' ' + ['checked', 'value', 'group'].map((a) => a + '=' + m.getAttribute(a)).join(' '))`

// en rendu client pur, la balise ne porte que ce que la page a écrit en dur : `checked`, `value="…"`, jamais l'état posé par expression ou lié
const ATTRIBUTS_CLIENT = [
  'cb checked=null value=null group=null',
  'sw checked=null value=null group=null',
  'r1 checked=true value=x group=null',
  'r2 checked=null value=y group=null',
  'g1 checked=null value=a group=null',
  'g2 checked=null value=b group=null',
  'n checked=null value=3 group=null',
  'gg checked=null value=4 group=null',
  'k checked=null value=30 group=null',
  's checked=null value=b group=null',
  'm checked=null value=null group=null'
]

type Scenario = { build: 'dev' | 'prod'; client: boolean; mode: string; ordre: typeof ORDRES[number]; nom: string }

const SCENARIOS: Scenario[] = []
for (const build of ['dev', 'prod'] as const) {
  const quand = build === 'dev' ? 'développement' : 'production'
  SCENARIOS.push({ build, client: true, mode: '', ordre: ORDRES[0], nom: `${quand}, rendu client pur` })
  for (const ordre of build === 'prod' ? ORDRES : [ORDRES[0]]) for (const mode of MODES) {
    SCENARIOS.push({ build, client: false, mode, ordre, nom: `${quand}, hydratation « ${mode} »` + (build === 'prod' ? `, ${ordre}` : '') })
  }
}

type Rendu = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Record<'dev' | 'prod', Rendu>; dev: string; fichiers: Map<string, Buffer>; total: number }
let construit: Promise<Construit> | null = null

// le rendu serveur dans chaque mode, le script de développement et le build de production, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('champs-auteur')
    const srcDir  = join(root, 'src')
    const devDir  = join(root, 'dev')
    const prodDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const compilateur = await createSSRRenderer({ sourceDir: srcDir, outputDir: devDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    await compilateur.renderToString('mjs-hote-ssr', { ssrMode: 'replace' } as any)
    await compilateur.close()
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(devDir, f), 'utf-8'))).join('\n')
    const dev    = stripEsm(readFileSync(join(devDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres
    // sans dossier de sortie à lui, le rendu écrit ses feuilles partagées en ligne (jamais en `<link>`) : la racine de la page ne commence que par les nœuds de sa vue ;
    // un site en production rend sur le serveur avec le build de production : ce que ce build retire du code d'un module ne se trouve alors ni dans le HTML, ni dans le navigateur
    const rendus: Record<'dev' | 'prod', Rendu> = { dev: {}, prod: {} }
    for (const build of ['dev', 'prod'] as const) {
      const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'], ...(build === 'prod' ? { env: 'prod' } : {}) } } as any)
      for (const mode of MODES) {
        const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
        rendus[build][mode] = { html, hydrateScript }
      }
      await renderer.close()
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(prodDir, f)))
    assert.ok(fichiers.has('bundle.js') && [...fichiers.keys()].some((f) => /^core-radio-/.test(f)), 'le build de production sépare un morceau par module')
    const total = (rendus.dev.markers.html.match(/<mjs-core-(checkbox|switch|radio|number|gauge|knob|select)[ >]/g) ?? []).length
    return { rendus, dev, fichiers, total }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox'] as const) describe(`modules à champ caché : le champ de la page dans leur balise est gardé (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let ordre: typeof ORDRES[number] = ORDRES[0]
  let fait: Construit
  const envois: string[]  = []
  const erreurs: string[] = []

  const attendre   = (ms = 150) => page.waitForTimeout(ms)
  const champs     = (): Promise<string[]> => page.evaluate(`Array.from(new FormData(__q('.f-auteur'))).map((p) => p[0] + '=' + p[1])`)
  const attributs  = (): Promise<string[]> => page.evaluate('__attributs()')

  // le centre d'une pièce visible d'un module (la case, la pastille, l'anneau, le bouton « + », la liste), pour de vrais clics
  async function cliquer(cls: string, piece: string, rang = 0) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('.${cls}')._shadow.querySelectorAll('${piece}')[${rang}]
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  async function cliquerBouton(cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('.${cls}')
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
  }

  // un geste de l'utilisateur : un clic sur la pièce du module, la flèche haute du bouton rotatif (vraie touche) ou un choix dans une liste (la liste restée ouverte est refermée d'un clic à côté)
  async function geste(nomGeste: string) {
    if (nomGeste === 'k') {
      await page.evaluate(`__q('.k')._shadow.querySelector('.knob').focus()`)
      await page.keyboard.press('ArrowUp')
      await attendre()
    } else if (nomGeste === 's' || nomGeste === 'm') {
      await cliquer(nomGeste, '.select-btn')
      await cliquer(nomGeste, '.select-option', nomGeste === 's' ? 0 : 1)
      await page.mouse.click(2, 2)
      await attendre()
    } else {
      const [cls, piece] = PIECE[nomGeste]
      await cliquer(cls, piece)
    }
  }

  // la page dans ce scénario (rendu client pur : la balise de la page seule ; sinon le HTML du serveur dans ce mode), puis l'attente que les modules soient montés
  async function charger(sc: Scenario) {
    ordre = sc.ordre
    const pre    = `<script>(function () { document.querySelector('mjs-hote-ssr').shadowRoot.querySelectorAll('form').forEach(function (f) { f.__srv = true }) })()</script>`
    const corps  = sc.client ? '<mjs-hote-ssr></mjs-hote-ssr>' : `${fait.rendus[sc.build][sc.mode].html}\n${pre}\n${fait.rendus[sc.build][sc.mode].hydrateScript}`
    const script = sc.build === 'dev' ? `<script>${fait.dev}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}\n${script}</body></html>`
    await page.goto('http://champs.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
      return m.length === ${fait.total} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.evaluate(ATTRIBUTS)
    await page.waitForTimeout(400)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      fait    = await construire()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
      await page.route('http://champs.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/envoi') {
          envois.push(url.pathname + url.search)
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
          return
        }
        if (url.pathname.startsWith('/out/')) {
          const f = url.pathname.slice(5)
          let corps = fait.fichiers.get(f)
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          // « les modules d'abord » : avant de lancer le chargeur, le manifeste évalue le morceau de chaque module du cœur, l'un après l'autre
          if (f === 'bundle.js' && ordre === ORDRES[1]) {
            const texte = corps.toString('utf-8')
            const lance = 'if (µ.Autoloader) {'
            assert.ok(texte.includes(lance), 'le manifeste lance le chargeur à cet endroit')
            corps = Buffer.from(texte.replace(lance, 'for (const n of Object.keys(µPaths).filter((k) => k.startsWith(\'core-\'))) { await import(µPathsPrefix + µPaths[n]); }\n  ' + lance), 'utf-8')
          }
          await route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const sc of SCENARIOS) describe(sc.nom, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      envois.length  = 0
      erreurs.length = 0
      await charger(sc)
    })

    it('la page est reprise dans le mode demandé, sans erreur ; le formulaire porte le champ de la page puis celui de chaque module', async function () {
      if (!present) { this.skip(); return }
      const reprise = await page.evaluate(`document.querySelector('mjs-hote-ssr')._shadow.querySelector('form').__srv === true`)
      assert.equal(reprise, !sc.client && sc.mode !== 'replace', 'le mode demandé est celui qui a joué : les nœuds du serveur sont repris, sauf en « replace » et en rendu client pur')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      assert.deepEqual(await champs(), formulaire(depart()), 'FormData au départ')
    })

    it('de vrais gestes puis form.reset() : le champ de la page reste à sa place, celui du module suit l\'état', async function () {
      if (!present) { this.skip(); return }
      const etat = depart()
      for (const [nomGeste, change] of GESTES) {
        await geste(nomGeste)
        change(etat)
        assert.deepEqual(await champs(), formulaire(etat), `FormData après un geste sur « ${nomGeste} »`)
      }
      await cliquerBouton('rz')
      await attendre(400)
      // tous reviennent à leur état de départ, la jauge (4) et le bouton rotatif (30) comme les autres
      assert.deepEqual(await champs(), formulaire(depart()), 'FormData après la remise à zéro')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    })

    it('un vrai envoi du formulaire porte le champ de la page et celui du module, au départ puis après des gestes', async function () {
      if (!present) { this.skip(); return }
      await cliquerBouton('go')
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['/envoi?' + formulaire(depart()).join('&')], 'envoi sans geste')
      await charger(sc)
      envois.length = 0
      const etat = depart()
      for (const [nomGeste, change] of GESTES.filter(([g]) => ['cb', 'r2', 'n', 'm'].includes(g))) {
        await geste(nomGeste)
        change(etat)
      }
      await cliquerBouton('go')
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['/envoi?' + formulaire(etat).join('&')], 'envoi après des gestes')
    })

    it('le navigateur n\'écrit jamais l\'état d\'un module dans sa balise : checked, value et group restent ce que la page ou le serveur a écrit', async function () {
      if (!present) { this.skip(); return }
      const avant = await attributs()
      if (sc.client) assert.deepEqual(avant, ATTRIBUTS_CLIENT, 'rendu client pur : seulement ce que la page a écrit en dur')
      for (const [nomGeste] of GESTES) await geste(nomGeste)
      assert.deepEqual(await attributs(), avant, 'les mêmes attributs après les gestes')
      await cliquerBouton('rz')
      await attendre(400)
      assert.deepEqual(await attributs(), avant, 'les mêmes attributs après la remise à zéro')
    })
  })
})
