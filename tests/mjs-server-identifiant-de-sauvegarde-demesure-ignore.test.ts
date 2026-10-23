// Une sauvegarde illisible dont l'id dépasse la précision des nombres (`game99999999999999999999`) ne relève plus le compteur
// d'identifiants : au-delà de 2^53, `++` ne bougeait plus et toutes les parties neuves recevaient le même id — la seconde écrasait
// la première au registre (son joueur ne la retrouvait plus) et dans le stockage. Seuls les ids de 15 chiffres au plus sont retenus.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, MemoryPersistAdapter } from '../src/mjs-server/index.js'
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

describe('MJS-Server — un id de sauvegarde démesuré n empoisonne pas les ids neufs', () => {
  for (const demesure of ['game99999999999999999999', 'game9007199254740993', 'game1000000000000000']) {
    it('sauvegarde illisible « ' + demesure + ' » : deux parties neuves, deux ids, chacune retrouvée par son joueur', async () => {
      const store = new MemoryPersistAdapter()
      store.save(demesure, { id: demesure, type: 'compteur' } as any)
      const transport = new MemoryTransport()
      const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: store, onLog: () => {} })
      await app.listen()
      app.game('compteur', { seats: 2, code: true, state: () => ({ n: 0 }), moves: {} })
      const a = await connecter(transport, 'a')
      const b = await connecter(transport, 'b')
      const r1 = await a.request('µgame:play', { type: 'compteur', code: true })
      const r2 = await b.request('µgame:play', { type: 'compteur', code: true })
      assert.notEqual(r1.game, r2.game)
      assert.match(r1.game, /^game\d{1,15}$/)
      assert.equal((await a.request('µgame:resync', { game: r1.game })).game, r1.game)
      assert.equal((await b.request('µgame:resync', { game: r2.game })).game, r2.game)
      await app.stop()
    })
  }
})
