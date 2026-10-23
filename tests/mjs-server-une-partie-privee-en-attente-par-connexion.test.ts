// Une connexion ne tient qu'une partie privée en attente à la fois : créer une nouvelle partie par code ferme la précédente tant que
// ses places n'ont jamais été toutes prises (µgame:end { cancelled: true, reason: 'replaced' } à ses sièges, partie détruite, code
// oublié). Sans cette borne, une seule connexion créait autant de parties vivantes qu'elle envoyait de µgame:play { code: true } et
// pouvait épuiser la mémoire du serveur à elle seule. Une partie dont les places ont été prises est une vraie partie : elle continue.
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
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, ...opts })
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

/** les µgame:end reçus par une connexion, dans l'ordre */
function fins(sock: any): any[] {
  const recues: any[] = []
  sock.on('µgame:end', (p: any) => recues.push(p))
  return recues
}

describe('MJS-Server — une seule partie privée en attente par connexion', () => {
  it('créer une 2e partie par code ferme la 1re encore en attente : fin « replaced » pour son créateur, partie et code oubliés', async () => {
    const { transport, app } = await startApp()
    app.game('salon', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const finsA = fins(a)
    const r1 = await a.request('µgame:play', { type: 'salon', code: true })
    const r2 = await a.request('µgame:play', { type: 'salon', code: true })
    await tick(10)
    assert.notEqual(r2.game, r1.game)
    assert.deepEqual(finsA, [{ game: r1.game, result: { cancelled: true, reason: 'replaced' } }])
    await assert.rejects(a.request('µgame:resync', { game: r1.game }), /partie introuvable/)
    await assert.rejects(b.request('µgame:play', { type: 'salon', code: r1.code }), /code inconnu/)
    const encore = await a.request('µgame:resync', { game: r2.game })
    assert.equal(encore.game, r2.game)
    await app.stop()
  })

  it('une partie dont les places ont été prises n est pas fermée par la création suivante de son créateur', async () => {
    const { transport, app } = await startApp()
    app.game('salon', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const finsA = fins(a)
    const finsB = fins(b)
    const r1 = await a.request('µgame:play', { type: 'salon', code: true })
    await b.request('µgame:play', { type: 'salon', code: r1.code })
    const r2 = await a.request('µgame:play', { type: 'salon', code: true })
    await tick(10)
    assert.deepEqual(finsA, [])
    assert.deepEqual(finsB, [])
    const vueB = await b.request('µgame:resync', { game: r1.game })
    assert.equal(vueB.game, r1.game)
    const vueA = await a.request('µgame:resync', { game: r2.game })
    assert.equal(vueA.game, r2.game)
    await app.stop()
  })

  it('une connexion qui enchaîne les créations ne garde qu une partie vivante, quel que soit le type de jeu', async () => {
    const { transport, app } = await startApp()
    app.game('salon', { seats: 2, code: true, state: () => ({}), moves: {} })
    app.game('autre', { seats: 3, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const finsA = fins(a)
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push((await a.request('µgame:play', { type: i % 2 === 0 ? 'salon' : 'autre', code: true })).game)
    await tick(10)
    let vivantes = 0
    for (const id of ids) {
      try {
        await a.request('µgame:resync', { game: id })
        vivantes++
      } catch {
        // partie fermée par la création suivante
      }
    }
    assert.equal(vivantes, 1)
    assert.deepEqual(finsA.map(f => f.game), ids.slice(0, -1))
    await app.stop()
  })
})
