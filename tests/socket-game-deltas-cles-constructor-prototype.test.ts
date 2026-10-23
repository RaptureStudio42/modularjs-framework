// Deltas (def.deltas) : une clé « constructor » ou « prototype » (le pseudo d'un joueur, par exemple) suit côté client. Le client
// refuse de suivre ces segments dans un chemin à points (garde contre la pollution de prototype) et jetait l'opération en silence :
// son store gardait l'ancienne valeur alors que le serveur avait changé. L'objet qui porte une telle clé part désormais en bloc.
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

describe('client de jeu — deltas d une clé constructor ou prototype', function() {
  this.timeout(10000)
  for (const pseudo of ['constructor', 'prototype']) {
    it('le score du joueur « ' + pseudo + ' » suit côté client, sans toucher aux prototypes', async () => {
      const transport = new MemoryTransport()
      const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
      await app.listen()
      app.game('tableau', { seats: 1, code: true, deltas: true, state: () => { const s: any = { scores: {}, bulk: 'remplissage-'.repeat(12) }; s.scores[pseudo] = 0; s.scores.zoe = 0; return s }, view: (g: any) => g.state,
        moves: { marque: (g: any, _p: any, qui: string) => { g.state.scores[qui]++ } } })
      const h = client(transport, 'a').game('tableau', { code: true })
      await tick(40)
      await h.move('marque', pseudo)
      await h.move('marque', 'zoe')
      await h.move('marque', pseudo)
      await tick(40)
      const scores = h.state.scores
      assert.ok(Object.prototype.hasOwnProperty.call(scores, pseudo))
      assert.equal(scores[pseudo], 2)
      assert.equal(scores.zoe, 1)
      assert.equal(typeof ({} as any).constructor, 'function')
      assert.equal(({} as any).prototype, undefined)
      await app.stop()
    })
  }
})
