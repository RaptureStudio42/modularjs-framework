// Un salon, un flux ou un type de message nommé comme une méthode que tout objet JavaScript hérite (`toString`,
// `constructor`, `__proto__`, `hasOwnProperty`, `valueOf`) : les registres de la connexion étaient des objets ordinaires,
// où ce nom trouvait la méthode héritée. `room('toString')` se croyait déjà dans le salon (aucun `µ:join`, jamais rejoint
// à la reconnexion), `presence()` d'un tel salon rendait la méthode au lieu d'un store, `stream('constructor')` rendait
// `undefined`, `on('valueOf', …)` levait une erreur, et une trame du serveur nommée `__proto__` écrivait sur
// `Object.prototype`. Ces noms se rejoignent, s'écoutent et se quittent comme les autres.
// Faux WebSocket, pour voir exactement ce que le client envoie.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const NOMS = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']

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

function connecter(url: string): { s: any, ws: FauxWS } {
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 } })
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws }
}

const trames = (ws: FauxWS, t: string, cle: string, nom: string): number => ws.envoyes.filter(m => m.t === t && m.p && m.p[cle] === nom).length

// ce que le test a pu écrire sur Object.prototype ou sur les méthodes héritées : relevé, puis retiré (un échec ne laisse
// rien aux fichiers de test suivants)
const herites = (): any[] => [Object.prototype, ...NOMS.map(n => (Object.prototype as any)[n]).filter(v => typeof v === 'function')]
let AVANT = new Map<any, Set<string>>()
const instantane = (): void => { AVANT = new Map(herites().map(o => [o, new Set(Object.getOwnPropertyNames(o))])) }
function ajoutsHerites(): string[] {
  const vus: string[] = []
  for (const [o, noms] of AVANT) {
    for (const k of Object.getOwnPropertyNames(o)) {
      if (!noms.has(k)) { vus.push((o === Object.prototype ? 'Object.prototype.' : o.name + '.') + k); delete o[k] }
    }
  }
  return vus
}

describe('µ.socket — salon, flux ou type nommé comme une méthode héritée', () => {
  beforeEach(() => { FauxWS.tous = []; instantane() })
  afterEach(() => { ajoutsHerites() })
  after(() => { (globalThis as any).WebSocket = avant })

  it('room(nom) envoie son µ:join, reçoit ses messages, se quitte, et se rejoint de nouveau', () => {
    const { s, ws } = connecter('wss://heritage/salons')
    for (const nom of NOMS) {
      const h = s.room(nom)
      assert.equal(trames(ws, 'µ:join', 'room', nom), 1, nom + ' : un µ:join')
      const recus: any[] = []
      h.on('coup', (p: any) => recus.push(p))
      ws.recevoir({ t: nom + '/coup', p: { n: 1 } })
      assert.deepEqual(recus, [{ n: 1 }], nom + ' : message du salon reçu')
      h.leave()
      assert.equal(trames(ws, 'µ:leave', 'room', nom), 1, nom + ' : un µ:leave')
      s.room(nom)
      assert.equal(trames(ws, 'µ:join', 'room', nom), 2, nom + ' : rejoint de nouveau')
    }
    assert.deepEqual(ajoutsHerites(), [], 'rien d\'écrit sur Object.prototype ni sur ses méthodes')
  })

  it('une exclusion appelle son onLeft, et le salon se rejoint à la reconnexion', async () => {
    const { s, ws } = connecter('wss://heritage/reconnexion')
    const exclus: string[] = []
    for (const nom of NOMS) s.room(nom).onLeft(() => exclus.push(nom))
    ws.recevoir({ t: 'µ:left', p: { room: 'valueOf', reason: 'kick' } })
    assert.deepEqual(exclus, ['valueOf'])
    ws.readyState = 3
    ws.onclose({ code: 1006 })
    await new Promise(r => setTimeout(r, 30))
    const ws2 = dernier()
    assert.notEqual(ws2, ws, 'reconnecté')
    ws2.ouvrir()
    ws2.recevoir({ t: 'µ:welcome', p: {} })
    for (const nom of NOMS.filter(n => n !== 'valueOf')) assert.equal(trames(ws2, 'µ:join', 'room', nom), 1, nom + ' : rejoint à la reconnexion')
    assert.equal(trames(ws2, 'µ:join', 'room', 'valueOf'), 0, 'le salon d\'où l\'on est exclu n\'est pas rejoint')
    s.destroy()
    assert.deepEqual(ajoutsHerites(), [])
  })

  it('presence() d\'un tel salon rend un store neuf, rempli par le serveur', () => {
    const { s, ws } = connecter('wss://heritage/presence')
    for (const nom of NOMS) {
      const store = s.room(nom).presence()
      assert.equal(typeof store, 'object', nom + ' : un store')
      assert.notEqual(store, (Object.prototype as any)[nom], nom + ' : pas la méthode héritée')
      assert.deepEqual(Object.keys(store), [])
      assert.equal(trames(ws, 'µ:sub-presence', 'room', nom), 1, nom + ' : abonné')
      ws.recevoir({ t: 'µ:presence', p: { room: nom, op: 'join', id: 'u1', meta: { a: 1 } } })
      assert.deepEqual(store.u1, { a: 1 }, nom + ' : arrivée vue')
    }
    assert.deepEqual(ajoutsHerites(), [])
  })

  it('stream(nom) et on(nom) : un flux et un type de message reçoivent leurs données', () => {
    for (const nom of NOMS) {
      const { s, ws } = connecter('wss://heritage/flux-' + nom)
      const store = s.stream(nom)
      assert.equal(typeof store, 'object', nom + ' : un store de flux')
      assert.equal(trames(ws, 'µ:sub-stream', 'stream', nom), 1, nom + ' : abonné au flux')
      ws.recevoir({ t: nom, seq: 1, p: { op: 'add', key: 'a', value: 1 } })
      assert.equal(store.a, 1, nom + ' : delta appliqué')
      const { s: s2, ws: ws2 } = connecter('wss://heritage/type-' + nom)
      const recus: any[] = []
      assert.doesNotThrow(() => s2.on(nom, (p: any) => recus.push(p)), nom + ' : on() accepté')
      ws2.recevoir({ t: nom, p: { x: 1 } })
      assert.deepEqual(recus, [{ x: 1 }], nom + ' : message reçu')
    }
    assert.deepEqual(ajoutsHerites(), [])
  })

  it('une trame du serveur nommée comme une méthode héritée, sans abonnement, n\'écrit rien et ne lève rien', () => {
    const { ws } = connecter('wss://heritage/trames')
    for (const nom of NOMS) {
      assert.doesNotThrow(() => ws.recevoir({ t: nom, seq: 3, p: { op: 'add', key: 'pollue', value: 1 } }), nom + ' : flux')
      assert.doesNotThrow(() => ws.recevoir({ t: nom, p: { x: 1 } }), nom + ' : message')
      assert.doesNotThrow(() => ws.recevoir({ t: 'µ:presence', p: { room: nom, op: 'join', id: 'pollue', meta: 1 } }), nom + ' : présence')
    }
    assert.deepEqual(ajoutsHerites(), [], 'rien d\'écrit sur Object.prototype ni sur ses méthodes')
  })
})
