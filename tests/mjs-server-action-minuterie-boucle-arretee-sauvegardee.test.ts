// Mode action, boucle arrêtée (plus aucun siège connecté) : une minuterie qui part fait sauvegarder la partie. Seule la boucle de
// tick marquait une partie d'action à sauvegarder ; arrêtée, une minuterie unique de l'appli qui partait n'était pas sauvegardée :
// le stockage la gardait, un arrêt propre du serveur ne l'en retirait pas, et au redémarrage elle repartait une seconde fois (un
// rappel envoyé deux fois). Ce qu'elle changeait dans l'état était perdu de même, comme le tour passé par turns.timeout. Vrai
// serveur MJS-Server + vrai client µ.socket (MemoryTransport) + stockage texte JSON partagé entre deux démarrages, comme celui des
// adaptateurs fournis ; les durées sont courtes.
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

// stockage texte JSON : `store` garde le texte de chaque partie, relu au démarrage suivant
function jsonStore() {
  const store   = new Map<string, string>()
  const adapter = {
    load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
    save:   (id: string, data: any) => { store.set(id, JSON.stringify(data)) },
    remove: (id: string) => { store.delete(id) },
  }
  return { store, adapter }
}

describe('MJS-Server — mode action, boucle arrêtée : une minuterie qui part fait sauvegarder la partie', function () {
  this.timeout(10000)
  const apps: MjsServerApp[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  async function serve(def: Record<string, any>, adapter: any) {
    const transport = new MemoryTransport()
    const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: () => {} })
    apps.push(app)
    app.game('arene', { seats: 1, code: true, tick: 20, emptyTtl: 60000, state: () => ({ n: 0 }), ...def } as any)
    await app.listen()
    return { app, transport }
  }

  // arrêt propre du serveur (dernière rafale de sauvegardes comprise), avant d'en démarrer un autre sur le même stockage
  async function stop(app: MjsServerApp) {
    apps.splice(apps.indexOf(app), 1)
    await app.stop()
  }

  // le joueur crée la partie, joue `arme`, puis se déconnecte : la boucle s'arrête avant que la minuterie ne parte
  async function armAndLeave(transport: MemoryTransport, store: Map<string, string>) {
    const host    = makeClient(transport, 'hote'); await tick()
    const created = await host.request('µgame:play', { type: 'arene', code: true })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    await until(() => store.has(created.game) && JSON.parse(store.get(created.game)!).timers.some((timer: any) => timer.name !== 'µempty'), 'la minuterie armée est sauvegardée')
    host.close()
    return created.game as string
  }

  const storedTimers = (store: Map<string, string>, id: string) => JSON.parse(store.get(id)!).timers.map((timer: any) => timer.name).sort()

  it('minuterie unique qui ne change rien d\'autre : la sauvegarde ne la porte plus, elle ne repart pas au redémarrage', async () => {
    const { store, adapter } = jsonStore()
    let reminders = 0
    const def = { moves: { arme: (game: any) => { game.timer('rappel', 200) } }, timers: { rappel: () => { reminders++ } } }
    const first = await serve(def, adapter)
    const id    = await armAndLeave(first.transport, store)
    await until(() => reminders === 1, 'le rappel part une fois, boucle arrêtée')
    await tick(100)
    assert.deepEqual(storedTimers(store, id), ['µempty'], 'la sauvegarde porte encore la minuterie déjà partie')
    await stop(first.app)
    await serve(def, adapter)
    await tick(150)
    assert.equal(reminders, 1, 'le rappel déjà parti est reparti au redémarrage (' + reminders + ' rappels)')
  })

  it('minuterie unique qui change l\'état : le changement est sauvegardé et relu au redémarrage', async () => {
    const { store, adapter } = jsonStore()
    const def = {
      moves: { arme: (game: any) => { game.timer('bonus', 200) } },
      timers: { bonus: (game: any) => { game.state.n = 9 } },
    }
    const first = await serve(def, adapter)
    const id    = await armAndLeave(first.transport, store)
    await until(() => JSON.parse(store.get(id)!).state.n === 9, 'le changement fait par la minuterie est sauvegardé')
    await stop(first.app)
    const second = await serve(def, adapter)
    const back   = makeClient(second.transport, 'hote'); await tick()
    const resync = await back.request('µgame:resync', { game: id })
    assert.equal(resync.view.n, 9, 'la partie restaurée a perdu le changement de la minuterie')
  })

  it('tour passé par turns.timeout, boucle arrêtée : sauvegardé', async () => {
    const { store, adapter } = jsonStore()
    const def = {
      turns: { order: 'roundrobin', timeout: 200 },
      moves: { arme: (game: any) => { game.next() } },
      hooks: { onTurnTimeout: (game: any) => { game.state.n++; game.next() } },
    }
    const { transport } = await serve(def, adapter)
    const id = await armAndLeave(transport, store)
    await until(() => JSON.parse(store.get(id)!).state.n >= 1, 'le passage de tour fait par onTurnTimeout est sauvegardé')
  })
})
