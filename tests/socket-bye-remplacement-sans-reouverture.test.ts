// µ.socket — un adieu du serveur (µ:bye) ou une session exclusive perdue (fermeture 4003 remplacé,
// 4004 refusé) met fin à la connexion pour de bon : send()/on() ne doivent pas en rouvrir une en
// douce. Sur 4003, une réouverture implicite remplacerait à son tour l'autre onglet de la même
// identité, qui ferait de même : ping-pong sans fin au rythme de l'activité de l'application.
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
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  ;(globalThis as any).WebSocket = MockWS
  new Function('µ', src)(µ)
  return µ
}
const last = () => MockWS.instances[MockWS.instances.length - 1]

describe('µ.socket — µ:bye, session exclusive perdue, adresse invalide : aucune réouverture implicite', () => {
  beforeEach(() => { MockWS.instances = [] })

  it('µ:bye puis send() et on() : aucune connexion ne se rouvre', () => {
    const µ = makeMu()
    const s = µ.socket('wss://bye1', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} }); ws1._srv({ t: 'µ:bye', p: { code: 'fin' } })
    assert.equal(s.state, 'closed')

    const avant = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté après µ:bye')
    s.on('chat', () => {})
    assert.equal(MockWS.instances.length, avant, 'ni send() ni on() ne rouvrent de connexion après µ:bye')
    s.destroy()
  })

  it('fermeture 4003 (remplacé par un autre onglet) puis send() : aucune connexion ne se rouvre', () => {
    const µ = makeMu()
    const s = µ.socket('wss://bye2', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} }); ws1._mjs_drop(4003)

    const avant = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté après un remplacement de session')
    assert.equal(MockWS.instances.length, avant, 'send() après 4003 ne rouvre pas de connexion')
    s.destroy()
  })

  it('fermeture 4004 (refusé) puis send() : aucune connexion ne se rouvre', () => {
    const µ = makeMu()
    const s = µ.socket('wss://bye3', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._mjs_drop(4004)

    const avant = MockWS.instances.length
    assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté après un refus de session')
    assert.equal(MockWS.instances.length, avant, 'send() après 4004 ne rouvre pas de connexion')
    s.destroy()
  })

  it('adresse invalide (le constructeur WebSocket lève) puis send() et on() : aucune nouvelle tentative', () => {
    const µ = makeMu()
    const Vraie = (globalThis as any).WebSocket
    let tentatives = 0
    ;(globalThis as any).WebSocket = class { constructor() { tentatives++; throw new SyntaxError('URL invalide') } }
    try {
      const s = µ.socket('pas une url', { heartbeat: 0 })
      s.connect()
      assert.equal(s.state, 'closed')
      assert.equal(tentatives, 1)
      assert.equal(s.send('move', { x: 1 }), false, 'envoi écarté après une adresse invalide')
      s.on('chat', () => {})
      assert.equal(tentatives, 1, 'ni send() ni on() ne retentent une adresse invalide')
      s.destroy()
    } finally {
      ;(globalThis as any).WebSocket = Vraie
    }
  })

  it('connect() explicite après µ:bye rouvre bien la connexion', () => {
    const µ = makeMu()
    const s = µ.socket('wss://bye4', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} }); ws1._srv({ t: 'µ:bye', p: {} })

    const avant = MockWS.instances.length
    s.connect()
    assert.equal(MockWS.instances.length, avant + 1, 'connect() explicite rouvre une connexion après µ:bye')
    const ws2 = last(); ws2._mjs_open(); ws2._srv({ t: 'µ:welcome', p: {} })
    assert.equal(s.state, 'open')
    s.destroy()
  })

  it('coupure ordinaire (1006) : la reconnexion automatique reste active', () => {
    const µ = makeMu()
    const s = µ.socket('wss://bye5', { heartbeat: 0 })
    s.connect()
    const ws1 = last(); ws1._mjs_open(); ws1._srv({ t: 'µ:welcome', p: {} }); ws1._mjs_drop(1006)
    assert.notEqual(s.state, 'closed', 'une coupure ordinaire ne vaut pas abandon')
    s.destroy()
  })
})
