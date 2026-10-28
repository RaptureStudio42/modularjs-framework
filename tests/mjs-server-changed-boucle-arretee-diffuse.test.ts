// game.changed() sur une partie finie dont un siège est encore connecté : le joueur reçoit le changement, et la partie est
// sauvegardée. En mode action, la diffusion appartient à la boucle de tick, que la fin de la partie arrête : le changement était
// sauvegardé mais ne partait jamais vers le joueur encore là (un règlement fait après la fin restait invisible). Quand la boucle est
// arrêtée, game.changed() diffuse lui-même, une fois par microtâche comme en mode événementiel. Vrai serveur MJS-Server + vrai
// client µ.socket (MemoryTransport) + adaptateur de sauvegarde espion.
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

describe('MJS-Server — game.changed() sur une partie finie diffuse au siège encore connecté', function () {
  this.timeout(10000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un siège, partie finie par le coup `fin` ; `views` note chaque vue reçue par l'hôte, `saves` chaque sauvegarde
  async function finished(tickHz: number) {
    const saves: any[] = []
    const spy = { load: async () => [], save: (_id: string, data: any) => { saves.push(JSON.parse(JSON.stringify(data))) }, remove: () => {} }
    const transport = new MemoryTransport()
    let live: any = null
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })
    app.game('solo', {
      seats: 1, code: true, tick: tickHz, endTtl: 5000, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }),
      moves: { fin: (game: any) => { game.end({ ok: 1 }) } }, hooks: { onCreate: (game: any) => { live = game } },
    } as any)
    await app.listen()
    const host  = makeClient(transport, 'hote'); await tick()
    const views: number[] = []
    host.on('µgame:state', (p: any) => { if (p.view) views.push(p.view.n) })
    const created = await host.request('µgame:play', { type: 'solo', code: true })
    await host.request('µgame:move', { game: created.game, move: 'fin' })
    await tick(80)
    return { saves, views, game: live }
  }

  for (const tickHz of [0, 20]) {
    it((tickHz ? 'mode action' : 'mode événementiel') + ' : le changement annoncé après la fin part au joueur encore connecté et il est sauvegardé', async () => {
      const { saves, views, game } = await finished(tickHz)
      assert.equal(game._tickHandle, null, 'la boucle de tick tourne encore après la fin')
      game.state.n = 8
      game.changed()
      await until(() => saves.some(save => save.state.n === 8), 'le changement est sauvegardé')
      await tick(40)
      assert.ok(views.includes(8), 'le joueur encore connecté ne reçoit jamais le changement annoncé par game.changed() (vues reçues : ' + JSON.stringify(views) + ')')
    })
  }

  it('mode action, partie finie : deux game.changed() dans la même microtâche ne font qu\'une diffusion, avec le dernier état', async () => {
    const { views, game } = await finished(20)
    const before = views.length
    game.state.n = 8
    game.changed()
    game.state.n = 9
    game.changed()
    await tick(60)
    assert.deepEqual(views.slice(before), [9], 'diffusions reçues après les deux annonces : ' + JSON.stringify(views.slice(before)))
  })
})
