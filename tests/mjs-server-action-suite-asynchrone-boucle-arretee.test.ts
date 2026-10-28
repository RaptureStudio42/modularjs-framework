// Mode action : la suite d'un simulate ou d'un slowTick asynchrone (la Promise qu'il rend) n'était ni sauvegardée ni diffusée quand
// la boucle s'était arrêtée entre-temps (plus aucun siège connecté) : rien ne marquait la partie à sa fin. Elle la marque désormais,
// comme la suite d'une intention, comparée à la dernière sauvegarde comme leur début (leur effet ne se voit pas), et la diffuse tout
// de suite quand aucun tick ne la porterait. Vrai serveur MJS-Server (MemoryTransport), stockage texte JSON, un spectateur qui regarde
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const pause     = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function jsonStore() {
  const store   = new Map<string, string>()
  const started: number[] = []
  const adapter: any = {
    load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
    save:   (id: string, data: any) => { const txt = JSON.stringify(data); started.push(JSON.parse(txt).state?.n); store.set(id, txt) },
    remove: (id: string) => { store.delete(id) },
  }
  return { started, adapter, stored: (id: string) => (store.has(id) ? JSON.parse(store.get(id)!) : null) }
}

function rawClient(transport: MemoryTransport, id: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  const sock = µ.socket('memory://' + id, { auth: () => ({ id: id }), reconnect: { enabled: false } })
  sock.connect()
  return sock
}

describe('MJS-Server — mode action : la suite asynchrone de simulate et de slowTick, boucle arrêtée', function () {
  this.timeout(20000)
  const apps: any[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  // une partie à un siège par code, son hôte et un spectateur ; `vu` : les `n` que le spectateur reçoit
  async function partie(adapter: any, def: any) {
    const transport = new MemoryTransport()
    const app       = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: () => {} } as any)
    apps.push(app)
    app.game('jeu', { seats: 1, code: true, emptyTtl: 60000, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }), spectatorView: (g: any) => ({ n: g.state.n }), moves: {}, ...def })
    await app.listen()
    const hote = rawClient(transport, 'hote')
    await attendre(() => hote.state === 'open', 'hôte connecté')
    const created = await hote.request('µgame:play', { type: 'jeu', code: true })
    const spectateur = rawClient(transport, 'spectateur')
    await attendre(() => spectateur.state === 'open', 'spectateur connecté')
    const vu: number[] = []
    spectateur.on('µgame:state', (p: any) => { if (p.game === created.game) vu.push(p.view.n) })
    await spectateur.request('µgame:play', { type: 'jeu', code: created.code, spectator: true })
    return { id: created.game as string, hote, vu }
  }

  for (const quoi of ['simulate', 'slowTick'] as const) {
    it(quoi + ' rend une Promise et le seul joueur se déconnecte avant sa fin : la suite est sauvegardée et part au spectateur', async () => {
      const s     = jsonStore()
      let release = () => {}
      const gate  = new Promise<void>(resolve => { release = resolve })
      let entered = false
      const lent  = (g: any) => { if (entered) return; entered = true; return (async () => { await gate; g.state.n = 7 })() }
      const r     = await partie(s.adapter, quoi === 'simulate' ? { tick: 20, simulate: lent } : { tick: 20, slowTick: { hz: 10, fn: lent } })
      await attendre(() => s.stored(r.id) && entered, quoi + ' lancé, arrivée sauvegardée')
      r.hote._mjs_ws.close(1006, 'coupure')
      // la boucle s'arrête avec le siège déconnecté : la marque qu'elle retenait part, puis plus aucun tick
      await pause(200)
      const k = r.vu.length
      release()
      await attendre(() => s.stored(r.id)?.state.n === 7, { message: 'n=7 stocké après la fin de ' + quoi, delai: 3000 })
      await attendre(() => r.vu.slice(k).includes(7), { message: 'le spectateur voit n=7', delai: 3000 })
    })
  }

  it('une suite qui ne change rien n\'écrit pas : la partie est comparée à sa dernière sauvegarde', async () => {
    const s     = jsonStore()
    let release = () => {}
    const gate  = new Promise<void>(resolve => { release = resolve })
    let entered = false
    let ended   = false
    const r     = await partie(s.adapter, { tick: 20, simulate: () => { if (entered) return; entered = true; return (async () => { await gate; ended = true })() } })
    await attendre(() => s.stored(r.id) && entered, 'simulate lancé, arrivée sauvegardée')
    r.hote._mjs_ws.close(1006, 'coupure')
    await pause(200)
    const k = s.started.length
    release()
    await attendre(() => ended, 'suite terminée')
    await pause(200)
    assert.equal(s.started.length, k, 'aucune écriture de plus')
  })
})
