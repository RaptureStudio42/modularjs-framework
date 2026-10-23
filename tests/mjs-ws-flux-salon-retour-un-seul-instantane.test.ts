// Flux de salon ouvert par le client du framework (`salle = sock.room('partie-42')`, `salle.stream('main')` : flux
// `partie-42/main`, déclaré `{ room: 'partie-42' }`) : le client l'oublie en quittant le salon et le redemande lui-même
// au retour. Le serveur le rendait en plus au retour : deux instantanés complets à chaque retour, et un client revenu
// sans rouvrir le flux (autre vue du même salon) recevait quand même l'instantané et tous les deltas d'un flux oublié.
// Le serveur ne rend plus au retour les flux `salon/…` ; les autres flux réservés au salon lui sont toujours rendus
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// vrai client du framework (runtime/mjs_socket.ts) sur le transport mémoire ; `recues` garde chaque trame reçue
function navigateur(transport: MemoryTransport, recues: any[]): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) {
    const s: any = transport.connect({ url, protocols })
    let h: any = null
    Object.defineProperty(s, 'onmessage', { configurable: true, get() { return h && ((ev: any) => { recues.push(JSON.parse(ev.data)); h(ev) }) }, set(v) { h = v } })
    return s
  }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', clientSrc)(µ)
  return µ
}

describe('MJS-WS — flux de salon `salon/…` au retour dans le salon', function () {
  this.timeout(10000)

  it('retour + salle.stream() : un seul instantané ; retour sans rouvrir le flux : aucune trame du flux', async () => {
    const transport = new MemoryTransport()
    const recues: any[] = []
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const partie = app.stream('partie-42/main', { room: 'partie-42' })
    partie.add('grille', { cases: ['a', 'b'] })
    await app.listen()
    const s = navigateur(transport, recues).socket('memory://retour-salon', { auth: () => undefined, reconnect: { enabled: false } })
    s.connect()
    await tick(20)
    let salle = s.room('partie-42'); await tick(20)
    let magasin = salle.stream('main'); await tick(20)
    partie.add('tour-1', 1); await tick(20)
    assert.ok('tour-1' in magasin, 'dans le salon : delta reçu')
    const instantanes = (depuis: number) => recues.slice(depuis).filter(f => f.t === 'partie-42/main' && f.p?.op === 'reset').length

    salle.leave(); await tick(20)
    let n0 = recues.length
    salle = s.room('partie-42'); magasin = salle.stream('main'); await tick(40)
    partie.add('tour-2', 2); await tick(20)
    assert.equal(instantanes(n0), 1, 'un seul instantané complet au retour')
    assert.ok('tour-2' in magasin && 'tour-1' in magasin, 'état complet puis deltas')

    salle.leave(); await tick(20)
    n0 = recues.length
    salle = s.room('partie-42'); await tick(40)
    for (let i = 3; i < 8; i++) partie.add('tour-' + i, i)
    await tick(30)
    assert.deepEqual(recues.slice(n0).filter(f => f.t === 'partie-42/main'), [], 'flux non rouvert : rien')
    s.destroy(); await app.stop()
  })
})
