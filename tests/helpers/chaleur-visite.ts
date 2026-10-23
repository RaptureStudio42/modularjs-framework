// chaleur-visite — une page de navigateur réduite à ce que `*heatmap` touche (mjs_fx_heatmap.ts), branchée par la vraie
// connexion µ.socket (mjs_socket.ts) sur un vrai serveur MJS WS (MemoryTransport) : de quoi compter les points ENVOYÉS
// par l'effet et les points REÇUS par le paquet heatmapPackage

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, heatmapPackage } from '../../src/mjs-ws/index.js'
import { MemoryTransport } from '../../src/mjs-ws/transport.js'
import { poserMessages } from './messages-stub.js'

const ICI = dirname(fileURLToPath(import.meta.url))

export const lire        = (f: string) => readFileSync(join(ICI, '../../src/runtime/' + f), 'utf8')
export const socketSrc   = lire('mjs_socket.ts')
export const routerSrc   = lire('mjs_router.ts')
export const heatmapSrc  = lire('mjs_fx_heatmap.ts')
export const tick        = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

export async function attendre(cond: () => boolean, ms = 6000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await tick(10)
}

export interface VisiteOptions {
  // la part des effets en direct, en trames par seconde (µ._fxConf.rate)
  rate?: number
  // la connexion est ouverte avant le premier point (défaut) ; false : paresseuse, rien ne l'a ouverte
  connecte?: boolean
  // la connexion se rouvre seule après une coupure, au bout de ce délai en ms (défaut : elle ne se rouvre pas)
  reconnexion?: number
  // la borne du lien (opts.maxBuffered de la connexion)
  maxBuffered?: number
  // le serveur n'a pas le paquet heatmapPackage
  sansPaquet?: boolean
  // les limites du serveur MJS WS (limits : maxPayload…)
  limites?: Record<string, number>
  // les réglages du paquet, en plus de `origins` et `onPoint`
  paquet?: Record<string, unknown>
}

// un élément de page : ses écouteurs, et de quoi tirer un événement dessus (`i` décale la place du point)
export function element(localName = 'div') {
  const ecouteurs: Record<string, (ev: any) => void> = {}
  const el: any = { localName, clientWidth: 200, clientHeight: 100, addEventListener: (t: string, f: (ev: any) => void) => { ecouteurs[t] = f }, removeEventListener: (t: string) => { delete ecouteurs[t] }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) }
  const tire = (type: string, i = 0) => ecouteurs[type]({ clientX: 5 + i, clientY: 5, detail: 1, composedPath: () => [el], target: el })
  return { el, ecouteurs, tire }
}

// la place (en fraction de la largeur de la zone) du point tiré par `tire(type, i)` : ce qui dit LEQUEL est arrivé
export const place = (i: number) => Math.round((5 + i) / 200 * 10000) / 10000
export const attendus = (n: number) => Array.from({ length: n }, (_, i) => place(i))

export async function visite(options: VisiteOptions = {}) {
  const transport         = new MemoryTransport()
  const recus: any[]      = []
  const trames: any[]     = []
  const erreurs: string[] = []
  const app: any          = mjsWs({ transport, heartbeat: 0, onLog: () => {}, ...(options.limites ? { limits: options.limites } : {}) })
  if (!options.sansPaquet) {
    app.use(heatmapPackage({ origins: ['https://site.fr'], onPoint: (p: any) => recus.push(p), ...options.paquet }))
    app.on('heatmap:point', (p: any) => trames.push(p))
  }
  await app.listen()
  let connexions = 0
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { connexions++; return transport.connect({ url, protocols, origin: 'https://site.fr' }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: (...a: any[]) => { erreurs.push(a.join(' ')) }, warn() {}, log() {}, _mjs_fxDefs: {}, _mjs_fxInner: () => null, _mjs_fxAdopt() {}, _mjs_fxRelative: () => () => {}, _mjs_dom: new Proxy({}, { get: (_, nom: string) => (n: any, ...args: any[]) => n[nom](...args) }), elementAt: () => null, _mjs_scrollSubs: new Set() }
  poserMessages(µ)
  if (options.rate) µ._fxConf = { rate: options.rate }
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
  const reglages: any = { reconnect: options.reconnexion ? { backoff: [options.reconnexion], jitter: 0 } : { enabled: false } }
  if (options.maxBuffered) reglages.maxBuffered = options.maxBuffered
  const sock = µ.socket('memory://carte', reglages)
  if (options.connecte !== false) {
    sock.connect()
    await tick(10)
  }
  // les points que les effets ont confiés à la connexion (une trame en porte un, ou plusieurs dans `pts`)
  let emis = 0
  const envoyer = sock.send.bind(sock)
  sock.send = (type: string, p: any, o: any) => {
    if (type === 'heatmap:point') emis += Array.isArray(p && p.pts) ? p.pts.length : 1
    return envoyer(type, p, o)
  }
  const page = element()
  const pose = (cible: any, reglage: any = {}) => µ._mjs_fxDefs.heatmap.setup(cible, { sock, ...reglage })
  return {
    µ, app, sock, transport, document, window, recus, trames, erreurs, va, pose, element,
    el: page.el, ecouteurs: page.ecouteurs, clic: (i = 0) => page.tire('click', i),
    dessins: () => dessins,
    connexions: () => connexions,
    emis: () => emis,
    places: () => recus.map((p) => p.z[0][1]),
    async fermer() {
      sock.destroy()
      await app.stop()
    }
  }
}
