// Le client ne contrôlait les trous d'un flux qu'à partir de son premier delta : après l'état complet d'un flux encore
// vide (`reset` à 0), un delta qui en sautait un (le précédent perdu pendant une reprise de session, par exemple) était
// appliqué tel quel, et le client restait à l'état faux sans jamais le savoir. Après un état complet numéroté, un trou se
// voit désormais dès 0 : le client redemande la suite (`µ:resync`) au lieu d'appliquer
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
  _ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  _srv(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
}

describe('µ.socket — flux : un trou se voit dès l’état complet à 0', () => {
  const vraiWebSocket = (globalThis as any).WebSocket
  after(() => { (globalThis as any).WebSocket = vraiWebSocket })

  it('reset à 0 puis delta 2 : µ:resync depuis 0, le delta n’est pas appliqué ; delta 1 : appliqué', () => {
    MockWS.instances = []
    ;(globalThis as any).WebSocket = MockWS
    const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
    new Function('µ', src)(µ)
    const sock = µ.socket('wss://trou')
    const etat = sock.stream('partie')
    const ws = MockWS.instances[MockWS.instances.length - 1]
    ws._ouvrir()
    ws._srv({ t: 'µ:welcome', p: {} })
    ws._srv({ t: 'partie', seq: 0, p: { op: 'reset', values: {} } })
    ws.sent.length = 0
    ws._srv({ t: 'partie', seq: 2, p: { op: 'add', key: 'deuxieme', value: 2 } })
    assert.deepEqual(Object.keys(etat), [], 'un delta qui en saute un n’est pas appliqué')
    assert.deepEqual(ws.sent.filter((m: any) => m.t === 'µ:resync').map((m: any) => m.p), [{ stream: 'partie', from: 0 }], 'la suite est redemandée depuis 0')
    ws._srv({ t: 'partie', seq: 1, p: { op: 'add', key: 'premier', value: 1 } })
    ws._srv({ t: 'partie', seq: 2, p: { op: 'add', key: 'deuxieme', value: 2 } })
    assert.deepEqual(Object.keys(etat), ['premier', 'deuxieme'], 'la suite contiguë est appliquée')
    sock.close()
  })
})
