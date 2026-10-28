// Instantanés du journal lockstep (MJS-Server) : le serveur ne simule rien, seuls les clients connaissent l'état. Tous les
// `lockstepJournal.snapshotEvery` ticks, chaque client propose son état (et celui du générateur partagé) ; le serveur ne le garde que
// quand au moins deux joueurs assis ET la majorité absolue des joueurs assis envoient exactement le même JSON pour le même tick — un
// joueur seul ne peut jamais imposer un état. Gardé, il remplace le début du journal : le resync et la sauvegarde portent l'instantané
// puis les seuls ordres qui le suivent, et la partie peut durer bien au-delà de `maxBytes`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame, MemoryPersistAdapter } from '../src/mjs-server/index.js'
import { restoreGame } from '../src/mjs-server/game.js'
import { createLockstep } from '../src/mjs-server/lockstep.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const octets = (x: unknown) => Buffer.byteLength(JSON.stringify(x), 'utf8')

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', clientSrc)(µ)
  return µ
}

// l'appli déclare ses jeux AVANT listen() : une partie sauvegardée n'est restaurée que si son type est déjà connu
async function demarrer(opts: MjsServerOptions, declarer: (app: MjsServerApp) => void): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...opts })
  declarer(app)
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const s = makeMu().socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  s.connect(); await tick()
  return s
}

const DEF_SNAP = { mode: 'lockstep', seats: 2, code: true, tick: 40, seatTtl: 300, emptyTtl: 5000, moves: {}, lockstepJournal: { snapshotEvery: 4 } }

function declarerJeu(app: MjsServerApp, overrides: Record<string, any> = {}): void {
  app.game('snap', { ...DEF_SNAP, ...overrides } as any)
}

async function deuxJoueurs(transport: MemoryTransport): Promise<{ sx: any; sy: any; rep: any }> {
  const sx = await connecter(transport, 'x')
  const rep = await sx.request('µgame:play', { type: 'snap', code: true })
  const sy = await connecter(transport, 'y')
  await sy.request('µgame:play', { type: 'snap', code: rep.code })
  return { sx, sy, rep }
}

// client minimal honnête : à chaque tick de la cadence, il propose l'état (ici dérivé du tick seul, identique chez tous)
function proposer(sock: any, game: string, every: number): void {
  sock.on('µgame:orders', (f: any) => {
    if (f.tick % every === 0) sock.send('µgame:snapshot', { game, tick: f.tick, state: { compte: f.tick, unites: { a: { x: f.tick * 2 } } }, rng: f.tick * 7 })
  })
}

// attend qu'un instantané soit gardé (resync de `sock`), au plus `ms`
async function attendreInstantane(sock: any, game: string, ms = 2000): Promise<any> {
  const fin = Date.now() + ms
  for (;;) {
    // client d'aujourd'hui : il se déclare capable de lire un instantané (sinon refusé une fois le journal coupé)
    const r = await sock.request('µgame:resync', { game, snapshots: true })
    if (r.snapshot) return r
    if (Date.now() > fin) return r
    await tick(20)
  }
}

describe('MJS-Server — instantanés du journal lockstep', function () {
  this.timeout(10000)

  describe('1. lockstep.ts — certification par les clients', () => {
    it('deux sièges sur trois envoient le même état : l\'instantané est gardé et le journal coupé avant lui', () => {
      const ls = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) { ls.addOrder('a', 'bouger', { i }); ls.closeTick() }
      const etat = { unites: { a: { x: 1 } } }
      const trio = ['a', 'b', 'c']
      assert.equal(ls.receiveSnapshot('a', 4, etat, 123, trio), false, 'un seul témoin : pas encore')
      assert.equal(ls.snapshot(), null)
      assert.equal(ls.receiveSnapshot('b', 4, JSON.parse(JSON.stringify(etat)), 123, trio), true, 'deux sur trois : gardé')
      assert.deepEqual(ls.snapshot(), { tick: 4, state: etat, rng: 123 })
      assert.deepEqual(ls.journal().map(g => g.tick), [5, 6], 'le journal ne garde que les ticks qui suivent l\'instantané')
      assert.equal(ls._bytes(), octets(ls.journal()), 'taille tenue du journal coupé')
      assert.equal(ls.closeTick()!.tick, 7, 'la numérotation continue')
    })

    it('un tricheur seul ne fait rien garder : seul l\'état de la majorité honnête est gardé', () => {
      const ls = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 5; i++) ls.closeTick()
      const trio = ['tricheur', 'a', 'b']
      assert.equal(ls.receiveSnapshot('tricheur', 4, { or: 999999 }, 1, trio), false)
      assert.equal(ls.receiveSnapshot('a', 4, { or: 10 }, 1, trio), false)
      assert.equal(ls.snapshot(), null, 'un contre un : rien')
      assert.equal(ls.receiveSnapshot('b', 4, { or: 10 }, 1, trio), true)
      assert.deepEqual(ls.snapshot()!.state, { or: 10 })
    })

    it('à deux sièges il faut les deux ; un siège seul ne fait jamais garder d\'instantané ; un vote compte une fois', () => {
      const duel = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 4; i++) duel.closeTick()
      assert.equal(duel.receiveSnapshot('a', 4, { n: 1 }, 0, ['a', 'b']), false)
      assert.equal(duel.receiveSnapshot('b', 4, { n: 2 }, 0, ['a', 'b']), false, 'désaccord à deux : rien')
      assert.equal(duel.snapshot(), null)
      const solo = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 4; i++) solo.closeTick()
      assert.equal(solo.receiveSnapshot('a', 4, { n: 1 }, 0, ['a']), false, 'un siège seul ne certifie rien')
      assert.equal(solo.snapshot(), null)
      const deuxFois = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 4; i++) deuxFois.closeTick()
      assert.equal(deuxFois.receiveSnapshot('a', 4, { n: 1 }, 0, ['a', 'b', 'c']), false)
      assert.equal(deuxFois.receiveSnapshot('a', 4, { n: 1 }, 0, ['a', 'b', 'c']), false, 'le même siège ne vote pas deux fois')
      assert.equal(deuxFois.snapshot(), null)
    })

    it('tick hors cadence, à venir, périmé ou non entier, générateur invalide, état absent : refusés sans rien garder', () => {
      const ls = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) ls.closeTick()
      const refus: Array<[number, unknown, unknown]> = [[3, { n: 1 }, 0], [8, { n: 1 }, 0], [4.5, { n: 1 }, 0], [4, { n: 1 }, -1], [4, { n: 1 }, 2 ** 32], [4, { n: 1 }, 1.5], [4, { n: 1 }, '3'], [4, undefined, 0]]
      for (const [t, s, r] of refus) {
        assert.equal(ls.receiveSnapshot('a', t, s, r as any, ['a', 'b', 'c']), false, JSON.stringify([t, s, r]))
        assert.equal(ls.receiveSnapshot('b', t, s, r as any, ['a', 'b', 'c']), false, JSON.stringify([t, s, r]))
      }
      assert.equal(ls.snapshot(), null)
      for (let i = 0; i < 3; i++) ls.closeTick()
      assert.equal(ls.receiveSnapshot('a', 4, { n: 1 }, 0, ['a', 'b', 'c']), false, 'tick 4 périmé : la cadence attend maintenant le tick 8')
      assert.equal(ls.receiveSnapshot('b', 4, { n: 1 }, 0, ['a', 'b', 'c']), false)
      assert.equal(ls.snapshot(), null)
    })

    it('sans snapshotEvery, aucun instantané n\'est jamais gardé', () => {
      const ls = createLockstep('g', null, {})
      for (let i = 0; i < 4; i++) ls.closeTick()
      assert.equal(ls.receiveSnapshot('a', 4, { n: 1 }, 0, ['a', 'b']), false)
      assert.equal(ls.receiveSnapshot('b', 4, { n: 1 }, 0, ['a', 'b']), false)
      assert.equal(ls.snapshot(), null)
      assert.equal(ls.journal().length, 4)
    })

    it('maxBytes compte l\'instantané et le journal : avec des instantanés réguliers, la partie dure bien au-delà de la borne', () => {
      const sans = createLockstep('g', null, { maxBytes: 600 })
      let fin = 0
      for (let i = 1; i <= 200; i++) { if (!sans.closeTick()) { fin = i; break } }
      assert.ok(fin > 0 && fin < 40, 'sans instantané, 600 octets tiennent moins de 40 ticks (fin au tick '+ fin +')')
      const avec = createLockstep('g', null, { maxBytes: 600 }, 5)
      for (let i = 1; i <= 200; i++) {
        const g = avec.closeTick()
        assert.ok(g, 'tick '+ i +' refusé malgré les instantanés')
        // accord sur le dernier tick clos : rangé à la clôture du tick suivant
        if (g.tick % 5 === 1 && g.tick > 1) assert.equal(avec.snapshot()!.tick, g.tick - 1, 'instantané du tick '+ (g.tick - 1))
        if (g.tick % 5 === 0) {
          avec.receiveSnapshot('a', g.tick, { n: g.tick }, g.tick, ['a', 'b'])
          avec.receiveSnapshot('b', g.tick, { n: g.tick }, g.tick, ['a', 'b'])
        }
        assert.ok(avec._bytes() + octets(avec.snapshot() ?? {}) <= 600, 'tick '+ i +' : '+ avec._bytes() +' octets de journal')
      }
      assert.ok(avec.closeTick())
      assert.equal(avec.snapshot()!.tick, 200)
    })

    it('un instantané qui ne tiendrait pas dans maxBytes n\'est pas gardé, le journal reste entier', () => {
      const ls = createLockstep('g', null, { maxBytes: 300 }, 4)
      for (let i = 0; i < 4; i++) ls.closeTick()
      const gros = { d: 'x'.repeat(400) }
      ls.receiveSnapshot('a', 4, gros, 0, ['a', 'b'])
      assert.equal(ls.receiveSnapshot('b', 4, gros, 0, ['a', 'b']), false)
      assert.equal(ls.closeTick()!.tick, 5)
      assert.equal(ls.snapshot(), null)
      assert.deepEqual(ls.journal().map(g => g.tick), [1, 2, 3, 4, 5])
    })

    it('restauration : l\'instantané revient, la numérotation reprend après la dernière entrée, ou après l\'instantané si le journal est vide', () => {
      const ls = createLockstep('g', null, {}, 4)
      const snap = { tick: 8, state: { n: 1 }, rng: 5 }
      ls._restoreJournal([{ tick: 9, orders: [] }, { tick: 10, orders: [] }], snap)
      assert.deepEqual(ls.snapshot(), snap)
      assert.equal(ls.closeTick()!.tick, 11)
      const vide = createLockstep('g', null, {}, 4)
      vide._restoreJournal([], { tick: 8, state: {}, rng: 0 })
      assert.equal(vide.closeTick()!.tick, 9)
    })
  })

  describe('2. déclaration — lockstepJournal.snapshotEvery', () => {
    const base = { mode: 'lockstep', seats: 2, tick: 20, moves: {} }

    it('un entier ≥ 1 ; toute autre valeur lève une erreur claire à la déclaration', () => {
      for (const v of [0, -4, 1.5, '4', null, Infinity]) {
        assert.throws(() => resolveGameDef('v', { ...base, lockstepJournal: { snapshotEvery: v } } as any), /snapshotEvery/, String(v))
      }
    })

    it('absent : aucun instantané (lockstepSnapshot null) ; présent : cadence et taille permise d\'une proposition', () => {
      assert.equal(resolveGameDef('v', base as any).lockstepSnapshot, null)
      assert.deepEqual(resolveGameDef('v', { ...base, lockstepJournal: { snapshotEvery: 60 } } as any).lockstepSnapshot, { every: 60, max: 65536 - 1024, window: 60 })
      assert.equal(resolveGameDef('v', { ...base, lockstepJournal: { snapshotEvery: 60, maxBytes: 1000 } } as any).lockstepSnapshot!.max, 1000, 'jamais plus que maxBytes')
      assert.equal(resolveGameDef('v', { ...base, lockstepJournal: { snapshotEvery: 60 } } as any, () => {}, 1048576).lockstepSnapshot!.max, 1048576 - 1024, 'suit la taille de trame permise par le serveur')
      assert.equal(resolveGameDef('v', { seats: 2, tick: 0, moves: {}, state: () => ({}), view: () => ({}) } as any).lockstepSnapshot, null, 'hors lockstep')
    })
  })

  describe('3. partie réelle — µgame:snapshot, resync, sauvegarde', () => {
    it('la trame de départ annonce la cadence et la taille permise (qui suit limits.maxPayload) ; sans snapshotEvery, rien', async () => {
      const { transport, app } = await demarrer({ limits: { maxPayload: 200000 } }, a => { declarerJeu(a); a.game('sans', { ...DEF_SNAP, lockstepJournal: {} } as any) })
      const { sx, rep } = await deuxJoueurs(transport)
      assert.equal(rep.snapshotEvery, 4)
      assert.equal(rep.snapshotMax, 200000 - 1024)
      assert.equal(rep.snapshot, undefined, 'aucun instantané au départ')
      const rep2 = await sx.request('µgame:play', { type: 'sans', code: true })
      assert.ok(!('snapshotEvery' in rep2) && !('snapshotMax' in rep2) && !('snapshot' in rep2), JSON.stringify(Object.keys(rep2)))
      await app.stop()
    })

    it('les deux joueurs proposent le même état : le resync porte l\'instantané puis les seuls ordres qui le suivent', async () => {
      const { transport, app } = await demarrer({}, a => declarerJeu(a))
      const { sx, sy, rep } = await deuxJoueurs(transport)
      proposer(sx, rep.game, 4)
      proposer(sy, rep.game, 4)
      const r = await attendreInstantane(sx, rep.game)
      assert.ok(r.snapshot, 'aucun instantané gardé : '+ JSON.stringify(Object.keys(r)))
      assert.equal(r.snapshot.tick % 4, 0)
      assert.deepEqual(r.snapshot.state, { compte: r.snapshot.tick, unites: { a: { x: r.snapshot.tick * 2 } } })
      assert.equal(r.snapshot.rng, r.snapshot.tick * 7)
      assert.equal(r.journal[0].tick, r.snapshot.tick + 1, 'le journal reprend juste après l\'instantané')
      r.journal.forEach((g: any, i: number) => assert.equal(g.tick, r.snapshot.tick + 1 + i))
      await app.stop()
    })

    it('un seul joueur qui propose (l\'autre se tait) : rien n\'est gardé, le journal reste entier', async () => {
      const { transport, app } = await demarrer({}, a => declarerJeu(a))
      const { sx, rep } = await deuxJoueurs(transport)
      proposer(sx, rep.game, 4)
      await tick(300)
      const r = await sx.request('µgame:resync', { game: rep.game, snapshots: true })
      assert.equal(r.snapshot, undefined)
      assert.equal(r.journal[0].tick, 1)
      await app.stop()
    })

    it('sauvegarde : l\'instantané part avec le journal coupé et revient au redémarrage, la numérotation continue', async () => {
      const adapter = new MemoryPersistAdapter()
      const { transport, app } = await demarrer({ persist: { adapter, debounce: 5 } }, a => declarerJeu(a))
      const { sx, sy, rep } = await deuxJoueurs(transport)
      proposer(sx, rep.game, 4)
      proposer(sy, rep.game, 4)
      const r = await attendreInstantane(sx, rep.game)
      assert.ok(r.snapshot)
      await app.stop()
      const [{ data }] = await adapter.load()
      assert.ok(data.lockstep?.snapshot, 'la sauvegarde porte l\'instantané')
      assert.ok(data.lockstep!.snapshot!.tick >= r.snapshot.tick)
      const journal = data.lockstep!.journal
      assert.ok(journal.length === 0 || journal[0].tick === data.lockstep!.snapshot!.tick + 1, 'journal coupé dans la sauvegarde')
      const dernier = journal.length > 0 ? journal[journal.length - 1].tick : data.lockstep!.snapshot!.tick
      const { transport: t2, app: app2 } = await demarrer({ persist: { adapter } }, a => declarerJeu(a))
      const sx2 = await connecter(t2, 'x')
      const ticks: number[] = []
      sx2.on('µgame:orders', (f: any) => ticks.push(f.tick))
      const r2 = await sx2.request('µgame:resync', { game: rep.game, snapshots: true })
      assert.deepEqual(r2.snapshot, data.lockstep!.snapshot)
      assert.deepEqual(r2.journal, journal)
      await tick(120)
      assert.equal(ticks[0], dernier + 1, 'premier tick après le redémarrage : '+ JSON.stringify(ticks.slice(0, 3)))
      await app2.stop()
    })

    it('une sauvegarde dont l\'instantané lockstep est mal formé est refusée à la restauration', () => {
      const def = resolveGameDef('snap', DEF_SNAP as any)
      const app: any = { send() {} }
      const data: any = createGame(app, def, () => {}, 'g1').serialize()
      for (const snapshot of [{ tick: 'x', state: {}, rng: 0 }, { tick: 0, state: {}, rng: 0 }, { tick: 4, state: {}, rng: -1 }, { tick: 4, rng: 0 }, 'texte']) {
        assert.throws(() => restoreGame(app, def, () => {}, { ...data, lockstep: { journal: [], snapshot } }), /lockstep\.snapshot/, JSON.stringify(snapshot))
      }
      const bon = restoreGame(app, def, () => {}, { ...data, lockstep: { journal: [], snapshot: { tick: 4, state: { n: 1 }, rng: 9 } } })
      assert.deepEqual(bon._lockstep!.snapshot(), { tick: 4, state: { n: 1 }, rng: 9 })
      bon._destroy(true)
    })
  })
})
