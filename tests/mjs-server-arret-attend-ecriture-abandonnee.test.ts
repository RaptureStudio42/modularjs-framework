// app.stop() et une écriture abandonnée (restée sans réponse dans son délai) qui n'a pas encore répondu. Elle pouvait aboutir après
// l'arrêt, par-dessus la sauvegarde plus récente : le coup n°2, acquitté et sauvé, revenait à n=1 au redémarrage. L'arrêt attend
// désormais, avant sa dernière rafale, les écritures abandonnées encore sans réponse — chacune au plus le délai d'une écriture après
// son abandon — et réécrit l'état courant de la partie quand l'une d'elles a pu remplacer un état plus récent. Une écriture qui ne
// répond jamais ne retient pas l'arrêt au-delà de cette borne. Vrai serveur MJS-Server, vrai client µ.socket/µ.game (MemoryTransport)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const gameSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function clientMu(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc + '\n' + gameSrc)(µ)
  return µ
}

const def = () => ({ seats: 1, code: true, emptyTtl: 60000, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }), moves: { inc: (g: any) => { g.state.n++ } } })

describe('MJS-Server — app.stop() attend une écriture abandonnée encore sans réponse avant sa dernière rafale', function () {
  this.timeout(20000)
  const apps: any[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  // stockage texte ; la sauvegarde de n=1 ne répond qu'au bout de `retard` ms (Infinity : jamais) ; délai d'une écriture : 100 ms
  // déclarés + 1 s de marge = 1,1 s
  function stockage(retard: number) {
    const store = new Map<string, string>()
    let lent = true
    const adapter = {
      writeTimeoutMs: 100,
      load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
      save:   (id: string, data: any) => {
        const txt = JSON.stringify(data)
        if (data.state.n === 1 && lent) {
          lent = false
          return new Promise<void>(r => { if (retard !== Infinity) setTimeout(() => { store.set(id, txt); r() }, retard) })
        }
        store.set(id, txt)
      },
      remove: (id: string) => { store.delete(id) },
    }
    const stocke = () => JSON.parse([...store.values()][0]).state.n
    return { adapter, stocke }
  }
  async function serve(transport: MemoryTransport, adapter: any, logs: string[]) {
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: (l: string, m: string) => { logs.push(l + ' ' + m) } } as any)
    apps.push(app)
    app.game('jeu', def())
    await app.listen()
    return app
  }
  // coup n°1 (sa sauvegarde reste sans réponse, abandonnée à 1,1 s), coup n°2 acquitté et sauvé, puis app.stop()
  async function deuxCoupsPuisArret(retard: number) {
    const { adapter, stocke } = stockage(retard)
    const logs: string[] = []
    const transport = new MemoryTransport()
    const app  = await serve(transport, adapter, logs)
    const µ    = clientMu(transport)
    const sock = µ.socket('memory://x', { auth: () => ({ id: 'x' }), reconnect: { enabled: false } })
    const h    = sock.game('jeu', { code: true })
    await attendre(() => h.state.status === 'playing', 'partie en cours')
    await h.move('inc')
    await attendre(() => logs.some(l => l.includes('écriture abandonnée')), 'sauvegarde de n=1 abandonnée')
    await h.move('inc')
    await attendre(() => stocke() === 2, 'coup n°2 sauvé')
    apps.splice(apps.indexOf(app), 1)
    const t0 = Date.now()
    await app.stop()
    return { adapter, stocke, logs, duree: Date.now() - t0, sock, h }
  }

  it('l\'écriture abandonnée répond pendant l\'arrêt : l\'arrêt l\'attend, réécrit l\'état courant, et le redémarrage reprend le coup n°2', async () => {
    const { adapter, stocke, logs, sock, h } = await deuxCoupsPuisArret(1900)
    assert.equal(stocke(), 2, 'juste après app.stop() : n=2')
    await tick(800)
    assert.equal(stocke(), 2, 'plus tard : toujours n=2 (rien n\'arrive après l\'arrêt)')
    assert.ok(!logs.some(l => l.includes('pendant l\'arrêt')), 'aucune écriture tardive après la dernière rafale : ' + JSON.stringify(logs))
    // redémarrage : le joueur revenu retrouve le coup n°2
    const vu = h.state.seq
    const transport = new MemoryTransport()
    ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    await serve(transport, adapter, [])
    sock.connect()
    await attendre(() => h.state.seq > vu, 'reprise après le redémarrage')
    assert.equal(h.state.n, 2, 'restauré : le coup n°2')
    sock.destroy()
  })

  it('l\'écriture abandonnée ne répond jamais : l\'arrêt ne l\'attend pas au-delà du délai d\'une écriture après son abandon', async () => {
    const { stocke, duree, sock } = await deuxCoupsPuisArret(Infinity)
    assert.equal(stocke(), 2, 'n=2 gardé')
    assert.ok(duree < 1600, 'arrêt borné : ' + duree + ' ms (abandon il y a plus de 0,2 s, délai d\'une écriture 1,1 s)')
    sock.destroy()
  })
})
