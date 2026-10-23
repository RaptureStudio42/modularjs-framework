// Une durée au-delà de 2^31-1 ms (24,8 jours) n'est pas une durée que setTimeout sait attendre : Node la ramène à 1 ms (et
// signale un TimeoutOverflowWarning). emptyTtl, seatTtl, turns.timeout et game.timer() acceptent pourtant tout nombre fini
// > 0 : une partie vide était détruite aussitôt, une partie de la file annulée aussitôt, le tour tournait en boucle et la
// minuterie applicative partait aussitôt. MJS-Server attend maintenant par tranches jusqu'à l'échéance. Les minuteries et
// l'horloge sont simulées (node:test mock) : aucune vraie attente de 24 jours, et le simulateur reproduit le plafond de
// Node (une durée trop longue y part après 1 ms) — ces essais sont donc rouges sur l'ancien code. Deux essais en vraie
// horloge (vrai serveur, MemoryTransport) vérifient le même défaut sans simulation.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

const MAX_TIMEOUT = 2_147_483_647   // plafond d'un setTimeout Node (2^31-1 ms)
const LONG        = 3_000_000_000   // 34,7 jours : au-dessus du plafond
const DAY         = 24 * 3600 * 1000
const WALL_START  = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970

function fakeApp(): any {
  const sent: any[] = []
  return { send: (client: any, type: string, p: any) => sent.push({ client, type, p }), _sent: sent }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function declare(raw: Record<string, any> = {}): { game: any; app: any; def: any; destroyed: () => boolean } {
  let destroyed = false
  const def = resolveGameDef('longue', {
    seats: 2,
    state: () => ({ rappels: 0 }),
    moves: {},
    timers: { rappel: (game: any) => { game.state.rappels++ } },
    ...raw,
  })
  const app = fakeApp()
  return { game: createGame(app, def, () => { destroyed = true }, 'longue1'), app, def, destroyed: () => destroyed }
}

describe('MJS-Server — durées au-delà de 2^31-1 ms (minuteries simulées)', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: WALL_START }) })
  afterEach(() => { mock.timers.reset() })

  it('emptyTtl : la partie vide survit à la première tranche et n\'est détruite qu\'à l\'échéance', () => {
    const { game, destroyed } = declare({ emptyTtl: LONG })
    const host = fakeClient('hote')
    game._createSeat(host)
    game._started = true       // partie commencée : emptyTtl attend le retour de ses joueurs (une table jamais complète est fermée aussitôt)
    game._onDisconnect(host)   // plus aucun siège connecté : la grâce démarre
    mock.timers.tick(1000)
    assert.equal(destroyed(), false, 'la partie vide a été détruite aussitôt')
    mock.timers.tick(MAX_TIMEOUT)   // au-delà du plafond d'un setTimeout, avant l'échéance
    assert.equal(destroyed(), false, 'la partie vide a été détruite à la fin de la première tranche')
    mock.timers.tick(LONG - 1000 - MAX_TIMEOUT - 1)
    assert.equal(destroyed(), false, 'la partie vide a été détruite une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(destroyed(), true, 'la partie vide n\'a pas été détruite à l\'échéance')
  })

  it('seatTtl : la partie issue de la file n\'est pas annulée aussitôt, mais à l\'échéance', () => {
    const { game, app, destroyed } = declare({ seatTtl: LONG })
    game._createSeat(fakeClient('a')); game._createSeat(fakeClient('b'))
    game._armConfirmWindow(['b'], game.def.seatTtl)
    mock.timers.tick(1000)
    assert.equal(destroyed(), false, 'la partie a été annulée aussitôt')
    assert.equal(app._sent.filter((e: any) => e.type === 'µgame:end').length, 0)
    mock.timers.tick(LONG - 1000)
    assert.equal(destroyed(), true, 'la partie n\'a pas été annulée à l\'échéance')
    const ends = app._sent.filter((e: any) => e.type === 'µgame:end')
    assert.equal(ends[0].p.result.reason, 'seat-expired')
  })

  it('turns.timeout : le tour ne tourne pas aussitôt, il tourne une fois à l\'échéance', () => {
    const { game } = declare({ turns: { order: 'roundrobin', timeout: LONG } })
    game._createSeat(fakeClient('p1')); game._createSeat(fakeClient('p2'))
    game.next()
    assert.equal(game.turn, 'p1')
    mock.timers.tick(1000)
    assert.equal(game.turn, 'p1', 'le tour a tourné aussitôt')
    mock.timers.tick(MAX_TIMEOUT)
    assert.equal(game.turn, 'p1', 'le tour a tourné à la fin de la première tranche')
    mock.timers.tick(LONG - 1000 - MAX_TIMEOUT)
    assert.equal(game.turn, 'p2', 'le tour n\'a pas tourné à l\'échéance')
    game._destroy()
  })

  it('hooks.onTurnTimeout : appelé une seule fois, à l\'échéance', () => {
    let calls = 0
    const { game } = declare({ turns: { order: 'roundrobin', timeout: LONG }, hooks: { onTurnTimeout: () => { calls++ } } })
    game._createSeat(fakeClient('p1'))
    game.next()
    mock.timers.tick(LONG - 1)
    assert.equal(calls, 0)
    mock.timers.tick(1)
    assert.equal(calls, 1)
    game._destroy()
  })

  it('game.timer() : la minuterie applicative ne part pas aussitôt, elle part une fois à l\'échéance', () => {
    const { game } = declare()
    game.timer('rappel', LONG)
    mock.timers.tick(1000)
    assert.equal(game.state.rappels, 0, 'la minuterie applicative a été exécutée aussitôt')
    mock.timers.tick(LONG - 1000 - 1)
    assert.equal(game.state.rappels, 0, 'la minuterie applicative a été exécutée une milliseconde trop tôt')
    mock.timers.tick(1)
    assert.equal(game.state.rappels, 1)
    mock.timers.tick(10 * LONG)
    assert.equal(game.state.rappels, 1, 'la minuterie applicative est repartie')
    assert.equal(game._timers.size, 0, 'une minuterie échue reste enregistrée')
    game._destroy()
  })

  it('une durée de plusieurs tranches part à l\'échéance, ni avant ni deux fois', () => {
    const { game } = declare()
    game.timer('rappel', 5 * MAX_TIMEOUT + 123)
    mock.timers.tick(5 * MAX_TIMEOUT + 122)
    assert.equal(game.state.rappels, 0)
    mock.timers.tick(1)
    assert.equal(game.state.rappels, 1)
    game._destroy()
  })

  it('réarmer une minuterie longue remplace la tranche en attente : l\'ancienne échéance ne part jamais', () => {
    const { game } = declare()
    game.timer('rappel', LONG)
    mock.timers.tick(1000)
    game.timer('rappel', 100)
    mock.timers.tick(100)
    assert.equal(game.state.rappels, 1)
    mock.timers.tick(2 * LONG)
    assert.equal(game.state.rappels, 1, 'l\'ancienne échéance est repartie')
    game._destroy()
  })

  it('détruire la partie coupe la tranche en attente : aucune minuterie ne survit', () => {
    const { game } = declare()
    game.timer('rappel', LONG)
    mock.timers.tick(MAX_TIMEOUT + 1)   // la première tranche est passée, la seconde attend
    game._destroy()
    assert.equal(game._timers.size, 0)
    mock.timers.tick(2 * LONG)
    assert.equal(game.state.rappels, 0, 'une minuterie a survécu à la destruction de la partie')
  })

  it('une minuterie longue sauvegardée est réarmée au délai restant à la restauration', () => {
    const { game, def } = declare({ emptyTtl: 10 * LONG })   // la partie restaurée est vide : sa grâce ne doit pas passer avant la minuterie
    game.timer('rappel', LONG)
    mock.timers.tick(1000)
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    game._destroy()
    const restored = restoreGame(fakeApp(), def, () => {}, snapshot)
    mock.timers.tick(LONG - 1000 - 1)
    assert.equal(restored.state.rappels, 0, 'la minuterie restaurée est partie trop tôt')
    mock.timers.tick(1)
    assert.equal(restored.state.rappels, 1)
    restored._destroy()
  })

  it('Number.MAX_SAFE_INTEGER est une durée acceptée : attente sans fin pratique, jamais d\'échéance aussitôt', () => {
    const { game, destroyed } = declare({ emptyTtl: Number.MAX_SAFE_INTEGER })
    const host = fakeClient('hote')
    game._createSeat(host)
    game._started = true   // partie commencée, cf. plus haut
    game._onDisconnect(host)
    mock.timers.tick(1000 * DAY)
    assert.equal(destroyed(), false)
    game._destroy()
  })

  it('Infinity est refusé aux déclarations de durée (emptyTtl, seatTtl, turns.timeout)', () => {
    assert.throws(() => declare({ emptyTtl: Infinity }), /emptyTtl/)
    assert.throws(() => declare({ seatTtl: Infinity }), /seatTtl/)
    assert.throws(() => declare({ turns: { order: 'roundrobin', timeout: Infinity } }), /timeout/)
  })

  it('game.timer() avec Infinity : attente sans fin, et la sauvegarde reste restaurable', () => {
    const { game, def } = declare()
    game.timer('rappel', Infinity)
    mock.timers.tick(1000 * DAY)
    assert.equal(game.state.rappels, 0, 'la minuterie infinie est partie')
    const snapshot = JSON.parse(JSON.stringify(game.serialize()))
    assert.equal(typeof snapshot.timers[0].at, 'number', 'l\'échéance infinie ne survit pas à la sérialisation JSON')
    const restored = restoreGame(fakeApp(), def, () => {}, snapshot)
    restored._destroy()
    game._destroy()
  })
})

describe('MJS-Server — durées au-delà de 2^31-1 ms (vraie horloge)', () => {
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
    app.game('duo', { seats: 2, code: true, state: () => ({ rappels: 0 }), view: (game: any) => ({ rappels: game.state.rappels }), moves: {}, ...raw })
    return transport
  }

  it('emptyTtl de 3 000 000 000 ms : la partie commencée vide survit à une coupure de 100 ms, sans avertissement de Node', async () => {
    const warnings: string[] = []
    const listener = (w: Error) => { warnings.push(w.name) }
    process.on('warning', listener)
    try {
      const transport = await serve({ emptyTtl: LONG, seats: 1 })   // une place : la partie commence à sa création
      const host = makeClient(transport, 'hote'); await tick()
      const created = await host.request('µgame:play', { type: 'duo', code: true })
      host.close()
      await tick(100)
      const back = makeClient(transport, 'hote'); await tick()
      const resync = await back.request('µgame:resync', { game: created.game }).catch((e: unknown) => assert.fail('la partie vide a été fermée aussitôt : ' + e)) as any
      assert.equal(resync.seat, 0)
      assert.deepEqual(warnings.filter(name => name === 'TimeoutOverflowWarning'), [], 'Node a signalé un dépassement de durée')
    } finally {
      process.off('warning', listener)
    }
  })

  it('seatTtl de 3 000 000 000 ms : la partie de la file n\'est pas annulée aussitôt', async () => {
    const transport = await serve({ seatTtl: LONG })
    const a = makeClient(transport, 'a'); const b = makeClient(transport, 'b'); await tick()
    const ends: any[] = []
    a.on('µgame:end', (p: any) => ends.push(p))
    await a.request('µgame:play', { type: 'duo' })
    await b.request('µgame:play', { type: 'duo' })
    await tick(100)
    assert.deepEqual(ends, [], 'la partie a été annulée aussitôt')
  })
})
