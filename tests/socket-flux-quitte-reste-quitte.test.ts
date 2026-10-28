// µ.socket — un flux quitté reste quitté. `unstream()` appelé hors ligne ne pouvait pas partir : avec la reprise de
// session du serveur (`resume: true`), la session reprise gardait l'abonnement, le serveur poussait encore le flux et les
// écouteurs `on(type)` l'entendaient ; un second `unstream()` ne faisait rien. Le désabonnement part désormais au
// `µ:welcome` repris, une trame d'un flux quitté (en vol, rejouée par la reprise, ou poussée parce que le désabonnement
// s'est perdu en route) ne va à personne, et un serveur qui pousse encore un flux quitté reçoit de nouveau son
// `µ:unsub-stream`, une fois par connexion. Le refus d'un flux nomme le flux (`µ:error { code: 'stream-denied', stream }`) :
// ce flux seul est oublié, plus redemandé aux reconnexions, et `stream()` le redemande
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

class MockWS {
  static instances: MockWS[] = []
  url: string; readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; MockWS.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  _mjs_open() { this.readyState = 1; this.onopen && this.onopen({}) }
  _srv(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  _mjs_drop(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }) }
}
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  ;(globalThis as any).WebSocket = MockWS
  new Function('µ', src)(µ)
  return µ
}
const last = () => MockWS.instances[MockWS.instances.length - 1]
const desabonnements = (ws: MockWS) => ws.sent.filter((m: any) => m.t === 'µ:unsub-stream').map((m: any) => m.p.stream)
const redemandes = (ws: MockWS) => ws.sent.filter((m: any) => m.t === 'µ:sub-stream' || m.t === 'µ:resync').map((m: any) => m.p.stream)

// un socket ouvert (welcome reçu), sa trame de départ vidée
function ouvert(µ: any, url: string): { s: any; ws: MockWS } {
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 }, heartbeat: 0 })
  s.connect()
  const ws = last()
  ws._mjs_open()
  ws._srv({ t: 'µ:welcome', p: { session: { id: 's1', key: 'k1' } } })
  ws.sent.length = 0
  return { s, ws }
}
// coupure, reconnexion automatique, accueil (repris ou neuf)
async function reprendre(ws: MockWS, resumed: boolean): Promise<MockWS> {
  ws._mjs_drop()
  await tick(10)
  const ws2 = last()
  assert.ok(ws2 !== ws, 'une connexion neuve')
  ws2._mjs_open()
  ws2._srv({ t: 'µ:welcome', p: { session: { id: 's1', key: 'k2' }, resumed } })
  return ws2
}

// client réel contre le serveur MJS-WS, sur le transport mémoire (trames reçues et envoyées relevées)
function brancher(transport: MemoryTransport, recu: any[], sortants: any[]): void {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) {
    const ws: any = transport.connect({ url, protocols })
    let reel: any = null
    Object.defineProperty(ws, 'onmessage', { get() { return reel }, set(fn: any) { reel = fn && ((ev: any) => { recu.push(JSON.parse(ev.data)); fn(ev) }) } })
    const envoyer = ws.send.bind(ws)
    ws.send = (d: any) => { sortants.push(JSON.parse(d)); return envoyer(d) }
    return ws
  }
}
function muReel(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', src)(µ)
  return µ
}

describe('µ.socket — un flux quitté reste quitté', () => {
  beforeEach(() => { MockWS.instances = [] })

  for (const resume of [true, false]) {
    it(`unstream() hors ligne puis reconnexion (reprise ${resume ? 'de session' : 'refusée, accueil neuf'}) : plus rien du flux, ni au magasin ni aux écouteurs`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, resume, onLog: () => {} })
      const flux = app.stream('x', { public: true })
      await app.listen()
      const recu: any[] = [], sortants: any[] = []
      brancher(transport, recu, sortants)
      const s = muReel().socket('memory://quitte-' + resume, { reconnect: { enabled: false } })
      const entendus: any[] = []
      s.on('x', (p: any) => entendus.push(p))
      const magasin = s.stream('x')
      s.connect(); await tick(20)
      flux.add('a', 1); await tick(20)
      assert.deepEqual({ ...magasin }, { a: 1 })
      s._mjs_ws.close(1006, 'coupure'); await tick(20)
      flux.add('pendant', 1); await tick(20)
      s.unstream('x')
      const envoyes = sortants.length
      s.connect(); await tick(50)
      const accueil = recu.filter(f => f.t === 'µ:welcome').at(-1)
      assert.equal(accueil.p.resumed === true, resume, 'reprise telle que demandée')
      const unsubs = sortants.slice(envoyes).filter(m => m.t === 'µ:unsub-stream').map(m => m.p.stream)
      assert.deepEqual(unsubs, resume ? ['x'] : [], 'le désabonnement part à la reprise, et seulement à elle')
      const depart = recu.length
      flux.add('b', 2); await tick(20)
      assert.deepEqual(recu.slice(depart).filter(f => f.t === 'x'), [], 'le serveur ne pousse plus le flux')
      assert.deepEqual(entendus, [], 'aucune trame du flux quitté n’atteint les écouteurs on(x)')
      assert.deepEqual({ ...magasin }, { a: 1 }, 'le magasin garde son dernier état')
      s.destroy(); await app.stop()
    })
  }

  it('une trame d’un flux quitté, encore en vol, n’atteint ni le magasin ni les écouteurs ; stream() le suit de nouveau', () => {
    const { s, ws } = ouvert(makeMu(), 'wss://quitte-en-vol')
    const entendus: any[] = []
    s.on('flux', (p: any) => entendus.push(p))
    const magasin = s.stream('flux')
    ws._srv({ t: 'flux', seq: 1, p: { op: 'add', key: 'a', value: 1 } })
    s.unstream('flux')
    ws._srv({ t: 'flux', seq: 2, p: { op: 'add', key: 'b', value: 2 } })
    ws._srv({ t: 'flux', seq: 0, p: { op: 'reset', values: { z: 0 } } })
    assert.deepEqual(entendus, [])
    assert.deepEqual({ ...magasin }, { a: 1 })
    assert.deepEqual(desabonnements(ws), ['flux'], 'un seul µ:unsub-stream sur cette connexion')
    const neuf = s.stream('flux')
    ws._srv({ t: 'flux', seq: 3, p: { op: 'reset', values: { c: 3 } } })
    assert.deepEqual({ ...neuf }, { c: 3 })
    assert.deepEqual(entendus, [], 'suivi de nouveau : un flux, jamais un message ordinaire')
    s.destroy()
  })

  it('désabonnement perdu en route (session reprise qui pousse encore le flux) : µ:unsub-stream repart, une fois par connexion', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://quitte-perdu')
    const entendus: any[] = []
    s.on('flux', (p: any) => entendus.push(p))
    s.stream('flux')
    ws._srv({ t: 'flux', seq: 1, p: { op: 'add', key: 'a', value: 1 } })
    s.unstream('flux')
    assert.deepEqual(desabonnements(ws), ['flux'])
    const ws2 = await reprendre(ws, true)
    assert.deepEqual(desabonnements(ws2), [], 'parti sur la connexion d’avant : rien à l’accueil')
    ws2._srv({ t: 'flux', seq: 2, p: { op: 'add', key: 'b', value: 2 } })
    ws2._srv({ t: 'flux', seq: 3, p: { op: 'add', key: 'c', value: 3 } })
    assert.deepEqual(desabonnements(ws2), ['flux'], 'le serveur pousse encore : le désabonnement repart, une fois')
    assert.deepEqual(entendus, [])
    s.destroy()
  })

  it('hors ligne, unstream() puis stream() : le flux est suivi, aucun désabonnement à la reprise', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://quitte-repris')
    s.stream('flux')
    ws._srv({ t: 'flux', seq: 1, p: { op: 'add', key: 'a', value: 1 } })
    ws._mjs_drop()
    s.unstream('flux')
    const neuf = s.stream('flux')
    await tick(10)
    const ws2 = last()
    ws2._mjs_open()
    ws2._srv({ t: 'µ:welcome', p: { session: { id: 's1', key: 'k2' }, resumed: true } })
    assert.deepEqual(desabonnements(ws2), [])
    assert.deepEqual(redemandes(ws2), ['flux'])
    ws2._srv({ t: 'flux', seq: 4, p: { op: 'reset', values: { r: 1 } } })
    assert.deepEqual({ ...neuf }, { r: 1 })
    s.destroy()
  })

  it('accueil neuf : un type quitté redevient un message ordinaire pour on(type)', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://quitte-accueil-neuf')
    const entendus: any[] = []
    s.on('flux', (p: any) => entendus.push(p))
    s.stream('flux')
    s.unstream('flux')
    const ws2 = await reprendre(ws, false)
    ws2._srv({ t: 'flux', p: { texte: 'bonjour' } })
    assert.deepEqual(entendus, [{ texte: 'bonjour' }])
    assert.deepEqual(desabonnements(ws2), [])
    s.destroy()
  })
})

describe('µ.socket — le refus d’un flux le nomme : ce flux seul est oublié', () => {
  beforeEach(() => { MockWS.instances = [] })

  it('µ:error stream-denied : lastError nomme le flux, il n’est plus redemandé aux reconnexions, stream() le redemande', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://refus-nomme')
    const refuse = s.stream('refuse')
    s.stream('autre')
    ws._srv({ t: 'autre', seq: 1, p: { op: 'add', key: 'a', value: 1 } })
    ws._srv({ t: 'µ:error', p: { message: 'accès au flux refusé', code: 'stream-denied', stream: 'refuse' } })
    assert.deepEqual(s.lastError, { message: 'accès au flux refusé', code: 'stream-denied', stream: 'refuse' })
    const ws2 = await reprendre(ws, false)
    assert.deepEqual(redemandes(ws2), ['autre'], 'aucun nouvel essai automatique du flux refusé')
    const hello = ws2.sent.find((m: any) => m.t === 'µ:hello')
    assert.equal(hello.p.resub.includes('stream:refuse'), false)
    ws2.sent.length = 0
    const neuf = s.stream('refuse')
    assert.ok(neuf !== refuse, 'un magasin neuf')
    assert.deepEqual(redemandes(ws2), ['refuse'], 'stream() le redemande')
    s.destroy()
  })

  it('une autre erreur (sans code, refus d’un salon) ne fait oublier aucun flux', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://refus-autre')
    s.stream('flux')
    ws._srv({ t: 'µ:error', p: { message: 'débit dépassé' } })
    ws._srv({ t: 'µ:error', p: { message: 'salon refusé', code: 'join-denied', room: 'flux' } })
    ws._srv({ t: 'µ:error', p: { message: 'accès au flux refusé', code: 'stream-denied', stream: 'inconnu' } })
    const ws2 = await reprendre(ws, false)
    assert.deepEqual(redemandes(ws2), ['flux'])
    s.destroy()
  })

  it('serveur réel : garde sans réponse dans son délai — lastError nomme le flux, l’autre flux continue', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    app.stream('lent', { canSubscribe: () => new Promise<boolean>(() => {}), guardTimeout: 30 })
    const ouvertFlux = app.stream('ouvert', { public: true })
    await app.listen()
    const recu: any[] = [], sortants: any[] = []
    brancher(transport, recu, sortants)
    const s = muReel().socket('memory://refus-lent', { reconnect: { enabled: false } })
    s.stream('lent')
    const magasin = s.stream('ouvert')
    s.connect(); await tick(120)
    assert.deepEqual(s.lastError, { message: "accès au flux refusé : sa garde n'a pas répondu à temps", code: 'stream-denied', stream: 'lent' })
    ouvertFlux.add('a', 1); await tick(20)
    assert.deepEqual({ ...magasin }, { a: 1 })
    s.destroy(); await app.stop()
  })
})
