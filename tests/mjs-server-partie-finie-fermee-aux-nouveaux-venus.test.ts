// Partie par code terminée (dans sa grâce `endTtl`) : un nouveau venu qui a le code prenait le siège libéré par un départ — assis
// dans une partie finie, et hooks.onJoin tournait après la fin. Il est désormais refusé (« partie terminée ») sans que onJoin ne
// tourne ; un joueur déjà assis, lui, peut toujours se resynchroniser ou rattacher un 2e onglet pendant la grâce.
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

/** partie par code à 2 places, finie par le coup 'fin' ; compte les hooks.onJoin appelés après la fin */
function declarerSalle(app: MjsServerApp, compteur: { apresFin: number }): void {
  app.game('salle', {
    seats: 2,
    code: true,
    endTtl: 60000,
    state: () => ({ fini: false }),
    hooks: { onJoin: (game: any) => { if (game.state.fini) compteur.apresFin++ } },
    moves: { fin: (game: any) => { game.state.fini = true; game.end({}) } },
  })
}

describe('MJS-Server — partie finie fermée aux nouveaux venus', () => {
  it('un nouveau venu avec le code est refusé dans une partie terminée, sans passer par hooks.onJoin', async () => {
    const { transport, app } = await startApp()
    const compteur = { apresFin: 0 }
    declarerSalle(app, compteur)
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const partie = await a.request('µgame:play', { type: 'salle', code: true })
    await b.request('µgame:play', { type: 'salle', code: partie.code })
    await a.request('µgame:move', { game: partie.game, move: 'fin' })
    await b.request('µgame:leave', { game: partie.game })
    const c = await connecter(transport, 'c')
    await assert.rejects(c.request('µgame:play', { type: 'salle', code: partie.code }), /partie terminée/)
    assert.equal(compteur.apresFin, 0)
    await app.stop()
  })

  it('un joueur déjà assis se resynchronise et rattache un 2e onglet pendant la grâce', async () => {
    const { transport, app } = await startApp()
    const compteur = { apresFin: 0 }
    declarerSalle(app, compteur)
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const partie = await a.request('µgame:play', { type: 'salle', code: true })
    await b.request('µgame:play', { type: 'salle', code: partie.code })
    await a.request('µgame:move', { game: partie.game, move: 'fin' })
    const resync = await a.request('µgame:resync', { game: partie.game })
    assert.equal(resync.seat, 0)
    const a2 = await connecter(transport, 'a')
    const onglet = await a2.request('µgame:play', { type: 'salle', code: partie.code })
    assert.equal(onglet.game, partie.game)
    assert.equal(onglet.seat, 0)
    assert.equal(compteur.apresFin, 0)
    await app.stop()
  })
})
