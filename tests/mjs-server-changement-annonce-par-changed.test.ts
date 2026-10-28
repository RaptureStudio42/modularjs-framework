// game.changed() annonce à MJS-Server un changement qu'il ne peut pas voir seul : celui que fait la suite d'une Promise que personne
// ne rend (lancée par une minuterie ou par un coup sans être attendue : une réponse de base de données, un appel réseau), ou tout
// code qui tourne hors d'un coup et d'une minuterie. En mode événementiel, l'état est alors diffusé et la partie sauvegardée, comme
// après un coup ; en mode action, la sauvegarde est demandée tout de suite — la boucle de tick ne marque la partie qu'à sa cadence,
// et plus du tout quand elle est arrêtée (aucun siège connecté, partie finie). Il fallait jusque-là détourner game.to(game.phase),
// sans effet en mode action. Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + adaptateur de sauvegarde espion.
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

describe('MJS-Server — game.changed() : un changement fait hors d\'un coup et d\'une minuterie', function () {
  this.timeout(8000)
  let app: MjsServerApp | null = null
  afterEach(async () => { if (app) await app.stop(); app = null })

  // un siège ; `seen(n)` : la dernière vue reçue par l'hôte porte n, `kept(n)` : une sauvegarde le porte, `game()` : la partie vivante
  async function solo(def: Record<string, any>) {
    const saves: any[] = []
    const spy = { load: async () => [], save: (_id: string, data: any) => { saves.push(JSON.parse(JSON.stringify(data))) }, remove: () => {} }
    const transport = new MemoryTransport()
    let live: any = null
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: spy, debounce: 20 }, onLog: () => {} })
    app.game('solo', { seats: 1, code: true, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }), hooks: { onCreate: (game: any) => { live = game } }, ...def })
    await app.listen()
    const host = makeClient(transport, 'hote'); await tick()
    const views: number[] = []
    host.on('µgame:state', (p: any) => { if (p.view) views.push(p.view.n) })
    const created = await host.request('µgame:play', { type: 'solo', code: true })
    await tick(60)
    const seen = (n: number) => views[views.length - 1] === n
    const kept = (n: number) => saves.some(s => s.state.n === n)
    return { host, created, saves, seen, kept, game: () => live }
  }

  it('la suite d\'une Promise lancée par une minuterie, sans être rendue, puis annoncée par game.changed() : diffusée et sauvegardée', async () => {
    const { host, created, seen, kept } = await solo({
      moves: { arme: (game: any) => { game.timer('reponse', 10) } },
      timers: { reponse: (game: any) => { new Promise<void>(resolve => setTimeout(resolve, 20)).then(() => { game.state.n = 3; game.changed() }) } },
    })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => seen(3), 'le joueur voit le changement fait après l\'attente')
    await until(() => kept(3), 'la sauvegarde le porte')
  })

  it('la suite d\'une Promise lancée par un coup, sans être rendue, puis annoncée par game.changed() : diffusée et sauvegardée', async () => {
    const { host, created, seen, kept } = await solo({
      moves: { regle: (game: any) => { new Promise<void>(resolve => setTimeout(resolve, 30)).then(() => { game.state.n = 4; game.changed() }) } },
    })
    await host.request('µgame:move', { game: created.game, move: 'regle' })
    await until(() => seen(4), 'le joueur voit le changement fait après l\'attente')
    await until(() => kept(4), 'la sauvegarde le porte')
  })

  it('sans game.changed(), la suite d\'une Promise que personne ne rend reste invisible : ni diffusée, ni sauvegardée', async () => {
    let done = false
    const { host, created, seen, kept } = await solo({
      moves: { arme: (game: any) => { game.timer('reponse', 10) } },
      timers: { reponse: (game: any) => { new Promise<void>(resolve => setTimeout(resolve, 20)).then(() => { game.state.n = 5; done = true }) } },
    })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => done, 'la suite a tourné')
    await tick(80)
    assert.equal(seen(5), false, 'MJS-Server ne voit pas un changement fait hors de ce qu\'il appelle')
    assert.equal(kept(5), false)
  })

  it('mode action, boucle arrêtée (plus aucun siège connecté) : game.changed() fait sauvegarder la partie', async () => {
    const { host, saves, kept, game } = await solo({ tick: 20, moves: {} })
    host.close()
    await until(() => game()._tickHandle === null, 'la boucle s\'arrête quand plus aucun siège n\'est connecté')
    await tick(60)
    const before = saves.length
    game().state.n = 7
    game().changed()
    await until(() => kept(7), 'la sauvegarde demandée par game.changed() part')
    assert.equal(saves.length, before + 1)
  })

  it('mode action, partie finie : ce qu\'on règle après la fin et qu\'on annonce par game.changed() est sauvegardé', async () => {
    const { kept, game } = await solo({ tick: 20, moves: {} })
    game().end({ fin: 'temps' })
    await tick(60)
    game().state.n = 8
    game().changed()
    await until(() => kept(8), 'le règlement fait après la fin est sauvegardé')
  })

  it('game.changed() sur une partie détruite : sans effet, ne lève pas', async () => {
    const { host, created, saves, game } = await solo({ moves: {} })
    await host.request('µgame:leave', { game: created.game })
    await until(() => game()._destroyed === true, 'la table quittée par son seul joueur est fermée')
    await tick(60)
    const before = saves.length
    game().state.n = 9
    assert.doesNotThrow(() => game().changed())
    await tick(60)
    assert.equal(saves.length, before, 'une partie détruite a été sauvegardée')
  })
})
