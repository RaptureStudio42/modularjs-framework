// Trois restes de la sauvegarde et de la diffusion de MJS-Server :
// (a) mode action, boucle arrêtée (plus aucun siège connecté) : ce que change une minuterie de l'appli part aux spectateurs, comme
//     après game.changed() — aucun tick ne le porterait ;
// (b) une marque de sauvegarde retenue par la boucle (au plus une toutes les 100 ms) au moment d'app.stop() part dans la rafale
//     finale : le dernier coup n'est pas perdu au redémarrage ;
// (c) une sauvegarde qui échoue est retentée seule, après une attente qui double à chaque échec (1 s, 2 s, 4 s… 60 s au plus), tant
//     que la partie vit ; la rafale finale d'app.stop() la reprend, la fin de la partie l'annule.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, MemoryPersistAdapter, createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...opts })
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const s = makeMu().socket('memory://'+ id, { auth: () => ({ id }), reconnect: { enabled: false } })
  s.connect(); await tick()
  return s
}

// adaptateur qui échoue ses `echecs` premières écritures, puis écrit
class Capricieux {
  store = new Map<string, any>()
  appels = 0
  constructor(public echecs: number) {}
  async load(): Promise<any[]> { return [] }
  save(id: string, data: any): Promise<void> {
    this.appels++
    if (this.echecs-- > 0) return Promise.reject(new Error('stockage indisponible'))
    this.store.set(id, JSON.parse(JSON.stringify(data)))
    return Promise.resolve()
  }
  remove(id: string): void { this.store.delete(id) }
}

function partieFactice(id = 'g1'): any {
  return { id, etat: { n: 1 }, _onMutate: null, serialize() { return { id, state: { ...this.etat } } } }
}

describe('MJS-Server — restes de la sauvegarde et de la diffusion', function () {
  this.timeout(10000)

  it('(a) mode action, boucle arrêtée : le changement d\'une minuterie de l\'appli part aux spectateurs', async () => {
    const { transport, app } = await startApp()
    app.game('act', {
      seats: 1, code: true, tick: 20, seatTtl: 300, emptyTtl: 5000,
      state: () => ({ n: 0 }),
      view: (g: any) => ({ n: g.state.n }),
      spectatorView: (g: any) => ({ n: g.state.n }),
      moves: { armer: (g: any) => { g.timer('tictac', 120) } },
      timers: { tictac: (g: any) => { g.state.n++ } },
    } as any)
    const sx = await connecter(transport, 'x')
    const rep = await sx.request('µgame:play', { type: 'act', code: true })
    await sx.request('µgame:move', { game: rep.game, move: 'armer' })
    sx.close()
    await tick(20)
    const ss = await connecter(transport, 's')
    const vues: any[] = []
    ss.on('µgame:state', (f: any) => vues.push(f.view))
    const entree = await ss.request('µgame:play', { type: 'act', code: rep.code, spectator: true })
    assert.deepEqual(entree.view, { n: 0 })
    await tick(250)
    assert.deepEqual(vues[vues.length - 1], { n: 1 }, 'vues reçues : '+ JSON.stringify(vues))
    await app.stop()
  })

  it('(b) app.stop() : le coup dont la marque attendait la boucle part dans la rafale finale', async () => {
    const saves: any[] = []
    class Enregistreur extends MemoryPersistAdapter {
      save(id: string, data: any): void { saves.push(JSON.parse(JSON.stringify(data.state))); super.save(id, data) }
    }
    const { transport, app } = await startApp({ persist: { adapter: new Enregistreur(), debounce: 10 } })
    app.game('act2', { seats: 1, code: true, tick: 20, seatTtl: 300, emptyTtl: 5000, state: () => ({ n: 0 }), view: (g: any) => g.state, moves: { ajouter: (g: any) => { g.state.n++ } } } as any)
    const sx = await connecter(transport, 'x')
    const rep = await sx.request('µgame:play', { type: 'act2', code: true })
    await sx.request('µgame:move', { game: rep.game, move: 'ajouter' })
    const fin = Date.now() + 1000
    while (!saves.some(s => s.n === 1) && Date.now() < fin) await tick(2)
    assert.ok(saves.some(s => s.n === 1), 'premier coup sauvegardé')
    await sx.request('µgame:move', { game: rep.game, move: 'ajouter' })
    await app.stop()
    assert.deepEqual(saves[saves.length - 1], { n: 2 }, 'sauvegardes : '+ JSON.stringify(saves))
  })

  it('(c) une sauvegarde échouée est retentée seule, après 1 s puis 2 s ; l\'avertissement annonce l\'attente', async () => {
    const cap = new Capricieux(2)
    const logs: string[] = []
    const engine = createPersistEngine(resolvePersistOption({ adapter: cap, debounce: 5 }), (niveau: string, msg: string) => { logs.push(niveau +' '+ msg) })!
    const partie = partieFactice()
    engine.armGame(partie)
    partie._onMutate(partie)
    await tick(300)
    assert.equal(cap.appels, 1)
    assert.equal(cap.store.size, 0)
    assert.ok(logs.some(l => /^warn .*g1.*1 s/.test(l)), JSON.stringify(logs))
    await tick(1000)
    assert.equal(cap.appels, 2, 'premier nouvel essai après 1 s')
    assert.ok(logs.some(l => /^warn .*g1.*2 s/.test(l)), 'attente doublée : '+ JSON.stringify(logs))
    await tick(1000)
    assert.equal(cap.appels, 2, 'le second attend 2 s')
    await tick(1300)
    assert.equal(cap.appels, 3)
    assert.deepEqual(cap.store.get('g1').state, { n: 1 })
    await tick(1200)
    assert.equal(cap.appels, 3, 'plus rien une fois écrite')
    await engine.stop()
  })

  it('(c) la rafale finale d\'app.stop() reprend une sauvegarde échouée qui attendait son nouvel essai', async () => {
    const cap = new Capricieux(1)
    const engine = createPersistEngine(resolvePersistOption({ adapter: cap, debounce: 5 }), () => {})!
    const partie = partieFactice()
    engine.armGame(partie)
    partie._onMutate(partie)
    await tick(100)
    assert.equal(cap.store.size, 0)
    await engine.stop()
    assert.equal(cap.appels, 2)
    assert.deepEqual(cap.store.get('g1').state, { n: 1 })
  })

  it('(c) une partie finie (oubliée) n\'est plus retentée : rien n\'écrit après sa suppression', async () => {
    const cap = new Capricieux(1)
    const engine = createPersistEngine(resolvePersistOption({ adapter: cap, debounce: 5 }), () => {})!
    const partie = partieFactice()
    engine.armGame(partie)
    partie._onMutate(partie)
    await tick(100)
    engine.forgetGame('g1')
    await tick(1300)
    assert.equal(cap.appels, 1)
    assert.equal(cap.store.size, 0)
    await engine.stop()
  })
})
