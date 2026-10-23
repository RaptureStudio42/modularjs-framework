// µ.predict sur sock.game contre un vrai serveur MJS-Server : un coup joué pendant une coupure (refusé « offline »,
// jamais reçu par le serveur) est retiré de la prédiction — à la reprise, prédiction et serveur disent la même chose
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_game.ts', 'mjs_predict.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('µ.predict — coup refusé hors ligne', function() {
  this.timeout(10000)

  it('le coup refusé « offline » ne reste pas dans la prédiction après la reprise', async () => {
    const transport = new MemoryTransport()
    const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    await app.listen()
    app.game('net-jeu', { seats: 2, code: true, tick: 40, seatTtl: 5000, emptyTtl: 5000, deltas: true,
      state: () => ({ entites: {} }),
      intents: { bouger: (g: any, player: any, p: any) => { const e = g.state.entites[player.id]; if (e) e.x += p.dx || 0 } },
      moves: { direct: (g: any, player: any, p: any) => { const e = g.state.entites[player.id]; if (e) e.x += p.dx } },
      view: (g: any, player: any) => ({ entites: g.state.entites, moi: player && g.state.entites[player.id] ? g.state.entites[player.id] : null, bulk: 'remplissage-'.repeat(12) }),
      hooks: { onJoin: (g: any, player: any) => { g.state.entites[player.id] = { x: 0 } } } })
    const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
    const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
    const sock = µ.socket('memory://p', { auth: () => ({ id: 'p' }) })
    const game = sock.game('net-jeu', { code: true })
    await tick(80)
    const miroir = µ.predict(game, { fields: ['moi'], apply: (f: any, name: string, p: any) => { if (name === 'bouger') f.moi.x += p.dx } })
    game.move('bouger', { dx: 1 })
    await tick(200)
    assert.equal(game.state.moi.x, 1)
    sock._mjs_ws.close(1006)
    let refus: any = null
    game.move('bouger', { dx: 1 }).catch((e: any) => { refus = e })
    await tick(10)
    assert.equal(refus && refus.code, 'offline', 'le coup hors ligne est bien refusé à l appelant')
    await tick(1500)
    assert.equal(sock.state, 'open')
    assert.equal(game.state.moi.x, 1)
    assert.equal(miroir.moi.x, game.state.moi.x, 'la prédiction garde un coup que le serveur n a jamais reçu')
    miroir.stop()
    await app.stop()
  })
})
