// *heatmap : ce que le SERVEUR reçoit — le vrai effet (mjs_fx_heatmap.ts), la vraie connexion µ.socket
// (mjs_socket.ts : sa part de 4 trames par seconde pour tous les effets en direct) et le vrai paquet
// heatmapPackage, par un MemoryTransport. Les points partent par lots (une trame porte plusieurs points
// quand la part est épuisée), aucun n'est perdu ; l'adresse de la page ne laisse partir ni jeton ni
// identifiant (le masque complet : chaleur-masque-adresses.test.ts ; la route du routeur MJS part telle quelle,
// jamais sous son motif : une page par article) ; `*heatmap('wss://…')` dit qu'une adresse n'est pas un
// événement ; le relais de défilement des composants dessine à nouveau.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI        = dirname(fileURLToPath(import.meta.url))
const source     = (f: string) => readFileSync(join(ICI, '../src/runtime/' + f), 'utf8')
const socketSrc  = source('mjs_socket.ts')
const routerSrc  = source('mjs_router.ts')
const heatmapSrc = source('mjs_fx_heatmap.ts')
const tick       = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 6000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await tick(10)
}

// une page de navigateur réduite à ce que l'effet touche, branchée sur un vrai serveur
async function visite(reglages: { rate?: number } = {}) {
  const transport         = new MemoryTransport()
  const recus: any[]      = []
  const trames: any[]     = []
  const erreurs: string[] = []
  const app: any          = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  app.use(heatmapPackage({ origins: ['https://site.fr'], onPoint: (p: any) => recus.push(p) }))
  app.on('heatmap:point', (p: any) => trames.push(p))
  await app.listen()
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols, origin: 'https://site.fr' }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: (...a: any[]) => { erreurs.push(a.join(' ')) }, warn() {}, log() {}, _mjs_fxDefs: {}, _mjs_fxInner: () => null, _mjs_fxAdopt() {}, _mjs_fxRelative: () => () => {}, _mjs_dom: new Proxy({}, { get: (_, nom: string) => (n: any, ...args: any[]) => n[nom](...args) }), elementAt: () => null, _mjs_scrollSubs: new Set() }
  poserMessages(µ)
  if (reglages.rate) µ._fxConf = { rate: reglages.rate }
  const location: any = { origin: 'https://site.fr', pathname: '/', hash: '', href: 'https://site.fr/' }
  new Function('µ', 'location', socketSrc)(µ, location)
  new Function('µ', routerSrc)(µ)
  // la page est à cette adresse (chemin, puis route du routeur MJS)
  const va                    = (pathname: string, hash = '') => { location.pathname = pathname; location.hash = hash; location.href = 'https://site.fr' + pathname + hash }
  const document: any         = { documentElement: {}, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, remove() {}, getContext: () => null }) }
  const window: any           = { scrollX: 0, scrollY: 0, innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} }
  let dessins                 = 0
  const attentes              = new Map<number, ReturnType<typeof setTimeout>>()
  const requestAnimationFrame = (f: () => void) => { const id = ++dessins; attentes.set(id, setTimeout(() => { attentes.delete(id); f() }, 0)); return id }
  const cancelAnimationFrame  = (id: number) => { clearTimeout(attentes.get(id)); attentes.delete(id) }
  new Function('µ', 'document', 'location', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', heatmapSrc)(µ, document, location, window, requestAnimationFrame, cancelAnimationFrame)
  const sock = µ.socket('memory://carte', { reconnect: { enabled: false } })
  sock.connect()
  await tick(10)
  const ecouteurs: Record<string, (ev: any) => void> = {}
  const el: any = { localName: 'div', clientWidth: 200, clientHeight: 100, addEventListener: (t: string, f: (ev: any) => void) => { ecouteurs[t] = f }, removeEventListener: (t: string) => { delete ecouteurs[t] }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) }
  const pose    = (cible: any, options: any = {}) => µ._mjs_fxDefs.heatmap.setup(cible, { sock, ...options })
  const clic    = (i = 0) => ecouteurs.click({ clientX: 5 + i, clientY: 5, detail: 1, composedPath: () => [el], target: el })
  return {
    µ, app, sock, el, document, window, ecouteurs, recus, trames, erreurs, va, pose, clic,
    dessins: () => dessins,
    // la place (en fraction de la largeur de la zone) du point reçu : ce qui dit LEQUEL est arrivé
    places: () => recus.map((p) => p.z[0][1]),
    async fermer() { sock.destroy(); await app.stop() }
  }
}

const attendus = (n: number) => Array.from({ length: n }, (_, i) => Math.round((5 + i) / 200 * 10000) / 10000)

describe('*heatmap — les points partent par lots, aucun n\'est perdu', function () {
  this.timeout(40000)

  it('20 points à 110 ms d\'écart, seuls sur la connexion : le serveur reçoit les 20, dans l\'ordre', async () => {
    const v = await visite()
    v.pose(v.el)
    for (let i = 0; i < 20; i++) { v.clic(i); await tick(110) }
    await attendre(() => v.recus.length >= 20)
    assert.deepEqual(v.places(), attendus(20), `${v.recus.length} points reçus sur 20`)
    await v.fermer()
  })

  it('avec le trafic d\'un *cursors sur la même connexion (la part des effets disputée), 6 clics : le serveur reçoit les 6', async () => {
    const v = await visite()
    v.pose(v.el)
    let fini = false
    // la souris bouge sans arrêt : les positions de *cursors (regroupées par 50 ms, volatiles) prennent la part
    ;(async () => { while (!fini) { v.sock.send('cursors:move', { room: '/', p: null, t: null }, { coalesce: 50, volatile: true, key: '/' }); await tick(5) } })()
    await tick(1200)
    for (let i = 0; i < 6; i++) { v.clic(i); await tick(110) }
    await attendre(() => v.recus.length >= 6, 8000)
    fini = true
    assert.deepEqual(v.places(), attendus(6), `${v.recus.length} points reçus sur 6`)
    await v.fermer()
  })

  it('la part des effets épuisée : les points attendent et partent ensemble — UNE trame porte plusieurs points', async () => {
    const v = await visite({ rate: 1 })
    v.pose(v.el)
    for (let i = 0; i < 12; i++) { v.clic(i); await tick(110) }
    await attendre(() => v.recus.length >= 12)
    assert.deepEqual(v.places(), attendus(12), `${v.recus.length} points reçus sur 12`)
    const lots = v.trames.filter((t) => Array.isArray(t.pts))
    assert.ok(lots.length >= 1 && lots.some((t) => t.pts.length > 1), 'une trame qui porte plusieurs points : ' + JSON.stringify(v.trames.map((t) => Array.isArray(t.pts) ? t.pts.length : 1)))
    assert.ok(v.trames.length < 12, `${v.trames.length} trames pour 12 points`)
    await v.fermer()
  })

  it('un lot ne dépasse pas 20 points : au-delà, les plus anciens s\'oublient', async () => {
    const v = await visite()
    const envoyes: any[] = []
    let libre = false
    const faux: any = { state: 'open', room() {}, _mjs_fxToken: () => libre, send(type: string, p: any) { envoyes.push([type, p]) } }
    v.pose(v.el, { sock: faux })
    const maintenant = Date.now
    try {
      // 30 clics, 200 ms les uns après les autres, la part des effets restant épuisée
      for (let i = 0; i < 30; i++) { Date.now = () => maintenant() + 1000 * (i + 1); v.clic(i) }
    }
    finally { Date.now = maintenant }
    assert.deepEqual(envoyes, [], 'rien ne part tant que la part est épuisée')
    libre = true
    const partis = () => envoyes.flatMap((e) => e[1].pts ?? [e[1]])
    await attendre(() => partis().length >= 20, 3000)
    await tick(300)
    // le seau de points de la connexion garde un jeton de côté : les vingt partent en deux trames, dans l'ordre
    assert.equal(partis().length, 20, 'vingt points au plus')
    assert.deepEqual(partis().map((p: any) => p.z[0][1]), attendus(30).slice(10), 'les plus récents')
    await v.fermer()
  })

  it('un lien saturé (ce que le navigateur n\'a pas encore envoyé dépasse la borne) : rien ne part de plus, le lot part quand il se vide', async () => {
    const v = await visite()
    const envoyes: any[] = []
    const faux: any = { state: 'open', room() {}, opts: {}, _mjs_ws: { bufferedAmount: 100000 }, _mjs_fxToken: () => true, send(type: string, p: any) { envoyes.push([type, p]) } }
    v.pose(v.el, { sock: faux })
    v.clic(0)
    await tick(250)
    assert.deepEqual(envoyes, [], 'le lien est saturé : le point attend')
    faux._mjs_ws.bufferedAmount = 0
    await attendre(() => envoyes.length > 0, 2000)
    assert.equal(envoyes.length, 1)
    assert.equal(envoyes[0][1].ev, 'click')
    await v.fermer()
  })

  it('le retrait d\'une connexion détruite par l\'appli n\'envoie rien (ni message d\'avertissement de la connexion)', async () => {
    const v = await visite()
    const envoyes: any[] = []
    const libre = false
    const faux: any = { state: 'open', room() {}, _mjs_fxToken: () => libre, send(type: string, p: any) { envoyes.push([type, p]) } }
    const arret = v.pose(v.el, { sock: faux })
    v.clic(0)
    faux._mjs_destroyed = true
    arret()
    await tick(150)
    assert.deepEqual(envoyes, [])
    await v.fermer()
  })

  it('le retrait de l\'effet envoie ce qui attend encore (un clic qui change de page)', async () => {
    const v = await visite({ rate: 1 })
    const arret = v.pose(v.el)
    v.clic(0)
    await tick(110)
    v.clic(1)
    await attendre(() => v.recus.length >= 1, 1000)
    assert.equal(v.recus.length, 1, 'le premier est parti, le second attend la part')
    arret()
    await attendre(() => v.recus.length >= 2, 600)
    assert.deepEqual(v.places(), attendus(2), 'le second part au retrait, sans attendre la part')
    await v.fermer()
  })
})

describe('*heatmap — l\'adresse de la page : ni jeton ni identifiant', function () {
  this.timeout(20000)

  // l'adresse de la page, telle que le serveur la reçoit
  async function adresse(v: any, pathname: string, hash = '', routes?: Record<string, string>) {
    v.va(pathname, hash)
    if (routes) v.µ.Router._mjs_awareComponents.add({ routes: { vue: routes } })
    v.pose(v.el)
    const avant = v.recus.length
    v.clic(0)
    await attendre(() => v.recus.length > avant, 3000)
    // l'adresse telle que le NAVIGATEUR l'envoie (le jeton ne doit pas en sortir), et telle que le serveur la garde
    const trame   = v.trames[v.trames.length - 1]
    const envoyee = trame.url ?? trame.pts[0].url
    assert.equal(v.recus[v.recus.length - 1]?.url, envoyee, 'le serveur garde ce que le navigateur a envoyé')
    return envoyee
  }

  it('un segment du chemin qui ressemble à un jeton part remplacé par _SECRET_ID_ — 16 caractères mêlant lettres et chiffres, ou 6 chiffres', async () => {
    const v = await visite()
    assert.equal(await adresse(v, '/reset/AbCd1234EfGh5678'), 'https://site.fr/reset/_SECRET_ID_')
    await v.fermer()
    const w = await visite()
    assert.equal(await adresse(w, '/commande/123456/suivi'), 'https://site.fr/commande/_SECRET_ID_/suivi')
    await w.fermer()
  })

  it('un segment ordinaire reste : 12, 5 chiffres, 15 caractères mêlés, un slug à tirets', async () => {
    for (const segment of ['12', '12345', 'abcd1234efgh567', 'top-10-des-meilleurs-outils', 'iphone-15-pro-max-256gb']) {
      const v = await visite()
      assert.equal(await adresse(v, '/p/' + segment), 'https://site.fr/p/' + segment, segment)
      await v.fermer()
    }
  })

  it('la route du routeur MJS : un jeton y part remplacé aussi (#/reset/…)', async () => {
    const v = await visite()
    assert.equal(await adresse(v, '/', '#/reset/AbCd1234EfGh5678?x=1'), 'https://site.fr/#/reset/_SECRET_ID_')
    await v.fermer()
  })

  it('la route du routeur MJS part telle quelle, jamais sous son motif : une page par article, quelles que soient les routes connues', async () => {
    const v = await visite()
    assert.equal(await adresse(v, '/', '#/blog/mon-article', { '/blog/:slug': 'mjs-article', '/': 'mjs-accueil' }), 'https://site.fr/#/blog/mon-article')
    await v.fermer()
    // deux routes correspondent (celle d'une coque et celle d'une page) : ni l'une ni l'autre ne passe pour l'adresse
    const w = await visite()
    w.µ.Router._mjs_awareComponents.add({ routes: { vue: { '/:section/:id': 'mjs-coque' } } })
    assert.equal(await adresse(w, '/', '#/p/12', { '/p/:id': 'mjs-page' }), 'https://site.fr/#/p/12')
    await w.fermer()
    // une route sans paramètre, un repli `/*`
    const x = await visite()
    assert.equal(await adresse(x, '/', '#/tarifs', { '/tarifs': 'mjs-tarifs', '/*': 'mjs-introuvable' }), 'https://site.fr/#/tarifs')
    await x.fermer()
  })
})

describe('*heatmap — un réglage qui n\'est pas un événement', function () {
  this.timeout(20000)

  it('*heatmap(\'wss://x\') : une erreur en console dit que c\'est un nom d\'événement, et que l\'adresse s\'écrit avec server', async () => {
    const v = await visite()
    const arret = v.pose(v.el, { on: 'wss://x' })
    assert.ok(v.erreurs.some((e) => /\*heatmap/.test(e) && /nom d'événement/.test(e) && /server/.test(e)), JSON.stringify(v.erreurs))
    assert.equal(typeof arret, 'function')
    assert.deepEqual(Object.keys(v.ecouteurs), [], 'aucun événement écouté')
    arret()
    await v.fermer()
  })

  it('un nom d\'événement valide : click par défaut, mousemove, pointerdown', async () => {
    const v = await visite()
    for (const on of [undefined, 'mousemove', 'pointerdown', 'mjs:menu']) {
      const arret = v.pose(v.el, { on })
      assert.deepEqual(Object.keys(v.ecouteurs), [on ?? 'click'])
      arret()
    }
    assert.deepEqual(v.erreurs, [])
    await v.fermer()
  })
})

describe('*heatmap show — le défilement d\'un composant redessine la chaleur de la page', function () {
  this.timeout(20000)

  it('posé sur la page, il s\'abonne au relais de défilement du cœur ; son retrait s\'en désabonne', async () => {
    const v = await visite()
    const arret = v.pose(v.document.documentElement, { show: true })
    assert.equal(v.µ._mjs_scrollSubs.size, 1, 'abonné au défilement relayé')
    await tick(20)
    const avant = v.dessins()
    ;[...v.µ._mjs_scrollSubs][0]({ type: 'scroll' })
    assert.equal(v.dessins(), avant + 1, 'un défilement relayé redessine')
    arret()
    assert.equal(v.µ._mjs_scrollSubs.size, 0, 'désabonné au retrait')
    await v.fermer()
  })
})
