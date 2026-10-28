// Accord des instantanés du journal lockstep (MJS-Server). Un vote ne compte que s'il vient d'un joueur assis au moment du décompte :
// un joueur parti ne vote plus, celui qui prend son siège ne vote que pour lui. Le journal n'est pas coupé tant qu'un client assis n'a
// jamais proposé d'instantané (un client qui ne sait pas les lire repartirait du tick 1 sans les ordres retirés), et un instantané n'est
// jamais rangé à côté d'un journal vide. Une proposition arrivée avec un retard réseau ordinaire est encore reçue ; une déclaration dont
// l'anneau ne couvre pas cette fenêtre, ou une sauvegarde dont le journal ne reprend pas juste après l'instantané, est refusée.
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
const lire = (fichiers: string[]) => fichiers.map(f => readFileSync(join(__dirname, '../src/runtime/'+ f), 'utf8')).join('\n')
const socketSrc = lire(['mjs_socket.ts'])
const clientSrc = lire(['mjs_socket.ts', 'mjs_game.ts', 'mjs_det.ts', 'mjs_lockstep.ts'])

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(src: string, erreurs: string[] = []): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', src)(µ)
  return µ
}

async function demarrer(declarer: (app: MjsServerApp) => void, opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...opts })
  declarer(app)
  await app.listen()
  return { transport, app }
}

// connexion nue (trames à la main) : ce client ne propose que ce que le test lui fait envoyer
async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const s = makeMu(socketSrc).socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  s.connect(); await tick()
  return s
}

// joueur complet : socket + partie + µ.lockstep ; `retard` (ms) retient ses propositions avant de les envoyer
async function joueur(transport: MemoryTransport, id: string, type: string, code: string | true, retard = 0): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ = makeMu(clientSrc)
  const sock = µ.socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect(); await tick()
  const envoyer = sock.send.bind(sock)
  sock.send = function(t: string, payload: any, opts?: any) {
    if (t !== 'µgame:snapshot' || retard === 0) return envoyer(t, payload, opts)
    const copie = JSON.parse(JSON.stringify(payload))
    setTimeout(() => envoyer(t, copie, opts), retard)
    return true
  }
  const partie = sock.game(type, { code })
  const etat: any = µ.lockstep(partie, {
    state0: () => ({ n: 0, somme: 0 }),
    apply: (s: any) => { s.n++; s.somme += etat.rng.int(1, 1000) },
    every: 0,
  })
  await tick(30)
  return { sock, partie, etat }
}

// premier tick diffusé multiple de `n` (sous 3 s)
function tickDeCadence(sock: any, n: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const fin = setTimeout(() => reject(new Error('aucun tick multiple de '+ n)), 3000)
    sock.on('µgame:orders', (f: any) => { if (f.tick % n === 0) { clearTimeout(fin); resolve(f.tick) } })
  })
}

// client honnête minimal : à chaque tick de la cadence, l'état dérivé du tick seul (identique chez tous)
function proposer(sock: any, game: string, every: number): void {
  sock.on('µgame:orders', (f: any) => {
    if (f.tick % every === 0) sock.send('µgame:snapshot', { game, tick: f.tick, state: { compte: f.tick }, rng: f.tick * 7 })
  })
}

// resync toutes les 100 ms (sous le débit permis par MJS-WS) jusqu'à un instantané gardé, au plus `ms`
async function attendreInstantane(sock: any, game: string, ms: number): Promise<any> {
  const fin = Date.now() + ms
  for (;;) {
    // client d'aujourd'hui : il se déclare capable de lire un instantané (sinon refusé une fois le journal coupé)
    const r = await sock.request('µgame:resync', { game, snapshots: true })
    if (r.snapshot || Date.now() > fin) return r
    await tick(100)
  }
}

const DUEL = { mode: 'lockstep', seats: 2, code: true, tick: 40, seatTtl: 300, emptyTtl: 5000, moves: {}, lockstepJournal: { snapshotEvery: 40 } }

describe('MJS-Server — accord des instantanés lockstep', function () {
  this.timeout(15000)

  describe('1. un vote ne compte que s\'il vient d\'un joueur assis au moment du décompte', () => {
    it('lockstep.ts : le vote d\'un joueur parti est oublié — son remplaçant, même d\'accord avec lui, ne fait rien garder', () => {
      const faux = { v: 'faux' }
      const duel = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) duel.closeTick()
      assert.equal(duel.receiveSnapshot('menteur', 4, faux, 1, ['menteur', 'h']), false)
      assert.equal(duel.receiveSnapshot('h', 4, { v: 'vrai' }, 1, ['menteur', 'h']), false)
      assert.equal(duel.receiveSnapshot('complice', 4, faux, 1, ['complice', 'h']), false, 'à deux sièges, il faut les deux joueurs assis')
      assert.equal(duel.snapshot(), null)
      const trois = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) trois.closeTick()
      trois.receiveSnapshot('menteur', 4, faux, 1, ['menteur', 'a', 'b'])
      trois.receiveSnapshot('a', 4, { v: 'a' }, 1, ['menteur', 'a', 'b'])
      assert.equal(trois.receiveSnapshot('complice', 4, faux, 1, ['complice', 'a', 'b']), false, 'un seul vote assis pour le faux état')
      assert.equal(trois.snapshot(), null)
      assert.equal(trois.receiveSnapshot('b', 4, { v: 'a' }, 1, ['complice', 'a', 'b']), true, 'deux joueurs assis sur trois')
      assert.deepEqual(trois.snapshot()!.state, { v: 'a' })
    })

    it('lockstep.ts : un joueur ne vote qu\'une fois par tick, et une seule fois encore s\'il revient après un départ ; un expéditeur qui n\'est pas assis ne vote pas', () => {
      const ls = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) ls.closeTick()
      const s = { n: 1 }
      assert.equal(ls.receiveSnapshot('a', 4, s, 1, ['a', 'b', 'c']), false)
      assert.equal(ls.receiveSnapshot('a', 4, s, 1, ['a', 'b', 'c']), false, 'second vote du même joueur')
      assert.equal(ls.receiveSnapshot('x', 4, s, 1, ['a', 'b', 'c']), false, 'pas assis')
      assert.equal(ls.snapshot(), null)
      assert.equal(ls.receiveSnapshot('b', 4, s, 1, ['a', 'b', 'c']), true)
      const retour = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 6; i++) retour.closeTick()
      retour.receiveSnapshot('a', 4, s, 1, ['a', 'b', 'c'])
      assert.equal(retour.receiveSnapshot('c', 4, { n: 2 }, 1, ['b', 'c']), false, 'a est parti : son vote est oublié')
      assert.equal(retour.receiveSnapshot('a', 4, s, 1, ['a', 'b', 'c']), false, 'a revient : un vote, le sien seul')
      assert.equal(retour.snapshot(), null)
      assert.equal(retour.receiveSnapshot('b', 4, s, 1, ['a', 'b', 'c']), true, 'a et b, deux joueurs assis sur trois')
    })

    it('partie réelle, deux sièges : un menteur propose, quitte la partie, un complice prend son siège et propose le même faux état — rien n\'est gardé', async () => {
      const { transport, app } = await demarrer(a => a.game('duel', DUEL as any))
      const L = await connecter(transport, 'L')
      const rep = await L.request('µgame:play', { type: 'duel', code: true })
      const H = await connecter(transport, 'H')
      await H.request('µgame:play', { type: 'duel', code: rep.code })
      const cadence = await tickDeCadence(L, 40)
      const faux = { n: 999, unites: { L: 1000000 } }
      H.send('µgame:snapshot', { game: rep.game, tick: cadence, state: { n: 1 }, rng: 5 })
      L.send('µgame:snapshot', { game: rep.game, tick: cadence, state: faux, rng: 1 }); await tick(5)
      await L.request('µgame:leave', { game: rep.game }); await tick(5)
      const W = await connecter(transport, 'W')
      const place = await W.request('µgame:play', { type: 'duel', code: rep.code })
      assert.equal(place.seat, 0, 'le complice a pris le siège laissé libre')
      W.send('µgame:snapshot', { game: rep.game, tick: cadence, state: faux, rng: 1 }); await tick(30)
      const r = await H.request('µgame:resync', { game: rep.game, snapshots: true })
      assert.equal(r.snapshot, undefined, 'faux état gardé : '+ JSON.stringify(r.snapshot))
      assert.equal(r.journal[0].tick, 1, 'journal entier')
      await app.stop()
    })

    it('partie réelle, trois sièges : le vote du menteur parti ne s\'ajoute pas à celui de son complice', async () => {
      const { transport, app } = await demarrer(a => a.game('trio', { ...DUEL, seats: 3 } as any))
      const L = await connecter(transport, 'L')
      const rep = await L.request('µgame:play', { type: 'trio', code: true })
      const Y = await connecter(transport, 'Y')
      await Y.request('µgame:play', { type: 'trio', code: rep.code })
      const Z = await connecter(transport, 'Z')
      await Z.request('µgame:play', { type: 'trio', code: rep.code })
      const cadence = await tickDeCadence(L, 40)
      const faux = { n: 999 }
      Y.send('µgame:snapshot', { game: rep.game, tick: cadence, state: { n: 'y' }, rng: 2 })
      Z.send('µgame:snapshot', { game: rep.game, tick: cadence, state: { n: 'z' }, rng: 3 })
      L.send('µgame:snapshot', { game: rep.game, tick: cadence, state: faux, rng: 1 }); await tick(5)
      await L.request('µgame:leave', { game: rep.game }); await tick(5)
      const W = await connecter(transport, 'W')
      await W.request('µgame:play', { type: 'trio', code: rep.code })
      W.send('µgame:snapshot', { game: rep.game, tick: cadence, state: faux, rng: 1 }); await tick(30)
      const r = await Y.request('µgame:resync', { game: rep.game, snapshots: true })
      assert.equal(r.snapshot, undefined, 'faux état gardé : '+ JSON.stringify(r.snapshot))
      assert.equal(r.journal[0].tick, 1)
      await app.stop()
    })
  })

  describe('2. un client qui ne sait pas lire les instantanés n\'est jamais laissé figé', () => {
    it('partie réelle : tant qu\'un joueur assis n\'a jamais proposé d\'instantané, le journal n\'est pas coupé ; son départ lève la retenue', async () => {
      const { transport, app } = await demarrer(a => a.game('trio', { ...DUEL, seats: 3, lockstepJournal: { snapshotEvery: 4 } } as any))
      const x = await connecter(transport, 'x')
      const rep = await x.request('µgame:play', { type: 'trio', code: true })
      const y = await connecter(transport, 'y')
      await y.request('µgame:play', { type: 'trio', code: rep.code })
      const ancien = await connecter(transport, 'ancien')
      await ancien.request('µgame:play', { type: 'trio', code: rep.code })
      proposer(x, rep.game, 4)
      proposer(y, rep.game, 4)
      await tickDeCadence(x, 16)
      await tick(60)
      const r = await ancien.request('µgame:resync', { game: rep.game })
      assert.equal(r.snapshot, undefined, 'journal coupé sous un client qui ne sait pas lire l\'instantané : '+ JSON.stringify(r.snapshot))
      assert.equal(r.journal[0].tick, 1, 'il rejoue tout depuis le tick 1')
      await ancien.request('µgame:leave', { game: rep.game })
      const apres = await attendreInstantane(x, rep.game, 4000)
      assert.ok(apres.snapshot, 'les deux joueurs qui restent s\'accordent ensuite')
      assert.ok(apres.journal.length > 0 && apres.journal[0].tick === apres.snapshot.tick + 1, 'journal non vide, juste après l\'instantané : '+ JSON.stringify(apres.journal.slice(0, 2)))
      await app.stop()
    })

    it('lockstep.ts : un accord retenu ne garde rien, et le tick suivant de la cadence peut encore s\'accorder', () => {
      const ls = createLockstep('g', null, {}, 4, 40)
      for (let i = 0; i < 5; i++) ls.closeTick()
      ls.receiveSnapshot('a', 4, { n: 4 }, 1, ['a', 'b'], true)
      assert.equal(ls.receiveSnapshot('b', 4, { n: 4 }, 1, ['a', 'b'], true), false, 'retenu')
      assert.equal(ls.snapshot(), null)
      for (let i = 0; i < 4; i++) ls.closeTick()
      ls.receiveSnapshot('a', 8, { n: 8 }, 1, ['a', 'b'])
      assert.equal(ls.receiveSnapshot('b', 8, { n: 8 }, 1, ['a', 'b']), true, 'plus de retenue au tick 8')
      assert.equal(ls.snapshot()!.tick, 8)
    })

    it('lockstep.ts : un accord sur le dernier tick clos n\'est rangé qu\'à la clôture du suivant — jamais d\'instantané à côté d\'un journal vide', () => {
      const ls = createLockstep('g', null, {}, 4)
      for (let i = 0; i < 4; i++) { ls.addOrder('a', 'm', { i }); ls.closeTick() }
      ls.receiveSnapshot('a', 4, { n: 4 }, 9, ['a', 'b'])
      ls.receiveSnapshot('b', 4, { n: 4 }, 9, ['a', 'b'])
      assert.equal(ls.snapshot(), null, 'pas encore rangé : le journal serait vide')
      assert.deepEqual(ls.journal().map(g => g.tick), [1, 2, 3, 4])
      assert.equal(ls.receiveSnapshot('c', 4, { n: 4 }, 9, ['a', 'b', 'c']), false, 'accord déjà atteint pour ce tick')
      assert.equal(ls.closeTick()!.tick, 5)
      assert.deepEqual(ls.snapshot(), { tick: 4, state: { n: 4 }, rng: 9 })
      assert.deepEqual(ls.journal().map(g => g.tick), [5], 'le journal porte le tick qui suit l\'instantané')
      assert.equal(ls._bytes(), Buffer.byteLength(JSON.stringify(ls.journal()), 'utf8'), 'taille tenue')
    })

    it('partie réelle : chaque resync qui porte un instantané porte aussi au moins le tick qui le suit', async () => {
      const { transport, app } = await demarrer(a => a.game('duel', { ...DUEL, lockstepJournal: { snapshotEvery: 4 } } as any))
      const x = await connecter(transport, 'x')
      const rep = await x.request('µgame:play', { type: 'duel', code: true })
      const y = await connecter(transport, 'y')
      await y.request('µgame:play', { type: 'duel', code: rep.code })
      // les deux propositions partent dès la diffusion du tick : l'accord tombe avant la clôture du tick suivant (25 ms à 40 Hz)
      const cadence = await tickDeCadence(x, 4)
      for (const s of [x, y]) s.send('µgame:snapshot', { game: rep.game, tick: cadence, state: { compte: cadence }, rng: 7 })
      await tick(3)
      const vus = [await x.request('µgame:resync', { game: rep.game, snapshots: true })]
      await tick(80)
      vus.push(await x.request('µgame:resync', { game: rep.game, snapshots: true }))
      const avec = vus.filter(r => r.snapshot).map(r => ({ snap: r.snapshot.tick, ticks: r.journal.map((g: any) => g.tick).slice(0, 3) }))
      assert.ok(avec.length > 0, 'aucun instantané gardé')
      for (const v of avec) assert.equal(v.ticks[0], v.snap + 1, JSON.stringify(avec))
      await app.stop()
    })
  })

  describe('3. fenêtre des propositions, anneau, sauvegarde', () => {
    it('déclaration : une proposition est reçue pendant deux secondes de ticks, ou toute la cadence si elle est plus longue', () => {
      const base = { mode: 'lockstep', seats: 2, moves: {} }
      assert.equal(resolveGameDef('v', { ...base, tick: 20, lockstepJournal: { snapshotEvery: 1 } } as any).lockstepSnapshot!.window, 40)
      assert.equal(resolveGameDef('v', { ...base, tick: 60, lockstepJournal: { snapshotEvery: 30 } } as any).lockstepSnapshot!.window, 120)
      assert.equal(resolveGameDef('v', { ...base, tick: 20, lockstepJournal: { snapshotEvery: 1200 } } as any).lockstepSnapshot!.window, 1200)
      assert.equal(resolveGameDef('v', { ...base, tick: 1.5, lockstepJournal: { snapshotEvery: 2 } } as any).lockstepSnapshot!.window, 3)
    })

    it('lockstep.ts : cadence 1, une proposition en retard de plusieurs ticks est encore reçue ; un seul tick en cours à la fois', () => {
      const ls = createLockstep('g', null, {}, 1, 40)
      for (let i = 0; i < 5; i++) ls.closeTick()
      assert.equal(ls.receiveSnapshot('a', 5, { n: 5 }, 1, ['a', 'b']), false)
      for (let i = 0; i < 10; i++) ls.closeTick()
      for (let t = 6; t <= 15; t++) assert.equal(ls.receiveSnapshot('a', t, { n: t }, 1, ['a', 'b']), false, 'tick '+ t +' : le tick 5 est en cours')
      assert.equal(ls.receiveSnapshot('b', 5, { n: 5 }, 1, ['a', 'b']), true, 'dix ticks de retard : reçue')
      assert.equal(ls.snapshot()!.tick, 5)
      assert.deepEqual(ls.journal().map(g => g.tick), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      const tard = createLockstep('g', null, {}, 1, 40)
      for (let i = 0; i < 50; i++) tard.closeTick()
      assert.equal(tard.receiveSnapshot('a', 10, { n: 10 }, 1, ['a', 'b']), false, 'au-delà de la fenêtre')
      assert.equal(tard.receiveSnapshot('b', 10, { n: 10 }, 1, ['a', 'b']), false)
      assert.equal(tard.snapshot(), null)
      tard.receiveSnapshot('a', 11, { n: 11 }, 1, ['a', 'b'])
      assert.equal(tard.receiveSnapshot('b', 11, { n: 11 }, 1, ['a', 'b']), true, 'le tick 11 est encore dans la fenêtre')
    })

    it('partie réelle, cadence 1 à 20 Hz : un joueur dont les propositions arrivent 300 ms en retard s\'accorde quand même avec l\'autre', async () => {
      const { transport, app } = await demarrer(a => a.game('vif', { ...DUEL, tick: 20, lockstepJournal: { snapshotEvery: 1 } } as any))
      const x = await joueur(transport, 'x', 'vif', true)
      const y = await joueur(transport, 'y', 'vif', x.partie.state.code, 300)
      for (let i = 0; i < 4; i++) { x.partie.move('bouger', {}); await tick(40) }
      const r = await attendreInstantane(x.sock, x.partie.state.gameId, 3000)
      assert.ok(r.snapshot, 'aucun instantané gardé malgré 300 ms de retard : '+ JSON.stringify(Object.keys(r)))
      assert.equal(r.journal[0].tick, r.snapshot.tick + 1)
      await tick(400)
      assert.equal(JSON.stringify(y.etat), JSON.stringify(x.etat), 'mêmes états')
      await app.stop()
    })

    it('déclaration : un anneau maxTicks plus court que la fenêtre des propositions est refusé, erreur claire', () => {
      const base = { mode: 'lockstep', seats: 2, moves: {}, tick: 20 }
      assert.throws(() => resolveGameDef('v', { ...base, lockstepJournal: { maxTicks: 5, snapshotEvery: 8 } } as any), /maxTicks.*\b5\b.*\b40\b/)
      assert.throws(() => resolveGameDef('v', { ...base, lockstepJournal: { maxTicks: 1199, snapshotEvery: 1200 } } as any), /maxTicks.*1199.*1200/)
      assert.equal(resolveGameDef('v', { ...base, lockstepJournal: { maxTicks: 40, snapshotEvery: 8 } } as any).lockstepJournal!.maxTicks, 40)
      assert.equal(resolveGameDef('v', { ...base, lockstepJournal: { maxTicks: 5 } } as any).lockstepJournal!.maxTicks, 5, 'sans instantané, l\'anneau reste libre')
    })

    it('sauvegarde : un journal qui ne reprend pas juste après l\'instantané est refusé au chargement, l\'erreur le dit', async () => {
      const def = resolveGameDef('snap', { ...DUEL, lockstepJournal: { snapshotEvery: 4 } } as any)
      const app: any = { send() {} }
      const data: any = createGame(app, def, () => {}, 'g1').serialize()
      const ticks = (de: number, a: number) => Array.from({ length: a - de + 1 }, (_, i) => ({ tick: de + i, orders: [] }))
      const snapshot = { tick: 100, state: { n: 1 }, rng: 9 }
      for (const journal of [ticks(50, 52), ticks(100, 102), ticks(102, 104)]) {
        assert.throws(() => restoreGame(app, def, () => {}, { ...data, lockstep: { journal, snapshot } }), /lockstep\.journal.*101/, JSON.stringify(journal.map(g => g.tick)))
      }
      for (const journal of [ticks(101, 103), []]) {
        const bon = restoreGame(app, def, () => {}, { ...data, lockstep: { journal, snapshot } })
        assert.deepEqual(bon._lockstep!.snapshot(), snapshot)
        bon._destroy(true)
      }
      // par le chargement du serveur : l'entrée est écartée avec un avertissement qui nomme le champ
      const adapter = new MemoryPersistAdapter()
      await adapter.save('g1', { ...data, type: 'snap', lockstep: { journal: ticks(50, 52), snapshot } })
      const logs: string[] = []
      const { app: serveur } = await demarrer(a => a.game('snap', { ...DUEL, lockstepJournal: { snapshotEvery: 4 } } as any), { persist: { adapter }, onLog: (_niveau: string, msg: string, meta?: unknown) => { logs.push(msg +' '+ JSON.stringify(meta ?? {})) } } as any)
      assert.ok(logs.some(m => /g1/.test(m) && /lockstep\.journal/.test(m) && /101/.test(m)), JSON.stringify(logs))
      await serveur.stop()
    })
  })
})
