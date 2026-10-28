// µ.socket — `unstream(type)`, le symétrique de `stream(type)` : le client cesse de suivre un flux sans quitter de salon ni
// fermer la connexion. `µ:unsub-stream` part, le magasin ne reçoit plus rien, et le flux n'est plus redemandé à la
// reconnexion ; un second appel, ou celui d'un type jamais suivi, n'envoie rien ; `stream()` ensuite repart d'un magasin
// neuf. La poignée d'un salon a le sien (`salon.unstream(type)`). Avant, aucun moyen : le flux restait suivi jusqu'au
// départ du salon ou à la fermeture de la connexion
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

// un socket ouvert (welcome reçu), sa trame de départ vidée
function ouvert(µ: any, url: string): { s: any; ws: MockWS } {
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 }, heartbeat: 0 })
  s.connect()
  const ws = last()
  ws._mjs_open()
  ws._srv({ t: 'µ:welcome', p: {} })
  ws.sent.length = 0
  return { s, ws }
}

describe('µ.socket — unstream(type) : le client cesse de suivre un flux', () => {
  beforeEach(() => { MockWS.instances = [] })

  it('µ:unsub-stream part, le magasin ne reçoit plus rien, rien n’est redemandé à la reconnexion', async () => {
    const { s, ws } = ouvert(makeMu(), 'wss://unstream-base')
    const magasin = s.stream('flux')
    ws._srv({ t: 'flux', seq: 1, p: { op: 'add', key: 'a', value: 1 } })
    assert.deepEqual({ ...magasin }, { a: 1 })
    ws.sent.length = 0
    s.unstream('flux')
    assert.deepEqual(ws.sent, [{ t: 'µ:unsub-stream', p: { stream: 'flux' } }])
    ws._srv({ t: 'flux', seq: 2, p: { op: 'add', key: 'b', value: 2 } })
    assert.deepEqual({ ...magasin }, { a: 1 }, 'un delta en vol ne touche plus le magasin')
    ws._mjs_drop()
    await tick(10)
    const ws2 = last()
    assert.notEqual(ws2, ws)
    ws2._mjs_open()
    ws2._srv({ t: 'µ:welcome', p: {} })
    assert.equal(ws2.sent.some((m: any) => (m.t === 'µ:sub-stream' || m.t === 'µ:resync') && m.p.stream === 'flux'), false)
    const hello = ws2.sent.find((m: any) => m.t === 'µ:hello')
    assert.equal(hello.p.resub.includes('stream:flux'), false, 'plus dans les ré-abonnements annoncés')
    s.destroy()
  })

  it('un second unstream(), ou celui d’un type jamais suivi, n’envoie rien', () => {
    const { s, ws } = ouvert(makeMu(), 'wss://unstream-idempotent')
    s.stream('flux')
    ws.sent.length = 0
    s.unstream('flux')
    s.unstream('flux')
    s.unstream('jamais')
    s.unstream('toString')
    assert.deepEqual(ws.sent, [{ t: 'µ:unsub-stream', p: { stream: 'flux' } }])
    s.destroy()
  })

  it('stream() après unstream() : un magasin neuf, µ:sub-stream de nouveau', () => {
    const { s, ws } = ouvert(makeMu(), 'wss://unstream-retour')
    const ancien = s.stream('flux')
    s.unstream('flux')
    ws.sent.length = 0
    const neuf = s.stream('flux')
    assert.notEqual(neuf, ancien)
    assert.deepEqual(ws.sent, [{ t: 'µ:sub-stream', p: { stream: 'flux' } }])
    ws._srv({ t: 'flux', seq: 5, p: { op: 'reset', values: { z: 9 } } })
    assert.deepEqual({ ...neuf }, { z: 9 })
    assert.deepEqual({ ...ancien }, {}, 'l’ancien magasin ne reçoit plus rien')
    s.destroy()
  })

  it('poignée de salon : salon.unstream(type) désabonne `salon/type` ; partie, elle ne fait rien', () => {
    const { s, ws } = ouvert(makeMu(), 'wss://unstream-salon')
    const salon = s.room('table')
    const autre = s.room('table')
    salon.stream('main')
    ws.sent.length = 0
    salon.unstream('main')
    assert.deepEqual(ws.sent, [{ t: 'µ:unsub-stream', p: { stream: 'table/main' } }])
    autre.stream('main')
    salon.leave()
    ws.sent.length = 0
    salon.unstream('main')
    assert.deepEqual(ws.sent, [], 'une poignée partie ne coupe pas le flux que tient une autre poignée')
    s.destroy()
  })

  it('jamais connecté : unstream() n’ouvre pas de connexion', () => {
    const µ = makeMu()
    const s = µ.socket('wss://unstream-paresseux', { heartbeat: 0 })
    s.unstream('flux')
    assert.equal(MockWS.instances.length, 0)
    s.destroy()
  })
})

describe('µ.socket — unstream(type) avec le serveur MJS-WS', function () {
  this.timeout(10000)

  it('plus aucun delta après unstream() : une écoute on() du même nom n’entend rien', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const scores = app.stream('scores', { public: true })
    await app.listen()
    ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', src)(µ)
    const s = µ.socket('memory://unstream', { auth: () => undefined, reconnect: { enabled: false } })
    try {
      s.connect()
      await tick(20)
      const magasin = s.stream('scores')
      await tick(20)
      scores.add('a', 1)
      await tick(20)
      assert.deepEqual({ ...magasin }, { a: 1 })
      s.unstream('scores')
      await tick(20)
      const entendus: unknown[] = []
      s.on('scores', (p: unknown) => entendus.push(p))
      scores.add('b', 2)
      await tick(20)
      assert.deepEqual(entendus, [], 'le serveur n’envoie plus rien de ce flux')
      assert.deepEqual({ ...magasin }, { a: 1 })
      assert.equal(s.lastError, null, 'aucune erreur')
    } finally {
      s.destroy()
      await app.stop()
    }
  })
})
