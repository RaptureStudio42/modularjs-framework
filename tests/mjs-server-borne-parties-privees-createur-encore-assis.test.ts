// La borne des parties privées en cours ne compte que les parties où leur créateur est encore assis, connecté ou non : une table
// qu'il a quittée ne compte plus, même si d'autres joueurs y restent. Avant, un invité resté assis dans les cinq tables que leur
// créateur avait quittées empêchait celui-ci d'en créer aucune autre tant qu'il restait connecté, sans aucun geste pour s'en libérer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
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

const PLAFOND = /limite de parties privées en cours atteinte \(5\)/

describe('MJS-Server — borne des parties privées : seules comptent celles où le créateur est encore assis', function() {
  this.timeout(20000)

  it('A quitte ses cinq tables, où B reste assis : A peut en créer une sixième', async () => {
    const { transport, app } = await startApp()
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    for (let i = 0; i < 5; i++) {
      const r = await a.request('µgame:play', { type: 'duo', code: true })
      await b.request('µgame:play', { type: 'duo', code: r.code })
      await a.request('µgame:leave', { game: r.game })
    }
    const sixieme = await a.request('µgame:play', { type: 'duo', code: true })
    assert.ok(sixieme.game)
    await app.stop()
  })

  it('un créateur déconnecté reste assis : ses parties commencées comptent encore quand il revient par une autre connexion', async () => {
    const { transport, app } = await startApp()
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    for (let i = 0; i < 5; i++) {
      const r = await a.request('µgame:play', { type: 'duo', code: true })
      await b.request('µgame:play', { type: 'duo', code: r.code })
    }
    a.close()
    await tick(10)
    const a2 = await connecter(transport, 'a')
    await assert.rejects(a2.request('µgame:play', { type: 'duo', code: true }), PLAFOND)
    await app.stop()
  })
})
