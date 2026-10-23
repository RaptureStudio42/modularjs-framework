// app.stop() : rien ne part vers l'adaptateur de persistance après son flush(). Une mutation pendant l'arrêt (boucle de tick, coup
// reçu) réarmait une sauvegarde qui partait après la fin de app.stop(), avec l'état d'une partie détruite (minuteries vidées) à la
// place de la bonne sauvegarde ; et le remove() d'une partie finie juste avant ou pendant l'arrêt n'était pas attendu : il pouvait
// arriver après flush(), connexion du stockage déjà fermée, et la partie finie revivait au démarrage suivant. Chaîne réelle : vrai
// serveur MJS-Server, vrai client µ.socket (MemoryTransport).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerPersistOption } from '../src/mjs-server/index.js'

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

interface Sauvegarde { at: number; id: string; timers: string[] }

async function demarrer(persist: MjsServerPersistOption, def: Record<string, any>): Promise<{ app: MjsServerApp; sock: any }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, persist })
  app.game('salle', def)
  await app.listen()
  const sock = makeClient(transport, 'a')
  await tick()
  return { app, sock }
}

describe('MJS-Server — app.stop() : aucune écriture vers l\'adaptateur après son flush()', function () {
  this.timeout(10000)

  // chaque sauvegarde est notée avec son heure et les minuteries qu'elle porte ; une écriture prend 20 ms, le flush() 150 ms
  function adaptateurNote(saves: Sauvegarde[]): any {
    return {
      async load() { return [] },
      save(id: string, data: any) { saves.push({ at: Date.now(), id, timers: data.timers.map((timer: any) => timer.name) }); return tick(20) },
      remove() {},
      flush() { return tick(150) },
    }
  }

  it('mode action : la boucle de tick ne réarme aucune sauvegarde pendant l\'arrêt, la dernière garde les minuteries de l\'appli', async () => {
    const saves: Sauvegarde[] = []
    const { app, sock } = await demarrer(adaptateurNote(saves), { seats: 1, code: true, tick: 20, state: () => ({ x: 0 }), simulate: (game: any) => { game.state.x++ }, timers: { rappel: () => {} }, moves: { armer: (game: any) => { game.timer('rappel', 600000) } } })
    const r = await sock.request('µgame:play', { type: 'salle', code: true })
    await sock.request('µgame:move', { game: r.game, move: 'armer' })
    await tick(400)
    await app.stop()
    const fin = Date.now()
    await tick(400)
    const apres = saves.filter(save => save.at > fin)
    assert.deepEqual(apres, [], 'sauvegardes parties après la fin de app.stop()')
    assert.ok(saves.length > 0, 'aucune sauvegarde')
    assert.ok(saves[saves.length - 1].timers.includes('rappel'), 'la dernière sauvegarde a perdu les minuteries : ' + JSON.stringify(saves[saves.length - 1]))
  })

  it('mode événementiel : un coup reçu pendant l\'arrêt ne fait partir aucune sauvegarde après la fin de app.stop()', async () => {
    const saves: Sauvegarde[] = []
    const { app, sock } = await demarrer(adaptateurNote(saves), { seats: 1, code: true, state: () => ({ n: 0 }), timers: { rappel: () => {} }, moves: { armer: (game: any) => { game.timer('rappel', 600000) }, inc: (game: any) => { game.state.n++ } } })
    const r = await sock.request('µgame:play', { type: 'salle', code: true })
    await sock.request('µgame:move', { game: r.game, move: 'armer' })
    await tick(300)
    const arret = app.stop()
    await tick(30)
    await sock.request('µgame:move', { game: r.game, move: 'inc' }).catch(() => {})
    await arret
    const fin = Date.now()
    await tick(400)
    assert.deepEqual(saves.filter(save => save.at > fin), [], 'sauvegardes parties après la fin de app.stop()')
    assert.ok(saves[saves.length - 1].timers.includes('rappel'), 'la dernière sauvegarde a perdu les minuteries : ' + JSON.stringify(saves[saves.length - 1]))
  })

  // une écriture lente (200 ms) est en vol quand la partie finit ; son remove() attend derrière elle et prend lui-même 30 ms
  function adaptateurLent(journal: string[]): any {
    return {
      async load() { return [] },
      save(id: string) { journal.push('save ' + id); return tick(200).then(() => { journal.push('save fini ' + id) }) },
      remove(id: string) { journal.push('remove ' + id); return tick(30).then(() => { journal.push('remove fini ' + id) }) },
      flush() { journal.push('flush') },
    }
  }

  for (const moment of ['juste avant l\'arrêt', 'pendant l\'arrêt']) {
    it('partie finie ' + moment + ', une sauvegarde lente en vol : son remove() aboutit avant le flush()', async () => {
      const journal: string[] = []
      const { app, sock } = await demarrer({ adapter: adaptateurLent(journal), debounce: 1 }, { seats: 2, code: true, emptyTtl: moment === 'pendant l\'arrêt' ? 80 : 20, state: () => ({ n: 0 }), moves: {} })
      const r = await sock.request('µgame:play', { type: 'salle', code: true })
      await tick(10)
      await sock.request('µgame:leave', { game: r.game })
      if (moment === 'juste avant l\'arrêt') await tick(60)
      await app.stop()
      journal.push('fin de stop')
      await tick(500)
      const remove = journal.indexOf('remove fini ' + r.game)
      assert.notEqual(journal.indexOf('remove ' + r.game), -1, 'aucun remove() pour la partie finie : ' + journal.join(' / '))
      assert.ok(remove !== -1 && remove < journal.indexOf('flush'), 'le remove() de la partie finie n\'a pas abouti avant le flush() : ' + journal.join(' / '))
    })
  }
})
