// µ.socket — après un refus explicite du serveur (µ:denied), plus aucune réouverture implicite :
// send()/on()/request()/stream() ne doivent pas rouvrir de connexion brute, seul un connect()
// explicite reprend la main — même garde que close() volontaire (cf. socket-close-then-reopen.test.ts).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

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
function makeMu(warns: string[] = []): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: (m: string) => { warns.push(m) }, log: () => {} }
  ;(globalThis as any).WebSocket = MockWS
  new Function('µ', src)(µ)
  return µ
}
const last = () => MockWS.instances[MockWS.instances.length - 1]

describe("µ.socket — µ:denied : plus de réouverture implicite", () => {
  beforeEach(() => { MockWS.instances = [] })

  it('µ:denied puis send() : le message est écarté, aucune connexion ne se rouvre', () => {
    const warns: string[] = []
    const µ = makeMu(warns)
    const s = µ.socket('wss://den1', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:denied', p: { message: 'jeton invalide' } })
    assert.equal(s.state, 'closed')

    const nBefore = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté après le refus du serveur')
    assert.equal(MockWS.instances.length, nBefore, 'send() après µ:denied ne rouvre pas de connexion')
    assert.equal(warns.length, 1, "un avertissement signale l'envoi écarté")
    s.destroy()
  })

  it("µ:denied puis on()/request()/stream() : ils s'enregistrent sans rouvrir de connexion", async () => {
    const µ = makeMu()
    const s = µ.socket('wss://den2', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:denied', p: { message: 'jeton invalide' } })

    const nBefore = MockWS.instances.length
    s.on('chat', () => {})
    assert.equal(MockWS.instances.length, nBefore, 'on() après µ:denied ne rouvre pas de connexion')

    let rejection: any = null
    try { await s.request('coup', {}) } catch (e) { rejection = e }
    assert.equal(MockWS.instances.length, nBefore, 'request() après µ:denied ne rouvre pas de connexion')
    assert.ok(rejection, 'request() après µ:denied rejette (socket non connecté)')

    const $$score = s.stream('score')
    assert.equal(MockWS.instances.length, nBefore, 'stream() après µ:denied ne rouvre pas de connexion')
    assert.ok($$score, 'stream() renvoie quand même son store réactif')
    s.destroy()
  })

  it('connect() explicite après µ:denied rouvre bien la connexion', () => {
    const µ = makeMu()
    const s = µ.socket('wss://den3', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:denied', p: { message: 'jeton invalide' } })

    const nBefore = MockWS.instances.length
    s.connect()
    assert.equal(MockWS.instances.length, nBefore + 1, 'connect() explicite rouvre une connexion après µ:denied')
    const ws2 = last(); ws2._mjs_open(); ws2._srv({ t: 'µ:welcome', p: {} })
    assert.equal(s.state, 'open')
    s.destroy()
  })
})
