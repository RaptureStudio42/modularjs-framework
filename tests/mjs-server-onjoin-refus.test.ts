// Un `throw` dans hooks.onJoin REFUSE le siège : le joueur refusé ne reste pas assis (plus aucune diffusion de la partie,
// ni resync, ni coup), son siège redevient libre pour un invité légitime, et une partie dont le créateur est refusé n'est pas
// laissée sans minuterie de partie vide. Ce que onJoin a modifié AVANT de lever n'est pas défait (la doc le dit). Protocole
// vérifié sur un vrai serveur MJS-Server + client µ.socket (MemoryTransport) ; minuteries et contournement historique
// (`players[seat] = null` puis `throw`) sur une instance de partie directe, avec des connexions factices.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

// message du refus, ou null si la requête a réussi
async function refusal(request: Promise<unknown>): Promise<string | null> {
  try { await request; return null } catch (e) { return String(e) }
}

// rejoint la salle par son code ; un refus devient une vraie erreur, lisible dans le rapport de test
async function joinRoom(sock: any, code: string): Promise<any> {
  try { return await sock.request('µgame:play', { type: 'salle', code: code }) } catch (e) { throw new Error('l\'invité légitime est refusé : ' + e) }
}

const PUSHES = ['µgame:start', 'µgame:state', 'µgame:seat', 'µgame:event', 'µgame:end', 'µgame:left']

// tout ce que la connexion reçoit de la partie, dans l'ordre
function listen(sock: any): string[] {
  const seen: string[] = []
  for (const type of PUSHES) sock.on(type, () => seen.push(type))
  return seen
}

// salle à 2 places en partie privée ; onJoin refuse l'identité 'intrus' comme le ferait une appli (liste d'exclusion) :
// un simple throw, rien d'autre
function declareRoom(app: MjsServerApp, hooks: Record<string, any> = {}, extra: Record<string, any> = {}): void {
  app.game('salle', {
    seats: 2,
    code: true,
    seatTtl: 5000,
    emptyTtl: 5000,
    state: () => ({ secret: 'reserve-aux-invites', coups: 0 }),
    moves: { jouer: (game: any) => { game.state.coups++ } },
    view: (game: any, player: any) => ({ ...game.state, vous: player ? player.id : null }),
    hooks: { onJoin: (game: any, player: any) => { if (player.id === 'intrus') throw new Error('refusé : identité exclue') }, ...hooks },
    ...extra,
  })
}

async function startApp(hooks: Record<string, any> = {}, extra: Record<string, any> = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth })
  await app.listen()
  declareRoom(app, hooks, extra)
  return { transport, app }
}

describe('onJoin qui lève — le siège est refusé (partie privée)', () => {
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  async function room(hooks: Record<string, any> = {}) {
    const started = await startApp(hooks)
    app = started.app
    const host   = makeClient(started.transport, 'hote')
    const intrus = makeClient(started.transport, 'intrus')
    const friend = makeClient(started.transport, 'ami')
    await tick()
    const created = await host.request('µgame:play', { type: 'salle', code: true })
    return { host, intrus, friend, code: created.code as string, gameId: created.game as string }
  }

  it('le joueur refusé reçoit le refus de onJoin', async () => {
    const { intrus, code } = await room()
    const message = await refusal(intrus.request('µgame:play', { type: 'salle', code: code }))
    assert.match(String(message), /refusé : identité exclue/)
  })

  it('le joueur refusé ne reçoit plus rien de la partie', async () => {
    const { host, intrus, code, gameId } = await room()
    const seen = listen(intrus)
    await refusal(intrus.request('µgame:play', { type: 'salle', code: code }))
    await host.request('µgame:move', { game: gameId, move: 'jouer' })
    await tick(30)
    assert.deepEqual(seen, [], 'le refusé a encore reçu des trames de la partie : ' + seen.join(', '))
  })

  it('le joueur refusé ne peut ni se rattacher à la partie par resync ni y jouer', async () => {
    const { intrus, code, gameId } = await room()
    await refusal(intrus.request('µgame:play', { type: 'salle', code: code }))
    assert.notEqual(await refusal(intrus.request('µgame:resync', { game: gameId })), null, 'le refusé a récupéré un siège (et la vue) par resync')
    assert.notEqual(await refusal(intrus.request('µgame:move', { game: gameId, move: 'jouer' })), null, 'le refusé a pu jouer un coup')
  })

  it('le siège du refusé est libre : un invité légitime rejoint ensuite la partie', async () => {
    const { intrus, friend, code } = await room()
    await refusal(intrus.request('µgame:play', { type: 'salle', code: code }))
    const joined = await joinRoom(friend, code)
    assert.equal(joined.seat, 1)
    assert.equal(joined.view.vous, 'ami')
  })

  it('le refusé qui retente est refusé de nouveau, sans jamais bloquer le siège', async () => {
    const { intrus, friend, code } = await room()
    for (let i = 0; i < 3; i++) assert.notEqual(await refusal(intrus.request('µgame:play', { type: 'salle', code: code })), null)
    const joined = await joinRoom(friend, code)
    assert.equal(joined.seat, 1)
  })

  it('le contournement historique (vider soi-même le siège puis lever) reste compatible', async () => {
    const { intrus, friend, code, gameId } = await room({
      onJoin: (game: any, player: any) => {
        if (player.id !== 'intrus') return
        game.players[player.seat] = null
        throw new Error('refusé : identité exclue')
      },
    })
    const seen = listen(intrus)
    const message = await refusal(intrus.request('µgame:play', { type: 'salle', code: code }))
    assert.match(String(message), /refusé : identité exclue/)
    assert.notEqual(await refusal(intrus.request('µgame:resync', { game: gameId })), null)
    const joined = await joinRoom(friend, code)
    assert.equal(joined.seat, 1)
    await tick(30)
    assert.deepEqual(seen, [])
  })

  it('créateur refusé : il ne tient ni siège ni vue de la partie qu\'il vient de créer', async () => {
    const created: string[] = []
    const started = await startApp({ onCreate: (game: any) => { created.push(game.id) } })
    app = started.app
    const intrus = makeClient(started.transport, 'intrus')
    await tick()
    const seen = listen(intrus)
    const message = await refusal(intrus.request('µgame:play', { type: 'salle', code: true }))
    assert.match(String(message), /refusé : identité exclue/)
    // la partie créée puis abandonnée, relevée à sa création
    assert.equal(created.length, 1)
    assert.notEqual(await refusal(intrus.request('µgame:resync', { game: created[0] })), null, 'le créateur refusé tient encore la partie')
    await tick(30)
    assert.deepEqual(seen, [])
  })
})

describe('onJoin qui lève — file publique', () => {
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // le refus défait l'appariement : la partie n'est jamais annoncée, l'hôte qui attendait n'en sait rien et reste en file (le détail
  // du protocole est dans mjs-server-file-publique-entree-refusee.test.ts)
  it('le ticket refusé reçoit le refus et ne tient ni siège ni vue de la partie, dont l\'hôte n\'apprend rien', async () => {
    const created: string[] = []
    const started = await startApp({ onCreate: (game: any) => { created.push(game.id) } })
    app = started.app
    const host   = makeClient(started.transport, 'hote')
    const intrus = makeClient(started.transport, 'intrus')
    await tick()
    const starts: any[] = []
    host.on('µgame:start', (p: any) => starts.push(p))
    const seen = listen(intrus)
    await host.request('µgame:play', { type: 'salle' })
    const message = await refusal(intrus.request('µgame:play', { type: 'salle' }))
    assert.match(String(message), /refusé : identité exclue/)
    await tick(30)
    assert.equal(starts.length, 0, 'l\'hôte est prévenu du début d\'une partie qui n\'a jamais commencé')
    // la partie du groupe défait, relevée à sa création : elle n'existe plus
    assert.equal(created.length, 1)
    assert.match(String(await refusal(intrus.request('µgame:resync', { game: created[0] }))), /introuvable/, 'le refusé de la file a récupéré un siège (et la vue) par resync')
    assert.match(String(await refusal(intrus.request('µgame:move', { game: created[0], move: 'jouer' }))), /introuvable/, 'le refusé de la file a pu jouer un coup')
    assert.deepEqual(seen, [], 'le refusé de la file a reçu des trames de la partie : ' + seen.join(', '))
  })
})

// --- instance de partie directe : minuteries et effets de bord ----------------------------------

function fakeApp(): any {
  return { send() {} }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function refusingGame(raw: Record<string, any> = {}): { game: any; destroyed: () => boolean } {
  let destroyed = false
  const def = resolveGameDef('refus', {
    seats: 2,
    state: () => ({ lettres: {} }),
    moves: {},
    hooks: { onJoin: (game: any, player: any) => { game.state.lettres[player.id] = 'O'; throw new Error('refusé') } },
    ...raw,
  })
  return { game: createGame(fakeApp(), def, () => { destroyed = true }, 'refus1'), destroyed: () => destroyed }
}

describe('onJoin qui lève — instance de partie', () => {
  it('le siège est libéré et l\'erreur de onJoin remonte telle quelle', () => {
    const { game } = refusingGame()
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.deepEqual(game.players, [null, null])
    game._destroy()
  })

  it('créateur refusé : la partie vide n\'est pas laissée orpheline, elle est fermée tout de suite (jamais complète)', () => {
    const { game, destroyed } = refusingGame({ emptyTtl: 40 })
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.equal(destroyed(), true, 'la partie du créateur refusé n\'est pas fermée tout de suite')
  })

  it('un refus sur une partie déjà vide ne repousse pas la grâce en cours', async () => {
    let refuse = false
    const { game } = refusingGame({
      emptyTtl: 5000,
      hooks: { onJoin: (g: any, player: any) => { if (refuse) throw new Error('refusé') } },
    })
    const host = fakeClient('hote')
    game._createSeat(host)
    game._started = true       // partie commencée : emptyTtl attend le retour de ses joueurs (une table jamais complète est fermée aussitôt)
    game._onDisconnect(host)   // plus aucun siège connecté : la grâce démarre
    const before = game._timers.get('µempty').at
    await tick(20)   // l'horloge avance : une grâce réarmée aurait une autre échéance
    refuse = true
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.equal(game._timers.get('µempty').at, before, 'un joueur refusé a repoussé la fermeture de la partie vide')
    game._destroy()
  })

  it('un refus sur une partie qui a un siège connecté ne laisse aucune minuterie de partie vide', () => {
    let refuse = false
    const { game } = refusingGame({
      emptyTtl: 5000,
      hooks: { onJoin: (g: any, player: any) => { if (refuse) throw new Error('refusé') } },
    })
    game._createSeat(fakeClient('hote'))
    refuse = true
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.equal(game._timers.has('µempty'), false)
    assert.equal(game.players.filter(Boolean).length, 1)
    game._destroy()
  })

  it('ce que onJoin a modifié avant de lever n\'est pas défait', () => {
    const { game } = refusingGame()
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.equal(game.state.lettres.intrus, 'O')
    game._destroy()
  })

  it('le contournement historique laisse intact le siège de l\'hôte', () => {
    let step = 0
    const { game } = refusingGame({
      hooks: {
        onJoin: (g: any, player: any) => {
          if (step++ === 0) return
          g.players[player.seat] = null
          throw new Error('refusé')
        },
      },
    })
    const host = fakeClient('hote')
    game._createSeat(host)
    assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé/)
    assert.equal(game.players[0]?.id, 'hote')
    assert.equal(game.players[1], null)
    game._destroy()
  })
})
