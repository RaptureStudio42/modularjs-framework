// µ.socket — le serveur répond « type inconnu » à un message d'un effet en direct dont le paquet manque
// (une erreur qui porte le `type` du message) : cette erreur ne dit rien d'un salon, elle ne retire
// aucun salon du suivi, celui de l'appli comme celui de l'effet. Après une reconnexion, les deux sont
// rejoints. Le vrai client contre un vrai serveur mjsWs, sans le paquet des curseurs.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

describe('µ.socket — une erreur « type inconnu » ne retire aucun salon', () => {
  it('deux messages d\'un effet sans son paquet, juste après les joins : les salons de l\'appli et de l\'effet restent, et sont rejoints à la reconnexion', async () => {
    const transport = new MemoryTransport()
    const joints: string[] = []
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, rooms: { join: (room: string) => { joints.push(room); return true } } } as any)
    await app.listen()
    const µ = makeClient(transport)
    const s = µ.socket('memory://salons', { reconnect: { enabled: true, backoff: [20], jitter: 0 } })
    s.connect()
    await tick(20)
    s.room('chat:general')
    s.room('cursors:/page')
    await tick(30)
    // le serveur ne connaît pas `cursors:move` : une erreur qui porte le type du message
    s.send('cursors:move', { room: '/page', p: null }, { volatile: true })
    s.send('cursors:move', { room: '/page', p: null, n: 2 }, { volatile: true })
    await tick(50)
    assert.equal(s.lastError && s.lastError.type, 'cursors:move', 'le serveur a bien répondu par une erreur qui porte le type : ' + JSON.stringify(s.lastError))
    assert.deepEqual(Object.keys(s._mjs_rooms).sort(), ['chat:general', 'cursors:/page'], 'les deux salons sont toujours suivis')
    // le réseau tombe : à la reconnexion, les deux sont rejoints
    joints.length = 0
    s._mjs_ws.close()
    await tick(200)
    assert.equal(s.state, 'open', 'reconnectée')
    assert.ok(joints.includes('chat:general'), 'le salon de l\'appli est rejoint : ' + JSON.stringify(joints))
    assert.ok(joints.includes('cursors:/page'), 'le salon de l\'effet est rejoint : ' + JSON.stringify(joints))
    s.destroy()
    await app.stop()
  })

  it('un join refusé (une erreur sans type) retire toujours le salon refusé, et lui seul', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, rooms: { join: (room: string) => room !== 'prive:x' } } as any)
    await app.listen()
    const µ = makeClient(transport)
    const s = µ.socket('memory://refus', { reconnect: { enabled: false } })
    s.connect()
    await tick(20)
    s.room('chat:general')
    await tick(30)
    // le salon de l'appli est accepté depuis plus de 5 s quand le second est refusé (l'horloge du client avance)
    const reel = s._mjs_now.bind(s)
    s._mjs_now = () => reel() + 10_000
    s.room('prive:x')
    await tick(50)
    assert.deepEqual(Object.keys(s._mjs_rooms), ['chat:general'], 'le salon refusé n\'est plus suivi, l\'autre reste')
    s.destroy()
    await app.stop()
  })
})
