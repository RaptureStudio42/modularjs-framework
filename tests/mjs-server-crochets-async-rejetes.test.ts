// hooks.onJoin, hooks.onEnd et hooks.onCreate sont synchrones par contrat, mais un auteur peut en écrire un `async` (ou renvoyer
// une Promise) : MJS-Server ne l'attend pas. Une Promise rejetée n'a alors personne à qui remonter : sans suivi, c'est un rejet non
// géré, que Node traite comme une erreur fatale (le processus tombe). Chaque rejet est donc suivi et journalisé (error, avec le
// nom du crochet). Pour onJoin, le rejet vaut refus du siège. En partie par code, un rejet connu après la réponse de la demande du joueur
// (le crochet a attendu quelque chose) est appliqué après coup : la requête a reçu sa réponse de siège, le siège est ensuite libéré, les
// autres sièges reçoivent µgame:left puis le roster à jour, et le refusé reçoit une fin « entrée refusée » puis plus rien (un rejet connu
// avant cette réponse refuse la demande elle-même : tests/mjs-server-refus-code-avant-apres-reponse.test.ts). En file publique,
// l'appariement attend la Promise : le refus défait le groupe avant qu'il ne soit annoncé. Protocole vérifié sur un vrai serveur
// MJS-Server + client µ.socket (MemoryTransport) ; minuteries, ordre des trames et rejets tardifs sur une instance de partie directe,
// avec des connexions factices
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

async function until(condition: () => boolean, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

async function untilAsync(condition: () => Promise<boolean>, label: string, limit = 2500): Promise<void> {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(10)
  }
}

// une Promise que le test résout ou rejette quand il le décide
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// le crochet d'un auteur qui refuse l'identité 'intrus' de façon asynchrone
const refuseIntrus = (game: any, player: any): Promise<void> | undefined => player.id === 'intrus' ? Promise.reject(new Error('boum-admission')) : undefined

// le même crochet, mais qui attend (une base de données, par exemple) avant de rejeter : en partie par code, le rejet est connu APRÈS la
// réponse de la demande du joueur, qui a donc son siège avant d'être refusé (rejeté sans attente, il refuserait la demande elle-même :
// tests/mjs-server-refus-code-avant-apres-reponse.test.ts)
const refuseIntrusPlusTard = (game: any, player: any): Promise<void> | undefined => player.id === 'intrus' ? new Promise((_, rejet) => setTimeout(() => rejet(new Error('boum-admission')), 20)) : undefined

// --- vrai serveur + clients µ.socket ----------------------------------------------------------

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

const PUSHES = ['µgame:start', 'µgame:state', 'µgame:seat', 'µgame:event', 'µgame:end', 'µgame:left']

// tout ce que la connexion reçoit de la partie, dans l'ordre
function listen(sock: any): Array<{ type: string; p: any }> {
  const seen: Array<{ type: string; p: any }> = []
  for (const type of PUSHES) sock.on(type, (p: any) => seen.push({ type, p }))
  return seen
}

interface LogEntry { level: string; message: string; meta: any }

const logged = (journal: LogEntry[], crochet: string, texte: string): boolean => journal.some(e => e.level === 'error' && e.message.includes(crochet) && e.message.includes(texte))

// salle à 2 places, en partie privée ou par la file ; `hooks` et `extra` sont ceux de l'auteur
async function startApp(hooks: Record<string, any>, extra: Record<string, any> = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp; journal: LogEntry[] }> {
  const transport = new MemoryTransport()
  const journal: LogEntry[] = []
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (level: any, message: any, meta: any) => { journal.push({ level, message: String(message), meta }) } })
  await app.listen()
  app.game('salle', {
    seats: 2,
    code: true,
    seatTtl: 5000,
    emptyTtl: 5000,
    state: () => ({ coups: 0 }),
    moves: {
      jouer: (game: any) => { game.state.coups++ },
      finir: (game: any) => { game.end({ gagnant: 'hote' }) },
    },
    view: (game: any, player: any) => ({ coups: game.state.coups, vous: player ? player.id : null }),
    hooks,
    ...extra,
  })
  return { transport, app, journal }
}

// la partie vit-elle encore ? une connexion qui n'a jamais été assise la sonde : « introuvable » = détruite
async function isDestroyedFor(sock: any, gameId: string): Promise<boolean> {
  return /introuvable/.test(String(await refusal(sock.request('µgame:resync', { game: gameId }))))
}

describe('MJS-Server — hooks.onJoin qui rejette : le joueur est refusé après coup (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // l'hôte crée la partie privée ; `intrus` (refusé par le crochet), `friend` (légitime) et `third` (jamais assis) attendent
  async function room(hooks: Record<string, any>, extra: Record<string, any> = {}) {
    const started = await startApp(hooks, extra)
    app           = started.app
    const host    = makeClient(started.transport, 'hote')
    const intrus  = makeClient(started.transport, 'intrus')
    const friend  = makeClient(started.transport, 'ami')
    const third   = makeClient(started.transport, 'tiers')
    await tick()
    const created = await host.request('µgame:play', { type: 'salle', code: true })
    await tick(30)
    return { host, intrus, friend, third, code: created.code as string, gameId: created.game as string, journal: started.journal }
  }

  it('le rejet est journalisé (error, nom du crochet et erreur) et n\'atteint jamais le processus', async () => {
    await sansChute(async () => {
      const { intrus, code, journal } = await room({ onJoin: refuseIntrusPlusTard })
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => logged(journal, 'hooks.onJoin', 'boum-admission'), 'le rejet de onJoin est journalisé')
      await tick(30)   // laisse passer une éventuelle remontée tardive au processus
    })
  })

  it('la requête du refusé a déjà reçu sa réponse de siège : le rejet vient après elle', async () => {
    await sansChute(async () => {
      const { intrus, code, journal } = await room({ onJoin: refuseIntrusPlusTard })
      const joined = await intrus.request('µgame:play', { type: 'salle', code: code })
      assert.equal(joined.seat, 1)
      assert.equal(joined.view.vous, 'intrus')
      await until(() => logged(journal, 'hooks.onJoin', 'boum-admission'), 'le rejet de onJoin est journalisé')
    })
  })

  it('le siège du refusé est libéré : un invité légitime rejoint ensuite la partie, au même siège', async () => {
    await sansChute(async () => {
      const { intrus, friend, code, journal } = await room({ onJoin: refuseIntrusPlusTard })
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => logged(journal, 'hooks.onJoin', 'boum-admission'), 'le rejet de onJoin est journalisé')
      await tick(30)
      const joined = await friend.request('µgame:play', { type: 'salle', code: code })
      assert.equal(joined.seat, 1)
      assert.equal(joined.view.vous, 'ami')
    })
  })

  it('les autres joueurs reçoivent µgame:left puis le roster sans le refusé', async () => {
    await sansChute(async () => {
      const { host, intrus, code } = await room({ onJoin: refuseIntrusPlusTard })
      const seen = listen(host)
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => seen.some(e => e.type === 'µgame:left'), 'l\'hôte est prévenu du départ du refusé')
      const left = seen.findIndex(e => e.type === 'µgame:left')
      assert.equal(seen[left].p.seat, 1)
      await until(() => seen.slice(left).some(e => e.type === 'µgame:seat'), 'l\'hôte reçoit le roster mis à jour')
      const roster = seen.slice(left).find(e => e.type === 'µgame:seat')!
      assert.equal(roster.p.seats[0].connected, true)
      assert.equal(roster.p.seats[1], null, 'le siège du refusé est encore annoncé occupé')
    })
  })

  it('le refusé ne reçoit plus aucune trame de la partie après le rejet, et ne peut ni se rattacher par resync ni y jouer', async () => {
    await sansChute(async () => {
      const { host, intrus, code, gameId, journal } = await room({ onJoin: refuseIntrusPlusTard })
      const seen = listen(intrus)
      await intrus.request('µgame:play', { type: 'salle', code: code })
      await until(() => logged(journal, 'hooks.onJoin', 'boum-admission'), 'le rejet de onJoin est journalisé')
      await tick(30)
      const before = seen.length
      await host.request('µgame:move', { game: gameId, move: 'jouer' })
      await tick(50)
      assert.deepEqual(seen.slice(before).map(e => e.type), [], 'le refusé a encore reçu des trames de la partie')
      assert.notEqual(await refusal(intrus.request('µgame:resync', { game: gameId })), null, 'le refusé a récupéré un siège (et la vue) par resync')
      assert.notEqual(await refusal(intrus.request('µgame:move', { game: gameId, move: 'jouer' })), null, 'le refusé a pu jouer un coup')
    })
  })

  it('créateur refusé : la partie vide est détruite après emptyTtl', async () => {
    await sansChute(async () => {
      const started = await startApp({ onJoin: refuseIntrusPlusTard }, { emptyTtl: 60 })
      app           = started.app
      const intrus  = makeClient(started.transport, 'intrus')
      const third   = makeClient(started.transport, 'tiers')
      await tick()
      const created = await intrus.request('µgame:play', { type: 'salle', code: true })
      await untilAsync(() => isDestroyedFor(third, created.game), 'la partie du créateur refusé est détruite après emptyTtl')
    })
  })

  // en file publique, l'appariement attend la Promise de onJoin : le refus défait le groupe avant qu'il ne soit annoncé (le détail du
  // protocole est dans mjs-server-file-publique-entree-refusee.test.ts)
  it('file publique : le refusé (dernier arrivé) a l\'erreur de sa requête, le joueur qui attendait ne reçoit rien, la file ne garde pas de ticket du refusé', async () => {
    await sansChute(async () => {
      const started = await startApp({ onJoin: refuseIntrus })
      app           = started.app
      const host    = makeClient(started.transport, 'hote')
      const intrus  = makeClient(started.transport, 'intrus')
      const third   = makeClient(started.transport, 'tiers')
      await tick()
      const seen = listen(host)
      await host.request('µgame:play', { type: 'salle' })
      assert.match(String(await refusal(intrus.request('µgame:play', { type: 'salle' }))), /entrée dans la partie a été refusée/, 'le refusé de la file n\'a pas l\'erreur de sa requête')
      await tick(60)
      assert.deepEqual(seen.map(e => e.type), [], 'l\'hôte a reçu des trames d\'une partie qui n\'a jamais commencé')
      const joined = await third.request('µgame:play', { type: 'salle' })
      assert.equal(joined.seat, 1, 'la file a gardé l\'hôte en tête, et pas le ticket du refusé')
    })
  })

  it('file publique : le refusé arrivé avant le dernier reçoit sa fin « entrée refusée », l\'hôte reste en file et rien ne l\'annule à l\'échéance de seatTtl', async () => {
    await sansChute(async () => {
      const started = await startApp({ onJoin: refuseIntrus }, { seatTtl: 150 })
      app           = started.app
      const intrus  = makeClient(started.transport, 'intrus')
      const host    = makeClient(started.transport, 'hote')
      await tick()
      const seenIntrus = listen(intrus)
      const seenHost   = listen(host)
      await intrus.request('µgame:play', { type: 'salle' })
      assert.deepEqual(await host.request('µgame:play', { type: 'salle' }), { queue: 1 }, 'l\'hôte, qui complétait le groupe, n\'est pas remis en file')
      await until(() => seenIntrus.some(e => e.type === 'µgame:end'), 'le refusé reçoit sa fin')
      assert.deepEqual(seenIntrus.find(e => e.type === 'µgame:end')!.p.result, { refused: true, reason: 'join-refused' })
      await tick(300)   // largement au-delà de seatTtl : aucune fenêtre de confirmation n'a été ouverte
      assert.deepEqual(seenHost.map(e => e.type), [], 'l\'hôte a reçu des trames d\'une partie qui n\'a jamais commencé')
    })
  })
})

describe('MJS-Server — hooks.onEnd qui rejette : la fin de partie a eu lieu, le rejet est journalisé (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  it('un coup qui termine la partie réussit, le joueur reçoit µgame:end, le rejet est journalisé et la partie est détruite après emptyTtl', async () => {
    await sansChute(async () => {
      const started = await startApp({ onEnd: () => Promise.reject(new Error('boum-fin')) }, { emptyTtl: 60 })
      app           = started.app
      const host    = makeClient(started.transport, 'hote')
      const third   = makeClient(started.transport, 'tiers')
      await tick()
      const seen    = listen(host)
      const created = await host.request('µgame:play', { type: 'salle', code: true })
      assert.equal(await refusal(host.request('µgame:move', { game: created.game, move: 'finir' })), null, 'le coup qui termine la partie est refusé')
      await until(() => seen.some(e => e.type === 'µgame:end'), 'le joueur reçoit µgame:end')
      assert.equal(seen.find(e => e.type === 'µgame:end')!.p.result.gagnant, 'hote')
      await until(() => logged(started.journal, 'hooks.onEnd', 'boum-fin'), 'le rejet de onEnd est journalisé')
      await untilAsync(() => isDestroyedFor(third, created.game), 'la partie terminée est détruite après emptyTtl')
    })
  })
})

describe('MJS-Server — hooks.onCreate qui rejette : la partie est créée quand même, le rejet est journalisé (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  it('partie privée : le créateur est assis, le rejet est journalisé et n\'atteint jamais le processus', async () => {
    await sansChute(async () => {
      const started = await startApp({ onCreate: () => Promise.reject(new Error('boum-creation')) })
      app           = started.app
      const host    = makeClient(started.transport, 'hote')
      await tick()
      const created = await host.request('µgame:play', { type: 'salle', code: true })
      assert.equal(created.seat, 0)
      await until(() => logged(started.journal, 'hooks.onCreate', 'boum-creation'), 'le rejet de onCreate est journalisé')
      await tick(30)
    })
  })

  it('file publique : les deux joueurs sont assis, le rejet est journalisé une fois', async () => {
    await sansChute(async () => {
      const started = await startApp({ onCreate: () => Promise.reject(new Error('boum-creation')) })
      app           = started.app
      const host    = makeClient(started.transport, 'hote')
      const guest   = makeClient(started.transport, 'ami')
      await tick()
      await host.request('µgame:play', { type: 'salle' })
      const joined = await guest.request('µgame:play', { type: 'salle' })
      assert.equal(joined.seat, 1)
      await until(() => logged(started.journal, 'hooks.onCreate', 'boum-creation'), 'le rejet de onCreate est journalisé')
      await tick(30)
      assert.equal(started.journal.filter(e => e.level === 'error' && e.message.includes('hooks.onCreate')).length, 1)
    })
  })

  it('témoin : un onCreate qui lève (synchrone) refuse toujours la création, avec son erreur', async () => {
    const started = await startApp({ onCreate: () => { throw new Error('boum-creation-sync') } })
    app           = started.app
    const host    = makeClient(started.transport, 'hote')
    await tick()
    const message = await refusal(host.request('µgame:play', { type: 'salle', code: true }))
    assert.match(String(message), /boum-creation-sync/)
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

// partie directe à 2 sièges ; `errors` reçoit les messages de niveau error du journal, `received(client, type)` les trames
// envoyées à ce client, `sentTo(client)` leurs types dans l'ordre, `destroyed()` dit si la partie a été retirée du registre
function directGame(hooks: Record<string, any>, extra: Record<string, any> = {}) {
  const app              = fakeAppCapture()
  const errors: string[] = []
  let destroyed          = false
  const def = resolveGameDef('admission', {
    seats: 2,
    emptyTtl: 40,
    state: () => ({ coups: 0 }),
    view: (game: any) => ({ coups: game.state.coups }),
    moves: {},
    hooks,
    ...extra,
  }, (level, msg) => { if (level === 'error') errors.push(String(msg)) })
  const game     = createGame(app, def, () => { destroyed = true }, 'admg')
  const received = (client: any, type: string): any[] => app._sent.filter((e: any) => e.client === client && e.type === type)
  const sentTo   = (client: any): string[] => app._sent.filter((e: any) => e.client === client).map((e: any) => e.type)
  return { game, app, errors, received, sentTo, destroyed: () => destroyed }
}

describe('MJS-Server — hooks.onJoin qui rejette : le siège est refusé après coup (instance de partie)', function () {
  this.timeout(8000)

  it('le siège est libéré, les autres sont prévenus (µgame:left puis roster), le refusé ne reçoit plus rien après le rejet', async () => {
    await sansChute(async () => {
      const { game, errors, received, sentTo } = directGame({ onJoin: refuseIntrus }, { moves: { jouer: (g: any) => { g.state.coups++ } } })
      const host   = fakeClient('hote')
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(host)
        game._createSeat(intrus)
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        await tick()
        assert.equal(game.players[1], null)
        assert.equal(game.players[0]?.id, 'hote')
        assert.equal(received(host, 'µgame:left').length, 1)
        assert.equal(received(host, 'µgame:left')[0].p.seat, 1)
        assert.equal(received(host, 'µgame:seat').pop()?.p.seats[1], null)
        const before      = sentTo(intrus).length
        const stateBefore = received(host, 'µgame:state').length
        game._onMove(host, 'jouer', {})   // une diffusion de plus, où le refusé ne figure plus
        await until(() => received(host, 'µgame:state').length > stateBefore, 'l\'état est rediffusé aux autres')
        await tick(20)
        assert.equal(sentTo(intrus).length, before, 'le refusé a reçu des trames après le rejet : ' + sentTo(intrus).slice(before).join(', '))
        assert.equal(received(intrus, 'µgame:left').length, 0)
      } finally { game._destroy() }
    })
  })

  it('l\'ordre des trames des autres : µgame:left, puis le roster, puis l\'état', async () => {
    await sansChute(async () => {
      const { game, errors, sentTo } = directGame({ onJoin: refuseIntrus })
      const host = fakeClient('hote')
      try {
        game._createSeat(host)
        await tick()
        game._createSeat(fakeClient('intrus'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        await tick(20)
        const sequence = sentTo(host)
        const left     = sequence.lastIndexOf('µgame:left')
        assert.ok(left >= 0, 'aucun µgame:left : ' + sequence.join(', '))
        assert.equal(sequence[left + 1], 'µgame:seat')
      } finally { game._destroy() }
    })
  })

  it('rejet après le départ du joueur : journalisé, aucun départ en double', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, errors, received } = directGame({ onJoin: (g: any, player: any) => player.id === 'intrus' ? attente.promise : undefined })
      const host   = fakeClient('hote')
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(host)
        game._createSeat(intrus)
        game._leave(intrus)
        assert.equal(received(host, 'µgame:left').length, 1)
        attente.reject(new Error('boum-tardif'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        assert.ok(errors.some(m => m.includes('hooks.onJoin') && m.includes('boum-tardif')), JSON.stringify(errors))
        await tick(20)
        assert.equal(received(host, 'µgame:left').length, 1, 'le départ a été annoncé deux fois')
      } finally { game._destroy() }
    })
  })

  it('rejet après la destruction de la partie : journalisé, rien n\'est envoyé', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, app, errors } = directGame({ onJoin: (g: any, player: any) => player.id === 'intrus' ? attente.promise : undefined })
      game._createSeat(fakeClient('hote'))
      game._createSeat(fakeClient('intrus'))
      await tick()
      game._destroy()
      const before = app._sent.length
      attente.reject(new Error('boum-tardif'))
      await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
      await tick(20)
      assert.equal(app._sent.length, before, 'des trames sont parties d\'une partie détruite')
    })
  })

  it('un siège réoccupé entre-temps par un autre joueur n\'est pas touché par le rejet de l\'ancien occupant', async () => {
    await sansChute(async () => {
      const attente = deferred()
      const { game, errors } = directGame({ onJoin: (g: any, player: any) => player.id === 'ancien' ? attente.promise : undefined })
      const host = fakeClient('hote')
      const old  = fakeClient('ancien')
      const next = fakeClient('nouveau')
      try {
        game._createSeat(host)
        game._createSeat(old)
        game._leave(old)
        game._createSeat(next)
        assert.equal(game.players[1]?.id, 'nouveau')
        attente.reject(new Error('boum-tardif'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        await tick(20)
        assert.equal(game.players[1]?.id, 'nouveau', 'le rejet de l\'ancien occupant a libéré le siège du nouveau')
      } finally { game._destroy() }
    })
  })

  it('la sauvegarde est reprogrammée après le refus : le dernier instantané ne garde plus le siège du refusé', async () => {
    await sansChute(async () => {
      const { game, errors } = directGame({ onJoin: refuseIntrus })
      const saves: any[] = []
      game._onMutate = (g: any) => { saves.push(g.serialize()) }
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(fakeClient('intrus'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        await tick(20)
        assert.ok(saves.length > 0, 'aucune sauvegarde')
        const last = saves[saves.length - 1]
        assert.equal(last.seats[0]?.id, 'hote')
        assert.equal(last.seats[1], null, 'le siège du refusé est encore dans la dernière sauvegarde')
      } finally { game._destroy() }
    })
  })

  it('deltas : le refusé qui revient reçoit d\'abord une vue complète, jamais un delta contre sa vue d\'avant', async () => {
    await sansChute(async () => {
      let refus = 0
      const { game, errors, received } = directGame({
        onJoin: (g: any, player: any) => player.id === 'intrus' && refus++ === 0 ? Promise.reject(new Error('boum-admission')) : undefined,
      }, { deltas: true })
      const host   = fakeClient('hote')
      const intrus = fakeClient('intrus')
      try {
        game._createSeat(host)
        game._createSeat(intrus)
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        await tick(20)
        const avant = received(intrus, 'µgame:state').length
        game._createSeat(intrus)   // le même joueur revient, cette fois accepté
        await tick(20)
        const apres = received(intrus, 'µgame:state').slice(avant)
        assert.ok(apres.length > 0, 'le joueur qui revient n\'a reçu aucune trame d\'état')
        assert.ok('view' in apres[0].p && !('delta' in apres[0].p), 'sa première trame est un delta : ' + JSON.stringify(apres[0].p))
      } finally { game._destroy() }
    })
  })

  it('une valeur rejetée quelconque (undefined compris) refuse aussi le joueur, et le rejet est journalisé', async () => {
    await sansChute(async () => {
      const { game, errors } = directGame({ onJoin: (g: any, player: any) => player.id === 'intrus' ? Promise.reject(undefined) : undefined })
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(fakeClient('intrus'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        assert.ok(errors.some(m => m.includes('hooks.onJoin')), JSON.stringify(errors))
        assert.equal(game.players[1], null)
      } finally { game._destroy() }
    })
  })

  it('créateur refusé : la partie vide n\'est pas laissée orpheline, elle est fermée tout de suite (jamais complète)', async () => {
    await sansChute(async () => {
      const { game, errors, destroyed } = directGame({ onJoin: () => Promise.reject(new Error('boum-admission')) })
      game._createSeat(fakeClient('intrus'))
      await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
      assert.deepEqual(game.players, [null, null])
      assert.ok(destroyed(), 'la partie du créateur refusé n\'est pas fermée tout de suite')
    })
  })

  it('un refus sur une partie qui a un siège connecté ne laisse aucune minuterie de partie vide', async () => {
    await sansChute(async () => {
      const { game, errors } = directGame({ onJoin: refuseIntrus }, { emptyTtl: 5000 })
      try {
        game._createSeat(fakeClient('hote'))
        game._createSeat(fakeClient('intrus'))
        await until(() => errors.length > 0, 'le rejet de onJoin est journalisé')
        assert.equal(game._timers.has('µempty'), false)
        assert.equal(game.players.filter(Boolean).length, 1)
      } finally { game._destroy() }
    })
  })

  it('témoin : une Promise résolue ne refuse personne et ne journalise rien', async () => {
    await sansChute(async () => {
      const { game, errors, received } = directGame({ onJoin: () => Promise.resolve() })
      try {
        game._createSeat(fakeClient('hote'))
        const guest = fakeClient('ami')
        game._createSeat(guest)
        await tick(30)
        assert.deepEqual(errors, [])
        assert.equal(game.players[1]?.id, 'ami')
        assert.equal(received(guest, 'µgame:left').length, 0)
      } finally { game._destroy() }
    })
  })

  it('témoin : onJoin reste appelé en méthode de hooks (this = hooks)', async () => {
    let seen = ''
    const hooks: Record<string, any> = { onJoin(this: any) { seen = this === hooks ? 'hooks' : 'autre'; return Promise.resolve() } }
    const { game } = directGame(hooks)
    try {
      game._createSeat(fakeClient('hote'))
      assert.equal(seen, 'hooks')
    } finally { game._destroy() }
  })
})

describe('MJS-Server — hooks.onEnd qui rejette (instance de partie)', function () {
  this.timeout(8000)

  it('end() n\'échoue pas, la grâce de partie vide est armée tout de suite, le rejet est journalisé', async () => {
    await sansChute(async () => {
      const { game, errors, destroyed } = directGame({ onEnd: () => Promise.reject(new Error('boum-fin')) })
      game._createSeat(fakeClient('hote'))
      game.end({ gagnant: 'hote' })
      assert.equal(game._ended, true)
      assert.ok(game._timers.has('µempty'), 'aucune minuterie de partie vide n\'est armée')
      await until(() => errors.length > 0, 'le rejet de onEnd est journalisé')
      assert.ok(errors.some(m => m.includes('hooks.onEnd') && m.includes('boum-fin')), JSON.stringify(errors))
      await until(destroyed, 'la partie terminée est détruite après emptyTtl')
    })
  })

  it('un 2e end() est un no-op total : onEnd n\'est pas rappelé, un seul rejet journalisé', async () => {
    await sansChute(async () => {
      let appels = 0
      const { game, errors } = directGame({ onEnd: () => { appels++; return Promise.reject(new Error('boum-fin')) } })
      try {
        game._createSeat(fakeClient('hote'))
        game.end('a')
        game.end('b')
        await until(() => errors.length > 0, 'le rejet de onEnd est journalisé')
        await tick(20)
        assert.equal(appels, 1)
        assert.equal(errors.length, 1)
      } finally { game._destroy() }
    })
  })

  it('témoin : une Promise résolue ne journalise rien', async () => {
    await sansChute(async () => {
      const { game, errors } = directGame({ onEnd: () => Promise.resolve() })
      try {
        game._createSeat(fakeClient('hote'))
        game.end('a')
        await tick(30)
        assert.deepEqual(errors, [])
      } finally { game._destroy() }
    })
  })

  it('témoin : un onEnd qui lève (synchrone) remonte toujours à l\'appelant de end(), la grâce est armée', () => {
    const { game } = directGame({ onEnd: () => { throw new Error('boum-fin-sync') } })
    try {
      game._createSeat(fakeClient('hote'))
      assert.throws(() => game.end('a'), /boum-fin-sync/)
      assert.ok(game._timers.has('µempty'))
    } finally { game._destroy() }
  })
})

describe('MJS-Server — hooks.onCreate qui rejette (instance de partie)', function () {
  this.timeout(8000)

  it('createGame rend la partie, jouable, et le rejet est journalisé sans atteindre le processus', async () => {
    await sansChute(async () => {
      const errors: string[] = []
      const def = resolveGameDef('creation', {
        seats: 2, state: () => ({ coups: 0 }), view: (game: any) => ({ coups: game.state.coups }), moves: {},
        hooks: { onCreate: () => Promise.reject(new Error('boum-creation')) },
      }, (level, msg) => { if (level === 'error') errors.push(String(msg)) })
      const game = createGame(fakeAppCapture(), def, () => {}, 'creag')
      try {
        game._createSeat(fakeClient('hote'))
        assert.equal(game.players[0]?.id, 'hote')
        await until(() => errors.length > 0, 'le rejet de onCreate est journalisé')
        assert.ok(errors.some(m => m.includes('hooks.onCreate') && m.includes('boum-creation')), JSON.stringify(errors))
        await tick(20)
      } finally { game._destroy() }
    })
  })

  it('témoin : un onCreate qui lève (synchrone) fait échouer createGame avec son erreur', () => {
    const def = resolveGameDef('creation', {
      seats: 2, state: () => ({ coups: 0 }), view: (game: any) => ({ coups: game.state.coups }), moves: {},
      hooks: { onCreate: () => { throw new Error('boum-creation-sync') } },
    })
    assert.throws(() => createGame(fakeAppCapture(), def, () => {}, 'creag'), /boum-creation-sync/)
  })
})
