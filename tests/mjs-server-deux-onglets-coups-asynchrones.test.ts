// Un joueur ouvert dans deux onglets (deux connexions, une identité, un siège) qui joue un coup ASYNCHRONE (appel de base de données
// avant d'appliquer le coup) : mjs-ws traite les trames d'une connexion une par une, mais deux connexions en parallèle. Les deux coups
// passaient la garde « ce n'est pas votre tour » avant que le premier ne passe le tour : le joueur jouait deux fois, l'adversaire
// sautait son tour. Les coups d'un même joueur passent désormais un par un, quel que soit le nombre de ses onglets : le second attend
// la fin du premier, puis passe toutes les gardes (partie finie, siège, phase, tour, anti-abus) comme s'il venait d'arriver.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname   = dirname(fileURLToPath(import.meta.url))
const clientSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick        = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))
const savedSocket = (globalThis as any).WebSocket

function connecter(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

function fakeClient(identityId: string, connId: string): any {
  return { id: connId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('deux onglets d\'un même joueur — coups asynchrones', function () {
  this.timeout(15000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })
  after(() => { (globalThis as any).WebSocket = savedSocket })

  async function partie(def: any): Promise<{ sA1: any; sA2: any; sB: any; game: string }> {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
    await app.listen()
    app.game('grille', def)
    const sA1 = connecter(transport, 'a')
    const sA2 = connecter(transport, 'a')
    const sB  = connecter(transport, 'b')
    await tick()
    const rA = await sA1.request('µgame:play', { type: 'grille', code: true })
    await sB.request('µgame:play', { type: 'grille', code: rA.code })
    const r2 = await sA2.request('µgame:resync', { game: rA.game })
    assert.equal(r2.seat, rA.seat, 'le 2e onglet est assis au même siège')
    await tick(10)
    return { sA1, sA2, sB, game: rA.game }
  }

  it('tour par tour : un seul des deux coups passe, le tour va à l\'adversaire', async () => {
    const { sA1, sA2, sB, game } = await partie({
      seats: 2, code: true, state: () => ({ marks: [] as string[] }), view: (g: any) => g.state, turns: { order: 'roundrobin' },
      hooks: { onJoin: (g: any) => { if (g.players.every((x: any) => x)) g.next() } },
      moves: { jouer: async (g: any, p: any, x: any) => { await tick(30); g.state.marks.push(p.id + ':' + x.i); g.next() } },
    })
    const [m1, m2] = await Promise.allSettled([
      sA1.request('µgame:move', { game, move: 'jouer', p: { i: 0 } }),
      sA2.request('µgame:move', { game, move: 'jouer', p: { i: 4 } }),
    ])
    await tick(60)
    const etat = await sB.request('µgame:resync', { game })
    assert.equal(m1.status, 'fulfilled')
    assert.equal(m2.status, 'rejected', 'le coup du 2e onglet est passé dans le même tour')
    assert.match(String((m2 as PromiseRejectedResult).reason), /pas votre tour|not your turn/)
    assert.deepEqual(etat.view.marks, ['a:0'])
    assert.equal(etat.turn, 'b')
  })

  it('sans tour : les deux coups passent, l\'un après l\'autre, jamais entremêlés', async () => {
    const { sA1, sA2, sB, game } = await partie({
      seats: 2, code: true, state: () => ({ trace: [] as string[] }), view: (g: any) => g.state,
      moves: { noter: async (g: any, _p: any, x: any) => { g.state.trace.push('debut:' + x.i); await tick(30); g.state.trace.push('fin:' + x.i) } },
    })
    const [m1, m2] = await Promise.allSettled([
      sA1.request('µgame:move', { game, move: 'noter', p: { i: 0 } }),
      sA2.request('µgame:move', { game, move: 'noter', p: { i: 4 } }),
    ])
    await tick(30)
    const etat = await sB.request('µgame:resync', { game })
    assert.equal(m1.status, 'fulfilled')
    assert.equal(m2.status, 'fulfilled')
    assert.deepEqual(etat.view.trace, ['debut:0', 'fin:0', 'debut:4', 'fin:4'])
  })
})

describe('deux onglets d\'un même joueur — le coup en attente', () => {
  it('la partie détruite pendant l\'attente : le coup en attente est refusé et ne tourne pas', async () => {
    let liberer: () => void = () => {}
    const attente = new Promise<void>(r => { liberer = r })
    let appels    = 0
    const def  = resolveGameDef('attente-detruite', { seats: 1, state: () => ({}), moves: { lent: async () => { appels++; await attente } } })
    const game = createGame({ send() {} } as any, def, () => {}, 'g1')
    const onglet1 = fakeClient('a', 'c1')
    const onglet2 = fakeClient('a', 'c2')
    game._createSeat(onglet1)
    game._createSeat(onglet2)
    const premier = game._onMove(onglet1, 'lent', {}) as Promise<unknown>
    const second  = Promise.resolve(game._onMove(onglet2, 'lent', {})).then(() => 'accepté', (err: Error) => err.message)
    await tick()
    assert.equal(appels, 1, 'le second coup a tourné pendant le premier')
    game._destroy()
    liberer()
    await premier
    assert.match(await second, /introuvable|not found/)
    assert.equal(appels, 1, 'le coup en attente a tourné dans une partie détruite')
  })

  it('un coup synchrone reste synchrone : résultat rendu tout de suite, sans attente', () => {
    const def  = resolveGameDef('synchrone', { seats: 1, state: () => ({ n: 0 }), moves: { inc: (g: any) => ++g.state.n } })
    const game = createGame({ send() {} } as any, def, () => {}, 'g2')
    const onglet1 = fakeClient('a', 'c1')
    game._createSeat(onglet1)
    assert.equal(game._onMove(onglet1, 'inc', {}), 1)
    assert.equal(game._onMove(onglet1, 'inc', {}), 2)
    game._destroy()
  })
})
