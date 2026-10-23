// Bornes du journal lockstep (MJS-Server) : un ordre trop gros est refusé avant d'entrer dans le journal,
// et un journal qui atteindrait sa taille maximale termine la partie avec une raison claire — jamais de
// troncature, chaque joueur garde le même état (celui du dernier tick reçu). Le journal est renvoyé en
// entier à chaque resync et à chaque sauvegarde : sans borne, un seul joueur le faisait grossir sans fin.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { createLockstep } from '../src/mjs-server/lockstep.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const octets = (x: unknown) => Buffer.byteLength(JSON.stringify(x), 'utf8')
const MIO_16 = 16 * 1024 * 1024

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
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
  const s = makeMu().socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  s.connect(); await tick()
  return s
}

// 2 places (code privé), tick rapide (40 Hz) — `moves: {}` requis par le type, jamais appelé en lockstep
function declarerJeuLockstep(app: MjsServerApp, overrides: Record<string, any> = {}): void {
  app.game('bornes', { mode: 'lockstep', seats: 2, code: true, tick: 40, seatTtl: 300, emptyTtl: 200, moves: {}, ...overrides })
}

async function deuxJoueurs(transport: MemoryTransport): Promise<{ sx: any; sy: any; rep: any }> {
  const sx = await connecter(transport, 'x')
  const rep = await sx.request('µgame:play', { type: 'bornes', code: true })
  const sy = await connecter(transport, 'y')
  await sy.request('µgame:play', { type: 'bornes', code: rep.code })
  return { sx, sy, rep }
}

// partie en direct (sans réseau), même banc que les autres tests de Game : l'appli enregistre ce qu'elle envoie
function recordingApp(): any { const sent: any[] = []; return { send(c: any, type: string, p: any) { sent.push({ c, type, p }) }, sent } }
function fakeClient(id: string): any { return { id: 'fake-'+ id, identity: { id }, latency: null, meta: {}, send() {}, close() {} } }

// le journal reçu commence au tick 1 et ne saute aucun tick (jamais tronqué)
function assertJournalComplet(journal: any[]): void {
  journal.forEach((g, i) => assert.equal(g.tick, i + 1, 'tick '+ g.tick +' à la position '+ i))
}

describe('MJS-Server — bornes du journal lockstep', () => {
  it('un ordre de 60 Ko est refusé avec un message clair : il n\'entre pas dans le journal renvoyé au resync', async () => {
    const { transport, app } = await startApp()
    declarerJeuLockstep(app)
    const { sx, rep } = await deuxJoueurs(transport)
    const gros = 'x'.repeat(60000)
    for (let i = 0; i < 5; i++) {
      await assert.rejects(sx.request('µgame:move', { game: rep.game, move: 'gros', p: { d: gros } }), /ordre trop volumineux/)
    }
    const ack = await sx.request('µgame:move', { game: rep.game, move: 'petit', p: { dx: 1 } })
    assert.equal(ack.ok, true, 'un ordre de taille normale passe toujours')
    await tick(90)
    const resync = await sx.request('µgame:resync', { game: rep.game })
    assert.deepEqual(resync.journal.flatMap((g: any) => g.orders.map((o: any) => o.move)), ['petit'])
    assert.ok(octets(resync.journal) < 10000, 'journal de '+ octets(resync.journal) +' octets')
    await app.stop()
  })

  it('un ordre refusé pour sa taille ne consomme pas son numéro de séquence (antiReplay) : sa reprise allégée passe', () => {
    const def = resolveGameDef('rejeu', { mode: 'lockstep', seats: 1, tick: 1, moves: {}, antiReplay: true })
    const game: any = createGame(recordingApp(), def, () => {}, 'rejeu1')
    const A = fakeClient('A')
    game._createSeat(A)
    assert.throws(() => game._onMove(A, 'o', { _s: 1, d: 'x'.repeat(5000) }), /ordre trop volumineux/)
    assert.doesNotThrow(() => game._onMove(A, 'o', { _s: 1, d: 'court' }))
    game._runTick()
    assert.deepEqual(game._lockstep.journal().flatMap((g: any) => g.orders.map((o: any) => o.p.d)), ['court'])
    game._destroy()
  })

  it('journal plein (lockstepJournal.maxBytes) : la partie se termine, raison journal-full, les deux joueurs reçoivent µgame:end ; le journal reste complet et sous la borne', async () => {
    const { transport, app } = await startApp()
    const finsAppli: any[] = []
    declarerJeuLockstep(app, { endTtl: 5000, lockstepJournal: { maxBytes: 4000 }, hooks: { onEnd: (_g: any, r: any) => finsAppli.push(r) } })
    const { sx, sy, rep } = await deuxJoueurs(transport)
    const finX: any[] = [], finY: any[] = []
    sx.on('µgame:end', (p: any) => finX.push(p))
    sy.on('µgame:end', (p: any) => finY.push(p))
    const charge = 'y'.repeat(1500)
    for (let i = 0; i < 8 && finX.length === 0; i++) {
      try { await sx.request('µgame:move', { game: rep.game, move: 'charge', p: { d: charge } }) } catch {}
      await tick(40)
    }
    await tick(60)
    const attendu = { ended: true, reason: 'journal-full' }
    assert.deepEqual(finX.map(f => f.result), [attendu], 'x reçoit la fin et sa raison')
    assert.deepEqual(finY.map(f => f.result), [attendu], 'y reçoit la fin et sa raison')
    assert.deepEqual(finsAppli, [attendu], 'hooks.onEnd reçoit le même résultat')
    await assert.rejects(sx.request('µgame:move', { game: rep.game, move: 'apres', p: null }), /partie terminée/)
    const resync = await sx.request('µgame:resync', { game: rep.game })
    assert.ok(octets(resync.journal) <= 4000, 'journal de '+ octets(resync.journal) +' octets pour une borne de 4000')
    assert.ok(resync.journal.some((g: any) => g.orders.length > 0), 'les ordres déjà diffusés restent dans le journal')
    assertJournalComplet(resync.journal)
    await app.stop()
  })

  it('borne par défaut : sans lockstepJournal, un flot d\'ordres (quota levé) termine la partie avant que le journal ne dépasse 16 Mo', () => {
    const def = resolveGameDef('defaut', { mode: 'lockstep', seats: 1, tick: 1, moves: {}, limits: { moves: null } })
    const app = recordingApp()
    const game: any = createGame(app, def, () => {}, 'defaut1')
    const A = fakeClient('A')
    game._createSeat(A)
    const charge = 'z'.repeat(1900)
    let ordres = 0
    while (!game._ended && ordres < 20000) {
      game._onMove(A, 'o', { d: charge })
      ordres++
      if (ordres % 500 === 0) game._runTick()
    }
    const journal = game._lockstep.journal()
    const fin = app.sent.filter((s: any) => s.type === 'µgame:end')
    game._destroy()
    assert.equal(game._ended, true, 'partie toujours en cours après '+ ordres +' ordres, journal de '+ octets(journal) +' octets')
    assert.deepEqual(game._endResult, { ended: true, reason: 'journal-full' })
    assert.deepEqual(fin.map((s: any) => s.p.result), [{ ended: true, reason: 'journal-full' }], 'le joueur reçoit la fin')
    assert.ok(octets(journal) <= MIO_16, 'journal de '+ octets(journal) +' octets')
    assertJournalComplet(journal)
  })

  it('createLockstep : taille tenue au plus juste (octets UTF-8 du JSON), anneau maxTicks jamais pris pour un journal plein, restauration recalculée', () => {
    const ls: any = createLockstep('b1', null, { maxBytes: 100000, maxOrderBytes: 500 })
    assert.equal(ls._bytes(), octets(ls.journal()))
    ls.addOrder('x', 'a', { t: 'é€😀' })
    ls.addOrder('y', 'b', undefined)
    ls.closeTick()
    ls.closeTick()
    ls.addOrder('x', 'c', [1, 2])
    ls.closeTick()
    assert.equal(ls._bytes(), octets(ls.journal()))
    // 300 « é » : environ 330 caractères mais plus de 600 octets — la borne compte des octets
    assert.throws(() => ls.addOrder('x', 'd', { t: 'é'.repeat(300) }), /ordre trop volumineux/)
    ls.closeTick()
    assert.deepEqual(ls.journal().map((g: any) => g.orders.length), [2, 0, 1, 0], 'l\'ordre refusé n\'est entré dans aucun tick')

    // 2 ticks vides tiennent dans 60 octets, 3 non : seul le calcul qui retire le tick évincé laisse la partie vivre
    const anneau: any = createLockstep('b2', 2, { maxBytes: 60 })
    for (let i = 0; i < 50; i++) assert.ok(anneau.closeTick(), 'tick '+ (i + 1) +' refusé alors que l\'anneau ne garde que 2 ticks')
    assert.equal(anneau._bytes(), octets(anneau.journal()))

    const restaure: any = createLockstep('b3', null, { maxBytes: 100000 })
    restaure._restoreJournal(ls.journal())
    assert.equal(restaure._bytes(), octets(ls.journal()))

    // journal restauré déjà au-delà de la borne (borne abaissée entre deux lancements) : aucun tick de plus
    const plein: any = createLockstep('b4', null, { maxBytes: 60 })
    plein._restoreJournal([{ tick: 1, orders: [{ player: 'x', move: 'm', p: 'x'.repeat(50) }] }])
    assert.equal(plein.closeTick(), null)
    assert.equal(plein.journal().length, 1)
  })

  it('validation : maxBytes et maxOrderBytes sont des entiers ≥ 1, maxTicks devient facultatif, défauts 16 Mo et 2 Ko, toujours refusé hors lockstep', () => {
    const base = { mode: 'lockstep' as const, seats: 2, tick: 20, moves: {} }
    assert.throws(() => resolveGameDef('v1', { ...base, lockstepJournal: { maxBytes: 0 } } as any), /lockstepJournal\.maxBytes doit être un entier ≥ 1/)
    assert.throws(() => resolveGameDef('v2', { ...base, lockstepJournal: { maxBytes: '16 Mo' } } as any), /lockstepJournal\.maxBytes doit être un entier ≥ 1/)
    assert.throws(() => resolveGameDef('v3', { ...base, lockstepJournal: { maxOrderBytes: 1.5 } } as any), /lockstepJournal\.maxOrderBytes doit être un entier ≥ 1/)
    assert.throws(() => resolveGameDef('v4', { ...base, lockstepJournal: { maxTicks: 0 } } as any), /lockstepJournal\.maxTicks doit être un entier ≥ 1/)
    assert.deepEqual(resolveGameDef('v5', base as any).lockstepJournal, { maxTicks: null, maxBytes: MIO_16, maxOrderBytes: 2048 })
    assert.deepEqual(resolveGameDef('v6', { ...base, lockstepJournal: { maxOrderBytes: 512 } } as any).lockstepJournal, { maxTicks: null, maxBytes: MIO_16, maxOrderBytes: 512 })
    assert.deepEqual(resolveGameDef('v7', { ...base, lockstepJournal: { maxTicks: 5, maxBytes: 4096 } } as any).lockstepJournal, { maxTicks: 5, maxBytes: 4096, maxOrderBytes: 2048 })
    assert.throws(() => resolveGameDef('v8', { seats: 2, tick: 0, moves: {}, state: () => ({}), lockstepJournal: { maxBytes: 5000 } } as any), /lockstepJournal nécessite mode: 'lockstep'/)
    assert.equal(resolveGameDef('v9', { seats: 2, tick: 0, moves: {}, state: () => ({}), view: () => ({}) } as any).lockstepJournal, null)
  })
})
