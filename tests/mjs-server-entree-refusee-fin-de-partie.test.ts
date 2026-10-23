// Un joueur refusé APRÈS COUP (la Promise de hooks.onJoin est rejetée) a déjà reçu sa réponse de siège : le refus lui arrive
// désormais sous la forme d'une fin de partie « entrée refusée » (µgame:end { refused: true, reason: 'join-refused' }), à lui seul.
// Les autres joueurs et les spectateurs reçoivent ce qu'ils recevaient déjà (µgame:left puis le roster), jamais cette fin : la
// partie, elle, continue. Un refus synchrone (throw) n'est pas concerné : son erreur est la réponse de la requête du joueur.
// Protocole vérifié sur un vrai serveur MJS-Server + clients µ.socket (MemoryTransport) ; ordre des trames, onglets multiples et
// rejets tardifs sur une instance de partie directe, avec des connexions factices
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8') + '\n' + readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

const REFUSED = { refused: true, reason: 'join-refused' }

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

// une Promise que le test résout ou rejette quand il le décide
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// --- vrai serveur + clients µ.socket ----------------------------------------------------------

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

const PUSHES = ['µgame:start', 'µgame:state', 'µgame:seat', 'µgame:event', 'µgame:end', 'µgame:left']

// tout ce que la connexion reçoit de la partie, dans l'ordre
function listen(sock: any): Array<{ type: string; p: any }> {
  const seen: Array<{ type: string; p: any }> = []
  for (const type of PUSHES) sock.on(type, (p: any) => seen.push({ type, p }))
  return seen
}

// salle à 2 places en partie privée ; onJoin refuse l'identité 'intrus' par une Promise rejetée au bout de 20 ms
async function startApp(): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  await app.listen()
  app.game('salle', {
    seats: 2,
    code: true,
    seatTtl: 5000,
    emptyTtl: 5000,
    state: () => ({ coups: 0 }),
    moves: { jouer: (game: any) => { game.state.coups++ } },
    view: (game: any, player: any) => ({ coups: game.state.coups, vous: player ? player.id : null }),
    hooks: { onJoin: (game: any, player: any) => player.id === 'intrus' ? new Promise((_, rejet) => setTimeout(() => rejet(new Error('boum-admission')), 20)) : undefined },
  })
  return { transport, app }
}

describe('MJS-Server — le joueur refusé après coup reçoit une fin « entrée refusée » (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  async function room() {
    const started = await startApp()
    app           = started.app
    const host    = makeClient(started.transport, 'hote')
    const intrus  = makeClient(started.transport, 'intrus')
    const friend  = makeClient(started.transport, 'ami')
    await tick()
    const created = await host.request('µgame:play', { type: 'salle', code: true })
    await tick(30)
    return { host, intrus, friend, code: created.code as string, gameId: created.game as string }
  }

  it('le refusé reçoit une seule fois µgame:end { refused: true, reason: \'join-refused\' }, après sa réponse de siège, et rien d\'autre ensuite', async () => {
    await sansChute(async () => {
      const { intrus, code, gameId } = await room()
      const seen   = listen(intrus)
      const joined = await intrus.request('µgame:play', { type: 'salle', code: code })
      assert.equal(joined.seat, 1, 'la requête du refusé a bien reçu sa réponse de siège avant le rejet')
      await until(() => seen.some(e => e.type === 'µgame:end'), 'le refusé reçoit µgame:end')
      await tick(60)
      const fins = seen.filter(e => e.type === 'µgame:end')
      assert.equal(fins.length, 1, 'le refusé a reçu ' + fins.length + ' fins de partie')
      assert.deepEqual(fins[0].p.result, REFUSED)
      assert.equal(fins[0].p.game, gameId)
      assert.equal(seen[seen.length - 1].type, 'µgame:end', 'le refusé a reçu une trame de la partie après sa fin : ' + seen.map(e => e.type).join(', '))
    })
  })

  it('la poignée du refusé passe en statut finished, avec le résultat de son refus', async () => {
    await sansChute(async () => {
      const { intrus, code } = await room()
      const poignee = intrus.game('salle', { code: code })
      const fins: any[] = []
      poignee.on('end', (p: any) => fins.push(p))
      await until(() => poignee.state.status === 'finished', 'la poignée du refusé se termine')
      assert.deepEqual(poignee.state.result, REFUSED)
      assert.equal(fins.length, 1)
      assert.deepEqual(fins[0].result, REFUSED)
    })
  })

  it('les autres joueurs ne reçoivent pas cette fin : ils reçoivent µgame:left puis le roster, et la partie continue', async () => {
    await sansChute(async () => {
      const { host, intrus, friend, code, gameId } = await room()
      const seen = listen(host)
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => seen.some(e => e.type === 'µgame:left'), 'l\'hôte est prévenu du départ du refusé')
      await tick(60)
      assert.equal(seen.some(e => e.type === 'µgame:end'), false, 'l\'hôte a reçu la fin d\'entrée refusée de l\'autre : ' + seen.map(e => e.type).join(', '))
      const left = seen.findIndex(e => e.type === 'µgame:left')
      assert.equal(seen[left].p.seat, 1)
      assert.equal(seen[left + 1].type, 'µgame:seat')
      await host.request('µgame:move', { game: gameId, move: 'jouer' })
      const joined = await friend.request('µgame:play', { type: 'salle', code: code })
      assert.equal(joined.seat, 1, 'le siège du refusé est libre pour un invité légitime')
      await tick(60)
      assert.equal(seen.some(e => e.type === 'µgame:end'), false, 'la partie a été terminée pour l\'hôte')
    })
  })

  it('le refusé ne peut ni se rattacher par resync ni jouer après sa fin', async () => {
    await sansChute(async () => {
      const { intrus, code, gameId } = await room()
      const seen = listen(intrus)
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => seen.some(e => e.type === 'µgame:end'), 'le refusé reçoit µgame:end')
      await assert.rejects(intrus.request('µgame:resync', { game: gameId }), 'le refusé a récupéré un siège par resync')
      await assert.rejects(intrus.request('µgame:move', { game: gameId, move: 'jouer' }), 'le refusé a pu jouer un coup')
    })
  })
})

// --- instance de partie directe ---------------------------------------------------------------

function fakeAppCapture(): any {
  const sent: any[] = []
  return { send: (client: any, type: string, p: any) => sent.push({ client, type, p }), _sent: sent }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// partie directe à 2 sièges ; onJoin du joueur 'intrus' rendu par `rendre(player)` ; received(client, type) = trames reçues par ce client
function directGame(rendre: (player: any) => unknown = () => undefined, extra: Record<string, any> = {}) {
  const app              = fakeAppCapture()
  const errors: string[] = []
  const def = resolveGameDef('admission', {
    seats: 2,
    emptyTtl: 5000,
    state: () => ({ coups: 0 }),
    view: (game: any) => ({ coups: game.state.coups }),
    moves: {},
    hooks: { onJoin: (g: any, player: any) => player.id === 'intrus' ? rendre(player) : undefined },
    ...extra,
  }, (level, msg) => { if (level === 'error') errors.push(String(msg)) })
  const game     = createGame(app, def, () => {}, 'admg')
  const received = (client: any, type: string): any[] => app._sent.filter((e: any) => e.client === client && e.type === type)
  const sentTo   = (client: any): string[] => app._sent.filter((e: any) => e.client === client).map((e: any) => e.type)
  return { game, app, errors, received, sentTo }
}

describe('MJS-Server — la fin « entrée refusée » (instance de partie)', function () {
  this.timeout(8000)

  it('la fin part au refusé seul, avant µgame:left des autres, avec l\'id de la partie et le résultat du refus', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, app, received, sentTo } = directGame(() => attente.promise)
      const host   = fakeClient('hote')
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(host)
        game._createSeat(intrus)
        attente.reject(new Error('boum-tardif'))
        await until(() => received(intrus, 'µgame:end').length > 0, 'le refusé reçoit µgame:end')
        await tick(20)
        const fins = app._sent.filter((e: any) => e.type === 'µgame:end')
        assert.equal(fins.length, 1, 'la fin a été envoyée à ' + fins.length + ' connexions')
        assert.equal(fins[0].client, intrus)
        assert.deepEqual(fins[0].p, { game: 'admg', result: REFUSED })
        assert.equal(sentTo(host).includes('µgame:end'), false)
        const iFin  = app._sent.findIndex((e: any) => e.type === 'µgame:end')
        const iLeft = app._sent.findIndex((e: any) => e.type === 'µgame:left')
        assert.ok(iFin >= 0 && iLeft > iFin, 'la fin du refusé doit précéder le µgame:left des autres (fin à ' + iFin + ', left à ' + iLeft + ')')
      } finally { game._destroy() }
    })
  })

  it('les deux onglets du refusé reçoivent la fin', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, received } = directGame(() => attente.promise)
      const onglet1 = fakeClient('intrus')
      const onglet2 = fakeClient('intrus')
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(onglet1)
        game._createSeat(onglet2)   // même identité : rattaché au siège existant, sans nouvel onJoin
        attente.reject(new Error('boum-tardif'))
        await until(() => received(onglet1, 'µgame:end').length > 0 && received(onglet2, 'µgame:end').length > 0, 'les deux onglets reçoivent µgame:end')
        assert.equal(received(onglet1, 'µgame:end').length, 1)
        assert.equal(received(onglet2, 'µgame:end').length, 1)
      } finally { game._destroy() }
    })
  })

  it('un spectateur reçoit µgame:left du refusé, jamais sa fin', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, received } = directGame(() => attente.promise, { spectatorView: () => ({}) })
      const spectateur = fakeClient('curieux')
      try {
        game._createSeat(fakeClient('hote'))
        game._addSpectator(spectateur)
        game._createSeat(fakeClient('intrus'))
        attente.reject(new Error('boum-tardif'))
        await until(() => received(spectateur, 'µgame:left').length > 0, 'le spectateur est prévenu du départ du refusé')
        await tick(20)
        assert.equal(received(spectateur, 'µgame:end').length, 0, 'le spectateur a reçu la fin d\'entrée refusée')
      } finally { game._destroy() }
    })
  })

  it('un refusé déjà déconnecté ne reçoit rien et son siège est libéré quand même', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, app, received } = directGame(() => attente.promise)
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(intrus)
        game._onDisconnect(intrus)
        const avant = app._sent.length
        attente.reject(new Error('boum-tardif'))
        await tick(40)
        assert.equal(received(intrus, 'µgame:end').length, 0)
        assert.equal(game.players[1], null, 'le siège du refusé n\'est pas libéré')
        assert.equal(app._sent.slice(avant).some((e: any) => e.client === intrus), false)
      } finally { game._destroy() }
    })
  })

  it('un refus appliqué deux fois n\'envoie la fin qu\'une fois', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, received } = directGame(() => attente.promise)
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(fakeClient('hote'))
        const siege = game._createSeat(intrus)
        attente.reject(new Error('boum-tardif'))
        await until(() => received(intrus, 'µgame:end').length > 0, 'le refusé reçoit µgame:end')
        game._refuseSeat(siege)
        await tick(20)
        assert.equal(received(intrus, 'µgame:end').length, 1, 'la fin a été envoyée deux fois')
      } finally { game._destroy() }
    })
  })

  it('un joueur qui est parti avant le rejet ne reçoit pas de fin : il n\'est plus assis', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, received } = directGame(() => attente.promise)
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(intrus)
        game._leave(intrus)
        attente.reject(new Error('boum-tardif'))
        await tick(40)
        assert.equal(received(intrus, 'µgame:end').length, 0)
      } finally { game._destroy() }
    })
  })

  it('un rejet après la destruction de la partie n\'envoie rien', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, app } = directGame(() => attente.promise)
      game._createSeat(fakeClient('hote'))
      game._createSeat(fakeClient('intrus'))
      game._destroy()
      const avant = app._sent.length
      attente.reject(new Error('boum-tardif'))
      await tick(40)
      assert.equal(app._sent.length, avant, 'des trames sont parties d\'une partie détruite')
    })
  })

  it('témoin : un refus synchrone (throw) ne produit aucune fin, son erreur remonte à l\'appelant', () => {
    const { game, app } = directGame(() => { throw new Error('refusé : identité exclue') })
    try {
      game._createSeat(fakeClient('hote'))
      assert.throws(() => game._createSeat(fakeClient('intrus')), /refusé : identité exclue/)
      assert.equal(app._sent.some((e: any) => e.type === 'µgame:end'), false, 'un refus synchrone a envoyé une fin de partie')
    } finally { game._destroy() }
  })

  it('témoin : une Promise résolue ne refuse personne, aucune fin n\'est envoyée', async () => {
    await sansChute(async () => {
      const { game, app } = directGame(() => Promise.resolve())
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(fakeClient('intrus'))
        await tick(40)
        assert.equal(app._sent.some((e: any) => e.type === 'µgame:end'), false)
        assert.equal(game.players[1]?.id, 'intrus')
      } finally { game._destroy() }
    })
  })
})
