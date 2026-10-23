// Suivre celui qui mène (followPackage) : sans `canLead`, personne ne mène — ni la position (follow:at) ni la souris
// (follow:cursor) d'un membre ne partent vers les autres, et aucune dernière position n'est gardée. `canLead` ouvre la
// main à qui l'appli désigne. Avant, tout membre du salon menait l'écran des autres.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, followPackage } from '../src/mjs-ws/index.js'
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

async function demarrer(pkg: any) {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  app.use(pkg)
  await app.listen()
  return { transport, app }
}

async function membre(transport: MemoryTransport, qui: any) {
  const s = makeClient(transport).socket('memory://suivi', { auth: () => qui, reconnect: { enabled: false } })
  const positions: any[] = [], souris: any[] = []
  s.on('follow:at', (p: any) => positions.push(p))
  s.on('follow:cursor', (p: any) => souris.push(p))
  s.room('follow:cours')
  await tick(5)
  return { s, positions, souris }
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('MJS-WS — suivre celui qui mène : personne ne mène par défaut', () => {
  it('sans canLead, ni la position ni la souris d\'un membre ne partent ; aucune dernière position gardée', async () => {
    const { transport, app } = await demarrer(followPackage())
    const a = await membre(transport, zora)
    const b = await membre(transport, theo)
    a.s.send('follow:at', { room: 'cours', a: [0, 3], y: 0.25 })
    a.s.send('follow:cursor', { room: 'cours', p: { a: [1], x: 0.5, y: 0.5 }, t: null })
    await tick(10)
    assert.deepEqual(b.positions, [], 'la position ne part pas')
    assert.deepEqual(b.souris, [], 'la souris ne part pas')
    assert.equal(await b.s.request('follow:last', { room: 'cours' }), null, 'aucune position gardée')
    await app.stop()
  })

  it('canLead ouvre la main à qui l\'appli désigne', async () => {
    const { transport, app } = await demarrer(followPackage({ canLead: (client) => client.identity?.id === '1' }))
    const a = await membre(transport, zora)
    const b = await membre(transport, theo)
    a.s.send('follow:at', { room: 'cours', a: [0, 3], y: 0.25 })
    a.s.send('follow:cursor', { room: 'cours', p: { a: [1], x: 0.5, y: 0.5 }, t: null })
    b.s.send('follow:at', { room: 'cours', a: [9], y: 0 })
    await tick(10)
    assert.deepEqual(b.positions, [{ room: 'cours', a: [0, 3], y: 0.25, from: { id: '1', name: 'Zora' } }])
    assert.equal(b.souris.length, 1, JSON.stringify(b.souris))
    assert.deepEqual(a.positions, [], 'Theo ne mène pas')
    assert.deepEqual(await b.s.request('follow:last', { room: 'cours' }), { a: [0, 3], y: 0.25 })
    await app.stop()
  })
})
