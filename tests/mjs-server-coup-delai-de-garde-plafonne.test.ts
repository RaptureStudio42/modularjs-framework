// limits.moveWaitMs ne dépasse pas 2 147 483 647 ms (environ 24,8 jours, le plus long délai d'une minuterie Node) : au-delà, la
// déclaration du jeu est refusée avec un message clair. Avant, une valeur plus grande (30 jours, écrite pour dire « jamais ») était
// acceptée : Node ramenait le délai à 1 ms et la garde qui fait passer les coups d'un même joueur un par un était coupée en silence —
// un 2e onglet jouait pendant le coup asynchrone du 1er, le joueur jouait deux fois dans son tour.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { setMessagesLang } from '../src/messages/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const MAX = 2147483647

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

const declarer = (moveWaitMs: unknown) => resolveGameDef('d', { seats: 2, state: () => ({}), moves: {}, limits: { moveWaitMs } } as any)

describe('MJS-Server — limits.moveWaitMs plafonné au plus long délai d une minuterie', function() {
  this.timeout(10000)

  it('au-delà de 2 147 483 647 ms, la déclaration est refusée, en français comme en anglais ; la valeur maximale est acceptée', () => {
    for (const valeur of [MAX + 1, 30 * 86400000, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => declarer(valeur), /limits\.moveWaitMs doit être un nombre fini > 0 et au plus 2147483647/, String(valeur))
    }
    setMessagesLang('en')
    try {
      assert.throws(() => declarer(30 * 86400000), /limits\.moveWaitMs must be a finite number > 0 and at most 2147483647/)
    } finally {
      setMessagesLang('fr')
    }
    assert.equal((declarer(MAX).limits as any).moveWaitMs, MAX)
  })

  it('à la valeur maximale, le 2e onglet d un joueur attend encore la fin du coup asynchrone du 1er : un seul coup dans son tour', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('tour', { seats: 2, code: true, limits: { moveWaitMs: MAX }, state: () => ({ coups: [] as string[] }), view: (g: any) => g.state,
      turns: { order: 'roundrobin', timeout: 600000 }, hooks: { onJoin: (g: any) => { if (g.players.every((x: any) => x)) g.next() } },
      moves: { joue: async (g: any, _p: any, tag: string) => { await tick(200); g.state.coups.push(tag); g.next() } } })
    const a1 = await connecter(transport, 'a')
    const b  = await connecter(transport, 'b')
    const r = await a1.request('µgame:play', { type: 'tour', code: true })
    await b.request('µgame:play', { type: 'tour', code: r.code })
    const a2 = await connecter(transport, 'a')
    await a2.request('µgame:resync', { game: r.game })
    const p1 = a1.request('µgame:move', { game: r.game, move: 'joue', p: 'onglet1' }).then(() => 'acquitté', (e: any) => 'refusé : ' + String(e?.message ?? e))
    await tick(50)
    const p2 = a2.request('µgame:move', { game: r.game, move: 'joue', p: 'onglet2' }).then(() => 'acquitté', (e: any) => 'refusé : ' + String(e?.message ?? e))
    const [x1, x2] = await Promise.all([p1, p2])
    const fin = await b.request('µgame:resync', { game: r.game })
    assert.equal(x1, 'acquitté')
    assert.match(x2, /ce n'est pas votre tour/)
    assert.deepEqual(fin.view.coups, ['onglet1'])
    await app.stop()
  })
})
