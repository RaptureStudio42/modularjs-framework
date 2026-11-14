// Les pages d'une table de routes préchargées au repos (`µ._mjs_routesIdle`, mjs_router.ts, et l'attente commune `µ._idle`,
// mjs_autoloader.ts) : rien ne part avant l'événement `load` de la fenêtre ni tant qu'un chargement ou une demande de MJS est en
// vol, puis une page par temps de repos, dans l'ordre de la table, une seule en vol, par un lien `modulepreload` — jamais un
// `import()` : rien ne s'exécute avant la visite. Une page déjà définie, déjà demandée ou déjà ratée est sautée ; une page qui
// importe un module ou porte un effet part à sa visite. Un échec au repos ne dit rien, n'allume rien et ne recharge jamais la
// page ; la visite redemande la page sous une adresse neuve. Le routeur demande lui-même la page qu'il monte.
//
// Méthode : les sources réelles du routeur et du chargeur dans une fenêtre happy-dom, `import()` remplacé par une fonction
// pilotée à la main, `requestIdleCallback` aussi, les liens posés dans l'en-tête retenus sans être chargés

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const lire      = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')

type Vol = { path: string, ok: () => void, ko: () => void }

function monter(chargement: 'complete' | 'loading' = 'loading') {
  const win: any = new Window({ url: 'http://localhost/#/' })
  const vols     = [] as Vol[]
  const imports  = [] as string[]
  const imp = (path: string) => new Promise<void>((resolve, reject) => {
    imports.push(path)
    const tag = 'mjs-' + path.replace(/^\/|\.js$|\?.*$/g, '')
    vols.push({ path, ok: () => { win.customElements.define(tag, class extends win.HTMLElement {}); resolve() }, ko: () => reject(new TypeError('Failed to fetch dynamically imported module')) })
  })
  const init = lire('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')
  const src  = `${init}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_nav_progress.ts')}\n${lire('mjs_router.ts')}\n${lire('mjs_autoloader.ts').replace(/import\(path\)/g, '__imp(path)')}\nreturn µ;`
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'CustomEvent', '__imp', src)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, win.CustomEvent, imp)
  const repos = [] as Array<() => void>
  // le repos des messages du cœur (mjs_init.ts) n'est pas celui des pages
  win.requestIdleCallback = (f: () => void) => { if (f.name !== '_mjsMsgEarly') repos.push(f) }
  Object.defineProperty(win.document, 'readyState', { configurable: true, get: () => chargement })
  // l'événement load de la fenêtre ne part qu'à la main (happy-dom envoie le sien de lui-même)
  const auLoad = [] as Array<() => void>
  const ecouter = win.addEventListener.bind(win)
  win.addEventListener = (type: string, f: any, o?: any) => { if (type === 'load') auLoad.push(f); else ecouter(type, f, o) }
  // les liens de préchargement : retenus, jamais chargés ; leur fin se joue à la main (`onload`, `onerror`)
  const liens  = [] as any[]
  const poser  = win.document.head.appendChild.bind(win.document.head)
  win.document.head.appendChild = (l: any) => { if (l.rel === 'modulepreload') { liens.push(l); return l } return poser(l) }
  const erreurs = [] as unknown[]
  µ.log   = () => {}
  µ.error = (...a: unknown[]) => { erreurs.push(a) }
  µ.paths = { 'page-a': '/page-a.js', 'page-b': '/page-b.js', 'page-c': '/page-c.js' }
  let recharge = 0
  let fetches  = 0
  µ.Autoloader._mjs_reloadOnStale = () => { recharge++ }
  win.fetch = () => { fetches++; return new Promise(() => {}) }
  // un composant routé : une vue, trois routes
  const comp: any = win.document.createElement('div')
  const view: any = win.document.createElement('metamjs-view')
  view.id = 'main'
  comp._shadow = comp
  comp.appendChild(view)
  comp.routes = { main: { '/a': 'page-a', '/b': 'page-b', '/c': 'page-c' } }
  win.document.body.appendChild(comp)
  µ.Router._mjs_awareComponents = [comp]
  const pause  = (ms = 5) => new Promise((r) => setTimeout(r, ms))
  // un temps de repos : la fonction en attente part, puis les promesses se tiennent
  const reposer = async () => { const f = repos.shift(); assert.ok(f, 'un temps de repos est attendu'); f!(); await pause() }
  const hrefs   = () => liens.map((l) => l.getAttribute('href'))
  return { win, µ, vols, imports, repos, liens, hrefs, erreurs, reposer, pause, chargee: () => { chargement = 'complete'; auLoad.splice(0).forEach((f) => f()) }, recharge: () => recharge, fetches: () => fetches }
}

describe('pages d\'une table de routes préchargées au repos — routeur et chargeur', function () {
  it('rien avant le load de la fenêtre ; puis une page par repos, dans l\'ordre, une seule en vol, sans être exécutée', async () => {
    const t = monter()
    t.µ._mjs_routesIdle(['page-a', 'page-b', 'page-c'])
    await t.pause()
    assert.deepEqual(t.hrefs(), [], 'rien avant le load')
    assert.equal(t.repos.length, 0, 'aucun repos demandé avant le load')
    t.chargee()
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-a.js'])
    assert.equal(t.repos.length, 0, 'la suivante attend la fin de la première')
    t.liens[0].onload()
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-a.js', '/page-b.js'])
    t.liens[1].onload()
    await t.reposer()
    t.liens[2].onload()
    await t.pause()
    assert.deepEqual(t.hrefs(), ['/page-a.js', '/page-b.js', '/page-c.js'])
    assert.deepEqual(t.imports, [], 'aucun import : rien ne s\'exécute avant la visite')
    assert.ok(t.win.customElements.get('mjs-page-c') === undefined, 'la page n\'est pas définie')
    t.win.close()
  })

  it('liste vide : rien ; doublons et pages déjà définies sautés', async () => {
    const t = monter('complete')
    t.µ._mjs_routesIdle([])
    assert.equal(t.repos.length, 0)
    t.win.customElements.define('mjs-page-a', class extends t.win.HTMLElement {})
    t.µ._mjs_routesIdle(['page-a', 'page-b', 'page-b'])
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-b.js'])
    t.liens[0].onload()
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-b.js'], 'plus rien en file')
    assert.equal(t.repos.length, 0)
    t.win.close()
  })

  it('une page déjà en vol (visite, survol) retient la file jusqu\'à son arrivée, puis elle est sautée', async () => {
    const t = monter('complete')
    t.µ.Autoloader.load('mjs-page-a')
    t.µ._mjs_routesIdle(['page-a', 'page-b'])
    await t.pause(250)
    assert.equal(t.repos.length, 0, 'le chargeur a encore un fichier en route : pas de repos')
    t.vols[0].ok()
    await t.pause(250)
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-b.js'], 'la page arrivée est sautée')
    assert.deepEqual(t.imports, ['/page-a.js'])
    t.win.close()
  })

  it('une demande de MJS en vol retient la file ; elle part à sa fin', async () => {
    const t = monter()
    t.µ._mjs_busy = 1
    t.µ._mjs_routesIdle(['page-a'])
    t.chargee()
    await t.pause(250)
    assert.equal(t.repos.length, 0, 'une demande en vol : pas de repos')
    t.µ._mjs_busy = 0
    await t.pause(250)
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-a.js'])
    t.win.close()
  })

  it('une visite d\'une page en file la charge aussitôt, une seule fois', async () => {
    const t = monter()
    t.µ._mjs_routesIdle(['page-a', 'page-b'])
    t.µ.Router.navigate('#/b')
    await t.pause()
    assert.deepEqual(t.imports, ['/page-b.js'], 'le routeur demande la page qu\'il monte')
    t.vols[0].ok()
    await t.pause()
    t.chargee()
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-a.js'], 'la page visitée n\'est pas préchargée')
    t.liens[0].onload()
    await t.reposer()
    assert.equal(t.repos.length, 0, 'plus rien en file')
    assert.deepEqual(t.imports, ['/page-b.js'])
    t.win.close()
  })

  it('échec au repos : rien n\'est dit, rien n\'est rechargé, la file continue ; la visite redemande la page sous une adresse neuve', async () => {
    const t = monter('complete')
    t.µ.config.navProgress = 20
    t.µ._mjs_routesIdle(['page-a', 'page-b'])
    await t.reposer()
    t.liens[0].onerror()
    await t.pause()
    assert.deepEqual(t.erreurs, [], 'aucun µ.error')
    assert.equal(t.recharge(), 0, 'jamais de rechargement')
    assert.equal(t.fetches(), 0)
    assert.ok(t.win.document.body.querySelector('.mjs-nav-progress') === null, 'aucune barre')
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-a.js', '/page-b.js'], 'la file continue')
    t.µ.Router.navigate('#/a')
    await t.pause()
    assert.deepEqual(t.imports, ['/page-a.js?mjs-retry=1'], 'la visite redemande la page, sous une adresse neuve (le navigateur garde l\'échec de la première)')
    t.win.close()
  })

  it('une page qui importe un module ou porte un effet part à sa visite, jamais au repos', async () => {
    const t = monter('complete')
    t.µ.deps = { 'page-a': ['outil.module.js'], 'page-b': ['mjs_fx_neon'], 'page-c': ['page-a'] }
    t.µ._mjs_routesIdle(['page-a', 'page-b', 'page-c'])
    await t.reposer()
    assert.deepEqual(t.hrefs(), ['/page-c.js'])
    t.win.close()
  })

  it('absente du manifeste au repos : rien n\'est dit', async () => {
    const t = monter('complete')
    t.µ._mjs_routesIdle(['page-z'])
    await t.reposer()
    assert.deepEqual(t.erreurs, [])
    assert.deepEqual(t.hrefs(), [])
    assert.equal(t.µ.Autoloader.pendingComponents.has('mjs-page-z'), false)
    t.win.close()
  })

  it('sous "off" (liste vide) : seule la visite charge la page', async () => {
    const t = monter('complete')
    t.µ._mjs_routesIdle([])
    assert.equal(t.repos.length, 0)
    t.µ.Router.navigate('#/c')
    await t.pause()
    assert.deepEqual(t.imports, ['/page-c.js'])
    t.win.close()
  })

  it('page de prérendu (µ.server) : la file ne démarre pas', async () => {
    const t = monter('complete')
    t.µ.server = true
    t.µ._mjs_routesIdle(['page-a'])
    assert.equal(t.repos.length, 0)
    await t.pause()
    assert.deepEqual(t.hrefs(), [])
    t.win.close()
  })
})
