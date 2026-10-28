// Lockstep — une page qui ne sait pas lire un instantané, arrivée APRÈS une coupe du journal, repartait de son état initial avec un
// journal qui ne commence plus au tick 1 : « journal tronqué », et un état faux. Le client d'aujourd'hui se déclare
// (`snapshots: true` dans µgame:play et µgame:resync) ; une partie dont le journal est coupé refuse franchement la page qui ne se
// déclare pas — une erreur qui dit de recharger la page —, et la garde tant que rien n'est coupé. Vrai serveur MJS-Server
// (MemoryTransport) et vrais clients (µ.socket, sock.game, µ.lockstep) ; une page « d'avant » est simulée en retirant la
// déclaration de ses trames et en ne proposant aucun instantané, comme un client qui ne les connaît pas. Une page sans µ.lockstep (ni
// module 'lockstep', ni 'det') ne sait pas non plus repartir d'un instantané : elle ne se déclare pas, et elle était déclarée
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtime   = ['mjs_socket.ts', 'mjs_game.ts', 'mjs_det.ts', 'mjs_lockstep.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const sansLockstep = ['mjs_socket.ts', 'mjs_game.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const pause     = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// une seule fabrique de WebSocket pour tout le fichier, reposée avant chaque test (d'autres fichiers posent la leur) : chaque
// connexion `memory://<id>` relève ses trames sortantes, et celles d'une page d'avant perdent leur déclaration (µgame:snapshot
// jamais envoyé)
let transport: MemoryTransport
const anciennes = new Set<string>()
const sortants  = new Map<string, any[]>()
function fabrique(url: string, protocols?: any): any {
  const ws: any   = transport.connect({ url, protocols })
  const id        = url.replace('memory://', '')
  const envoyer   = ws.send.bind(ws)
  ws.send = (d: any) => {
    const m = JSON.parse(d)
    if (anciennes.has(id)) {
      if (m.t === 'µgame:snapshot') return
      if ((m.t === 'µgame:play' || m.t === 'µgame:resync') && m.p) { delete m.p.snapshots; d = JSON.stringify(m) }
    }
    if (!sortants.has(id)) sortants.set(id, [])
    sortants.get(id)!.push(m)
    return envoyer(d)
  }
  return ws
}

const DEF: any = { mode: 'lockstep', seats: 3, code: true, tick: 40, seatTtl: 300, emptyTtl: 5000, moves: {}, lockstepJournal: { snapshotEvery: 8 } }

describe('MJS-Server — lockstep : une page qui ne lit pas les instantanés, face à un journal coupé', function () {
  this.timeout(20000)
  let app: any = null
  let live: any = null
  beforeEach(async () => {
    ;(globalThis as any).WebSocket = fabrique
    transport = new MemoryTransport()
    anciennes.clear(); sortants.clear(); live = null
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    app.game('rts', { ...DEF, hooks: { onCreate: (g: any) => { live = g } } })
    await app.listen()
  })
  afterEach(async () => { await app.stop() })

  // un joueur : socket, partie, simulation lockstep ; `ancienne` : page d'avant
  async function joueur(id: string, code: any, ancienne = false) {
    if (ancienne) anciennes.add(id)
    const erreurs: string[] = []
    const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', runtime)(µ)
    const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
    sock.connect()
    await attendre(() => sock.state === 'open', id + ' connecté')
    const partie = sock.game('rts', { code })
    const etat: any = µ.lockstep(partie, {
      state0: () => ({ n: 0, somme: 0 }),
      apply: (s: any, o: any) => { s.n++; s.somme += etat.rng.int(1, 1000) + o.p.dx },
      every: 0,
    })
    await attendre(() => partie.state.status !== 'waiting', id + ' assis ou refusé')
    return { sock, partie, etat, erreurs }
  }
  const vue = (etat: any) => JSON.stringify({ n: etat.n, somme: etat.somme })

  // x, y, z assis ; quelques coups, puis attente d'un instantané gardé (journal coupé)
  async function partieCoupee() {
    const x = await joueur('x', true)
    const code = x.partie.state.code
    const y = await joueur('y', code)
    const z = await joueur('z', code)
    for (let i = 0; i < 4; i++) { x.partie.move('bouger', { dx: 1 }); y.partie.move('bouger', { dx: 2 }); await pause(30) }
    await attendre(() => live?._lockstep.snapshot()?.tick >= 8, { message: 'instantané gardé', delai: 5000 })
    return { x, y, z, code }
  }

  it('le client d\'aujourd\'hui se déclare dans µgame:play et dans µgame:resync', async () => {
    const x = await joueur('x', true)
    const play = sortants.get('x')!.find(m => m.t === 'µgame:play')
    assert.equal(play.p.snapshots, true)
    x.sock._mjs_ws.close(1006, 'coupure'); await pause(20)
    x.sock.connect()
    await attendre(() => sortants.get('x')!.some(m => m.t === 'µgame:resync'), 'resync parti')
    assert.equal(sortants.get('x')!.find(m => m.t === 'µgame:resync').p.snapshots, true)
    x.sock.destroy()
  })

  it('une page sans µ.lockstep ne se déclare ni dans µgame:play ni dans µgame:resync ; arrivée après la coupe, elle est refusée', async () => {
    const { x, y, code } = await partieCoupee()
    const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', sansLockstep)(µ)
    assert.equal(typeof µ.lockstep, 'undefined', 'page sans µ.lockstep')
    const sock = µ.socket('memory://w', { auth: () => ({ id: 'w' }), reconnect: { enabled: false } })
    sock.connect()
    await attendre(() => sock.state === 'open', 'w connecté')
    const partie = sock.game('rts', { code })
    await attendre(() => partie.state.status !== 'waiting', 'w assis ou refusé')
    const play = sortants.get('w')!.find(m => m.t === 'µgame:play')
    assert.equal('snapshots' in play.p, false, 'aucune déclaration dans µgame:play : ' + JSON.stringify(play.p))
    assert.equal(partie.state.status, 'error', 'refusée face au journal coupé')
    // une page sans µ.lockstep assise avant la coupe : son resync ne se déclare pas non plus
    const sock2 = µ.socket('memory://v', { auth: () => ({ id: 'v' }), reconnect: { enabled: false } })
    sock2.connect()
    await attendre(() => sock2.state === 'open', 'v connecté')
    sock2._mjs_resyncGame({ _mjs_gameId: x.partie.state.gameId, _mjs_status: 'playing', _mjs_handlers: {} })
    await attendre(() => (sortants.get('v') || []).some(m => m.t === 'µgame:resync'), 'resync parti')
    assert.equal('snapshots' in sortants.get('v')!.find(m => m.t === 'µgame:resync').p, false)
    sock.destroy(); sock2.destroy(); x.sock.destroy(); y.sock.destroy()
  })

  it('page d\'avant arrivée après la coupe : refusée, avec de quoi recharger ; son siège reste libre, les autres continuent', async () => {
    const { x, y, z, code } = await partieCoupee()
    z.partie.leave(); await pause(30)
    const w = await joueur('w', code, true)
    assert.equal(w.partie.state.status, 'error', 'refusée franchement')
    assert.match(String(w.partie.state.error), /rechargez la page/)
    assert.equal(live.players.filter(Boolean).length, 2, 'aucun siège pris')
    assert.deepEqual(w.erreurs.filter(e => e.includes('journal tronqué')), [], 'jamais de journal tronqué')
    x.partie.move('bouger', { dx: 3 }); y.partie.move('bouger', { dx: 4 }); await pause(150)
    assert.equal(vue(x.etat), vue(y.etat), 'x et y jouent toujours ensemble')
    for (const j of [x, y, z, w]) j.sock.destroy()
  })

  it('page d\'avant assise avant la coupe, déconnectée pendant : son resync est refusé, avec de quoi recharger', async () => {
    const x = await joueur('x', true)
    const code = x.partie.state.code
    const y = await joueur('y', code)
    const z = await joueur('z', code, true)
    z.sock._mjs_ws.close(1006, 'coupure'); await pause(30)
    for (let i = 0; i < 4; i++) { x.partie.move('bouger', { dx: 1 }); y.partie.move('bouger', { dx: 2 }); await pause(30) }
    await attendre(() => live?._lockstep.snapshot()?.tick >= 8, { message: 'instantané gardé, z absent', delai: 5000 })
    z.sock.connect()
    await attendre(() => z.partie.state.status === 'error', { message: 'resync de z refusé', delai: 3000 })
    assert.match(String(z.partie.state.error), /rechargez la page/)
    assert.deepEqual(z.erreurs.filter(e => e.includes('journal tronqué')), [], 'jamais de journal tronqué')
    for (const j of [x, y, z]) j.sock.destroy()
  })

  it('page d\'avant arrivée avant toute coupe : elle joue avec les autres, le journal reste entier tant qu\'elle est là', async () => {
    const x = await joueur('x', true)
    const code = x.partie.state.code
    const y = await joueur('y', code)
    const z = await joueur('z', code, true)
    assert.equal(z.partie.state.status, 'playing', 'acceptée tant que rien n\'est coupé')
    for (let i = 0; i < 6; i++) { x.partie.move('bouger', { dx: 1 }); z.partie.move('bouger', { dx: 5 }); await pause(40) }
    await pause(200)
    assert.equal(live._lockstep.snapshot(), null, 'aucun instantané gardé tant qu\'elle est assise')
    assert.equal(vue(z.etat), vue(x.etat))
    assert.equal(vue(y.etat), vue(x.etat))
    for (const j of [x, y, z]) j.sock.destroy()
  })

  it('page d\'aujourd\'hui arrivée après la coupe : assise, elle repart de l\'instantané et joue avec les autres', async () => {
    const { x, y, z, code } = await partieCoupee()
    z.partie.leave(); await pause(30)
    const w = await joueur('w', code)
    assert.equal(w.partie.state.status, 'playing')
    for (let i = 0; i < 3; i++) { w.partie.move('bouger', { dx: 5 }); y.partie.move('bouger', { dx: 3 }); await pause(30) }
    await pause(150)
    assert.equal(vue(w.etat), vue(x.etat))
    assert.deepEqual(w.erreurs, [])
    for (const j of [x, y, z, w]) j.sock.destroy()
  })
})
