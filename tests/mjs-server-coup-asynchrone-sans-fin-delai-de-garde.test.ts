// Les coups d'un même joueur passent un par un, mais un coup asynchrone qui ne se règle jamais (appel externe sans délai qui pend,
// bogue de l'appli) ne laisse plus le joueur sans réponse : passé limits.moveWaitMs (10 s par défaut) depuis son départ, son coup
// suivant — même depuis une nouvelle connexion — reçoit un refus clair (jamais deux coups du joueur à la fois) et le serveur le
// journalise. Avant, chaque coup suivant du joueur attendait sans fin, sans réponse, jusqu'à la destruction de la partie.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef } from '../src/mjs-server/index.js'
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

describe('MJS-Server — délai de garde d un coup asynchrone qui ne se règle jamais', () => {
  it('passé limits.moveWaitMs, le coup suivant du joueur reconnecté reçoit un refus clair (et le blocage est journalisé)', async () => {
    const journal: string[] = []
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: (niveau: string, message: string) => { journal.push(niveau + ' ' + message) } })
    await app.listen()
    app.game('lent', { seats: 2, code: true, state: () => ({ n: 0 }), view: (g: any) => g.state, turns: { order: 'roundrobin', timeout: 600000 }, limits: { moveWaitMs: 200 },
      hooks: { onJoin: (g: any) => { if (g.players.every((x: any) => x)) g.next() } },
      moves: { bloque: () => new Promise(() => {}), joue: (g: any) => { g.state.n++ } } })
    const a1 = await connecter(transport, 'a')
    const b  = await connecter(transport, 'b')
    const r = await a1.request('µgame:play', { type: 'lent', code: true })
    await b.request('µgame:play', { type: 'lent', code: r.code })
    await tick(10)
    a1.request('µgame:move', { game: r.game, move: 'bloque' }).catch(() => {})
    await tick(20)
    a1.close()
    await tick(20)
    const a2 = await connecter(transport, 'a')
    await a2.request('µgame:resync', { game: r.game })
    const issue = await Promise.race([
      a2.request('µgame:move', { game: r.game, move: 'joue' }).then(() => 'acquitté', (e: any) => 'refusé : ' + String(e?.message ?? e)),
      tick(1500).then(() => 'sans réponse après 1,5 s'),
    ])
    assert.equal(issue, 'refusé : votre coup précédent est encore en cours')
    assert.ok(journal.some(l => l.startsWith('warn') && l.includes("'bloque'") && l.includes('limits.moveWaitMs')), journal.join('\n'))
    await app.stop()
  })

  it('défaut 10 s ; une durée non finie ou ≤ 0 est refusée à la déclaration', () => {
    const def = resolveGameDef('d', { seats: 2, state: () => ({}), moves: {} } as any)
    assert.equal((def.limits as any).moveWaitMs, 10000)
    for (const valeur of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '200', null]) {
      assert.throws(() => resolveGameDef('d', { seats: 2, state: () => ({}), moves: {}, limits: { moveWaitMs: valeur } } as any), /limits\.moveWaitMs/, String(valeur))
    }
  })
})
