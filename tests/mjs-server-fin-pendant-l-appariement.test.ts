// File publique : hooks.onJoin termine la partie (game.end(), solde insuffisant par exemple) pendant l'appariement, quand la partie
// est encore muette. La fin était avalée : les joueurs recevaient µgame:start d'une partie finie et jamais µgame:end, et la fenêtre
// de confirmation des sièges (µmatch) était armée après la fin. La fin part désormais aux joueurs juste après l'annonce de la partie
// (µgame:start, et réponse de celui qui a complété le groupe : avant, son client ne connaît pas encore la partie) ; aucune fenêtre de
// confirmation n'est ouverte pour une partie finie.
// Vrai serveur MJS-Server + vrai client sock.game (mjs_socket.ts + mjs_game.ts concaténés comme le bundler), MemoryTransport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const clientSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8') + '\n' + readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const tick        = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))
const savedSocket = (globalThis as any).WebSocket
const RESULTAT    = { annulee: 'solde insuffisant' }

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

type Mode = 'synchrone' | 'par promesse'
const MODES: Mode[] = ['synchrone', 'par promesse']

for (const mode of MODES) {
  describe('file publique — fin décidée par hooks.onJoin pendant l\'appariement, crochet ' + mode, function () {
    this.timeout(15000)
    let app: MjsServerApp | null = null
    afterEach(async () => { if (app) await app.stop(); app = null })
    after(() => { (globalThis as any).WebSocket = savedSocket })

    it('les deux joueurs voient la fin : celui qui attendait en file et celui qui a complété le groupe', async () => {
      await sansChute(async () => {
        const transport = new MemoryTransport()
        app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
        await app.listen()
        const finir = (g: any): void => g.end(RESULTAT)
        app.game('duo', {
          seats: 2, seatTtl: 5000, state: () => ({}), moves: {},
          hooks: { onJoin: (g: any, p: any) => { if (p.id !== 'bob') return; if (mode === 'synchrone') finir(g); else return tick(10).then(() => finir(g)) } },
        })
        const sockA = makeClient(transport, 'alice')
        const sockB = makeClient(transport, 'bob')
        await tick()
        const alice = sockA.game('duo')
        await until(() => alice.state.queue === 1, 'Alice est en file')
        const bob = sockB.game('duo')
        await until(() => alice.state.status === 'finished' && bob.state.status === 'finished', 'les deux poignées se terminent')
        assert.deepEqual(alice.state.result, RESULTAT)
        assert.deepEqual(bob.state.result, RESULTAT)
        assert.equal(alice.state.gameId, bob.state.gameId)
      })
    })
  })
}

describe('fin pendant le silence d\'une partie de la file (moteur de partie)', () => {
  it('pas de fenêtre de confirmation après la fin, et la fin part une fois la partie annoncée', async () => {
    const sent: any[] = []
    const def  = resolveGameDef('duo-direct', { seats: 2, state: () => ({}), moves: {} })
    const game = createGame({ send(c: any, type: string, p: any) { sent.push({ c, type, p }) } } as any, def, () => {}, 'g1')
    const A = { id: 'c1', identity: { id: 'a' }, latency: null, meta: {}, send() {}, close() {} } as any
    const B = { id: 'c2', identity: { id: 'b' }, latency: null, meta: {}, send() {}, close() {} } as any
    game._silent = true
    game._createSeat(A, [])
    game._createSeat(B, [])
    game.end(RESULTAT)
    assert.equal(sent.filter(s => s.type === 'µgame:end').length, 0, 'rien ne part d\'une partie muette')
    game._announce()
    game._armConfirmWindow(['a'], 5000)
    assert.equal(game._timers.has('µmatch'), false, 'fenêtre de confirmation armée après la fin')
    assert.equal(game._unconfirmedSeats, null)
    assert.equal(game._timers.has('µempty'), true, 'la grâce de fin reste armée')
    await new Promise<void>(r => setImmediate(r))
    await tick()
    const fins = sent.filter(s => s.type === 'µgame:end')
    assert.deepEqual(fins.map(s => s.c.id).sort(), ['c1', 'c2'])
    assert.deepEqual(fins[0].p, { game: 'g1', result: RESULTAT })
    game._destroy()
  })
})
