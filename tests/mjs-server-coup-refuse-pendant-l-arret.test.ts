// Pendant app.stop(), un coup reçu est refusé avec une erreur claire au lieu d'être acquitté { ok: true } puis jamais sauvegardé :
// la rafale finale de sauvegarde est déjà partie, le coup aurait disparu au redémarrage alors que le joueur le croyait joué.
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

describe('MJS-Server — coup refusé pendant l arrêt du serveur', () => {
  it('un coup reçu pendant app.stop() est refusé (« le serveur s arrête »), jamais acquitté puis perdu', async () => {
    const sauves: number[] = []
    let lent = false
    const adapter = {
      async load() { return [] },
      save(_id: string, data: any) { sauves.push(data.state?.n); return tick(lent ? 300 : 2) },
      remove() {},
      flush() {},
    }
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, persist: { adapter, debounce: 50 }, onLog: () => {} } as any)
    await app.listen()
    app.game('compteur', { seats: 1, code: true, state: () => ({ n: 0 }), view: (g: any) => g.state, moves: { inc: (g: any) => { g.state.n++ } } })
    const a = await connecter(transport, 'a')
    const r = await a.request('µgame:play', { type: 'compteur', code: true })
    await a.request('µgame:move', { game: r.game, move: 'inc' })
    await tick(200)
    lent = true
    await a.request('µgame:move', { game: r.game, move: 'inc' })
    const arret = app.stop()
    await tick(40)
    const issue = await a.request('µgame:move', { game: r.game, move: 'inc' }).then((x: any) => 'acquitté ' + JSON.stringify(x), (e: any) => 'refusé : ' + String(e?.message ?? e))
    await arret
    assert.match(issue, /^refusé : .*le serveur s'arrête/)
    assert.ok(!sauves.includes(3), JSON.stringify(sauves))
  })
})
