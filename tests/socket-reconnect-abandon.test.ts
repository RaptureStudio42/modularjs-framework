// µ.socket — après un abandon de la reconnexion (essais épuisés ou reconnect.enabled:false), plus
// aucune réouverture implicite : send()/on()/request()/stream() ne doivent plus rouvrir de connexion
// brute hors de tout backoff/plafond. Seul un connect() explicite reprend la main, avec un compteur
// d'essais neuf. Un envoi pendant l'abandon est écarté, avec un seul avertissement par socket.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/runtime/mjs_socket.ts', import.meta.url), 'utf8')

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

describe("µ.socket — abandon de la reconnexion : plus de réouverture implicite", () => {
  beforeEach(() => { MockWS.instances = [] })

  it('essais épuisés (retries:0) — send()/on()/stream() ultérieurs ne rouvrent plus de connexion, le message est écarté', () => {
    const warns: string[] = []
    const µ = makeMu(warns)
    const s = µ.socket('wss://ab1', { reconnect: { retries: 0 }, heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} })
    ws1._mjs_drop()
    assert.equal(s.state, 'closed')

    const nBefore = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté pendant l’abandon')
    assert.equal(MockWS.instances.length, nBefore, 'send() ne rouvre plus de connexion après épuisement des essais')
    s.on('chat', () => {})
    assert.equal(MockWS.instances.length, nBefore, 'on() ne rouvre plus de connexion non plus')
    s.stream('score')
    assert.equal(MockWS.instances.length, nBefore, 'stream() ne rouvre plus de connexion non plus')
    assert.equal(warns.length, 1, 'un seul avertissement pour le premier envoi écarté')

    s.send('move', { x: 2 })
    assert.equal(warns.length, 1, 'un 2e envoi écarté ne déclenche pas un 2e avertissement')
    s.destroy()
  })

  it('reconnect.enabled:false — même défaut : send()/request() ultérieurs ne rouvrent plus de connexion', () => {
    const µ = makeMu()
    const s = µ.socket('wss://ab2', { reconnect: { enabled: false }, heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} })
    ws1._mjs_drop()
    assert.equal(s.state, 'closed')

    const nBefore = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false)
    assert.equal(MockWS.instances.length, nBefore, 'send() ne rouvre plus de connexion (reconnect désactivé)')
    s.request('coup', {}).catch(() => {})
    assert.equal(MockWS.instances.length, nBefore, 'request() ne rouvre plus de connexion non plus')
    s.destroy()
  })

  it('connect() explicite après abandon rouvre la connexion et repart avec un compteur d’essais neuf', () => {
    const µ = makeMu()
    const s = µ.socket('wss://ab3', { reconnect: { retries: 0 }, heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} })
    ws1._mjs_drop()
    assert.equal(s.state, 'closed')
    ;(s as any)._mjs_attempt = 3   // simule un compteur déjà avancé, pour distinguer d'un 0 qui traînerait par hasard

    const nBefore = MockWS.instances.length
    s.connect()
    assert.equal(MockWS.instances.length, nBefore + 1, 'connect() explicite rouvre bien une connexion après abandon')
    assert.equal((s as any)._mjs_attempt, 0, 'compteur d’essais remis à zéro par connect()')
    s.destroy()
  })
})
