// Rappel d'exclusion d'un salon (`onLeft`) tenu par plusieurs poignées sur une même connexion (deux composants, une
// discussion ou un hall et un composant qui écoute ce salon) : le salon ne gardait qu'un seul rappel, le dernier posé
// effaçait celui de l'autre poignée — une seule était prévenue de l'exclusion, et le départ de celle qui avait posé le
// dernier laissait l'autre sans rappel. Chaque poignée garde désormais le sien : une exclusion les appelle tous, le départ
// d'une poignée (leave(), fermeture de la discussion à la destruction de son composant) ne retire que le sien, et rien
// ne reste sur la connexion après le départ de toutes.
// Faux WebSocket, pour voir exactement ce que le client envoie ; le composant est réduit à ses deux files (destruction,
// montage), celles de mjs_lifecycle.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
// concaténés comme le fait le bundler : la connexion d'abord, la discussion et le hall ensuite
const SRC = lire('mjs_socket.ts') + '\n' + lire('mjs_chat.ts') + '\n' + lire('mjs_lobby.ts')

class FauxWS {
  static tous: FauxWS[] = []
  url: string; readyState = 0; envoyes: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.tous.push(this) }
  send(data: string) { this.envoyes.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  recevoir(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
}

const avant   = (globalThis as any).WebSocket
const dernier = (): FauxWS => FauxWS.tous[FauxWS.tous.length - 1]

let actif: any = null
function dans<T>(comp: any, fn: () => T): T { actif = comp; try { return fn() } finally { actif = null } }

function composant(): any {
  return {
    _mjs_destroy_cbs: null as any,
    _mjs_mount_cbs: null as any,
    _mjs_onDestroy(fn: () => void) { (this._mjs_destroy_cbs ||= []).push(fn); return fn },
    detruire() { const cbs = this._mjs_destroy_cbs || []; this._mjs_destroy_cbs = null; for (const f of cbs) f() },
  }
}

function connecter(url: string): { s: any, ws: FauxWS } {
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  Object.defineProperty(µ, 'activeComponent', { get: () => actif })
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 } })
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws }
}

const exclure = (ws: FauxWS, salon: string): void => ws.recevoir({ t: 'µ:left', p: { room: salon, reason: 'kick' } })
const departs = (ws: FauxWS, salon: string): number => ws.envoyes.filter(m => m.t === 'µ:leave' && m.p.room === salon).length

// la connexion retient-elle encore cette valeur ? parcours de tout ce qu'elle référence (objets, tableaux, Map, Set)
function retient(racine: any, cible: any): boolean {
  const vus = new Set<any>()
  const pile: any[] = [racine]
  while (pile.length) {
    const o = pile.pop()
    if (o === cible) return true
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || vus.has(o)) continue
    vus.add(o)
    if (o instanceof Map) { for (const [k, v] of o) pile.push(k, v) }
    if (o instanceof Set) { for (const v of o) pile.push(v) }
    for (const k of Object.keys(o)) pile.push(o[k])
  }
  return false
}

describe('µ.socket — un rappel d\'exclusion par poignée de salon', () => {
  beforeEach(() => { FauxWS.tous = []; actif = null })
  after(() => { (globalThis as any).WebSocket = avant })

  it('deux poignées du même salon posent chacune un rappel : une exclusion les appelle toutes les deux', () => {
    const { s, ws } = connecter('wss://deux-rappels')
    const a = s.room('partie'), b = s.room('partie')
    const appels: string[] = []
    a.onLeft((r: any) => appels.push('a:' + r))
    b.onLeft((r: any) => appels.push('b:' + r))
    exclure(ws, 'partie')
    assert.deepEqual(appels, ['a:kick', 'b:kick'], 'chaque poignée est prévenue, avec la raison, dans l\'ordre de pose')
    s.destroy()
  })

  it('une poignée part, l\'autre garde son rappel', () => {
    const { s, ws } = connecter('wss://un-depart')
    const a = s.room('partie'), b = s.room('partie')
    const appels: string[] = []
    a.onLeft(() => appels.push('a'))
    b.onLeft(() => appels.push('b'))
    b.leave()
    assert.equal(departs(ws, 'partie'), 0, 'le salon reste tenu par l\'autre poignée')
    exclure(ws, 'partie')
    assert.deepEqual(appels, ['a'], 'la poignée restante est prévenue, celle partie ne l\'est plus')
    s.destroy()
  })

  it('une poignée qui pose de nouveau son rappel remplace le sien, jamais celui de l\'autre', () => {
    const { s, ws } = connecter('wss://rappel-remplace')
    const a = s.room('partie'), b = s.room('partie')
    const appels: string[] = []
    a.onLeft(() => appels.push('a1'))
    b.onLeft(() => appels.push('b'))
    a.onLeft(() => appels.push('a2'))
    exclure(ws, 'partie')
    assert.deepEqual(appels.slice().sort(), ['a2', 'b'], 'le premier rappel de a est remplacé, celui de b reste')
    s.destroy()
  })

  it('un rappel qui quitte sa poignée pendant l\'exclusion n\'empêche pas les autres d\'être prévenus', () => {
    const { s, ws } = connecter('wss://rappel-qui-part')
    const a = s.room('partie'), b = s.room('partie')
    const appels: string[] = []
    a.onLeft(() => { a.leave(); appels.push('a') })
    b.onLeft(() => appels.push('b'))
    exclure(ws, 'partie')
    assert.deepEqual(appels, ['a', 'b'])
    assert.equal(departs(ws, 'partie'), 0, 'aucun µ:leave pour un salon dont le serveur vient d\'exclure le client')
    s.destroy()
  })

  it('la discussion fermée à la destruction de son composant ne retire pas le rappel d\'une autre poignée du salon', () => {
    const { s, ws } = connecter('wss://discussion-et-zone')
    const comp = composant()
    dans(comp, () => s.chat('general'))
    const zone = s.room('chat:general')
    const appels: string[] = []
    zone.onLeft((r: any) => appels.push('zone:' + r))
    comp.detruire()
    assert.equal(departs(ws, 'chat:general'), 0, 'la zone tient encore le salon')
    exclure(ws, 'chat:general')
    assert.deepEqual(appels, ['zone:kick'], 'la zone est prévenue de son exclusion')
    s.destroy()
  })

  it('rien ne reste sur la connexion après le départ de toutes les poignées', () => {
    const { s, ws } = connecter('wss://rien-ne-reste')
    const a = s.room('partie'), b = s.room('partie')
    const appels: string[] = []
    const fa = (): void => { appels.push('a') }
    const fb = (): void => { appels.push('b') }
    a.onLeft(fa)
    b.onLeft(fb)
    assert.ok(retient(s, fa) && retient(s, fb), 'les deux rappels sont tenus tant que le salon l\'est')
    a.leave()
    assert.equal(retient(s, fa), false, 'le rappel de la poignée partie n\'est plus tenu')
    assert.ok(retient(s, fb), 'celui de la poignée qui reste l\'est toujours')
    b.leave()
    assert.equal(departs(ws, 'partie'), 1, 'la dernière poignée quitte le salon')
    assert.equal(retient(s, fb), false, 'plus aucun rappel tenu après le départ de toutes')
    exclure(ws, 'partie')
    assert.deepEqual(appels, [], 'une exclusion tardive n\'appelle plus personne')
    s.destroy()
  })
})
