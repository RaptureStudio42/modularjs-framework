// Matrice de la navigation, le moteur : avec l'API Navigation, un lien pris par la navigation de MJS passe par une
// navigation interceptée (`intercept`), qui engage l'adresse dès le clic sans annoncer de départ ; Précédent et Suivant
// lancés par l'API rendent la page gardée ; la page ne bouge pas et le focus reste en place tant que
// la page demandée n'est pas arrivée ; une navigation lancée par un script reste au navigateur ; un départ lancé par la
// page pendant la visite reste un départ (question du `beforeunload`, départ annoncé), en développement et en
// production ; `history.state` de l'entrée poussée ; les écouteurs `navigate` de la page, posés avant ou après le runtime,
// qui annulent (aussi pendant une visite en vol), rangent l'entrée par `replaceState`, poussent une autre entrée, lèvent
// ou renvoient le lien vers un autre document (chargement complet) ; Précédent puis un clic, deux liens, dans la même tâche ;
// une `navigation` de la page qui n'est pas l'API du navigateur (élément, variable globale, objet quelconque, `Proxy` de
// l'API, cale ou polyfill de l'API, même par sa classe, quel que soit le moment où elle pousse l'entrée et joue les
// gestionnaires d'`intercept`, posée avant ou après le runtime) : elle n'est pas prise pour l'API, les liens naviguent comme
// sans elle, une seule visite par clic ; `history.pushState()` remplacé par la page — une fonction, une fonction liée ou un
// `Proxy` d'allure native — qui appelle celui du navigateur pendant l'appel, plus tard ou jamais, ou qui simule le `navigate`
// de l'API : une seule visite par clic ; la vraie API derrière un outil de la page (`addEventListener` enveloppé, avec ou sans
// `Function.prototype.toString` maquillé), une classe `Navigation` de la page ou un `Proxy` : seule l'interception dépend de
// sa reconnaissance — positions de la même ancre suivie deux fois, lien annulé par la page. Vrai projet construit,
// navigateur réel (Chromium, Firefox, WebKit), chaque cas joué tel quel puis avec `window.navigation` retiré avant le
// démarrage (Précédent et Suivant par `history`, le script par `location`).

import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { matrix, ready, address, sameDocument, events, hits, until, settle, scrollToY, reached, focused, waitHit, back, SLOW, type Case, type Run } from './helpers/navigation-matrice.js'

// un écouteur `navigate` de la page, sur le `pushState` d'un lien vers `/p2`, selon `window.__on` : 'annule'
// (`preventDefault()`), 'remplace' (l'état de l'entrée rangé par `replaceState`, comme une bibliothèque qui garde le
// défilement), 'pousse' (une autre entrée, par `pushState`), 'leve' (une erreur), ou le lien renvoyé vers la même adresse
// par un autre document : 'href' (`preventDefault()` puis `location.href`), 'assign' (`location.assign()`), 'replace'
// (`location.replace()`), 'navigate' (`navigation.navigate()`) ; posé avant le runtime (script de la page joué avant lui)
// ou après lui
const PAGE_NAVIGATE = '(function() { var w = window; w.__on = ""; if (w.navigation) { w.navigation.addEventListener("navigate", function(e) { var m = w.__on; if (!m || e.navigationType !== "push" || !/\\/p2$/.test(new URL(e.destination.url).pathname)) { return; } if (m === "annule") { e.preventDefault(); } else if (m === "remplace") { history.replaceState({ y: 0 }, ""); } else if (m === "pousse") { w.__on = ""; history.pushState({ lib: 1 }, "", location.pathname + "?lib"); } else if (m === "leve") { throw new Error("écouteur de la page"); } else { w.__on = ""; if (m === "href") { e.preventDefault(); location.href = e.destination.url; } else if (m === "assign") { location.assign(e.destination.url); } else if (m === "replace") { location.replace(e.destination.url); } else { var r = w.navigation.navigate(e.destination.url); r.committed.catch(function() {}); r.finished.catch(function() {}); } } }); } })()'

// l'écouteur de la page posé avant ou après le runtime, en développement (`x` : '') et en production (`x` : '/prod') ;
// sans l'API, aucun écouteur ne se pose : un seul passage
const placements = (withoutApi: boolean) => withoutApi ? [{ x: '', pre: true }] : [{ x: '', pre: true }, { x: '', pre: false }, { x: '/prod', pre: true }, { x: '/prod', pre: false }]
const where      = (x: string, pre: boolean) => 'écouteur posé ' + (pre ? 'avant' : 'après') + ' le runtime' + (x ? ', en production' : ', en développement')

// la page `/p1` du projet, l'écouteur de la page posé
async function openWith(r: Run, x: string, pre: boolean): Promise<Page> {
  const p = await r.open(x + '/p1', pre && !r.withoutApi ? PAGE_NAVIGATE : undefined)
  if (!pre && !r.withoutApi) await p.evaluate(PAGE_NAVIGATE)
  return p
}

// un départ lancé par la page pendant la partie synchrone de la visite : `location.assign()` dans un écouteur `mjs:visit`
// (page demandée au réseau) ou `mjs:load` d'une page rendue par le cache de pages (échange synchrone) ; `x` : '' en
// développement, '/prod' en production. Un départ comme un autre : le `beforeunload` de la page le reçoit (son compte
// gardé dans `sessionStorage` traverse le départ) ; s'il demande à rester, la question est posée, la page reste où la
// visite l'a menée et le départ reste annoncé (`µ._mjs_left()`, lu en développement : la production renomme les
// propriétés internes ; sans l'API, Firefox n'écoute `beforeunload` que pendant un chargement du runtime, rien n'y
// annonce ce départ)
const departure = (when: 'visit' | 'load', x: string): Case => ({
  name: 'départ (`location.assign()`) lancé par un écouteur `mjs:' + when + '`' + (when === 'load' ? ' d\'une page du cache de pages' : '') + (x ? ', en production' : ', en développement') + ' : le `beforeunload` de la page le reçoit ; s\'il demande à rester, la question est posée, la page reste et le départ est annoncé',
  run: async ({ open, site, engine, withoutApi }) => {
    const target = x + (when === 'load' ? '/p1' : '/p3')
    for (const ask of [true, false]) {
      const p       = await open(x + '/p1')
      const dialogs = [] as string[]
      p.on('dialog', d => { dialogs.push(d.type()); d.dismiss().catch(() => {}) })
      // une activation de l'utilisateur : sans elle, Firefox ne pose pas la question
      await p.mouse.click(5, 300)
      if (when === 'load') {
        await p.click('#lp2')
        await p.waitForSelector('#nom-p2', { state: 'attached' })
      }
      site.log.length = 0
      await p.evaluate(([w, t, a, slow]) => {
        sessionStorage.setItem('bu', '0')
        addEventListener('beforeunload', (e: any) => { sessionStorage.setItem('bu', String(Number(sessionStorage.getItem('bu')) + 1)); if (a) { e.preventDefault(); e.returnValue = 'x' } })
        let done = false
        document.addEventListener('mjs:' + w, (e: any) => { if (!done && (e.detail || {}).path === t) { done = true; location.assign(slow as string) } })
      }, [when, target, ask, x + '/lent'] as const)
      await p.evaluate((id) => document.getElementById(id)!.click(), when === 'load' ? 'lp1' : 'lp3')
      if (ask) {
        for (let i = 0; i < 50 && !dialogs.length; i++) await p.waitForTimeout(100)
        assert.deepEqual(dialogs, ['beforeunload'], 'la question du `beforeunload` de la page est posée')
        await p.waitForSelector('#nom-' + target.split('/').pop(), { state: 'attached', timeout: 8000 })
        await p.waitForTimeout(400)
        assert.equal(await p.evaluate(() => sessionStorage.getItem('bu')), '1', 'le `beforeunload` de la page reçoit le départ')
        assert.ok(await sameDocument(p), 'la page reste')
        assert.equal(await address(p), target)
        assert.ok(!site.log.some(h => h.path === x + '/lent'), 'aucun départ : ' + hits(site).join(', '))
        if (!x && !(withoutApi && engine === 'firefox')) assert.equal(await p.evaluate(() => (window as any).µ._mjs_left()), true, 'le départ est annoncé')
      }
      else {
        await until(p, () => (window as any).__doc !== 'départ' && document.readyState !== 'loading', null, 10000)
        assert.ok(Number(await p.evaluate(() => sessionStorage.getItem('bu'))) >= 1, 'le `beforeunload` de la page reçoit le départ')
        assert.deepEqual(dialogs, [])
      }
      await p.close()
    }
  },
})

// un écouteur `navigate` de la page (avant ou après le runtime) qui renvoie le lien vers la même adresse par un autre
// document pendant l'annonce de son `pushState` (une nouvelle version déployée, par exemple) : une navigation lancée par
// un script, laissée au navigateur — le chargement complet, que le `beforeunload` de la page reçoit (son compte gardé dans
// `sessionStorage` traverse le chargement), sans requête de la navigation de MJS ; `location.replace()` remplace l'entrée,
// sauf sous Firefox, qui en compte une de plus (comme la 3.1.0, et pour un écouteur posé après le runtime). Sans l'API,
// aucun écouteur, la visite a lieu
const elsewhere = (m: 'href' | 'assign' | 'replace' | 'navigate', how: string): Case => ({
  name: 'un écouteur `navigate` de la page (avant ou après le runtime) qui renvoie le lien vers la même adresse par un autre document pendant son annonce (' + how + ') : le navigateur charge la page entière, le `beforeunload` de la page le reçoit, aucune requête de la navigation de MJS ; en développement et en production ; sans l\'API, aucun écouteur, la visite a lieu',
  run: async (r) => {
    for (const { x, pre } of placements(r.withoutApi)) {
      const at     = where(x, pre)
      const p      = await openWith(r, x, pre)
      const length = await p.evaluate(() => history.length)
      await p.evaluate((mode) => {
        const w = window as any
        sessionStorage.setItem('bu', '0')
        addEventListener('beforeunload', () => { sessionStorage.setItem('bu', String(Number(sessionStorage.getItem('bu')) + 1)) })
        w.__on = mode
        document.getElementById('lp2')!.click()
      }, m)
      if (r.withoutApi) {
        await p.waitForSelector('#nom-p2', { state: 'attached' })
        assert.equal(await address(p), '/p2')
        assert.ok(await sameDocument(p), 'même document')
        continue
      }
      await until(p, () => !!document.getElementById('nom-p2') && (window as any).__doc !== 'départ' && history.scrollRestoration === 'manual').catch((e: Error) => { throw new Error('chargement complet attendu, ' + at + ' : ' + e.message.split(' : ')[0] + ' ; requêtes : ' + hits(r.site).join(', ')) })
      assert.equal(await address(p), x + '/p2', at)
      assert.ok(Number(await p.evaluate(() => sessionStorage.getItem('bu'))) >= 1, 'le `beforeunload` de la page reçoit le départ, ' + at)
      assert.equal(await p.evaluate(() => history.length), length + (m === 'replace' && r.engine !== 'firefox' ? 0 : 1), at)
      assert.ok(r.site.log.some(h => h.path === x + '/p2' && !h.mjs), 'la page chargée par le navigateur, ' + at + ' : ' + hits(r.site).join(', '))
      assert.ok(!r.site.log.some(h => h.mjs), 'aucune requête de la navigation de MJS, ' + at + ' : ' + hits(r.site).join(', '))
      await p.close()
    }
  },
})

// une `navigation` de la page qui n'est pas l'API Navigation du navigateur, jouée avant le runtime (en fin de `<body>`,
// avant le module) : un élément d'identifiant `navigation` (sans l'API, l'accès par le nom le rend dans `window.navigation`),
// la variable globale d'un script classique, une cale de l'API (un objet ; ou l'instance d'une classe `Navigation` posée à
// la place de celle du navigateur, dont l'entrée ne suit pas `pushState`), un objet quelconque doté d'`addEventListener`,
// un `Proxy` de l'API qui lie ses méthodes, dont le `get` lit par `Reflect.get(cible, nom, récepteur)` (l'entrée courante
// ne s'y lit pas : son accesseur refuse le `Proxy`) ou sur la cible (tout s'y lit) — sans l'API, rien à envelopper ; ou
// posée après le chargement de MJS (`late`). `what` : ce que la page lit alors dans `window.navigation` ; `kept` : l'API
// que MJS garde, quand c'est encore celle du navigateur (l'élément ne la masque pas)
const CALE  = 'var ent = { url: location.href, key: "cale", index: 0 }; window.navigation = { addEventListener: function() {}, removeEventListener: function() {}, get currentEntry() { return ent; } };'
const PROXY = 'if (window.navigation) { window.navigation = new Proxy(window.navigation, { get: function(t, k, r) { var v = Reflect.get(t, k, r); return typeof v === "function" ? v.bind(t) : v; } }); }'
const CIBLE = 'if (window.navigation) { window.navigation = new Proxy(window.navigation, { get: function(t, k) { var v = t[k]; return typeof v === "function" ? v.bind(t) : v; } }); }'
const MASKS = [
  { name: 'un élément d\'identifiant `navigation`', how: '<div id="navigation"></div>', what: (withoutApi: boolean) => withoutApi ? 'élément #navigation' : 'Navigation', kept: (withoutApi: boolean) => withoutApi ? 'aucune' : 'window.navigation' },
  { name: 'la variable globale d\'un script classique (`var navigation = document.getElementById(\'nav\')`)', how: '<script>var navigation = document.getElementById(\'nav\');</script>', what: () => 'élément #nav' },
  { name: 'une cale de l\'API (un objet doté d\'`addEventListener` et de `currentEntry`)', how: '<script>' + CALE + '</script>', what: () => 'Object' },
  { name: 'une cale de l\'API par sa classe (`Navigation` remplacée, une entrée qui ne suit pas `pushState`)', how: '<script>window.Navigation = class Navigation extends EventTarget { get currentEntry() { return null; } }; window.navigation = new Navigation();</script>', what: () => 'EventTarget' },
  { name: 'un objet quelconque doté d\'`addEventListener` (`new EventTarget()`)', how: '<script>window.navigation = new EventTarget();</script>', what: () => 'EventTarget' },
  { name: 'un `Proxy` de l\'API dont le `get` lie les méthodes et lit par `Reflect.get(cible, nom, récepteur)` (l\'entrée courante ne s\'y lit pas)', how: '<script>' + PROXY + '</script>', what: (withoutApi: boolean) => withoutApi ? 'aucune' : 'Navigation' },
  { name: 'un `Proxy` de l\'API dont le `get` lie les méthodes et lit sur la cible (tout s\'y lit)', how: '<script>' + CIBLE + '</script>', what: (withoutApi: boolean) => withoutApi ? 'aucune' : 'Navigation' },
  { name: 'un élément posé dans `window.navigation` après le chargement de MJS', how: 'window.navigation = document.getElementById("nav")', late: true, what: () => 'élément #nav' },
]

// ce que la page lit dans `window.navigation`
const WHAT = () => { const n = (window as any).navigation; return n === undefined ? 'aucune' : n instanceof Element ? 'élément #' + n.id : Object.prototype.toString.call(n).slice(8, -1) }

// la page `path` du site, `extra` ajouté en fin de `<body>`, la navigation chargée, le journal vidé ; sans la vérification
// du mode de `open()` : la `navigation` de la page y est justement une autre
async function openWithBody(r: Run, path: string, extra: string): Promise<Page> {
  const p = await r.ctx.newPage()
  p.on('pageerror', e => r.errors.push(e.message))
  await p.route(r.site.origin + path, async route => {
    const resp = await route.fetch()
    await route.fulfill({ response: resp, body: (await resp.text()).replace('</body>', extra + '</body>') })
  })
  await p.goto(r.site.origin + path)
  await ready(p)
  await p.evaluate(() => { (window as any).__doc = 'départ' })
  r.site.log.length = 0
  return p
}

// l'API gardée par MJS (`µ._mjs_nav`), lue en développement : la production renomme les propriétés internes
const KEPT = () => { const w = window as any; return !w.µ._mjs_nav ? 'aucune' : w.µ._mjs_nav === w.navigation ? 'window.navigation' : 'une autre' }

// MJS ne prend que l'API du navigateur, lue à son chargement et gardée : celle de la page n'est pas prise pour elle (posée
// après le chargement, l'API du navigateur reste celle de MJS), les liens naviguent par la navigation de MJS (la page
// demandée, une seule requête, même document, sans erreur), le suivant aussi, et Précédent rend la page gardée
const masked = (m: typeof MASKS[number]): Case => ({
  name: 'une `navigation` de la page qui n\'est pas l\'API du navigateur, ' + m.name + (m.late ? '' : ', posée avant le runtime') + ' : elle n\'est pas prise pour l\'API, les liens naviguent par la navigation de MJS, le suivant aussi, Précédent rend la page gardée ; en développement et en production',
  run: async (r) => {
    for (const x of ['', '/prod']) {
      const at = x ? 'en production' : 'en développement'
      const p  = m.late ? await r.open(x + '/p1') : await openWithBody(r, x + '/p1', m.how)
      if (m.late) await p.evaluate(m.how)
      assert.equal(await p.evaluate(WHAT), m.what(r.withoutApi), 'la `navigation` de la page, ' + at)
      await p.evaluate(() => document.getElementById('lp2')!.click())
      await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
      const there = await address(p)
      assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at + ' ; adresse ' + there + ', requêtes : ' + hits(r.site).join(', '))
      assert.equal(there, x + '/p2', at)
      assert.ok(await sameDocument(p), 'même document, ' + at)
      assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], at)
      await p.evaluate(() => document.getElementById('lp3')!.click())
      await p.waitForSelector('#nom-p3', { state: 'attached', timeout: 5000 }).catch(() => {})
      assert.ok(await p.evaluate(() => !!document.getElementById('nom-p3')), 'le lien suivant navigue, ' + at)
      assert.equal(await address(p), x + '/p3', at)
      await p.evaluate(() => history.back())
      await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
      assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'Précédent rend la page gardée, ' + at)
      assert.equal(await address(p), x + '/p2', at)
      assert.ok(await sameDocument(p), 'même document, ' + at)
      assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs', 'GET ' + x + '/p3 mjs'], at)
      if (!x) assert.equal(await p.evaluate(KEPT), m.kept ? m.kept(r.withoutApi) : m.late && !r.withoutApi ? 'une autre' : 'aucune', 'l\'API gardée par MJS, ' + at)
      await p.close()
    }
  },
})

// le moment d'un geste de la cale ou de la page, par rapport à l'appel `history.pushState()` du lien : pendant l'appel,
// après lui (micro-tâche : 'micro' ; tâche : 'tache') ou jamais
type Moment = 'pendant' | 'micro' | 'tache' | 'jamais'
const later = (when: Moment, f: string) => ({ pendant: f + '();', micro: 'Promise.resolve().then(' + f + ');', tache: 'setTimeout(' + f + ', 0);', jamais: '' })[when]

// une cale de l'API par sa classe (`Navigation` remplacée, une instance dans `window.navigation`), jouée avant le runtime,
// qui suit `history.pushState()` à sa façon : elle annonce un `navigate` interceptable, puis pousse l'entrée (le `pushState`
// du navigateur) au moment `commit` et joue les gestionnaires d'`intercept` qu'on lui a confiés au moment `run`, l'entrée
// d'abord quand les deux tombent au même moment ; `window.__caleJoue` compte les gestionnaires joués. Avec l'API du
// navigateur, posée par-dessus ; sans elle, un polyfill
const SHIM = (commit: Moment, run: Moment) => '<script>(function() { var push = History.prototype.pushState, n = 0, nav; window.Navigation = class Navigation extends EventTarget { constructor() { super(); this._e = { url: location.href, key: "k0", index: 0 }; } get currentEntry() { return this._e; } }; nav = window.navigation = new window.Navigation(); window.__caleJoue = 0; history.pushState = function(state, title, url) { var handlers = [], e = new Event("navigate", { cancelable: true }), go = function() { push.call(history, state, title, url); n++; nav._e = { url: location.href, key: "k" + n, index: n }; }, run = function() { handlers.forEach(function(h) { window.__caleJoue++; h(); }); }; Object.assign(e, { navigationType: "push", canIntercept: true, hashChange: false, destination: { url: new URL(url, document.baseURI).href, sameDocument: true }, downloadRequest: null, sourceElement: null, intercept: function(o) { if (o && o.handler) { handlers.push(o.handler); } } }); nav.dispatchEvent(e); if (e.defaultPrevented) { return; } ' + later(commit, 'go') + ' ' + later(run, 'run') + ' }; })();</script>'

// les liens d'un cas sans l'API : le lien vers `/p2` (la page demandée arrive, l'adresse `want('/p2')`, un seul `mjs:visit`,
// une seule requête), puis la page lente et le lien suivant (la page du lien suivant arrive, pas la page lente, la requête
// de la visite abandonnée coupée, un `mjs:visit` par clic) ; `after` relève ce qui suit chaque lien
async function twoLinks(r: Run, p: Page, x: string, at: string, want: (path: string) => string, after: () => Promise<void>): Promise<void> {
  const visits = async () => (await events(p)).filter(e => e.startsWith('visit '))
  await p.evaluate(() => document.getElementById('lp2')!.click())
  await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
  // ce que la cale ou la page fait après l'appel : le temps que ça joue
  await p.waitForTimeout(600)
  assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at + ' ; adresse ' + (await address(p)) + ', requêtes : ' + hits(r.site).join(', '))
  assert.equal(await address(p), want('/p2'), at)
  assert.ok(await sameDocument(p), 'même document, ' + at)
  let seen = await visits()
  assert.equal(seen.length, 1, 'un seul `mjs:visit`, ' + at + ' : ' + seen.join(', '))
  assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], 'une seule requête, ' + at)
  await after()
  r.site.log.length = 0
  await p.evaluate(() => document.getElementById('llent')!.click())
  await waitHit(r.site, h => h.path === x + '/lent')
  await p.evaluate(() => document.getElementById('lp3')!.click())
  await p.waitForSelector('#nom-p3', { state: 'attached', timeout: 5000 }).catch(() => {})
  await p.waitForTimeout(SLOW + 600)
  assert.equal(await address(p), want('/p3'), at)
  assert.ok(await p.evaluate(() => !!document.getElementById('nom-p3') && !document.getElementById('nom-lent')), 'la page du lien suivant arrive, pas la page lente, ' + at)
  seen = await visits()
  assert.equal(seen.length, 3, 'un `mjs:visit` par clic, ' + at + ' : ' + seen.join(', '))
  assert.deepEqual(hits(r.site), ['GET ' + x + '/lent mjs coupée', 'GET ' + x + '/p3 mjs'], 'une requête par clic, celle de la visite abandonnée coupée, ' + at)
  await after()
}

// la cale n'est pas prise pour l'API (sa classe n'est pas celle du navigateur) : aucun gestionnaire ne lui est confié, chaque
// lien pousse son entrée par elle puis part comme sans l'API — un seul `mjs:visit` et une seule requête par clic, quel que
// soit le moment où elle pousse l'entrée (jamais : l'adresse reste) ; la visite en vol abandonnée par le lien suivant
const shimmed = (commit: Moment, run: Moment, how: string): Case => ({
  name: 'une cale de l\'API par sa classe, ' + how + ' : elle n\'est pas prise pour l\'API (aucun gestionnaire d\'`intercept` ne lui est confié), une seule visite par clic (un seul `mjs:visit`, une seule requête), ' + (commit === 'jamais' ? 'l\'adresse reste' : 'l\'adresse poussée par la cale') + ', la visite en vol abandonnée par le lien suivant (sa requête coupée) ; en développement et en production',
  run: async (r) => {
    for (const x of ['', '/prod']) {
      const at = x ? 'en production' : 'en développement'
      const p  = await openWithBody(r, x + '/p1', SHIM(commit, run))
      assert.equal(await p.evaluate(WHAT), 'EventTarget', 'la cale dans `window.navigation`, ' + at)
      await twoLinks(r, p, x, at, path => x + (commit === 'jamais' ? '/p1' : path), async () => {
        assert.equal(await p.evaluate(() => (window as any).__caleJoue), 0, 'aucun gestionnaire joué par la cale, ' + at)
      })
      if (!x) assert.equal(await p.evaluate(KEPT), 'aucune', 'l\'API gardée par MJS, ' + at)
      await p.close()
    }
  },
})

// `history.pushState()` remplacé par la page (une bibliothèque qui suit les adresses), qui appelle celui du navigateur au
// moment `when` ; `simulate` : avant, il annonce lui-même un `navigate` de l'API sur la `navigation` du navigateur
// (`dispatchEvent()`, un événement que le navigateur n'a pas lancé ; `window.__simule` compte ses `intercept()`) — sans
// l'API, rien à simuler ; `form` : une fonction, ou une fonction que `Function.prototype.toString` rend comme du code du
// navigateur (`[native code]`) — liée par `bind`, ou un `Proxy` du `pushState` du navigateur
type Form = 'fonction' | 'liée' | 'Proxy'
const FORMS: Record<Form, string> = { fonction: 'f', liée: 'f.bind(history)', Proxy: 'new Proxy(push, { apply: function(t, self, args) { return f.apply(self, args); } })' }
const WRAP = (when: Moment, simulate = false, form: Form = 'fonction') => '(function() { var push = history.pushState, f; window.__simule = 0; f = function(state, title, url) { var go = function() { push.call(history, state, title, url); }, e; ' + (simulate ? 'if (window.navigation) { e = new Event("navigate", { cancelable: true }); Object.assign(e, { navigationType: "push", canIntercept: true, hashChange: false, destination: { url: new URL(url, document.baseURI).href, sameDocument: true }, downloadRequest: null, sourceElement: null, intercept: function() { window.__simule++; } }); window.navigation.dispatchEvent(e); } ' : '') + later(when, 'go') + ' }; history.pushState = ' + FORMS[form] + '; })();'

// la visite part une seule fois par clic, quelle que soit la forme du remplaçant : avec l'API, interceptée quand le
// `pushState` du navigateur part pendant l'appel (une navigation de l'API), sinon au retour de l'appel, comme sans l'API —
// l'entrée poussée plus tard n'est pas interceptée, jamais poussée l'adresse reste ; un `navigate` simulé n'est pas pris pour
// celui de l'API (aucun `intercept()`)
const wrapped = (when: Moment, pre: boolean, simulate: boolean, how: string, form: Form = 'fonction'): Case => ({
  name: '`history.pushState()` remplacé par la page ' + (pre ? 'avant' : 'après') + ' le runtime, ' + ({ fonction: '', liée: 'par une fonction liée (`bind`), d\'allure native, ', Proxy: 'par un `Proxy` du `pushState` du navigateur, d\'allure native, ' })[form] + how + ' : une seule visite par clic (un seul `mjs:visit`, une seule requête), ' + (when === 'jamais' ? 'l\'adresse reste' : 'l\'adresse poussée') + ', avec l\'API interceptée seulement quand le `pushState` du navigateur part pendant l\'appel' + (simulate ? ', le `navigate` simulé jamais pris pour celui de l\'API' : '') + ' ; la visite en vol abandonnée par le lien suivant ; en développement et en production',
  run: async (r) => {
    for (const x of ['', '/prod']) {
      const at = x ? 'en production' : 'en développement'
      const p  = pre ? await openWithBody(r, x + '/p1', '<script>' + WRAP(when, simulate, form) + '</script>') : await r.open(x + '/p1')
      if (!pre) await p.evaluate(WRAP(when, simulate, form))
      // les entrées poussées : avec l'API, interceptées (une transition en cours) ou non
      await p.evaluate(() => { const w = window as any; w.__tr = []; if (w.navigation) w.navigation.addEventListener('currententrychange', (e: any) => { if (e.navigationType === 'push') w.__tr.push(w.navigation.transition ? 'interceptée' : 'aucune') }) })
      if (!x) assert.equal(await p.evaluate(KEPT), r.withoutApi ? 'aucune' : 'window.navigation', 'l\'API gardée par MJS, ' + at)
      let clicks = 0
      await twoLinks(r, p, x, at, path => x + (when === 'jamais' ? '/p1' : path), async () => {
        clicks += clicks ? 2 : 1
        const want = r.withoutApi || when === 'jamais' ? [] : Array(clicks).fill(when === 'pendant' ? 'interceptée' : 'aucune')
        assert.deepEqual(await p.evaluate(() => (window as any).__tr), want, 'entrées poussées, ' + at)
        assert.equal(await p.evaluate(() => (window as any).__simule), 0, 'aucun `intercept()` sur un `navigate` simulé, ' + at)
      })
      await p.close()
    }
  },
})

// la vraie API derrière un script de la page joué avant le runtime : un outil qui enveloppe
// `EventTarget.prototype.addEventListener` d'une simple fonction (mesure d'audience, suivi d'erreurs), ou qui maquille aussi
// `Function.prototype.toString` (façon zone.js, façon Sentry) ; une classe `Navigation` de la page dans un script classique
// (`var Navigation = …`, `function Navigation() {}`) ; un `Proxy` de l'API lu sur la cible ou par `Reflect.get(cible, nom,
// récepteur)`. `init` : joué avant tout script de la page ; `how` : ajouté en fin de `<body>`, avant le module ; `kept` : MJS
// reconnaît l'API ; `entry` : l'entrée courante se lit dans `window.navigation`
const ZONE   = '(function() { var o = EventTarget.prototype.addEventListener, ts = Function.prototype.toString, w = function addEventListener(t, l, opt) { return o.call(this, t, l, opt); }; w.__zone_symbol__OriginalDelegate = o; EventTarget.prototype.addEventListener = w; Function.prototype.toString = function() { var d = typeof this === "function" && this.__zone_symbol__OriginalDelegate; return ts.call(d || this); }; })();'
const SENTRY = '(function() { var o = EventTarget.prototype.addEventListener, ts = Function.prototype.toString, w = function(t, l, opt) { var h = typeof l === "function" ? function() { try { return l.apply(this, arguments); } catch (e) { throw e; } } : l; return o.call(this, t, h, opt); }; Object.defineProperty(w, "__sentry_original__", { value: o }); EventTarget.prototype.addEventListener = w; Function.prototype.toString = function() { var f = typeof this === "function" && this.__sentry_original__; return ts.apply(f || this, arguments); }; })();'
const TOOLS: { name: string, init?: string, how?: string, kept: boolean, entry: boolean }[] = [
  { name: 'un outil qui enveloppe `EventTarget.prototype.addEventListener` d\'une simple fonction', init: '(function() { var o = EventTarget.prototype.addEventListener; EventTarget.prototype.addEventListener = function(t, l, opt) { return o.call(this, t, l, opt); }; })();', kept: false, entry: true },
  { name: 'un outil qui enveloppe `EventTarget.prototype.addEventListener` et maquille `Function.prototype.toString` (façon zone.js)', init: ZONE, kept: true, entry: true },
  { name: 'un outil qui enveloppe `EventTarget.prototype.addEventListener` et ses écouteurs, et maquille `Function.prototype.toString` (façon Sentry)', init: SENTRY, kept: true, entry: true },
  { name: 'une classe `Navigation` de la page (`var Navigation = { … }`, script classique)', how: '<script>var Navigation = { init: function() {} };</script>', kept: false, entry: true },
  { name: 'une classe `Navigation` de la page (`function Navigation() {}`, script classique)', how: '<script>function Navigation() {}</script>', kept: false, entry: true },
  { name: 'un `Proxy` de l\'API lu sur la cible', how: '<script>' + CIBLE + '</script>', kept: false, entry: true },
  { name: 'un `Proxy` de l\'API lu par `Reflect.get(cible, nom, récepteur)` (l\'entrée courante ne s\'y lit pas)', how: '<script>' + PROXY + '</script>', kept: false, entry: false },
]

// la même ancre suivie deux fois (`anchorHistory`) : la position rendue par trois Précédent, par rapport à l'ancre
async function anchorTwice(p: Page): Promise<number> {
  const top = await p.evaluate(() => Math.round(document.getElementById('a')!.getBoundingClientRect().top + scrollY))
  await p.click('#la')
  await reached(p, 'a')
  await scrollToY(p, top + 400)
  await p.click('#lb')
  await reached(p, 'b')
  await p.click('#la')
  await reached(p, 'a')
  await scrollToY(p, top + 150)
  await p.click('#lb')
  await reached(p, 'b')
  await back(p)
  // en cas d'attente dépassée, l'adresse et la position où la page s'est posée, par rapport à l'ancre
  await until(p, (y) => location.hash === '#a' && Math.abs(scrollY - y) <= 1, top + 150).catch(async (e: Error) => { throw new Error(e.message + ' — posée sur ' + (await p.evaluate((t) => location.hash + ' à ' + (Math.round(scrollY) - t), top).catch(() => '?'))) })
  await back(p)
  await until(p, () => location.hash === '#b' && Math.abs(document.getElementById('b')!.getBoundingClientRect().top) <= 2)
  await back(p)
  await until(p, () => location.hash === '#a')
  return (await settle(p, 800)) - top
}

// seule l'interception dépend de la reconnaissance de l'API : la position d'une entrée se range sous la clé de l'entrée
// courante de `window.navigation`, quelle qu'elle soit — la même ancre suivie deux fois, chaque entrée garde la sienne (400),
// sans entrée lisible, comme sans l'API, celle de la dernière quittée (150) ; les liens naviguent, une visite par clic ; un
// écouteur `navigate` de la page qui annule un lien : l'API reconnue, le lien ne fait rien ; sinon l'adresse reste et la page
// demandée arrive, comme sans interception
const tooled = (t: typeof TOOLS[number]): Case => ({
  name: 'la vraie API derrière ' + t.name + ' : ' + (t.kept ? 'MJS la reconnaît' : 'MJS ne la reconnaît pas, seule l\'interception est écartée') + ' ; la même ancre suivie deux fois, ' + (t.entry ? 'chaque entrée garde sa position' : 'la position de la dernière quittée') + ', sans l\'API celle de la dernière quittée ; une visite par clic ; un écouteur `navigate` qui annule un lien : ' + (t.kept ? 'le lien ne fait rien' : 'l\'adresse reste, la page demandée arrive') + ' ; en développement et en production',
  run: async (r) => {
    const open = (path: string) => t.init ? r.open(path, t.init) : openWithBody(r, path, t.how!)
    for (const x of ['', '/prod']) {
      const at = x ? 'en production' : 'en développement'
      let p = await open(x + '/p1')
      if (!x) assert.equal(await p.evaluate(KEPT), t.kept && !r.withoutApi ? 'window.navigation' : 'aucune', 'l\'API gardée par MJS, ' + at)
      await p.evaluate(() => document.getElementById('lp2')!.click())
      await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
      assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at + ' ; adresse ' + (await address(p)) + ', requêtes : ' + hits(r.site).join(', '))
      assert.equal(await address(p), x + '/p2', at)
      assert.ok(await sameDocument(p), 'même document, ' + at)
      assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], 'une seule requête, ' + at)
      assert.equal((await events(p)).filter(e => e.startsWith('visit ')).length, 1, 'un seul `mjs:visit`, ' + at)
      await p.close()
      if (!r.withoutApi) {
        p = await open(x + '/p1')
        await p.evaluate(() => { (window as any).navigation.addEventListener('navigate', (e: any) => { if (e.navigationType === 'push' && /\/p2$/.test(new URL(e.destination.url).pathname)) e.preventDefault() }) })
        await p.evaluate(() => document.getElementById('lp2')!.click())
        if (!t.kept) await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
        await p.waitForTimeout(600)
        assert.equal(await address(p), x + '/p1', 'lien annulé : l\'adresse reste, ' + at)
        assert.ok(await sameDocument(p), 'lien annulé : même document, ' + at)
        assert.ok(await p.evaluate((kept) => kept ? !!document.getElementById('nom-p1') && !document.getElementById('nom-p2') : !!document.getElementById('nom-p2'), t.kept), 'lien annulé : ' + (t.kept ? 'la page reste' : 'la page demandée arrive') + ', ' + at)
        assert.deepEqual(hits(r.site), t.kept ? [] : ['GET ' + x + '/p2 mjs'], 'lien annulé, ' + at)
        await p.close()
      }
      p = await open((x ? '/ahp' : '/ah') + '/p1')
      assert.equal(await anchorTwice(p), r.withoutApi || !t.entry ? 150 : 400, 'la même ancre suivie deux fois, ' + at)
      await p.close()
    }
  },
})

const CASES: Case[] = [
  {
    name: 'lien vers une page lente : l\'adresse engagée dès le clic, aucun départ annoncé pendant la visite ni après ; avec l\'API, par une navigation interceptée',
    run: async ({ open, site, withoutApi }) => {
      const p      = await open('/p1')
      const length = await p.evaluate(() => history.length)
      // l'entrée neuve, poussée par `pushState` : avec l'API, une navigation interceptée (une transition en cours), sans
      // elle aucune
      await p.evaluate(() => { const w = window as any; w.__tr = []; if (w.navigation) w.navigation.addEventListener('currententrychange', (e: any) => { if (e.navigationType === 'push') w.__tr.push(w.navigation.transition ? 'interceptée' : 'aucune') }) })
      // un écouteur `beforeunload` de la page : la visite ne quitte pas la page, il ne reçoit rien (WebKit en émet un pour
      // une navigation lancée par `navigation.navigate()`, que la visite n'emploie pas)
      await p.evaluate(() => { const w = window as any; w.__bu = 0; addEventListener('beforeunload', () => { w.__bu++ }) })
      await p.click('#llent')
      await p.waitForTimeout(400)
      assert.equal(await address(p), '/lent')
      assert.equal(await p.evaluate(() => (window as any).µ._mjs_left()), false, 'aucun départ annoncé pendant la visite')
      await p.waitForSelector('#nom-lent', { state: 'attached' })
      assert.ok(await sameDocument(p), 'même document')
      assert.equal(await p.evaluate(() => history.length), length + 1)
      assert.deepEqual(hits(site), ['GET /lent mjs'])
      assert.equal(await p.evaluate(() => (window as any).µ._mjs_left()), false, 'aucun départ annoncé après la visite')
      assert.equal(await p.evaluate(() => (window as any).__bu), 0, 'aucun `beforeunload` pour la page')
      if (!withoutApi) assert.deepEqual(await p.evaluate(() => (window as any).__tr), ['interceptée'], 'une navigation de l\'API, interceptée')
    },
  },
  {
    name: 'Précédent puis Suivant lancés par l\'API (`navigation.back()`, `navigation.forward()`) : chaque page revient du cache, sans requête',
    run: async ({ open, site }) => {
      const p = await open('/p1')
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      site.log.length = 0
      await p.evaluate(() => { const w = window as any; if (w.navigation) w.navigation.back().finished.catch(() => {}); else history.back() })
      await p.waitForSelector('#nom-p1', { state: 'attached' })
      assert.equal(await address(p), '/p1')
      await p.evaluate(() => { const w = window as any; if (w.navigation) w.navigation.forward().finished.catch(() => {}); else history.forward() })
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      assert.equal(await address(p), '/p2')
      assert.ok(await sameDocument(p), 'même document')
      assert.deepEqual(hits(site), [])
    },
  },
  {
    name: 'pendant la visite d\'une page lente, la page ne défile pas et le focus reste en place ; la page reçue part du haut',
    run: async ({ open }) => {
      const p = await open('/p1')
      await scrollToY(p, 900)
      await p.click('#llent')
      const before = await focused(p)
      await p.waitForTimeout(400)
      assert.equal(await p.evaluate(() => Math.round(scrollY)), 900, 'la page n\'a pas bougé')
      assert.equal(await focused(p), before, 'le focus n\'a pas bougé')
      await p.waitForSelector('#nom-lent', { state: 'attached' })
      assert.equal(await settle(p), 0)
    },
  },
  {
    name: 'navigation lancée par un script (`navigation.navigate()`, sans l\'API `location.assign()`) : laissée au navigateur, une entrée neuve ; `history: \'replace\'` (sans l\'API `location.replace()`) : l\'entrée remplacée',
    run: async ({ open, site, withoutApi }) => {
      const p      = await open('/p1')
      const length = await p.evaluate(() => history.length)
      await p.evaluate((w) => { const n = (window as any).navigation; if (w) location.assign('/p2'); else { const r = n.navigate('/p2'); r.committed.catch(() => {}); r.finished.catch(() => {}) } }, withoutApi)
      await until(p, () => !!document.getElementById('nom-p2') && (window as any).__doc !== 'départ' && history.scrollRestoration === 'manual')
      assert.equal(await p.evaluate(() => history.length), length + 1)
      assert.deepEqual(hits(site), ['GET /p2 navigateur'])
      site.log.length = 0
      await p.evaluate(() => { (window as any).__doc = 'deuxième' })
      await p.evaluate((w) => { const n = (window as any).navigation; if (w) location.replace('/p3'); else { const r = n.navigate('/p3', { history: 'replace' }); r.committed.catch(() => {}); r.finished.catch(() => {}) } }, withoutApi)
      await until(p, () => !!document.getElementById('nom-p3') && (window as any).__doc !== 'deuxième' && history.scrollRestoration === 'manual')
      assert.equal(await address(p), '/p3')
      assert.equal(await p.evaluate(() => history.length), length + 1)
      assert.deepEqual(hits(site), ['GET /p3 navigateur'])
    },
  },
  departure('visit', ''),
  departure('load', ''),
  departure('visit', '/prod'),
  departure('load', '/prod'),
  {
    name: 'après une visite par lien, `history.state` est l\'objet vide de l\'entrée poussée, avec ou sans l\'API, en développement et en production',
    run: async ({ open }) => {
      for (const x of ['', '/prod']) {
        const p = await open(x + '/p1')
        await p.click('#lp2')
        await p.waitForSelector('#nom-p2', { state: 'attached' })
        assert.equal(await p.evaluate(() => JSON.stringify(history.state)), '{}')
        assert.equal(await p.evaluate(() => typeof history.state.x), 'undefined')
        await p.close()
      }
    },
  },
  {
    name: 'un écouteur `navigate` de la page, posé avant ou après le runtime, qui annule la navigation d\'un lien : le lien ne fait rien, sans erreur (l\'adresse et la page restent, aucune requête, aucune visite annoncée) ; le clic suivant navigue ; en développement et en production ; sans l\'API, aucun écouteur, la visite a lieu',
    run: async (r) => {
      for (const { x, pre } of placements(r.withoutApi)) {
        const at     = where(x, pre)
        const p      = await openWith(r, x, pre)
        const length = await p.evaluate(() => history.length)
        await p.evaluate(() => { (window as any).__on = 'annule'; document.getElementById('lp2')!.click() })
        if (r.withoutApi) {
          await p.waitForSelector('#nom-p2', { state: 'attached' })
          assert.equal(await address(p), '/p2')
          continue
        }
        await p.waitForTimeout(600)
        assert.equal(await address(p), x + '/p1', at)
        assert.ok(await p.evaluate(() => !!document.getElementById('nom-p1') && !document.getElementById('nom-p2')), 'la page reste entière, ' + at)
        assert.ok(await sameDocument(p), 'même document, ' + at)
        assert.equal(await p.evaluate(() => history.length), length, at)
        assert.deepEqual(hits(r.site), [], at)
        assert.deepEqual((await events(p)).slice(1), ['before-visit link ' + x + '/p2'], at)
        assert.deepEqual(r.errors, [], 'aucune erreur, ' + at)
        await p.evaluate(() => { (window as any).__on = ''; document.getElementById('lp2')!.click() })
        await p.waitForSelector('#nom-p2', { state: 'attached' })
        assert.equal(await address(p), x + '/p2', at)
        assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], at)
        await p.close()
      }
    },
  },
  {
    name: 'pendant la visite en vol d\'une page lente, un écouteur `navigate` de la page (avant ou après le runtime) qui annule un lien : le lien ne fait rien, la visite en vol continue et arrive, sa requête n\'est pas coupée ; en développement et en production ; sans l\'API, le lien l\'emporte',
    run: async (r) => {
      for (const { x, pre } of placements(r.withoutApi)) {
        const at = where(x, pre)
        const p  = await openWith(r, x, pre)
        await p.click('#llent')
        await waitHit(r.site, h => h.path === x + '/lent')
        await p.evaluate(() => { (window as any).__on = 'annule'; document.getElementById('lp2')!.click() })
        if (r.withoutApi) {
          await p.waitForSelector('#nom-p2', { state: 'attached' })
          await p.waitForTimeout(SLOW)
          assert.equal(await address(p), '/p2')
          assert.ok(await p.evaluate(() => !document.getElementById('nom-lent')), 'la page lente ne s\'affiche pas')
          continue
        }
        await p.waitForSelector('#nom-lent', { state: 'attached', timeout: SLOW + 3000 }).catch(() => {})
        await p.waitForTimeout(300)
        assert.equal(await address(p), x + '/lent', at)
        assert.ok(await p.evaluate(() => !!document.getElementById('nom-lent') && !document.getElementById('nom-p2')), 'la page lente arrive, ' + at)
        assert.ok(await sameDocument(p), 'même document, ' + at)
        assert.deepEqual(hits(r.site), ['GET ' + x + '/lent mjs'], at)
        assert.deepEqual(r.errors, [], 'aucune erreur, ' + at)
        await p.close()
      }
    },
  },
  {
    name: 'un écouteur `navigate` de la page (avant ou après le runtime) qui range l\'état de l\'entrée par `replaceState` pendant le `pushState` d\'un lien : la navigation du lien, abandonnée par le navigateur, se joue comme sans l\'API — la page demandée arrive, sans erreur, l\'adresse reste celle de l\'entrée rangée ; le clic suivant navigue ; en développement et en production',
    run: async (r) => {
      for (const { x, pre } of placements(r.withoutApi)) {
        const at = where(x, pre)
        const p  = await openWith(r, x, pre)
        await p.evaluate(() => { (window as any).__on = 'remplace'; document.getElementById('lp2')!.click() })
        await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
        await p.waitForTimeout(200)
        assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at)
        assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], at)
        assert.equal(await address(p), r.withoutApi ? '/p2' : x + '/p1', at)
        if (!r.withoutApi) assert.equal(await p.evaluate(() => JSON.stringify(history.state)), '{"y":0}', at)
        assert.deepEqual(r.errors, [], 'aucune erreur, ' + at)
        await p.evaluate(() => document.getElementById('lp3')!.click())
        await p.waitForSelector('#nom-p3', { state: 'attached' })
        assert.equal(await address(p), x + '/p3', at)
        await p.close()
      }
    },
  },
  {
    name: 'un écouteur `navigate` de la page (avant ou après le runtime) qui pousse une autre entrée (`pushState`) pendant le `pushState` d\'un lien : la navigation du lien, abandonnée par le navigateur, se joue comme sans l\'API — la page demandée arrive, sans erreur, l\'adresse est celle de l\'écouteur ; le clic suivant navigue ; en développement et en production',
    run: async (r) => {
      for (const { x, pre } of placements(r.withoutApi)) {
        const at     = where(x, pre)
        const p      = await openWith(r, x, pre)
        const length = await p.evaluate(() => history.length)
        await p.evaluate(() => { (window as any).__on = 'pousse'; document.getElementById('lp2')!.click() })
        await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
        await p.waitForTimeout(200)
        assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at)
        assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], at)
        assert.equal(await address(p), r.withoutApi ? '/p2' : x + '/p1?lib', at)
        assert.equal(await p.evaluate(() => history.length), length + 1, at)
        assert.deepEqual(r.errors, [], 'aucune erreur, ' + at)
        await p.evaluate(() => document.getElementById('lp3')!.click())
        await p.waitForSelector('#nom-p3', { state: 'attached' })
        assert.equal(await address(p), x + '/p3', at)
        await p.close()
      }
    },
  },
  {
    name: 'un écouteur `navigate` de la page (avant ou après le runtime) qui lève pendant le `pushState` d\'un lien : la visite a lieu, la seule erreur est celle de l\'écouteur ; en développement et en production',
    run: async (r) => {
      for (const { x, pre } of placements(r.withoutApi)) {
        const at = where(x, pre)
        const p  = await openWith(r, x, pre)
        await p.evaluate(() => { (window as any).__on = 'leve'; document.getElementById('lp2')!.click() })
        await p.waitForSelector('#nom-p2', { state: 'attached', timeout: 5000 }).catch(() => {})
        await p.waitForTimeout(200)
        assert.equal(await address(p), x + '/p2', at)
        assert.ok(await p.evaluate(() => !!document.getElementById('nom-p2')), 'la page demandée arrive, ' + at)
        assert.deepEqual(hits(r.site), ['GET ' + x + '/p2 mjs'], at)
        assert.deepEqual(r.errors.splice(0), r.withoutApi ? [] : ['écouteur de la page'], at)
        await p.close()
      }
    },
  },
  elsewhere('href', '`preventDefault()` puis `location.href = e.destination.url`'),
  elsewhere('assign', '`location.assign()`'),
  elsewhere('replace', '`location.replace()`'),
  elsewhere('navigate', '`navigation.navigate()`'),
  {
    name: 'Précédent puis un clic sur un lien dans la même tâche : le navigateur tranche, avec ou sans l\'API (Chromium et WebKit : le retour l\'emporte ; Firefox : le clic)',
    run: async ({ open, engine }) => {
      const p = await open('/p1')
      await p.click('#lp2')
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await p.evaluate(() => { history.back(); document.getElementById('lp3')!.click() })
      await p.waitForTimeout(1500)
      const want = engine === 'firefox' ? '/p3' : '/p1'
      assert.equal(await address(p), want)
      assert.ok(await p.evaluate((id) => !!document.getElementById(id), 'nom-' + want.slice(1)), 'la page de l\'adresse est affichée')
      assert.ok(await sameDocument(p), 'même document')
    },
  },
  {
    // la requête de la première part ou non selon le moteur et la charge (WebKit sans l'API peut l'abandonner avant l'envoi) :
    // seule compte qu'elle n'aboutisse pas
    name: 'deux liens dans la même tâche : la seconde visite l\'emporte, la première est abandonnée (sa requête, si elle part, est coupée)',
    run: async ({ open, site }) => {
      const p      = await open('/p1')
      const length = await p.evaluate(() => history.length)
      await p.evaluate(() => { document.getElementById('llent')!.click(); document.getElementById('lp2')!.click() })
      await p.waitForSelector('#nom-p2', { state: 'attached' })
      await p.waitForTimeout(SLOW + 300)
      assert.equal(await address(p), '/p2')
      assert.ok(await p.evaluate(() => !document.getElementById('nom-lent')), 'la page lente ne s\'affiche pas')
      assert.equal(await p.evaluate(() => history.length), length + 2)
      assert.ok(site.log.every(h => h.path !== '/lent' || h.cut), 'la requête de la première est coupée : ' + hits(site).join(', '))
      assert.ok(site.log.some(h => h.path === '/p2' && h.mjs), hits(site).join(', '))
    },
  },
  ...MASKS.map(masked),
  shimmed('pendant', 'pendant', 'qui pousse l\'entrée et joue les gestionnaires d\'`intercept` pendant l\'appel `pushState`'),
  shimmed('pendant', 'micro', 'qui pousse l\'entrée pendant l\'appel et joue les gestionnaires après lui, en micro-tâche'),
  shimmed('pendant', 'tache', 'qui pousse l\'entrée pendant l\'appel et joue les gestionnaires après lui, dans une tâche'),
  shimmed('pendant', 'jamais', 'qui pousse l\'entrée pendant l\'appel et ne joue jamais les gestionnaires'),
  shimmed('micro', 'micro', 'qui pousse l\'entrée après l\'appel, en micro-tâche, puis joue les gestionnaires'),
  shimmed('micro', 'jamais', 'qui pousse l\'entrée après l\'appel, en micro-tâche, et ne joue jamais les gestionnaires'),
  shimmed('tache', 'tache', 'qui pousse l\'entrée après l\'appel, dans une tâche, puis joue les gestionnaires'),
  shimmed('tache', 'jamais', 'qui pousse l\'entrée après l\'appel, dans une tâche, et ne joue jamais les gestionnaires'),
  shimmed('jamais', 'pendant', 'qui ne pousse jamais l\'entrée et joue les gestionnaires pendant l\'appel'),
  shimmed('jamais', 'jamais', 'qui ne pousse jamais l\'entrée et ne joue jamais les gestionnaires'),
  wrapped('pendant', true, false, 'qui appelle celui du navigateur pendant l\'appel'),
  wrapped('micro', true, false, 'qui appelle celui du navigateur après l\'appel, en micro-tâche'),
  wrapped('micro', false, false, 'qui appelle celui du navigateur après l\'appel, en micro-tâche'),
  wrapped('tache', true, false, 'qui appelle celui du navigateur après l\'appel, dans une tâche'),
  wrapped('jamais', true, false, 'qui n\'appelle jamais celui du navigateur'),
  wrapped('jamais', false, false, 'qui n\'appelle jamais celui du navigateur'),
  wrapped('pendant', true, true, 'qui simule le `navigate` de l\'API puis appelle celui du navigateur pendant l\'appel'),
  wrapped('micro', true, true, 'qui simule le `navigate` de l\'API puis appelle celui du navigateur après l\'appel, en micro-tâche'),
  wrapped('jamais', true, true, 'qui simule le `navigate` de l\'API et n\'appelle jamais celui du navigateur'),
  wrapped('pendant', true, false, 'qui appelle celui du navigateur pendant l\'appel', 'liée'),
  wrapped('micro', true, false, 'qui appelle celui du navigateur après l\'appel, en micro-tâche', 'liée'),
  wrapped('tache', true, false, 'qui appelle celui du navigateur après l\'appel, dans une tâche', 'liée'),
  wrapped('jamais', true, false, 'qui n\'appelle jamais celui du navigateur', 'liée'),
  wrapped('pendant', true, false, 'qui appelle celui du navigateur pendant l\'appel', 'Proxy'),
  wrapped('micro', true, false, 'qui appelle celui du navigateur après l\'appel, en micro-tâche', 'Proxy'),
  wrapped('tache', true, false, 'qui appelle celui du navigateur après l\'appel, dans une tâche', 'Proxy'),
  wrapped('jamais', true, false, 'qui n\'appelle jamais celui du navigateur', 'Proxy'),
  ...TOOLS.map(tooled),
]

matrix('navigation, matrice du moteur — navigateur réel, vrai projet, avec et sans window.navigation', CASES)
