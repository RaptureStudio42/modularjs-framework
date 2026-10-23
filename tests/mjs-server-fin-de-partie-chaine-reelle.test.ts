// Une partie finie ne redevient ni « annulée » ni « en cours de tour » : essais de bout en bout (mjsServer + clients µsocket sur
// MemoryTransport, vraie horloge, durées courtes). Une partie de la file garde sa fenêtre de confirmation seatTtl tant qu'un siège
// n'a rien confirmé : si le siège qui a complété la file finit la partie avant, la fenêtre venait encore l'annuler en pleine grâce
// de endTtl (second µgame:end { cancelled }, partie détruite, µgame:resync sans réponse). La minuterie de tour, elle, continuait de
// tirer pendant la grâce et rediffusait l'état de la partie finie. Les essais à minuteries simulées vivent dans
// mjs-server-grace-apres-la-fin.test.ts ; ceux-ci prouvent la même chose sur le serveur entier.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const pause     = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-Server — la partie finie de bout en bout (vraie horloge)', () => {
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  function makeClient(transport: MemoryTransport, id: string): any {
    ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
    new Function('µ', clientSrc)(µ)
    const sock = µ.socket('memory://' + id + Math.random().toString(36).slice(2, 6), { auth: () => ({ id: id }), reconnect: { enabled: false } })
    sock.connect()
    return sock
  }

  async function serve(raw: Record<string, any>) {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth })
    await app.listen()
    app.game('duel', { seats: 2, state: () => ({}), view: () => ({}), moves: {}, ...raw })
    return transport
  }

  it('b complète la file puis finit la partie avant que a ait confirmé : passé seatTtl, b ne reçoit qu\'un seul µgame:end et la partie reste interrogeable', async () => {
    const transport = await serve({ seatTtl: 300, endTtl: 600_000, moves: { gg: (game: any, player: any) => { game.end({ gagnant: player.id }) } } })
    const a = makeClient(transport, 'a')
    const b = makeClient(transport, 'b')
    await pause()
    const fins: any[] = []
    b.on('µgame:end', (p: any) => fins.push(p))
    await a.request('µgame:play', { type: 'duel' })   // a attend en file
    const assis = await b.request('µgame:play', { type: 'duel' }) as any   // b complète la file : a n'a encore rien confirmé
    await b.request('µgame:move', { game: assis.game, move: 'gg' })
    await pause(700)   // largement au-delà de seatTtl
    assert.deepEqual(fins.map(p => p.result), [{ gagnant: 'b' }], 'b a reçu autre chose que la seule fin de la partie')
    const resync = await b.request('µgame:resync', { game: assis.game }).catch((e: unknown) => assert.fail('la partie finie a disparu avant la fin de sa grâce : ' + e)) as any
    assert.equal(resync.seat, 1)
  })

  it('la partie finie sur un coup qui passe la main ne rejoue plus le tour : onTurnTimeout reste muet et aucune trame d\'état ne part après la fin', async () => {
    let rappels = 0
    const transport = await serve({
      turns: { order: 'roundrobin', timeout: 150 },
      hooks: { onTurnTimeout: (game: any) => { rappels++; game.next() } },
      moves: { gg: (game: any, player: any) => { game.next(); game.end({ gagnant: player.id }) } }
    })
    const a = makeClient(transport, 'a')
    const b = makeClient(transport, 'b')
    await pause()
    const etats: any[] = []
    b.on('µgame:state', (p: any) => etats.push(p))
    await a.request('µgame:play', { type: 'duel' })
    const assis = await b.request('µgame:play', { type: 'duel' }) as any
    await b.request('µgame:move', { game: assis.game, move: 'gg' })
    await pause(50)   // la diffusion groupée du coup est partie
    const avant = etats.length
    await pause(600)   // plusieurs échéances de tour
    assert.equal(rappels, 0, 'onTurnTimeout a été rappelé après la fin')
    assert.equal(etats.length, avant, 'l\'état de la partie finie a été rediffusé')
  })
})
