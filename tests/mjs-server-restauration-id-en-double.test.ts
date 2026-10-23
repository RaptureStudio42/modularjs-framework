// Deux sauvegardes du même identifiant rendues par load() (copie de sauvegarde dans le dossier de stockage, back qui rend un doublon) :
// la première est restaurée, la seconde ignorée avec un avertissement. Les deux étaient restaurées : la seconde prenait la place de la
// première dans le registre, l'orpheline, détruite à sa grâce, retirait du registre la partie vivante (le joueur reconnecté recevait
// « partie introuvable ») puis effaçait sa sauvegarde. Chaîne réelle : vrai serveur MJS-Server, vrai client µ.socket (MemoryTransport).
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

const instantane = (n: number) => ({ id: 'game3', type: 'compteur', code: null, state: { n }, phase: null, turn: null, seq: n, journal: [], seats: [{ seat: 0, id: 'a', connected: false }, null], timers: [] })

describe('MJS-Server — deux sauvegardes du même identifiant au démarrage', function () {
  this.timeout(10000)

  it('la première est restaurée et reste jouable, la seconde est ignorée avec un avertissement, rien n\'est effacé du stockage', async () => {
    const removes: string[] = []
    const logs: Array<[string, string, any]> = []
    const transport = new MemoryTransport()
    const app = mjsServer({
      transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: (niveau: string, msg: string, extra?: any) => { logs.push([niveau, msg, extra]) },
      persist: { async load() { return [{ id: 'game3', data: instantane(1) }, { id: 'game3', data: instantane(2) }] as any }, save() {}, remove(id: string) { removes.push(id) } },
    })
    app.game('compteur', { seats: 2, emptyTtl: 150, state: () => ({ n: 0 }), view: (game: any) => game.state, moves: { inc: (game: any) => { game.state.n++ } } })
    await app.listen()
    try {
      const sock = makeClient(transport, 'a')
      await tick()
      const repris = await sock.request('µgame:resync', { game: 'game3' })
      assert.deepEqual(repris.view, { n: 1 }, 'la partie reprise n\'est pas la première sauvegarde rendue par load()')
      // la grâce de partie vide (150 ms) de l'éventuelle orpheline est passée
      await tick(300)
      let coup = 'accepté'
      try { await sock.request('µgame:move', { game: 'game3', move: 'inc' }) } catch (err) { coup = 'refusé : ' + err }
      assert.equal(coup, 'accepté', 'la partie vivante a disparu du registre')
      assert.deepEqual(removes, [], 'la sauvegarde de la partie vivante a été effacée')
      const avertissement = logs.find(([niveau, msg, extra]) => niveau === 'warn' && msg.includes('game3') && /game3/.test(String(extra?.err)))
      assert.ok(avertissement, 'aucun avertissement ne nomme la sauvegarde en double : ' + JSON.stringify(logs))
    }
    finally {
      await app.stop()
    }
  })
})
