// Le créateur d'une partie privée qui l'a QUITTÉE avant qu'elle soit complète ne la ferme plus en créant une autre partie : seule
// la partie en attente où sa connexion siège encore est remplacée (fin « replaced »). Avant, les joueurs qui attendaient à sa table,
// entrés avant ou après son départ, recevaient µgame:end { cancelled: true, reason: 'replaced' } d'une partie où il n'était plus.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

function fins(sock: any): any[] {
  const recues: any[] = []
  sock.on('µgame:end', (p: any) => recues.push(p))
  return recues
}

describe('MJS-Server — le créateur parti ne ferme plus la table où d autres attendent', () => {
  it('B entré avant le départ du créateur, C après : la nouvelle partie du créateur ne ferme pas leur table', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('table', { seats: 3, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const c = await connecter(transport, 'c')
    const finsB = fins(b)
    const finsC = fins(c)
    const r1 = await a.request('µgame:play', { type: 'table', code: true })
    await b.request('µgame:play', { type: 'table', code: r1.code })
    await a.request('µgame:leave', { game: r1.game })
    await c.request('µgame:play', { type: 'table', code: r1.code })
    const r2 = await a.request('µgame:play', { type: 'table', code: true })
    await tick(20)
    assert.notEqual(r2.game, r1.game)
    assert.deepEqual(finsB, [])
    assert.deepEqual(finsC, [])
    assert.equal((await b.request('µgame:resync', { game: r1.game })).game, r1.game)
    assert.equal((await c.request('µgame:resync', { game: r1.game })).game, r1.game)
    await app.stop()
  })
})
