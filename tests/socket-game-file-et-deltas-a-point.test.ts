// sock.game contre un vrai serveur MJS-Server (MemoryTransport) : quitter la file publique avant d'être apparié prévient
// le serveur (le joueur suivant n'est pas apparié avec un fantôme) ; en mode deltas, une clé de vue qui contient un point
// (« jean.dupont ») reste juste dans le store du client
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_game.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function client(transport: MemoryTransport, id: string): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: any }> {
  const transport = new MemoryTransport()
  const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
  await app.listen()
  return { transport, app }
}

describe('sock.game — quitter la file publique', function() {
  this.timeout(10000)

  it('leave() avant d être apparié : le joueur suivant reste en attente', async () => {
    const { transport, app } = await demarrer()
    app.game('duel', { seats: 2, seatTtl: 5000, state: () => ({ coups: 0 }), moves: { jouer: (g: any) => { g.state.coups++; return { ok: true } } }, view: (g: any) => ({ coups: g.state.coups }) })
    const hx = client(transport, 'x').game('duel')
    await tick(30)
    assert.equal(hx.state.status, 'waiting')
    hx.leave()
    await tick(30)
    const ho = client(transport, 'o').game('duel')
    await tick(60)
    assert.equal(ho.state.status, 'waiting', 'O est apparié avec X, qui a pourtant quitté la file')
    await app.stop()
  })
})

describe('sock.game — deltas et clés de vue à point', function() {
  this.timeout(10000)

  it('clé « jean.dupont » sous un objet de la vue : le store suit le serveur', async () => {
    const { transport, app } = await demarrer()
    app.game('scores', { seats: 1, code: true, deltas: true,
      state: () => ({ scores: { 'jean.dupont': 0, zoe: 0 }, bulk: 'remplissage-'.repeat(12) }),
      moves: { marquer: (g: any) => { g.state.scores['jean.dupont']++; return { ok: true } } },
      view: (g: any) => ({ scores: g.state.scores, bulk: g.state.bulk }) })
    const h = client(transport, 'j').game('scores', { code: true })
    await tick(40)
    await h.move('marquer')
    await tick(40)
    assert.deepEqual(h.state.scores, { 'jean.dupont': 1, zoe: 0 })
    await app.stop()
  })

  it('clé « jean.dupont » à la racine de la vue : le store suit le serveur', async () => {
    const { transport, app } = await demarrer()
    app.game('racine', { seats: 1, code: true, deltas: true,
      state: () => ({ n: 0, bulk: 'remplissage-'.repeat(12) }),
      moves: { marquer: (g: any) => { g.state.n++; return { ok: true } } },
      view: (g: any) => ({ 'jean.dupont': g.state.n, bulk: g.state.bulk }) })
    const h = client(transport, 'r').game('racine', { code: true })
    await tick(40)
    await h.move('marquer')
    await tick(40)
    assert.equal(h.state['jean.dupont'], 1)
    assert.equal('jean' in h.state, false, 'un objet « jean » est né dans le store')
    await app.stop()
  })
})
