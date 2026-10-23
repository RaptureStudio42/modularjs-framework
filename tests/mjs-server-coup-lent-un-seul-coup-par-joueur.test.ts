// Un coup asynchrone plus lent que limits.moveWaitMs (un appel externe lent, pas infini) : sa requête reçoit une erreur à
// l'échéance, ce qui libère l'onglet, et le coup continue sur le serveur. Le joueur rejouait aussitôt, du même onglet ou d'un
// autre : le nouveau coup passait (c'était encore son tour), puis le premier se réglait et s'appliquait aussi — deux coups dans
// son tour, l'effet compté deux fois, le tour de l'adversaire sauté. Tant que le coup précédent n'est pas réglé, un nouveau
// coup du même joueur est refusé ; le reste (resynchroniser, partir, discuter) passe
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

const issue = (p: Promise<any>) => p.then(() => 'acquitté', (e: any) => 'refusé : ' + String(e?.message ?? e))

// deux joueurs, tour par tour ; le premier achat du joueur a dure 500 ms (prestataire lent), moveWaitMs 200
async function partie(): Promise<{ app: any; transport: MemoryTransport; a: any; b: any; game: string }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
  await app.listen()
  let lent = true
  app.game('achat', { seats: 2, code: true, limits: { moveWaitMs: 200 }, state: () => ({ coups: [] as string[], or: 100 }), view: (g: any) => g.state,
    turns: { order: 'roundrobin', timeout: 600000 }, hooks: { onJoin: (g: any) => { if (g.players.every((x: any) => x)) g.next() } },
    moves: {
      acheter: async (g: any, j: any, tag: string) => { const d = lent ? 500 : 10; lent = false; await tick(d); g.state.or -= 30; g.state.coups.push(j.id + ':' + tag); g.next() },
      passer: (g: any, j: any) => { g.state.coups.push(j.id + ':passe'); g.next() },
    } })
  const a = await connecter(transport, 'a')
  const b = await connecter(transport, 'b')
  const r = await a.request('µgame:play', { type: 'achat', code: true })
  await b.request('µgame:play', { type: 'achat', code: r.code })
  return { app, transport, a, b, game: r.game }
}

describe('MJS-Server — coup plus lent que limits.moveWaitMs : jamais deux coups du même joueur à la fois', function() {
  this.timeout(10000)

  it('même onglet : après l erreur, le coup rejoué est refusé ; l onglet resynchronise ; un seul coup s applique', async () => {
    const { app, a, b, game } = await partie()
    const premier = await issue(a.request('µgame:move', { game, move: 'acheter', p: 'essai-1' }))
    assert.match(premier, /^refusé : votre coup 'acheter' est resté sans réponse pendant 200 ms/)
    assert.doesNotMatch(premier, /ne l'attendent plus/)
    assert.equal(await issue(a.request('µgame:move', { game, move: 'acheter', p: 'essai-2' })), 'refusé : votre coup précédent est encore en cours')
    const pendant = await a.request('µgame:resync', { game })
    assert.deepEqual(pendant.view.coups, [], 'l onglet resynchronise pendant le coup lent')
    await tick(400)
    const fin = await b.request('µgame:resync', { game })
    assert.deepEqual(fin.view.coups, ['a:essai-1'], 'un seul coup appliqué')
    assert.equal(fin.view.or, 70)
    assert.equal(fin.turn, 'b', 'le tour passe à l adversaire')
    assert.equal(await issue(b.request('µgame:move', { game, move: 'passer' })), 'acquitté')
    assert.equal(await issue(a.request('µgame:move', { game, move: 'acheter', p: 'essai-3' })), 'acquitté', 'le coup réglé, le joueur rejoue normalement')
    await app.stop()
  })

  it('autre onglet : le coup en attente derrière le coup lent est refusé à l échéance, jamais joué en même temps', async () => {
    const { app, transport, a, b, game } = await partie()
    const a2 = await connecter(transport, 'a')
    await a2.request('µgame:resync', { game })
    const premier = issue(a.request('µgame:move', { game, move: 'acheter', p: 'essai-1' }))
    await tick(50)
    assert.equal(await issue(a2.request('µgame:move', { game, move: 'acheter', p: 'essai-2' })), 'refusé : votre coup précédent est encore en cours')
    assert.match(await premier, /^refusé : votre coup 'acheter' est resté sans réponse/)
    await tick(400)
    const fin = await b.request('µgame:resync', { game })
    assert.deepEqual(fin.view.coups, ['a:essai-1'], 'un seul coup appliqué')
    assert.equal(fin.turn, 'b')
    await app.stop()
  })
})
