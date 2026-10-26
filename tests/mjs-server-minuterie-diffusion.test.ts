// Une minuterie applicative (def.timers) ou hooks.onTurnTimeout qui change l'état doit être diffusée aux joueurs et
// sauvegardée, comme après un coup : la partie est marquée « modifiée » après l'appel (et, si la minuterie rend une Promise,
// après sa résolution). Sans cela le serveur avait un état que ni les clients ni la sauvegarde ne voyaient. Vrai serveur
// MJS-Server + vrai client µ.socket (MemoryTransport) + adaptateur de sauvegarde espion ; les durées sont courtes.
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

describe('MJS-Server — minuterie qui change l\'état : diffusion et sauvegarde', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un seul siège ; l'adaptateur espion note chaque sauvegarde, `views` note chaque vue diffusée à l'hôte
  async function solo(def: Record<string, any>) {
    const saves: number[] = []
    const spy = { load: async () => [], save: (_id: string, data: any) => { saves.push(JSON.parse(JSON.stringify(data.state)).n) }, remove: () => {} }
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })   // journal muet : le throw du test est voulu
    app.game('solo', { seats: 1, code: true, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }), ...def })
    await app.listen()
    const host = makeClient(transport, 'hote'); await tick()
    const views: number[] = []
    host.on('µgame:state', (p: any) => views.push(p.view.n))
    const created = await host.request('µgame:play', { type: 'solo', code: true })
    await tick(60)   // laisse passer la diffusion et la sauvegarde de l'arrivée
    return { host, created, views, saves }
  }

  it('def.timers qui change l\'état : le client reçoit la nouvelle vue', async () => {
    const { host, created, views } = await solo({ moves: { arme: (game: any) => { game.timer('rappel', 30) } }, timers: { rappel: (game: any) => { game.state.n++ } } })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => views[views.length - 1] === 1, 'la vue n = 1 est diffusée après la minuterie')
  })

  it('def.timers qui change l\'état : la partie est sauvegardée avec le nouvel état', async () => {
    const { host, created, saves } = await solo({ moves: { arme: (game: any) => { game.timer('rappel', 30) } }, timers: { rappel: (game: any) => { game.state.n++ } } })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => saves.includes(1), 'une sauvegarde porte n = 1 : ' + JSON.stringify(saves))
  })

  it('hooks.onTurnTimeout qui ne fait que muter l\'état (sans next ni to) : la vue est diffusée', async () => {
    const { host, created, views } = await solo({
      turns: { order: 'roundrobin', timeout: 30 },
      moves: { go: (game: any) => { game.next() } },
      hooks: { onTurnTimeout: (game: any) => { game.state.n++ } },
    })
    await host.request('µgame:move', { game: created.game, move: 'go' })   // arme la minuterie de tour
    await until(() => views[views.length - 1] === 1, 'la vue n = 1 est diffusée après le hook de tour')
  })

  it('hooks.onTurnTimeout qui ne fait que muter l\'état : la partie est sauvegardée', async () => {
    const { host, created, saves } = await solo({
      turns: { order: 'roundrobin', timeout: 30 },
      moves: { go: (game: any) => { game.next() } },
      hooks: { onTurnTimeout: (game: any) => { game.state.n++ } },
    })
    await host.request('µgame:move', { game: created.game, move: 'go' })
    await until(() => saves.includes(1), 'une sauvegarde porte n = 1 : ' + JSON.stringify(saves))
  })

  it('une minuterie qui rend une Promise : la vue est diffusée aussi quand l\'état change après l\'attente', async () => {
    const { host, created, views } = await solo({
      moves: { arme: (game: any) => { game.timer('rappel', 20) } },
      timers: { rappel: (game: any) => (new Promise<void>(resolve => setTimeout(resolve, 40))).then(() => { game.state.n++ }) },
    })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => views[views.length - 1] === 1, 'la vue n = 1 est diffusée après la résolution de la Promise')
  })

  it('une minuterie qui lève après avoir changé l\'état : le changement est tout de même diffusé', async () => {
    const { host, created, views } = await solo({
      moves: { arme: (game: any) => { game.timer('rappel', 20) } },
      timers: { rappel: (game: any) => { game.state.n++; throw new Error('boum') } },
    })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => views[views.length - 1] === 1, 'la vue n = 1 est diffusée malgré le throw')
  })

  it('contraste : le même changement fait par un coup est diffusé et sauvegardé', async () => {
    const { host, created, views, saves } = await solo({ moves: { inc: (game: any) => { game.state.n++ } } })
    await host.request('µgame:move', { game: created.game, move: 'inc' })
    await until(() => views[views.length - 1] === 1 && saves.includes(1), 'le coup est diffusé et sauvegardé')
  })
})
