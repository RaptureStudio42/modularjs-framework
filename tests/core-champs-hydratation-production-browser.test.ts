// Les modules du cœur qui écrivent un champ caché dans leur balise (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>,
// <@@knob>, <@@select>) dans une page RENDUE PAR LE SERVEUR puis hydratée, chargée comme en PRODUCTION : un vrai build `env: 'prod'`
// (minifié, un morceau par module, manifeste `bundle.js` et chargeur à la demande), servi tel quel à un navigateur réel, pour chacun
// des quatre modes de reprise (`ssrMode` : markers, replace, positional, diff) et dans les deux ordres où les morceaux peuvent arriver :
//   · « la page d'abord » : le morceau de la page est évalué avant ceux des modules qu'elle contient (le chargeur ne découvre ces
//     balises qu'une fois la page construite) ;
//   · « les modules d'abord » : les morceaux des modules sont déjà évalués, chacun dans sa tâche, quand celui de la page arrive (un
//     autre composant les a demandés avant elle) : chaque module se synchronise avant que la page ne reprenne son rendu.
// Dans chaque cas, avec ou sans libellé entre les balises, à l'état posé en dur (`checked`, `value="3"`), par expression
// (`checked={true}`) ou lié à une variable de la page (`checked=!{…}`, `group=!{…}`, `value=!{…}`) :
// - chaque module actif porte UN seul champ caché, celui écrit par le serveur (jamais retiré par la reprise de la page, jamais doublé) ;
// - le formulaire dit toujours l'état réel : après de vrais gestes, `new FormData(form)` ET un vrai envoi portent l'état courant ;
// - `form.reset()` ramène l'état de départ (la jauge et le bouton rotatif compris, aussi quand le code des modules arrive avant celui de la page),
//   avec un seul champ par module actif ;
// - une liste déroulante garde ses champs (un par valeur choisie).
// Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const MODES  = ['markers', 'replace', 'positional', 'diff'] as const
const ORDRES = ['la page d\'abord', 'les modules d\'abord'] as const

// cinq formulaires : l'état posé en dur, posé par expression, lié à des variables de la page, des modules sans libellé, des listes déroulantes
const HOTE = `<script>
  $a = true
  $b = true
  $r = 'x'
  $n = 3
  $g = 4
  $k = 30
</script>

<form class="f-fixe" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked>case</@@checkbox>
  <@@switch class="sw" name="sw" checked>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked>x</@@radio>
  <@@radio class="r2" name="g" value="y">y</@@radio>
  <@@number class="n" name="n" value="3"></@@number>
  <@@gauge class="gg" name="gg" value="4"></@@gauge>
  <@@knob class="k" name="k" value="30"></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-expr" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}>case</@@checkbox>
  <@@switch class="sw" name="sw" checked={true}>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked={true}>x</@@radio>
  <@@radio class="r2" name="g" value="y" checked={false}>y</@@radio>
  <@@number class="n" name="n" value={3}></@@number>
  <@@gauge class="gg" name="gg" value={4}></@@gauge>
  <@@knob class="k" name="k" value={30}></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-lie" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked=!{$a}>case</@@checkbox>
  <@@switch class="sw" name="sw" checked=!{$b}>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" group=!{$r}>x</@@radio>
  <@@radio class="r2" name="g" value="y" group=!{$r}>y</@@radio>
  <@@number class="n" name="n" value=!{$n}></@@number>
  <@@gauge class="gg" name="gg" value=!{$g}></@@gauge>
  <@@knob class="k" name="k" value=!{$k}></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-nu" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked></@@checkbox>
  <@@switch class="sw" name="sw" checked></@@switch>
  <@@radio class="r1" name="g" value="x" checked></@@radio>
  <@@radio class="r2" name="g" value="y"></@@radio>
  <@@number class="n" name="n" value="3"></@@number>
  <@@gauge class="gg" name="gg" value="4"></@@gauge>
  <@@knob class="k" name="k" value="30"></@@knob>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-liste" method="get" action="/envoi" @noUJS>
  <@@select class="s" name="s" value="b">
    <@@option value="a">A</@@option>
    <@@option value="b">B</@@option>
  </@@select>
  <@@select class="m" name="m" multiple value={['a', 'c']}>
    <@@option value="a">A</@@option>
    <@@option value="b">B</@@option>
    <@@option value="c">C</@@option>
  </@@select>
  <button type="reset" class="rz">remise à zéro</button>
  <button type="submit" class="go">envoyer</button>
</form>
`

const FORMULAIRES = ['.f-fixe', '.f-expr', '.f-lie', '.f-nu']
const DEPART      = ['cb=on', 'sw=on', 'g=x', 'n=3', 'gg=4', 'k=30']
const LISTES      = ['s=b', 'm=a', 'm=c']
const MODULES     = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-gauge, mjs-core-knob, mjs-core-select'

// la pièce visible sur laquelle on clique, pour chaque module
const PIECE: Record<string, string> = { cb: '.box', sw: '.pill', r1: '.ring', r2: '.ring', n: 'button.step.more', gg: 'button.btn', s: '.select-btn', m: '.select-btn' }

// chaque geste de l'utilisateur et ce que le formulaire doit envoyer juste après
const GESTES: Array<[string, string[]]> = [
  ['cb', ['sw=on', 'g=x', 'n=3', 'gg=4', 'k=30']],
  ['r2', ['sw=on', 'g=y', 'n=3', 'gg=4', 'k=30']],
  ['n', ['sw=on', 'g=y', 'n=4', 'gg=4', 'k=30']],
  ['gg', ['sw=on', 'g=y', 'n=4', 'gg=5', 'k=30']],
  ['k', ['sw=on', 'g=y', 'n=4', 'gg=5', 'k=31']],
  ['cb', ['cb=on', 'sw=on', 'g=y', 'n=4', 'gg=5', 'k=31']]
]

// l'état réel des modules d'un formulaire, lu sur ce que chacun affiche : ce que le formulaire DOIT envoyer
const VERITE = `window.__verite = (f) => Array.from(__q(f).querySelectorAll('${MODULES}')).map((m) => {
  const s = m._shadow
  const t = m.localName
  const nom = m.getAttribute('name')
  if (t === 'mjs-core-checkbox' || t === 'mjs-core-switch' || t === 'mjs-core-radio') { const c = s.querySelector('input.native'); return c.checked && !c.disabled ? nom + '=' + (m.getAttribute('value') ?? 'on') : null }
  if (t === 'mjs-core-number') return nom + '=' + s.querySelector('input.input').value
  if (t === 'mjs-core-gauge') return nom + '=' + s.querySelector('output').textContent
  if (t === 'mjs-core-knob') return nom + '=' + s.querySelector('.knob').getAttribute('aria-valuenow')
  return null
}).filter((x) => x !== null)`

type Construit = { rendus: Record<string, { html: string; hydrateScript: string }>; fichiers: Map<string, Buffer>; total: number }
let construit: Promise<Construit> | null = null

// le rendu serveur dans chaque mode et le build de production (jamais servi depuis le disque : tout est lu en mémoire), une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root    = mjsTmp('champs-production')
    const srcDir  = join(root, 'src')
    const prodDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    // sans dossier de sortie à lui, le rendu écrit ses feuilles partagées en ligne (jamais en `<link>`) : la racine de la page ne commence que par les nœuds de sa vue
    // le serveur rend avec le build de production, comme `mjs serve --prod` : un build de développement garderait le code qu'une construction de production retire, et le HTML ne s'alignerait plus sur les modules
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] }, env: 'prod' } as any)
    const rendus: Record<string, { html: string; hydrateScript: string }> = {}
    for (const mode of MODES) {
      const { html, hydrateScript } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: mode } as any)
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats = await bundler.compile()
    await bundler.close()
    if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(prodDir, f)))
    assert.ok(fichiers.has('bundle.js') && [...fichiers.keys()].some((f) => /^core-radio-/.test(f)), 'le build de production sépare un morceau par module')
    const total = (rendus.markers.html.match(/<mjs-core-(checkbox|switch|radio|number|gauge|knob|select)[ >]/g) ?? []).length
    return { rendus, fichiers, total }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox'] as const) describe(`modules à champ caché : build de production, page rendue par le serveur puis hydratée (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let ordre: typeof ORDRES[number] = ORDRES[0]
  let fichiers = new Map<string, Buffer>()
  let rendus: Record<string, { html: string; hydrateScript: string }> = {}
  let total = 0
  const envois: string[]  = []
  const erreurs: string[] = []

  const attendre = (ms = 150) => page.waitForTimeout(ms)
  const champs   = (f: string): Promise<string[]> => page.evaluate(`Array.from(new FormData(__q('${f}'))).map((p) => p[0] + '=' + p[1])`)
  const caches   = (f: string): Promise<string[]> => page.evaluate(`Array.from(__q('${f}').querySelectorAll('input[type=hidden]')).map((i) => i.name + '=' + i.value)`)
  const verite   = (f: string): Promise<string[]> => page.evaluate(`__verite('${f}')`)
  // le nombre de champs cachés que porte chaque module, dans l'ordre du formulaire
  const parModule = (f: string): Promise<string[]> => page.evaluate(`Array.from(__q('${f}').querySelectorAll('${MODULES}')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`)

  // le centre d'une pièce visible d'un module (la case, la pastille, l'anneau, le bouton « + »), pour de vrais clics
  async function cliquer(f: string, cls: string, rang = 0, piece = PIECE[cls]) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('${f} .${cls}')._shadow.querySelectorAll('${piece}')[${rang}]
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  // un geste de l'utilisateur : un clic sur la pièce du module, ou la flèche haute du bouton rotatif (vraie touche)
  async function geste(f: string, cls: string) {
    if (cls === 'k') {
      await page.evaluate(`__q('${f} .k')._shadow.querySelector('.knob').focus()`)
      await page.keyboard.press('ArrowUp')
      await attendre()
      return
    }
    await cliquer(f, cls)
  }

  async function cliquerBouton(f: string, cls: string) {
    const { x, y } = await page.evaluate(`(() => {
      const e = __q('${f} .${cls}')
      e.scrollIntoView({ block: 'center' })
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
  }

  // la page rendue par le serveur dans ce mode, le build de production chargé après elle, puis l'attente de l'hydratation des modules
  async function charger(mode: string) {
    const pre = `<script>(function () { document.querySelector('mjs-hote-ssr').shadowRoot.querySelectorAll('form').forEach(function (f) { f.__srv = true }) })()</script>`
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode].html}\n${pre}\n${rendus[mode].hydrateScript}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    await page.goto('http://production.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote-ssr')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
      return m.length === ${total} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
    })()`, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote-ssr')._shadow.querySelector(s)`)
    await page.evaluate(VERITE)
    await page.waitForTimeout(400)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire()
      fichiers = fait.fichiers
      rendus   = fait.rendus
      total    = fait.total
      browser  = await playwright[nom].launch()
      page     = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
      await page.addInitScript('window.__name = (f) => f')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
      await page.route('http://production.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/envoi') {
          envois.push(url.pathname + url.search)
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
          return
        }
        if (url.pathname.startsWith('/out/')) {
          const f = url.pathname.slice(5)
          let corps = fichiers.get(f)
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

  for (const ord of ORDRES) for (const mode of MODES) describe(`hydratation « ${mode} », ${ord}`, function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      ordre          = ord
      envois.length  = 0
      erreurs.length = 0
      await charger(mode)
    })

    it('la page est bien reprise dans ce mode, sans erreur ; chaque module actif porte UN seul champ caché, le formulaire envoie l\'état de départ', async function () {
      if (!present) { this.skip(); return }
      assert.equal(await page.evaluate(`document.querySelector('mjs-hote-ssr')._shadow.querySelector('form').__srv === true`), mode !== 'replace', 'le mode demandé est celui qui a joué : les nœuds du serveur sont repris, sauf en « replace »')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      for (const f of FORMULAIRES) {
        assert.deepEqual(await parModule(f), ['cb:1', 'sw:1', 'r1:1', 'r2:0', 'n:1', 'gg:1', 'k:1'], `${f} : un champ par module actif, aucun pour le bouton non choisi`)
        assert.deepEqual(await caches(f), DEPART, `${f} : les champs cachés du formulaire`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData`)
        assert.deepEqual(await verite(f), DEPART, `${f} : l'état réel des modules`)
      }
      assert.deepEqual(await parModule('.f-liste'), ['s:1', 'm:2'], 'la liste déroulante : un champ par valeur choisie')
      assert.deepEqual(await champs('.f-liste'), LISTES, 'la liste déroulante : FormData')
    })

    it('de vrais gestes (case, bouton radio, « + » du nombre et de la jauge, flèche du bouton rotatif) : le formulaire envoie l\'état réel après chacun (FormData), sans champ resté du serveur', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        for (const [cls, attendu] of GESTES) {
          await geste(f, cls)
          assert.deepEqual(await champs(f), attendu, `${f} : FormData après un geste sur .${cls}`)
          assert.deepEqual(await caches(f), attendu, `${f} : les champs cachés après un geste sur .${cls}`)
          assert.deepEqual(await verite(f), attendu, `${f} : l'état réel après un geste sur .${cls}`)
        }
      }
    })

    it('un vrai envoi du formulaire porte l\'état de départ, puis l\'état réel après des gestes', async function () {
      if (!present) { this.skip(); return }
      await cliquerBouton('.f-fixe', 'go')
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['/envoi?cb=on&sw=on&g=x&n=3&gg=4&k=30'], '.f-fixe : envoi sans geste')
      for (const f of FORMULAIRES) {
        await charger(mode)
        envois.length = 0
        await geste(f, 'cb')
        await geste(f, 'r2')
        await geste(f, 'n')
        await cliquerBouton(f, 'go')
        await page.waitForFunction(`location.pathname === '/envoi'`)
        assert.deepEqual(envois, ['/envoi?sw=on&g=y&n=4&gg=4&k=30'], `${f} : envoi après la décoche de la case, le choix du second bouton et un « + » du nombre`)
      }
      await charger(mode)
      envois.length = 0
      await cliquerBouton('.f-liste', 'go')
      await page.waitForFunction(`location.pathname === '/envoi'`)
      assert.deepEqual(envois, ['/envoi?s=b&m=a&m=c'], '.f-liste : envoi sans geste')
    })

    it('form.reset() ramène l\'état de départ, avec un seul champ caché par module actif', async function () {
      if (!present) { this.skip(); return }
      for (const f of FORMULAIRES) {
        await geste(f, 'cb')
        await geste(f, 'r2')
        await geste(f, 'n')
        await geste(f, 'gg')
        await geste(f, 'k')
        assert.deepEqual(await champs(f), ['sw=on', 'g=y', 'n=4', 'gg=5', 'k=31'], `${f} : avant la remise à zéro`)
        await cliquerBouton(f, 'rz')
        await attendre(400)
        assert.deepEqual(await parModule(f), ['cb:1', 'sw:1', 'r1:1', 'r2:0', 'n:1', 'gg:1', 'k:1'], `${f} : un champ par module actif après la remise à zéro`)
        assert.deepEqual(await champs(f), DEPART, `${f} : FormData après la remise à zéro`)
        assert.deepEqual(await verite(f), DEPART, `${f} : l'état réel après la remise à zéro`)
      }
      // les listes déroulantes : un autre choix de l'utilisateur, puis la remise rend le choix du premier rendu (posé en dur pour `s`, par expression pour `m`)
      await cliquer('.f-liste', 's')
      await cliquer('.f-liste', 's', 0, '.select-option')
      await cliquer('.f-liste', 'm')
      await cliquer('.f-liste', 'm', 1, '.select-option')
      assert.notDeepEqual(await champs('.f-liste'), LISTES, '.f-liste : le choix de l\'utilisateur, avant la remise à zéro')
      await cliquerBouton('.f-liste', 'rz')
      await attendre(400)
      assert.deepEqual(await parModule('.f-liste'), ['s:1', 'm:2'], '.f-liste : un champ par valeur choisie après la remise à zéro')
      assert.deepEqual(await champs('.f-liste'), LISTES, '.f-liste : FormData après la remise à zéro')
    })
  })
})
