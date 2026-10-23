// Avec `deltas: true`, un changement de phase ou de tour SANS changement de vue part en trame « méta seule » (ni `view` ni
// `delta`, cf. mjs-server-deltas-meta.test.ts). Le client remplaçait alors sa vue par `undefined` : le store perdait tous les
// champs de la vue, et le delta suivant se posait sur une vue vide (vue amputée pour de bon). Une trame sans vue laisse
// maintenant la vue d'avant en place. Vrai serveur MJS-Server + vrai client sock.game, MemoryTransport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const gameSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const clientSrc = socketSrc + '\n' + gameSrc
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

describe('sock.game — trame de phase ou de tour sans vue (deltas)', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un seul siège ; la vue est assez grosse pour que le delta d'un coup reste sous le seuil de repli en vue complète
  async function solo(deltas: boolean) {
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth })
    app.game('solo', {
      seats: 1,
      code: true,
      deltas: deltas,
      state: () => ({ n: 5, texte: 'visible', remplissage: 'x'.repeat(200) }),
      phases: { jeu: ['passe', 'tour', 'inc'], fin: [] },
      turns: { order: 'roundrobin' },
      moves: {
        passe: (game: any) => { game.to('fin') },
        tour:  (game: any) => { game.next() },
        inc:   (game: any) => { game.state.n++ },
      },
      view: (game: any) => ({ n: game.state.n, texte: game.state.texte, remplissage: game.state.remplissage }),
    })
    await app.listen()
    const sock = makeClient(transport, 'hote'); await tick()
    const frames: any[] = []
    sock.on('µgame:state', (p: any) => frames.push({ hasView: 'view' in p, hasDelta: 'delta' in p, phase: p.phase, turn: p.turn }))
    const game = sock.game('solo', { code: true })
    await until(() => game.state.status === 'playing', 'la poignée est assise')
    return { game, frames }
  }

  it('un changement de phase seul garde la vue du client', async () => {
    const { game, frames } = await solo(true)
    await game.move('inc')
    await until(() => game.state.n === 6, 'le delta de vue est appliqué')
    frames.length = 0
    await game.move('passe')
    await until(() => game.state.phase === 'fin', 'la nouvelle phase est connue')
    assert.deepEqual(frames, [{ hasView: false, hasDelta: false, phase: 'fin', turn: null }], 'la trame de phase seule ne porte ni vue ni delta')
    assert.equal(game.state.n, 6, 'la vue a été perdue : state.n = ' + game.state.n)
    assert.equal(game.state.texte, 'visible', 'la vue a été perdue : state.texte = ' + game.state.texte)
  })

  it('un changement de tour seul garde la vue du client', async () => {
    const { game, frames } = await solo(true)
    frames.length = 0
    await game.move('tour')
    await until(() => game.state.turn != null, 'le nouveau tour est connu')
    assert.equal(frames.length, 1)
    assert.equal(frames[0].hasView || frames[0].hasDelta, false, 'la trame de tour seul ne porte ni vue ni delta')
    assert.equal(game.state.n, 5, 'la vue a été perdue : state.n = ' + game.state.n)
    assert.equal(game.state.texte, 'visible')
  })

  it('un delta de vue après une trame de méta seule complète la vue d\'avant, il ne la reconstruit pas à vide', async () => {
    const { game } = await solo(true)
    await game.move('tour')
    await until(() => game.state.turn != null, 'le nouveau tour est connu')
    await game.move('inc')
    await until(() => game.state.n === 6, 'le delta de vue est appliqué')
    assert.equal(game.state.texte, 'visible', 'vue amputée durablement : state.texte = ' + game.state.texte)
    assert.equal(game.state.remplissage, 'x'.repeat(200))
  })

  it('sans deltas, un changement de phase seul garde la vue (la trame porte toujours la vue)', async () => {
    const { game } = await solo(false)
    await game.move('inc')
    await until(() => game.state.n === 6, 'la vue complète est appliquée')
    await game.move('passe')
    await until(() => game.state.phase === 'fin', 'la nouvelle phase est connue')
    assert.equal(game.state.n, 6)
    assert.equal(game.state.texte, 'visible')
  })
})
