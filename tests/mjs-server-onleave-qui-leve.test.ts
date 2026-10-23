// un throw (ou un rejet de Promise) dans hooks.onLeave, ou dans turns.order au passage de tour du départ, ne coupe pas le départ :
// le siège est déjà vidé, les autres sièges et les spectateurs sont prévenus (µgame:left), le roster suit, l'état est diffusé, et une
// partie sans plus aucun siège connecté est détruite après emptyTtl. L'erreur remonte à celui qui part (réponse d'erreur de sa requête
// µgame:leave) ; ce que le code a fait avant de lever n'est pas défait. Les autres départs (socket fermé, annulation à l'échéance de
// seatTtl) ne laissent pas non plus une partie orpheline quand le code de l'auteur lève. Protocole vérifié sur un vrai serveur
// MJS-Server + client µ.socket (MemoryTransport) ; ordre des trames, minuteries et journal sur une instance de partie directe
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

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

async function untilAsync(condition: () => Promise<boolean>, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(10)
  }
}

const boomLeave = (): void => { throw new Error('boum-sortie') }

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

// salle à 2 places, en partie privée ou par la file ; `hooks` et `extra` sont ceux de l'auteur
async function startApp(hooks: Record<string, any>, extra: Record<string, any>): Promise<{ transport: MemoryTransport; app: MjsServerApp; journal: LogEntry[] }> {
  const transport = new MemoryTransport()
  const journal: LogEntry[] = []
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (level: any, message: any, meta: any) => { journal.push({ level, message: String(message), meta }) } })
  await app.listen()
  app.game('salle', {
    seats: 2,
    code: true,
    seatTtl: 5000,
    emptyTtl: 5000,
    state: () => ({ leavers: [] as string[] }),
    moves: {},
    view: (game: any, player: any) => ({ leavers: game.state.leavers.slice(), you: player ? player.id : null }),
    hooks,
    ...extra,
  })
  return { transport, app, journal }
}

// la partie vit-elle encore ? une connexion qui n'a jamais été assise la sonde : « introuvable » = détruite
async function isDestroyedFor(sock: any, gameId: string): Promise<boolean> {
  return /introuvable/.test(String(await refusal(sock.request('µgame:resync', { game: gameId }))))
}

describe('MJS-Server — hooks.onLeave qui lève : le départ va à son terme (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // hôte + ami assis dans la même partie privée, `third` jamais assis ; les trames de l'arrivée sont déjà passées
  async function room(hooks: Record<string, any> = {}, extra: Record<string, any> = {}) {
    const started = await startApp(hooks, extra)
    app           = started.app
    const host    = makeClient(started.transport, 'hote')
    const friend  = makeClient(started.transport, 'ami')
    const third   = makeClient(started.transport, 'tiers')
    await tick()
    const created = await host.request('µgame:play', { type: 'salle', code: true })
    await friend.request('µgame:play', { type: 'salle', code: created.code })
    await tick(30)
    return { host, friend, third, gameId: created.game as string, code: created.code as string, journal: started.journal }
  }

  it('celui qui part reçoit l\'erreur de onLeave comme réponse de sa requête, et aucune trame de la partie', async () => {
    const { friend, gameId } = await room({ onLeave: boomLeave })
    const seen    = listen(friend)
    const message = await refusal(friend.request('µgame:leave', { game: gameId }))
    assert.match(String(message), /boum-sortie/)
    await tick(30)
    assert.deepEqual(seen.map(e => e.type), [], 'celui qui part a reçu des trames de la partie')
  })

  it('l\'erreur remonte par le chemin d\'une requête qui lève : journal du serveur au niveau error', async () => {
    const { friend, gameId, journal } = await room({ onLeave: boomLeave })
    await refusal(friend.request('µgame:leave', { game: gameId }))
    const entry = journal.find(e => e.level === 'error' && e.meta?.err?.message === 'boum-sortie')
    assert.ok(entry, 'aucune entrée error du journal ne porte l\'erreur de onLeave : ' + JSON.stringify(journal.map(e => e.level + ' ' + e.message)))
    assert.match(entry.message, /µgame:leave/)
  })

  it('les autres joueurs reçoivent µgame:left et le roster avec le siège libéré', async () => {
    const { host, friend, gameId } = await room({ onLeave: boomLeave })
    const seen = listen(host)
    await refusal(friend.request('µgame:leave', { game: gameId }))
    await until(() => seen.some(e => e.type === 'µgame:left'), 'l\'hôte reçoit µgame:left')
    assert.equal(seen.find(e => e.type === 'µgame:left')!.p.seat, 1)
    await until(() => seen.some(e => e.type === 'µgame:seat'), 'l\'hôte reçoit le roster')
    const roster = seen.filter(e => e.type === 'µgame:seat').pop()!
    assert.equal(roster.p.seats[0].connected, true)
    assert.equal(roster.p.seats[1], null, 'le siège de celui qui part est encore annoncé occupé')
  })

  it('l\'état modifié par onLeave avant de lever est diffusé aux autres et n\'est pas défait', async () => {
    const { host, friend, gameId } = await room({ onLeave: (game: any, player: any) => { game.state.leavers.push(player.id); throw new Error('boum-sortie') } })
    const seen = listen(host)
    await refusal(friend.request('µgame:leave', { game: gameId }))
    await until(() => seen.some(e => e.type === 'µgame:state' && e.p.view.leavers.includes('ami')), 'l\'hôte reçoit l\'état modifié par onLeave')
    const resync = await host.request('µgame:resync', { game: gameId })
    assert.deepEqual(resync.view.leavers, ['ami'])
  })

  it('le siège libéré est réutilisable : un invité légitime rejoint ensuite la partie', async () => {
    const { friend, third, gameId, code } = await room({ onLeave: boomLeave })
    await refusal(friend.request('µgame:leave', { game: gameId }))
    const joined = await third.request('µgame:play', { type: 'salle', code: code })
    assert.equal(joined.seat, 1)
  })

  it('une Promise rejetée par onLeave : le départ aboutit, le rejet est journalisé, le processus ne tombe pas', async () => {
    await sansChute(async () => {
      const { host, friend, gameId, journal } = await room({ onLeave: () => Promise.reject(new Error('boum-promesse')) })
      const seen    = listen(host)
      const message = await refusal(friend.request('µgame:leave', { game: gameId }))
      assert.equal(message, null, 'un rejet que personne n\'attend ne remonte pas à celui qui part : sa requête a déjà réussi')
      await until(() => seen.some(e => e.type === 'µgame:left'), 'l\'hôte reçoit µgame:left')
      await until(() => journal.some(e => e.level === 'error' && e.message.includes('hooks.onLeave') && e.message.includes('boum-promesse')), 'le rejet de onLeave est journalisé')
      await tick(30)   // laisse passer une éventuelle remontée tardive au processus
    })
  })

  it('tous les joueurs partent avec un onLeave qui lève : la partie vide est détruite après emptyTtl', async () => {
    const { host, friend, third, gameId } = await room({ onLeave: boomLeave }, { emptyTtl: 60 })
    await refusal(friend.request('µgame:leave', { game: gameId }))
    await refusal(host.request('µgame:leave', { game: gameId }))
    await untilAsync(() => isDestroyedFor(third, gameId), 'la partie vide est détruite après emptyTtl')
  })

  it('témoin : un seul joueur sur deux part, la partie qui garde un siège connecté n\'est pas détruite', async () => {
    const { friend, third, gameId } = await room({ onLeave: boomLeave }, { emptyTtl: 60 })
    await refusal(friend.request('µgame:leave', { game: gameId }))
    await tick(250)
    assert.equal(await isDestroyedFor(third, gameId), false, 'la partie, qui a encore un siège connecté, a été détruite')
  })
})

describe('MJS-Server — les autres départs : aucune partie orpheline quand le code de l\'auteur lève (protocole)', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  it('sockets des deux joueurs fermés, view qui lève à chaque diffusion : la partie est détruite après emptyTtl', async () => {
    let broken = false
    // onLeave ne tourne pas à la fermeture d'un socket (le siège reste occupé) : il lève ici pour le prouver sans effet
    const started = await startApp({ onLeave: boomLeave }, {
      emptyTtl: 60,
      view: (game: any, player: any) => { if (broken) throw new Error('boum-vue'); return { leavers: game.state.leavers.slice(), you: player ? player.id : null } },
    })
    app           = started.app
    const host    = makeClient(started.transport, 'hote')
    const friend  = makeClient(started.transport, 'ami')
    const third   = makeClient(started.transport, 'tiers')
    await tick()
    const created = await host.request('µgame:play', { type: 'salle', code: true })
    await friend.request('µgame:play', { type: 'salle', code: created.code })
    await tick(30)
    broken = true
    host.close()
    // l'ami reste connecté le temps de la diffusion qui suit la déconnexion de l'hôte : sa vue lève, la trame est ignorée
    await until(() => started.journal.some(e => e.level === 'error' && e.message.includes('boum-vue')), 'la vue qui lève est journalisée')
    friend.close()
    await untilAsync(() => isDestroyedFor(third, created.game), 'la partie dont les deux sockets sont fermés est détruite après emptyTtl')
  })

  it('annulation à l\'échéance de seatTtl (file publique), onLeave et onEnd qui lèvent : la partie est détruite', async () => {
    const started = await startApp({ onLeave: boomLeave, onEnd: boomLeave }, { seatTtl: 60 })
    app           = started.app
    const a       = makeClient(started.transport, 'a')
    const b       = makeClient(started.transport, 'b')
    const third   = makeClient(started.transport, 'tiers')
    await tick()
    const seen = listen(a)
    await a.request('µgame:play', { type: 'salle' })
    const seat = await b.request('µgame:play', { type: 'salle' })
    // a ne se manifeste pas : sa place n'est pas confirmée, la partie entière est annulée à l'échéance
    await until(() => seen.some(e => e.type === 'µgame:end'), 'a reçoit l\'annulation')
    assert.equal(seen.find(e => e.type === 'µgame:end')!.p.result.reason, 'seat-expired')
    await untilAsync(() => isDestroyedFor(third, seat.game), 'la partie annulée est détruite')
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

// partie à 2 sièges (p1 puis p2 assis, trames de l'arrivée passées) ; `errors` reçoit les messages de niveau error du journal,
// `received(client, type)` les trames envoyées à ce client depuis, `sequence(client)` leurs types dans l'ordre, `destroyed()`
// dit si la partie a été retirée du registre
async function makeGame(hooks: Record<string, any>, extra: Record<string, any> = {}) {
  const app              = fakeAppCapture()
  const errors: string[] = []
  let destroyed          = false
  const def = resolveGameDef('depart', {
    seats: 2,
    emptyTtl: 40,
    state: () => ({ leavers: [] as string[] }),
    view: (game: any) => ({ leavers: game.state.leavers.slice() }),
    moves: {},
    hooks,
    ...extra,
  }, (level, msg) => { if (level === 'error') errors.push(String(msg)) })
  const game = createGame(app, def, () => { destroyed = true }, 'departg')
  const c1   = fakeClient('p1')
  const c2   = fakeClient('p2')
  game._createSeat(c1)
  game._createSeat(c2)
  await tick()
  app._sent.length = 0
  const received = (client: any, type: string): any[] => app._sent.filter((e: any) => e.client === client && e.type === type)
  const sequence = (client: any): string[] => app._sent.filter((e: any) => e.client === client).map((e: any) => e.type)
  return { game, c1, c2, errors, received, sequence, destroyed: () => destroyed }
}

describe('MJS-Server — hooks.onLeave qui lève : le départ va à son terme (instance de partie)', function () {
  this.timeout(8000)

  it('l\'erreur de onLeave remonte à celui qui part, telle quelle', async () => {
    const { game, c2 } = await makeGame({ onLeave: boomLeave })
    try {
      assert.throws(() => game._leave(c2), /boum-sortie/)
    } finally { game._destroy() }
  })

  it('une valeur levée quelconque (undefined compris) remonte aussi, et le départ va à son terme', async () => {
    const { game, c1, c2, received } = await makeGame({ onLeave: () => { throw undefined } })
    try {
      assert.throws(() => game._leave(c2))
      assert.equal(received(c1, 'µgame:left').length, 1)
    } finally { game._destroy() }
  })

  it('les autres sièges reçoivent µgame:left puis le roster, comme sans erreur et dans le même ordre', async () => {
    const sound = await makeGame({ onLeave: () => {} })
    sound.game._leave(sound.c2)
    await tick()
    const broken = await makeGame({ onLeave: boomLeave })
    assert.throws(() => broken.game._leave(broken.c2), /boum-sortie/)
    await tick()
    try {
      assert.deepEqual(sound.sequence(sound.c1), ['µgame:left', 'µgame:seat', 'µgame:state'])
      assert.deepEqual(broken.sequence(broken.c1), sound.sequence(sound.c1), 'les trames du départ avec erreur diffèrent de celles du départ sans erreur')
      assert.equal(broken.received(broken.c1, 'µgame:left')[0].p.seat, 1)
      assert.equal(broken.received(broken.c1, 'µgame:seat')[0].p.seats[1], null)
    } finally { sound.game._destroy(); broken.game._destroy() }
  })

  it('celui qui part ne reçoit rien de la partie', async () => {
    const { game, c2, sequence } = await makeGame({ onLeave: boomLeave })
    try {
      assert.throws(() => game._leave(c2), /boum-sortie/)
      await tick()
      assert.deepEqual(sequence(c2), [])
    } finally { game._destroy() }
  })

  it('les spectateurs reçoivent µgame:left', async () => {
    const { game, c2, received } = await makeGame({ onLeave: boomLeave })
    const spectator = fakeClient('spec')
    game._addSpectator(spectator)
    try {
      assert.throws(() => game._leave(c2), /boum-sortie/)
      assert.equal(received(spectator, 'µgame:left').length, 1, 'le spectateur n\'est pas prévenu du départ')
    } finally { game._destroy() }
  })

  it('l\'état modifié et l\'événement envoyé par onLeave avant de lever partent, et ne sont pas défaits', async () => {
    const { game, c1, c2, received } = await makeGame({ onLeave: (game: any, player: any) => { game.state.leavers.push(player.id); game.send('adieu', { de: player.id }); throw new Error('boum-sortie') } })
    try {
      assert.throws(() => game._leave(c2), /boum-sortie/)
      assert.equal(received(c1, 'µgame:event').length, 1, 'l\'événement envoyé par onLeave a été perdu')
      await until(() => received(c1, 'µgame:state').length > 0, 'l\'état modifié par onLeave est diffusé')
      assert.deepEqual(received(c1, 'µgame:state')[0].p.view.leavers, ['p2'])
      assert.deepEqual(game.state.leavers, ['p2'])
    } finally { game._destroy() }
  })

  it('le dernier joueur part : la partie vide est fermée tout de suite (plus aucun siège occupé)', async () => {
    const { game, c1, c2, destroyed } = await makeGame({ onLeave: boomLeave })
    assert.throws(() => game._leave(c2), /boum-sortie/)
    assert.equal(game._timers.has('µempty'), false, 'p1 est encore connecté : aucune grâce de partie vide')
    assert.equal(destroyed(), false, 'p1 est encore connecté : la partie reste')
    assert.throws(() => game._leave(c1), /boum-sortie/)
    assert.equal(destroyed(), true, 'la partie vide n\'est pas fermée tout de suite')
  })

  it('témoin : une partie qui garde un siège connecté n\'est pas détruite', async () => {
    const { game, c2, destroyed } = await makeGame({ onLeave: boomLeave }, { emptyTtl: 20 })
    try {
      assert.throws(() => game._leave(c2), /boum-sortie/)
      assert.equal(game._timers.has('µempty'), false)
      await tick(80)
      assert.equal(destroyed(), false)
    } finally { game._destroy() }
  })

  it('une Promise rejetée par onLeave est journalisée, jamais remontée au processus ; le départ va à son terme', async () => {
    await sansChute(async () => {
      const { game, c1, c2, errors, received } = await makeGame({ onLeave: () => Promise.reject(new Error('boum-promesse')) })
      try {
        game._leave(c2)   // le rejet n'a personne à qui remonter : l'appel réussit
        assert.equal(received(c1, 'µgame:left').length, 1)
        await until(() => errors.length > 0, 'le rejet de onLeave est journalisé')
        assert.ok(errors.some(m => m.includes('hooks.onLeave') && m.includes('boum-promesse')), `le journal doit nommer le crochet et l'erreur, reçu : ${JSON.stringify(errors)}`)
        await tick(20)
      } finally { game._destroy() }
    })
  })

  it('le dernier joueur part avec un onLeave qui rejette : la partie vide est fermée tout de suite (plus aucun siège occupé)', async () => {
    await sansChute(async () => {
      const { game, c1, c2, destroyed } = await makeGame({ onLeave: () => Promise.reject(new Error('boum-promesse')) })
      game._leave(c2)
      game._leave(c1)
      assert.equal(destroyed(), true, 'la partie vide n\'est pas fermée tout de suite')
      await tick(20)   // le rejet de onLeave, journalisé après coup, ne fait pas tomber le processus
    })
  })

  it('témoin : un onLeave qui ne lève pas ne journalise rien et reste appelé en méthode de hooks (this = hooks)', async () => {
    let seen = ''
    const hooks: Record<string, any> = { onLeave(this: any) { seen = this === hooks ? 'hooks' : 'autre' } }
    const { game, c2, errors } = await makeGame(hooks)
    try {
      game._leave(c2)
      assert.equal(seen, 'hooks')
      assert.deepEqual(errors, [])
    } finally { game._destroy() }
  })

  it('témoin : onLeave n\'est appelé qu\'au départ volontaire, jamais à la déconnexion (le siège reste occupé)', async () => {
    let calls = 0
    const { game, c2 } = await makeGame({ onLeave: () => { calls++ } })
    try {
      game._onDisconnect(c2)
      assert.equal(calls, 0)
      assert.equal(game.players[1]?.id, 'p2')
    } finally { game._destroy() }
  })
})

describe('MJS-Server — turns.order qui lève au départ du joueur dont c\'est le tour (instance de partie)', function () {
  this.timeout(8000)

  // l'ordre désigne le premier siège occupé ; il lève à la demande une fois `state.broken` posé
  function order(state: { broken: boolean }) {
    return (game: any) => { if (state.broken) throw new Error('boum-ordre'); return game.players.find(Boolean) }
  }

  it('le départ va à son terme et l\'erreur remonte à celui qui part', async () => {
    const state = { broken: false }
    const { game, c1, c2, received, sequence } = await makeGame({}, { turns: { order: order(state) } })
    try {
      game.next()   // le tour est à p1 : le seul siège dont le départ déclenche le passage de tour
      state.broken = true
      assert.throws(() => game._leave(c1), /boum-ordre/)
      assert.equal(game.players[0], null)
      assert.equal(received(c2, 'µgame:left').length, 1, 'l\'autre joueur n\'est pas prévenu du départ')
      assert.equal(received(c2, 'µgame:seat').pop()?.p.seats[0], null, 'le roster n\'a pas suivi')
      assert.deepEqual(sequence(c1), [], 'celui qui part a reçu des trames de la partie')
    } finally { game._destroy() }
  })

  it('le dernier joueur part ainsi : la partie vide est fermée tout de suite (plus aucun siège occupé)', async () => {
    const state = { broken: false }
    const { game, c1, c2, destroyed } = await makeGame({}, { turns: { order: order(state) } })
    game._leave(c2)   // ce n'est pas son tour : aucun passage de tour, aucune erreur
    game.next()
    state.broken = true
    assert.throws(() => game._leave(c1), /boum-ordre/)
    assert.equal(destroyed(), true, 'la partie vide n\'est pas fermée tout de suite')
  })

  it('onLeave et turns.order lèvent tous les deux : celui qui part reçoit la 1re erreur, la 2e est journalisée', async () => {
    const state = { broken: false }
    const { game, c1, c2, errors, received } = await makeGame({ onLeave: boomLeave }, { turns: { order: order(state) } })
    try {
      game.next()
      state.broken = true
      assert.throws(() => game._leave(c1), /boum-sortie/)
      assert.ok(errors.some(m => m.includes('turns.order') && m.includes('boum-ordre')), `la 2e erreur doit être journalisée, reçu : ${JSON.stringify(errors)}`)
      assert.equal(received(c2, 'µgame:left').length, 1)
    } finally { game._destroy() }
  })

  it('onLeave lève et turns.order est sain : le tour passe quand même au siège suivant', async () => {
    const { game, c1 } = await makeGame({ onLeave: boomLeave }, { turns: { order: 'roundrobin' } })
    try {
      game.next()
      assert.equal(game.turn, 'p1')
      assert.throws(() => game._leave(c1), /boum-sortie/)
      assert.equal(game.turn, 'p2', 'le tour est resté au siège qui vient de se libérer')
    } finally { game._destroy() }
  })
})
