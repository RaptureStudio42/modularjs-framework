// File publique : à la fin d'une partie, le client garde sa poignée (il ne quitte pas la partie) et la partie reste interrogeable
// pendant sa grâce `endTtl`. Un joueur qui relance µgame:play pendant cette grâce doit être remis en file : il recevait la partie
// FINIE, où tous ses coups sont refusés (« partie terminée »), et ne pouvait plus rejouer avant la fin de la grâce.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...opts })
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

function declarerDuel(app: MjsServerApp): void {
  app.game('duel', { seats: 2, endTtl: 60000, state: () => ({}), moves: { fin: (game: any) => { game.end({ gagnant: 'b' }) }, ping: () => 'pong' } })
}

describe('MJS-Server — rejouer la file pendant la grâce d une partie finie', () => {
  it('µgame:play pendant la grâce remet en file, puis apparie les deux joueurs dans une partie neuve et jouable', async () => {
    const { transport, app } = await startApp()
    declarerDuel(app)
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    await a.request('µgame:play', { type: 'duel' })
    const premiere = await b.request('µgame:play', { type: 'duel' })
    await b.request('µgame:move', { game: premiere.game, move: 'fin' })
    const encoreA = await a.request('µgame:play', { type: 'duel' })
    assert.deepEqual(encoreA, { queue: 1 })
    const encoreB = await b.request('µgame:play', { type: 'duel' })
    assert.equal(typeof encoreB.game, 'string')
    assert.notEqual(encoreB.game, premiere.game)
    assert.deepEqual(await b.request('µgame:move', { game: encoreB.game, move: 'ping' }), { ok: true, result: 'pong' })
    await app.stop()
  })

  it('un 2e onglet d un joueur assis dans une partie EN COURS y est toujours rattaché (pas un 2e ticket)', async () => {
    const { transport, app } = await startApp()
    declarerDuel(app)
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    await a.request('µgame:play', { type: 'duel' })
    const partie = await b.request('µgame:play', { type: 'duel' })
    const a2 = await connecter(transport, 'a')
    const rattache = await a2.request('µgame:play', { type: 'duel' })
    assert.equal(rattache.game, partie.game)
    assert.equal(rattache.seat, 0)
    await app.stop()
  })
})
