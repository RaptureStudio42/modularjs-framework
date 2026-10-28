// µ.lockstep et les instantanés du journal : le client propose son état et celui du générateur partagé à la cadence annoncée par le
// serveur (`snapshotEvery`), en direct seulement, et jamais au-delà de la taille de trame permise (`snapshotMax`) — un client qui
// enverrait plus serait coupé par MJS-WS. Au resync, un instantané gardé par le serveur remplace le rejeu depuis le tick 1 : l'état
// et le générateur repartent de là, puis les ordres qui suivent, et le client reste identique aux autres.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_game.ts', 'mjs_det.ts', 'mjs_lockstep.ts']
  .map(f => readFileSync(join(__dirname, '../src/runtime/'+ f), 'utf8'))
  .join('\n')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(erreurs: string[] = []): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
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

interface Joueur { µ: any; sock: any; partie: any; etat: any; snaps: any[]; erreurs: string[] }

// un joueur : socket + partie + µ.lockstep dont `apply` tire dans le générateur partagé à chaque ordre (l'état dépend donc de lui)
async function joueur(transport: MemoryTransport, id: string, type: string, code: string | true, state0: () => any = () => ({ n: 0, somme: 0, unites: {} })): Promise<Joueur> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const erreurs: string[] = []
  const µ = makeMu(erreurs)
  const sock = µ.socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  const snaps: any[] = []
  const envoyer = sock.send.bind(sock)
  sock.send = function(type: string, payload: any, opts?: any) {
    if (type === 'µgame:snapshot') snaps.push({ ...JSON.parse(JSON.stringify(payload)), opts })
    return envoyer(type, payload, opts)
  }
  const partie = sock.game(type, { code })
  const etat: any = µ.lockstep(partie, {
    state0,
    apply: (s: any, o: any) => { s.n++; s.somme += etat.rng.int(1, 1000); s.unites[o.player] = (s.unites[o.player] || 0) + o.p.dx },
    every: 4,
  })
  await tick(30)
  return { µ, sock, partie, etat, snaps, erreurs }
}

const texte = (j: Joueur) => JSON.stringify(j.etat)

describe('µ.lockstep — instantanés du journal', function () {
  this.timeout(10000)

  it('trois joueurs : l\'instantané est gardé, un joueur qui se resynchronise repart de lui (état et générateur) et reste identique aux autres', async () => {
    const { transport, app } = await startApp()
    app.game('rts-snap', { mode: 'lockstep', seats: 3, code: true, tick: 40, seatTtl: 300, emptyTtl: 5000, moves: {}, lockstepJournal: { snapshotEvery: 8 } } as any)
    const x = await joueur(transport, 'x', 'rts-snap', true)
    const code = x.partie.state.code
    const y = await joueur(transport, 'y', 'rts-snap', code)
    const z = await joueur(transport, 'z', 'rts-snap', code)
    await tick(40)
    for (let i = 0; i < 4; i++) { x.partie.move('bouger', { dx: 1 }); y.partie.move('bouger', { dx: 2 }); await tick(30) }
    // le serveur garde un instantané dont le tick suit au moins un ordre
    let r: any = null
    for (let essai = 0; essai < 60; essai++) {
      r = await x.sock.request('µgame:resync', { game: x.partie.state.gameId, snapshots: true })
      if (r.snapshot && r.snapshot.tick >= 16) break
      await tick(25)
    }
    assert.ok(r.snapshot, 'aucun instantané gardé : '+ JSON.stringify(Object.keys(r)))
    assert.ok(r.snapshot.state.n > 0, 'l\'instantané porte des ordres déjà appliqués')
    const etats: any[] = []
    z.partie.on('state', (f: any) => etats.push(f))
    const avant = z.snaps.length
    ;(z.sock as any)._mjs_resyncGame(z.partie)
    await tick(60)
    assert.ok(etats.length > 0 && etats[0].snapshot, 'le resync de z porte l\'instantané')
    assert.ok(etats[0].journal.length === 0 || etats[0].journal[0].tick === etats[0].snapshot.tick + 1, 'journal coupé avant l\'instantané')
    const rejoues = z.snaps.slice(avant).filter((s: any) => s.tick <= (etats[0].journal.length ? etats[0].journal[etats[0].journal.length - 1].tick : etats[0].snapshot.tick))
    assert.deepEqual(rejoues, [], 'le rejeu du resync ne propose aucun instantané')
    for (let i = 0; i < 4; i++) { y.partie.move('bouger', { dx: 3 }); z.partie.move('bouger', { dx: 5 }); await tick(30) }
    await tick(120)
    assert.equal(x.etat.n, 16, 'tous les ordres appliqués')
    assert.equal(texte(z), texte(x), 'z (resynchronisé depuis l\'instantané) = x')
    assert.equal(texte(y), texte(x))
    for (const j of [x, y, z]) {
      assert.ok(j.snaps.length > 0, 'chaque joueur propose ses instantanés')
      for (const s of j.snaps) {
        assert.equal(s.tick % 8, 0, 'cadence annoncée par le serveur')
        assert.equal(s.opts?.volatile, true, 'jamais mis en file hors ligne')
        assert.ok(Number.isInteger(s.rng) && s.rng >= 0 && s.rng < 2 ** 32, 'état du générateur : entier 32 bits')
      }
    }
    await app.stop()
  })

  it('un état plus gros que la trame permise n\'est pas proposé : pas de coupure, une seule erreur dans la console', async () => {
    const { transport, app } = await startApp({ limits: { maxPayload: 2048 } })
    app.game('rts-gros', { mode: 'lockstep', seats: 2, code: true, tick: 40, seatTtl: 300, emptyTtl: 5000, moves: {}, lockstepJournal: { snapshotEvery: 4 } } as any)
    const gros = () => ({ n: 0, somme: 0, unites: {}, decor: 'x'.repeat(1500) })
    const x = await joueur(transport, 'x', 'rts-gros', true, gros)
    const y = await joueur(transport, 'y', 'rts-gros', x.partie.state.code, gros)
    await tick(300)
    x.partie.move('bouger', { dx: 1 })
    await tick(100)
    assert.deepEqual(x.snaps, [], 'aucune proposition envoyée')
    assert.equal(x.sock.state, 'open', 'x reste connecté')
    assert.equal(x.etat.n, 1, 'les ordres arrivent toujours')
    assert.equal(y.etat.n, 1)
    const erreurs = x.erreurs.filter(e => /instantané/.test(e))
    assert.equal(erreurs.length, 1, JSON.stringify(x.erreurs))
    assert.match(erreurs[0], /1024/)
    await app.stop()
  })

  it('sans réseau : un second client qui part de l\'instantané d\'un premier tire ensuite les mêmes nombres', () => {
    const fake = (): any => {
      const handlers: Record<string, Function[]> = {}
      const g: any = { _mjs_gameId: 'g1', _mjs_handlers: handlers, envois: [] as any[], _hash() {}, _snapshot(tick: number, state: any, rng: number) { g.envois.push({ tick, state: JSON.parse(JSON.stringify(state)), rng }) } }
      g.on = (evt: string, fn: Function) => { (handlers[evt] || (handlers[evt] = [])).push(fn); return () => {} }
      g.emit = (evt: string, frame: any) => { (handlers[evt] || []).slice().forEach(fn => fn(frame)) }
      return g
    }
    const µ = makeMu()
    const ordres = (t: number) => ({ tick: t, orders: [{ player: 'a', move: 'm', p: { dx: t } }, { player: 'b', move: 'm', p: { dx: 1 } }] })
    const nouveau = (g: any) => { const e: any = µ.lockstep(g, { state0: () => ({ n: 0, somme: 0, unites: {} }), apply: (s: any, o: any) => { s.n++; s.somme += e.rng.int(1, 1000) + Math.floor(e.rng.next() * 1000); s.unites[o.player] = (s.unites[o.player] || 0) + o.p.dx }, every: 0 }); return e }
    const g1 = fake()
    const e1 = nouveau(g1)
    g1.emit('start', { game: 'g1', seed: 42, journal: [], snapshotEvery: 3, snapshotMax: 100000 })
    for (let t = 1; t <= 6; t++) g1.emit('orders', { game: 'g1', ...ordres(t) })
    assert.deepEqual(g1.envois.map((s: any) => s.tick), [3, 6])
    const snap = g1.envois[1]
    const g2 = fake()
    const e2 = nouveau(g2)
    g2.emit('state', { game: 'g1', seed: 42, snapshot: snap, journal: [ordres(7), ordres(8)], snapshotEvery: 3, snapshotMax: 100000 })
    assert.deepEqual(g2.envois, [], 'le rejeu ne propose rien')
    for (let t = 7; t <= 9; t++) g1.emit('orders', { game: 'g1', ...ordres(t) })
    g2.emit('orders', { game: 'g1', ...ordres(9) })
    assert.equal(JSON.stringify(e2), JSON.stringify(e1))
    assert.deepEqual(g2.envois, [g1.envois[2]], 'même proposition au tick 9, générateur compris')
  })
})
