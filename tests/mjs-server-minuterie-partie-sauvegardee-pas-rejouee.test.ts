// Une minuterie de l'appli (def.timers) qui part sans être réarmée disparaît des minuteries de la partie : la partie est alors
// sauvegardée, même si la minuterie n'a rien changé d'autre. Sans cette sauvegarde, le stockage gardait la minuterie déjà partie, un
// arrêt propre du serveur ne l'en retirait pas, et au redémarrage elle repartait une seconde fois (un rappel envoyé deux fois). Une
// minuterie neuve, armée par une minuterie, fait sauvegarder la partie de la même façon. Une veille réarmée sous le même nom, elle,
// ne fait pas sauvegarder : seule son échéance a bougé ; après un redémarrage, l'échéance sauvegardée, déjà passée, part tout de
// suite, une fois. Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + stockage texte JSON partagé entre deux
// démarrages, comme celui des adaptateurs fournis ; les durées sont courtes.
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

// stockage texte JSON : `store` garde le texte de chaque partie (relu au démarrage suivant), `saves` une copie de chaque sauvegarde
function jsonStore() {
  const store   = new Map<string, string>()
  const saves: any[] = []
  const adapter = {
    load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
    save:   (id: string, data: any) => { const txt = JSON.stringify(data); store.set(id, txt); saves.push(JSON.parse(txt)) },
    remove: (id: string) => { store.delete(id) },
  }
  return { store, saves, adapter }
}

// noms des minuteries que porte la sauvegarde de la partie `id`
function storedTimers(store: Map<string, string>, id: string): string[] {
  return JSON.parse(store.get(id)!).timers.map((timer: any) => timer.name).sort()
}

describe('MJS-Server — une minuterie partie sans être réarmée est sauvegardée et ne repart pas au redémarrage', function () {
  this.timeout(10000)
  const apps: MjsServerApp[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  async function serve(def: Record<string, any>, adapter: any) {
    const transport = new MemoryTransport()
    const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: () => {} })
    apps.push(app)
    app.game('jeu', def as any)
    await app.listen()
    return { app, transport }
  }

  // arrêt propre du serveur (dernière rafale de sauvegardes comprise), avant d'en démarrer un autre sur le même stockage
  async function stop(app: MjsServerApp) {
    apps.splice(apps.indexOf(app), 1)
    await app.stop()
  }

  // l'hôte crée une partie par code puis joue `arme`, qui arme la minuterie du test
  async function hostAndArm(transport: MemoryTransport) {
    const host    = makeClient(transport, 'hote'); await tick()
    const created = await host.request('µgame:play', { type: 'jeu', code: true })
    await host.request('µgame:move', { game: created.game, move: 'arme' })
    return created.game as string
  }

  it('une minuterie qui part sans rien changer d\'autre : la sauvegarde ne la porte plus, elle ne repart pas au redémarrage', async () => {
    const { store, adapter } = jsonStore()
    let reminders = 0
    const def = { seats: 2, code: true, state: () => ({ n: 0 }), moves: { arme: (game: any) => { game.timer('rappel', 30) } }, timers: { rappel: () => { reminders++ } } }
    const first = await serve(def, adapter)
    const id    = await hostAndArm(first.transport)
    await until(() => reminders === 1, 'le rappel part une fois')
    await tick(100)   // bien au-delà du débounce de la persistance (20 ms)
    assert.deepEqual(storedTimers(store, id), [], 'la sauvegarde porte encore la minuterie déjà partie')
    await stop(first.app)
    await serve(def, adapter)
    await tick(120)
    assert.equal(reminders, 1, 'le rappel déjà parti est reparti au redémarrage (' + reminders + ' rappels)')
  })

  it('une minuterie qui en arme une autre, sans rien changer d\'autre : la partie est sauvegardée avec la nouvelle', async () => {
    const { store, adapter } = jsonStore()
    let reminders = 0
    const def = {
      seats: 2, code: true, state: () => ({ n: 0 }),
      moves: { arme: (game: any) => { game.timer('rappel', 30) } },
      timers: { rappel: (game: any) => { reminders++; game.timer('relance', 60000) }, relance: () => {} },
    }
    const { transport } = await serve(def, adapter)
    const id = await hostAndArm(transport)
    await until(() => reminders === 1, 'le rappel part une fois')
    await tick(100)
    assert.deepEqual(storedTimers(store, id), ['relance'], 'la minuterie neuve n\'est pas dans la sauvegarde')
  })

  it('une veille réarmée sous le même nom : aucune sauvegarde à ses échéances ; au redémarrage, son échéance passée part tout de suite, une fois', async () => {
    const { store, saves, adapter } = jsonStore()
    let watches = 0
    let period  = 40
    const def = {
      seats: 2, code: true, state: () => ({ n: 0 }),
      moves: { arme: (game: any) => { game.timer('veille', 150) } },
      timers: { veille: (game: any) => { watches++; game.timer('veille', period) } },
    }
    const first = await serve(def, adapter)
    const id    = await hostAndArm(first.transport)
    await until(() => saves.some(save => save.timers.some((timer: any) => timer.name === 'veille')), 'le coup qui arme la veille est sauvegardé')
    const before = saves.length
    await until(() => watches >= 3, 'la veille part trois fois')
    await tick(30)
    assert.equal(saves.length, before, 'les échéances de la veille ont fait sauvegarder la partie : ' + (saves.length - before) + ' sauvegardes de trop')
    assert.deepEqual(storedTimers(store, id), ['veille'])
    await stop(first.app)
    period  = 60000
    watches = 0
    await serve(def, adapter)
    await until(() => watches === 1, 'l\'échéance sauvegardée, déjà passée, part au redémarrage')
    await tick(100)
    assert.equal(watches, 1, 'la veille est partie ' + watches + ' fois au redémarrage')
  })
})
