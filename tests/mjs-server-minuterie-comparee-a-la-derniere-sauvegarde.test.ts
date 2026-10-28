// À la fin de la Promise que rend une minuterie de l'appli, la partie est sauvegardée si elle diffère de sa DERNIÈRE sauvegarde, et
// non de l'état qu'elle avait juste après l'appel de la minuterie : un coup, ou une autre minuterie, qui change l'état pendant
// l'attente, puis la suite de la Promise qui le remet à la valeur d'avant, laissaient le stockage sur la valeur intermédiaire alors
// que la partie vivante était revenue en arrière (au redémarrage, la partie restaurée n'était plus celle que les joueurs voyaient).
// Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + stockage texte JSON, comme celui des adaptateurs fournis.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

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

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

describe('MJS-Server — la fin de la Promise d\'une minuterie est comparée à la dernière sauvegarde', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un siège ; `saves` garde une copie texte de chaque sauvegarde, `game()` rend la partie vivante
  async function solo(def: Record<string, any>) {
    const saves: any[] = []
    const spy = { load: async () => [], save: (_id: string, data: any) => { saves.push(JSON.parse(JSON.stringify(data))) }, remove: () => {} }
    const transport = new MemoryTransport()
    let live: any = null
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })
    app.game('solo', { seats: 1, code: true, hooks: { onCreate: (game: any) => { live = game } }, ...def } as any)
    await app.listen()
    const host    = makeClient(transport, 'hote'); await tick()
    const created = await host.request('µgame:play', { type: 'solo', code: true })
    const play    = (move: string) => host.request('µgame:move', { game: created.game, move })
    return { saves, play, game: () => live }
  }

  it('un coup change l\'état pendant l\'attente, la suite de la Promise le remet à la valeur d\'avant : le stockage suit la partie vivante', async () => {
    let settled = false
    const { saves, play, game } = await solo({
      state: () => ({ offer: null }),
      moves: { arme: (game: any) => { game.timer('purge', 10) }, offre: (game: any) => { game.state.offer = 'X' } },
      timers: { purge: (game: any) => new Promise<void>(resolve => setTimeout(resolve, 120)).then(() => { game.state.offer = null; settled = true }) },
    })
    await play('arme')
    await tick(40)   // la purge est partie, elle attend
    await play('offre')
    await until(() => saves.some(save => save.state.offer === 'X'), 'l\'offre faite pendant l\'attente est sauvegardée')
    await until(() => settled, 'la purge finit')
    await tick(150)
    assert.equal(game().state.offer, null)
    assert.equal(saves[saves.length - 1].state.offer, null, 'le stockage garde offer = ' + JSON.stringify(saves[saves.length - 1].state.offer) + ' alors que la partie vivante a offer = null')
  })

  it('une autre minuterie change l\'état pendant l\'attente, la suite de la Promise le remet : le stockage suit la partie vivante', async () => {
    let settled = false
    const { saves, play, game } = await solo({
      state: () => ({ n: 0 }),
      moves: { arme: (game: any) => { game.timer('a', 10); game.timer('b', 40) } },
      timers: {
        a: (game: any) => new Promise<void>(resolve => setTimeout(resolve, 120)).then(() => { game.state.n = 0; settled = true }),
        b: (game: any) => { game.state.n = 1 },
      },
    })
    await play('arme')
    await until(() => saves.some(save => save.state.n === 1), 'le changement de la minuterie b est sauvegardé')
    await until(() => settled, 'la minuterie a finit')
    await tick(150)
    assert.equal(game().state.n, 0)
    assert.equal(saves[saves.length - 1].state.n, 0, 'le stockage garde n = ' + saves[saves.length - 1].state.n + ' alors que la partie vivante a n = 0')
  })
})
