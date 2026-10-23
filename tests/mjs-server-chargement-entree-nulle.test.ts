// Un adaptateur de persistance maison (contrat public) dont load() rend une entrée `null` : l'entrée est ignorée avec un avertissement,
// app.listen() démarre et restaure les autres. La déstructuration de l'entrée se faisait hors de toute protection : le serveur ne
// démarrait pas. Chaîne réelle : vrai serveur MJS-Server, vrai client µ.socket (MemoryTransport).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

const valide = { id: 'game7', type: 'compteur', code: null, state: { n: 4 }, phase: null, turn: null, seq: 4, journal: [], seats: [{ seat: 0, id: 'a', connected: false }, null], timers: [] }

describe('MJS-Server — load() d\'un adaptateur maison qui rend une entrée null', function () {
  this.timeout(10000)

  it('l\'entrée null est ignorée avec un avertissement, app.listen() démarre et restaure l\'entrée valide', async () => {
    const logs: Array<[string, string]> = []
    const transport = new MemoryTransport()
    const app = mjsServer({
      transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (niveau: string, msg: string) => { logs.push([niveau, msg]) },
      persist: { async load() { return [null, { id: 'game7', data: valide }, undefined] as any }, save() {}, remove() {} },
    })
    app.game('compteur', { seats: 2, state: () => ({ n: 0 }), view: (game: any) => game.state, moves: {} })
    let demarrage = 'démarré'
    try { await app.listen() } catch (err) { demarrage = 'app.listen() a levé : ' + err }
    if (demarrage !== 'démarré') {
      await app.stop().catch(() => {})
      assert.fail(demarrage)
    }
    try {
      assert.equal(logs.filter(([niveau, msg]) => niveau === 'warn' && msg.includes('persist')).length, 2, 'un avertissement par entrée vide : ' + JSON.stringify(logs))
      const sock = makeClient(transport, 'a')
      await tick()
      assert.deepEqual((await sock.request('µgame:resync', { game: 'game7' })).view, { n: 4 }, 'l\'entrée valide n\'a pas été restaurée')
    }
    finally {
      await app.stop()
    }
  })
})
