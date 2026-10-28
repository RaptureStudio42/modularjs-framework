// Une minuterie déclarée (def.timers) qui ne change rien — ni l'état, ni la phase, ni le tour, ni les sièges, ni les minuteries
// présentes (elle se réarme sous son propre nom), et qui ne termine pas la partie — ne fait pas sauvegarder la partie : une veille
// récurrente (toutes les 15 s, par exemple) écrivait à chaque échéance dans le stockage de l'appli. La vue est rediffusée comme avant
// (elle peut dépendre d'autre chose que l'état). Ce qu'une minuterie change, en revanche, est toujours diffusé et sauvegardé, à l'appel
// comme à la fin de la Promise qu'elle rend ; une minuterie qui part sans se réarmer fait sauvegarder la partie, puisqu'elle disparaît
// de ses minuteries. Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + adaptateur de sauvegarde espion ; les durées
// sont courtes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
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

describe('MJS-Server — une minuterie qui ne change rien ne fait pas sauvegarder la partie', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un siège ; l'adaptateur espion garde une copie de chaque sauvegarde, `views` note chaque vue diffusée à l'hôte
  async function solo(def: Record<string, any>) {
    const saves: any[] = []
    const spy = { load: async () => [], save: (_id: string, data: any) => { saves.push(JSON.parse(JSON.stringify(data))) }, remove: () => {} }
    const transport = new MemoryTransport()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })
    app.game('solo', { seats: 1, code: true, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }), ...def })
    await app.listen()
    const host = makeClient(transport, 'hote'); await tick()
    const views: number[] = []
    host.on('µgame:state', (p: any) => views.push(p.view.n))
    const created = await host.request('µgame:play', { type: 'solo', code: true })
    await tick(60)   // laisse passer la diffusion et la sauvegarde de l'arrivée
    return { host, created, views, saves }
  }

  // arme la minuterie par un coup, puis attend la sauvegarde de ce coup : le compte des sauvegardes et des vues part de là
  async function armed(host: any, created: any, saves: any[], views: number[]) {
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await tick(50)
    return { savesBefore: saves.length, viewsBefore: views.length }
  }

  it('une minuterie qui ne change rien et se réarme : la vue est rediffusée, la partie n\'est pas sauvegardée', async () => {
    let fired = 0
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { fired++; game.timer('veille', 60000) } } })
    const { savesBefore, viewsBefore } = await armed(host, created, saves, views)
    await until(() => fired === 1 && views.length > viewsBefore, 'la minuterie part et la vue est rediffusée')
    await tick(80)   // bien au-delà du débounce de la persistance (20 ms)
    assert.equal(saves.length, savesBefore, 'la minuterie qui ne change rien a fait sauvegarder la partie : ' + saves.length + ' sauvegardes au lieu de ' + savesBefore)
  })

  it('une veille récurrente qui ne fait que se réarmer : aucune sauvegarde à ses échéances', async () => {
    let fired = 0
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 70) } }, timers: { veille: (game: any) => { fired++; game.timer('veille', 30) } } })
    const { savesBefore } = await armed(host, created, saves, views)
    await until(() => fired >= 3, 'la veille part trois fois')
    await tick(60)
    assert.equal(saves.length, savesBefore, 'chaque échéance de la veille a fait sauvegarder la partie : ' + (saves.length - savesBefore) + ' sauvegardes de trop')
  })

  it('une minuterie qui se réarme, rend une Promise et ne change rien : aucune sauvegarde, ni à l\'appel ni à la fin de l\'attente', async () => {
    let settled = 0
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { game.timer('veille', 60000); return new Promise<void>(resolve => setTimeout(resolve, 30)).then(() => { settled++ }) } } })
    const { savesBefore } = await armed(host, created, saves, views)
    await until(() => settled === 1, 'la Promise de la minuterie se termine')
    await tick(80)
    assert.equal(saves.length, savesBefore, 'la minuterie asynchrone qui ne change rien a fait sauvegarder la partie')
  })

  it('contraste : une minuterie qui change l\'état est diffusée et sauvegardée', async () => {
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { game.state.n = 1 } } })
    await armed(host, created, saves, views)
    await until(() => views[views.length - 1] === 1 && saves.some(s => s.state.n === 1), 'n = 1 est diffusé et sauvegardé')
  })

  it('contraste : ce qu\'une minuterie change après l\'attente de sa Promise est diffusé et sauvegardé à la fin de l\'attente', async () => {
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => new Promise<void>(resolve => setTimeout(resolve, 30)).then(() => { game.state.n = 2 }) } })
    await armed(host, created, saves, views)
    await until(() => views[views.length - 1] === 2 && saves.some(s => s.state.n === 2), 'n = 2 est diffusé et sauvegardé après l\'attente')
  })

  it('une minuterie qui termine la partie sans toucher à l\'état : la fin est sauvegardée', async () => {
    const { host, created, views, saves } = await solo({ moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { game.end({ fin: 'temps' }) } } })
    await armed(host, created, saves, views)
    await until(() => saves.some(s => s.ended === true && s.result?.fin === 'temps'), 'une sauvegarde porte la fin de la partie')
  })

  it('une minuterie qui ne change que la phase, ou que le tour : la partie est sauvegardée', async () => {
    const phases = await solo({ phases: { jeu: ['arme'], pause: ['arme'] }, moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { game.to('pause') } } })
    await armed(phases.host, phases.created, phases.saves, phases.views)
    await until(() => phases.saves.some(s => s.phase === 'pause'), 'une sauvegarde porte la nouvelle phase')
    await app!.stop(); app = null

    const tours = await solo({ turns: { order: 'roundrobin', timeout: 60000 }, moves: { arme: (game: any) => { game.timer('veille', 80) } }, timers: { veille: (game: any) => { game.next() } } })
    await armed(tours.host, tours.created, tours.saves, tours.views)
    await until(() => tours.saves.some(s => s.turn === 'hote'), 'une sauvegarde porte le nouveau tour')
  })

  it('un état que JSON ne sait pas écrire (objet circulaire) : la minuterie compte comme un changement, la partie est marquée comme avant', async () => {
    let marks = 0
    const def  = resolveGameDef('circulaire', { seats: 1, state: () => { const s: any = { n: 0 }; s.moi = s; return s }, moves: {}, timers: { veille: () => {} } })
    const game = createGame({ send() {} } as any, def, () => {}, 'circulaire1')
    game._onMutate = () => { marks++ }
    game._guardApplicativeTimer('veille')
    await tick()
    assert.equal(marks, 1, 'l\'empreinte illisible a été prise pour « rien n\'a changé »')
    game._destroy()
  })
})
