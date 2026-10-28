// hooks.onDestroy dans les cas limites : l'arrêt du serveur ne l'appelle pour aucune partie (finie en grâce, vide en grâce, groupe de
// la file en attente d'un onJoin), même après les échéances ; une partie restaurée d'une sauvegarde le reçoit à sa destruction sans
// avoir vu onCreate dans ce processus (un compteur tenu en mémoire doit en tenir compte) ; dans onDestroy, timer(), changed(), end(),
// next() et to() n'ont aucun effet et ne lèvent pas ; un onDestroy qui lève pendant un appariement défait n'arrête pas la file.
// Vrai serveur MJS-Server + vrai client µ.socket (MemoryTransport) + stockage texte JSON, comme celui des adaptateurs fournis.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'
import { attendre } from './helpers/attendre.js'

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

// stockage texte JSON partagé entre deux démarrages du serveur ; `saves` garde une copie de chaque sauvegarde
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

describe('MJS-Server — hooks.onDestroy : arrêt du serveur, partie restaurée, appels depuis le crochet, file publique', function () {
  this.timeout(10000)
  const apps: MjsServerApp[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  async function serve(def: Record<string, any>, adapter: any, logs: string[] = []) {
    const transport = new MemoryTransport()
    const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: adapter ? { adapter, debounce: 20 } : undefined, onLog: (level: string, msg: string) => { logs.push(level + ' ' + msg) } } as any)
    apps.push(app)
    app.game('jeu', def as any)
    await app.listen()
    return { app, transport }
  }

  async function stop(app: MjsServerApp) {
    apps.splice(apps.indexOf(app), 1)
    await app.stop()
  }

  it('app.stop() : ni la partie finie en grâce, ni la partie vide en grâce, ni le groupe de la file qui attend un onJoin ne reçoivent onDestroy, même quand leurs échéances passent pendant l\'arrêt', async () => {
    const destroyed: string[] = []
    const live = new Map<string, any>()
    // portes : le flush() du stockage retient l'arrêt jusqu'à ce que les échéances (500 ms) soient passées ; les onJoin de la file
    // ne se règlent qu'après l'arrêt
    let openFlush = () => {}
    let openJoins = () => {}
    const flushGate = new Promise<void>(resolve => { openFlush = resolve })
    const joinGate  = new Promise<void>(resolve => { openJoins = resolve })
    let joins = 0
    const def = {
      seats: 2, code: true, endTtl: 500, emptyTtl: 500, seatTtl: 500, state: () => ({ n: 0 }),
      moves: { fin: (game: any) => { game.end({ ok: 1 }) } },
      hooks: {
        onCreate: (game: any) => { live.set(game.id, game) },
        onJoin: (_game: any, player: any) => { if (!player.id.startsWith('q')) return undefined; joins++; return joinGate },
        onDestroy: (game: any) => { destroyed.push(game.id) },
      },
    }
    const { store, adapter } = jsonStore()
    const { app, transport } = await serve(def, { ...adapter, flush: () => flushGate })
    // d'abord le groupe de la file et les deux tables, puis ce qui arme les grâces, juste avant l'arrêt
    const q1 = makeClient(transport, 'q1'); const q2 = makeClient(transport, 'q2')
    await attendre(() => q1.state === 'open' && q2.state === 'open', 'clients de la file connectés')
    void q1.request('µgame:play', { type: 'jeu' }).catch(() => {})
    void q2.request('µgame:play', { type: 'jeu' }).catch(() => {})
    await attendre(() => joins === 2, 'groupe de la file formé, ses onJoin attendent')
    const a = makeClient(transport, 'a'); const b = makeClient(transport, 'b')
    const c = makeClient(transport, 'c'); const d = makeClient(transport, 'd')
    await attendre(() => [a, b, c, d].every(x => x.state === 'open'), 'clients connectés')
    const ended = await a.request('µgame:play', { type: 'jeu', code: true })
    await b.request('µgame:play', { type: 'jeu', code: ended.code })
    const empty = await c.request('µgame:play', { type: 'jeu', code: true })
    await d.request('µgame:play', { type: 'jeu', code: empty.code })
    await a.request('µgame:move', { game: ended.game, move: 'fin' })   // finie, en grâce endTtl
    c.close(); d.close()
    await attendre(() => live.get(empty.game).players.every((j: any) => !j || !j.connected), 'plus aucun siège connecté : grâce emptyTtl')
    const armed = Date.now()
    assert.deepEqual(destroyed, [], 'précondition : une grâce a expiré avant app.stop()')
    const stopping = stop(app)
    await attendre(() => Date.now() >= armed + 700, 'échéances passées pendant l\'arrêt')
    openFlush()
    await stopping
    openJoins()
    await tick(50)
    assert.deepEqual(destroyed, [], 'onDestroy appelé pendant ou après app.stop() : ' + JSON.stringify(destroyed))
    assert.ok(store.has(ended.game) && store.has(empty.game), 'partie retirée du stockage pendant l\'arrêt')
  })

  it('une partie restaurée détruite à sa grâce reçoit onDestroy sans avoir vu onCreate dans ce processus', async () => {
    const { store, adapter } = jsonStore()
    let creates = 0
    const destroyed: string[] = []
    const def = { seats: 2, code: true, emptyTtl: 80, state: () => ({ n: 0 }), moves: {}, hooks: { onCreate: () => { creates++ }, onDestroy: (game: any) => { destroyed.push(game.id) } } }
    const first = await serve(def, adapter)
    const a = makeClient(first.transport, 'a'); const b = makeClient(first.transport, 'b'); await tick()
    const game = await a.request('µgame:play', { type: 'jeu', code: true })
    await b.request('µgame:play', { type: 'jeu', code: game.code })
    await tick(80)
    await stop(first.app)
    assert.ok(store.has(game.game), 'la partie n\'est pas sauvegardée à l\'arrêt')
    creates = 0
    await serve(def, adapter)
    await until(() => destroyed.length === 1, 'la partie restaurée est détruite à sa grâce')
    assert.equal(creates, 0)
    assert.deepEqual(destroyed, [game.game])
  })

  it('dans onDestroy, timer(), changed(), end(), next() et to() n\'ont aucun effet et ne lèvent pas', async () => {
    const logs: string[] = []
    const errors: string[] = []
    let fired = 0
    const def = {
      seats: 2, code: true, state: () => ({ n: 0 }), phases: { jeu: [], fin: [] }, turns: { timeout: null }, moves: {},
      timers: { x: () => { fired++ } },
      hooks: {
        onDestroy: (game: any) => {
          for (const call of [() => game.timer('x', 5), () => game.changed(), () => game.end({}), () => game.next(), () => game.to('fin')]) {
            try { call() } catch (err: any) { errors.push(err.message) }
          }
        },
      },
    }
    const { saves, adapter } = jsonStore()
    const { transport } = await serve(def, adapter, logs)
    const a = makeClient(transport, 'a'); await tick()
    const game = await a.request('µgame:play', { type: 'jeu', code: true })
    await tick(60)
    const before = saves.length
    await a.request('µgame:leave', { game: game.game })   // table jamais complète que son seul joueur quitte : détruite
    await tick(120)
    assert.deepEqual(errors, [])
    assert.equal(fired, 0)
    assert.equal(saves.length, before, 'la partie détruite a été sauvegardée')
    assert.ok(!logs.some(line => line.startsWith('error')), logs.join('\n'))
  })

  it('un onDestroy qui lève pendant un appariement défait : journalisé, la file reprend (le joueur resté en file est apparié au suivant)', async () => {
    const logs: string[] = []
    let destroys = 0
    const def = {
      seats: 2, state: () => ({ n: 0 }), moves: {},
      hooks: { onJoin: (_game: any, player: any) => { if (player.id === 'b') throw new Error('refusé') }, onDestroy: () => { destroys++; throw new Error('boum') } },
    }
    const { transport } = await serve(def, null, logs)
    const a = makeClient(transport, 'a'); const b = makeClient(transport, 'b'); const c = makeClient(transport, 'c'); await tick()
    void a.request('µgame:play', { type: 'jeu' })
    await tick(10)
    await assert.rejects(b.request('µgame:play', { type: 'jeu' }), /refusé/)
    assert.equal(destroys, 1)
    const paired = await c.request('µgame:play', { type: 'jeu' })
    assert.ok(paired.game, 'c n\'est pas apparié : ' + JSON.stringify(paired))
    assert.ok(logs.some(line => line.startsWith('error') && line.includes('onDestroy') && line.includes('boum')))
  })
})
