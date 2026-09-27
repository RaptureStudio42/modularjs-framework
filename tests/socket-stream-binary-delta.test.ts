// µ.socket — un delta de flux (sock.stream(type)) reçu en trame BINAIRE doit alimenter le même
// store réactif qu'un delta reçu en JSON : le chemin binaire ne doit jamais court-circuiter
// _mjs_onStreamDelta. µ._mjs_mjschemaOnBinary (module 'schema') décode puis appelle
// sock._mjs_dispatch(type, {t,p}) directement (cf. mjs_schema.ts) — même contrat simulé ici, sans
// dépendre du codec binaire réel.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/runtime/mjs_socket.ts', import.meta.url), 'utf8')

class MockWS {
  static instances: MockWS[] = []
  url: string; readyState = 0; sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; MockWS.instances.push(this) }
  send(data: any) { this.sent.push(data) }
  close() { this.readyState = 3 }
  _mjs_open() { this.readyState = 1; this.onopen && this.onopen({}) }
  _srv(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  _srvBin(type: string, p: any) { this.onmessage && this.onmessage({ data: { type: type, p: p } }) }
}
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  // stub minimal du module 'schema' : décode -> dispatch direct, même contrat que
  // mjs_schema.ts::_mjs_mjschemaOnBinary (sock._mjs_dispatch(decoded.nom, {t, p:decoded.objet}))
  µ._mjs_mjschemaOnBinary = (sock: any, data: any) => { sock._mjs_dispatch(data.type, { t: data.type, p: data.p }) }
  ;(globalThis as any).WebSocket = MockWS
  new Function('µ', src)(µ)
  return µ
}
const last = () => MockWS.instances[MockWS.instances.length - 1]

describe('µ.socket — delta de flux binaire vs sock.stream()', () => {
  it("un delta reçu par le chemin binaire met à jour le même store réactif qu'un delta JSON", () => {
    MockWS.instances = []
    const µ = makeMu()
    const s = µ.socket('wss://strmfix1', { heartbeat: 0 })
    const ennemis = s.stream('ennemis')
    const ws = last(); ws._mjs_open(); ws._srv({ t: 'µ:welcome', p: {} })
    assert.ok(ws.sent.some((m: string) => typeof m === 'string' && JSON.parse(m).t === 'µ:sub-stream'))

    ws._srvBin('ennemis', { op: 'reset', values: { x: 7, y: 9 } })

    assert.equal(ennemis.x, 7, 'le delta binaire doit avoir traversé _mjs_onStreamDelta, pas être avalé par le pub/sub générique')
    assert.equal(ennemis.y, 9)
    s.destroy()
  })

  it('un type binaire NON abonné en stream() continue de rejoindre les handlers .on() normaux', () => {
    MockWS.instances = []
    const µ = makeMu()
    const s = µ.socket('wss://strmfix2', { heartbeat: 0 })
    const recus: any[] = []
    s.on('chat', (p: any) => recus.push(p))
    const ws = last(); ws._mjs_open(); ws._srv({ t: 'µ:welcome', p: {} })

    ws._srvBin('chat', { text: 'salut' })

    assert.deepEqual(recus, [{ text: 'salut' }], "un type qui n'est pas un flux continue de rejoindre les handlers .on() normaux")
    s.destroy()
  })
})
