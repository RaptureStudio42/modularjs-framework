// Sauvegarde d'une partie — trois trous où le dernier état n'arrivait jamais dans le stockage :
// - une écriture restée sans réponse (abandonnée au délai de l'adaptateur) n'était jamais refaite : la partie retenait l'empreinte de
//   ce qui était parti comme celle de sa dernière sauvegarde, et une veille qui ne change rien (mode événementiel) ou une boucle sans
//   rien à marquer (mode action) ne redemandait rien. L'empreinte de référence est celle de la dernière écriture RÉUSSIE, et une
//   écriture sans réponse est refaite comme une écriture refusée (une seconde après, puis une attente qui double) ;
// - mode action : la suite d'une intention asynchrone (la Promise qu'elle rend) était diffusée mais jamais sauvegardée ;
// - mode événementiel : game.changed() juste avant app.stop(), dans le même tour, manquait à la rafale finale de l'arrêt.
// Vrai serveur MJS-Server (MemoryTransport) + stockage texte JSON ; `hanging` : la sauvegarde qui porte state.n === x ne répond jamais.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

function jsonStore(writeTimeoutMs?: number) {
  const store   = new Map<string, string>()
  const hanging = new Set<number>()
  const started: number[] = []
  const adapter: any = {
    load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
    save:   (id: string, data: any) => {
      const txt = JSON.stringify(data)
      const n   = JSON.parse(txt).state?.n
      started.push(n)
      if (hanging.delete(n)) return new Promise(() => {})
      store.set(id, txt)
    },
    remove: (id: string) => { store.delete(id) },
  }
  if (writeTimeoutMs) adapter.writeTimeoutMs = writeTimeoutMs
  return { store, hanging, started, adapter, stored: (id: string) => (store.has(id) ? JSON.parse(store.get(id)!) : null) }
}

function rawClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

describe('MJS-Server — sauvegarde : écriture sans réponse refaite, suite d\'une intention asynchrone, changement annoncé avant l\'arrêt', function () {
  this.timeout(20000)
  const apps: any[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  // une partie à un siège, créée par un client brut ; `live()` rend la partie côté serveur
  async function solo(adapter: any, def: any) {
    const transport = new MemoryTransport()
    let live: any   = null
    const hooks     = { onCreate: (g: any) => { live = g } }
    const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: () => {} } as any)
    apps.push(app)
    app.game('jeu', { seats: 1, code: true, emptyTtl: 60000, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }), moves: {}, ...def, hooks })
    await app.listen()
    const sock    = rawClient(transport, 'hote')
    await attendre(() => sock.state === 'open', 'connexion ouverte')
    const request = (type: string, p: any) => sock.request(type, p)
    const created = await request('µgame:play', { type: 'jeu', code: true })
    return { app, id: created.game as string, live: () => live, move: (move: string, p?: any) => request('µgame:move', { game: created.game, move, p }) }
  }

  it('mode événementiel : écriture sans réponse puis veille qui ne change rien — l\'état finit stocké', async () => {
    const s = jsonStore(50)
    const r = await solo(s.adapter, { moves: { pose: (g: any) => { g.state.n = 1; g.timer('veille', 30) } }, timers: { veille: (g: any) => { g.timer('veille', 30) } } })
    await attendre(() => s.stored(r.id), 'arrivée sauvegardée')
    s.hanging.add(1)
    await r.move('pose')
    await attendre(() => s.stored(r.id)?.state.n === 1, { message: 'n=1 stocké après l\'écriture sans réponse', delai: 6000 })
  })

  it('mode événementiel : l\'empreinte de référence reste celle de la dernière écriture réussie tant que l\'écriture en vol ne répond pas', async () => {
    const s = jsonStore(5000)
    const r = await solo(s.adapter, { moves: { pose: (g: any) => { g.state.n = 1 } }, timers: { veille: () => {} } })
    await attendre(() => s.stored(r.id) && r.live()._lastSavePrint !== null, 'arrivée sauvegardée, empreinte retenue')
    const before = r.live()._lastSavePrint
    s.hanging.add(1)
    await r.move('pose')
    await attendre(() => s.started.includes(1), 'écriture de n=1 partie')
    assert.equal(r.live()._lastSavePrint, before, 'la référence a suivi une écriture qui n\'a pas répondu')
  })

  it('mode action : écriture sans réponse, plus rien ne marque — l\'état finit stocké', async () => {
    const s = jsonStore(50)
    const r = await solo(s.adapter, { tick: 20, moves: { pose: (g: any) => { g.state.n = 1 } } })
    await attendre(() => s.stored(r.id), 'arrivée sauvegardée')
    s.hanging.add(1)
    await r.move('pose')
    await attendre(() => s.stored(r.id)?.state.n === 1, { message: 'n=1 stocké après l\'écriture sans réponse', delai: 6000 })
  })

  it('mode action : la suite d\'une intention asynchrone (Promise rendue) est sauvegardée', async () => {
    const s     = jsonStore()
    let release = () => {}
    const gate  = new Promise<void>(resolve => { release = resolve })
    let entered = false
    const r     = await solo(s.adapter, { tick: 20, intents: { bouge: async (g: any) => { entered = true; await gate; g.state.n = 7 } } })
    await attendre(() => s.stored(r.id), 'arrivée sauvegardée')
    await r.move('bouge')
    // l'intention a tourné et la sauvegarde de sa marque est partie (n=0) avant que sa suite ne change l'état ; la pause laisse passer
    // toute marque encore retenue par la boucle (au plus une par 100 ms)
    await attendre(() => entered, 'intention lancée')
    const k = s.started.length
    await attendre(() => s.started.length > k, 'sauvegarde partie après l\'intention')
    await new Promise<void>(r => setTimeout(r, 300))
    release()
    await attendre(() => s.stored(r.id)?.state.n === 7, { message: 'n=7 stocké après la fin de l\'intention', delai: 3000 })
  })

  for (const hz of [0, 20]) {
    it('mode ' + (hz ? 'action' : 'événementiel') + ' : game.changed() juste avant app.stop(), dans le même tour — l\'arrêt le sauvegarde', async () => {
      const s = jsonStore()
      const r = await solo(s.adapter, { tick: hz })
      await attendre(() => s.stored(r.id), 'arrivée sauvegardée')
      const g = r.live()
      g.state.n = 9
      g.changed()
      apps.splice(apps.indexOf(r.app), 1)
      await r.app.stop()
      assert.equal(s.stored(r.id)?.state.n, 9)
    })
  }
})
