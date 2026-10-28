// Redémarrage du serveur : le numéro de séquence (`seq`) des trames d'une partie restaurée dépasse tout ce que ses joueurs ont vu avant
// l'arrêt, même quand la partie n'avait plus été écrite depuis longtemps. Une veille récurrente qui ne change rien (mode événementiel)
// et une boucle d'action dont `simulate` ne change rien diffusent sans sauvegarder : chaque diffusion avance `seq`, la sauvegarde garde
// l'ancien. Le client ignore toute trame dont le `seq` ne dépasse pas le dernier qu'il a vu, réponse de reprise comprise — le client
// déjà publié aussi, qui ne changera pas : repris de la sauvegarde, le `seq` laissait le joueur figé après le redémarrage. Le test
// regarde donc les trames brutes (le filtre de tout client) puis la vue du vrai client µ.socket/µ.game. Repartir de l'heure en
// millisecondes ne couvrait qu'une diffusion par milliseconde : une rafale plus rapide (5 000 `changed()` en moins de 200 ms), un arrêt
// brutal et un redémarrage aussitôt laissaient le joueur figé ; la marge est de 2 000 diffusions par milliseconde, sous 2^53.
// Vrai serveur MJS-Server (MemoryTransport) + stockage texte JSON partagé entre deux démarrages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const gameSrc   = readFileSync(join(__dirname, '../src/runtime/mjs_game.ts'), 'utf8')

function clientMu(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc + '\n' + gameSrc)(µ)
  return µ
}

function jsonStore() {
  const store   = new Map<string, string>()
  const adapter = {
    load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
    save:   (id: string, data: any) => { store.set(id, JSON.stringify(data)) },
    remove: (id: string) => { store.delete(id) },
  }
  return { store, adapter }
}

describe('MJS-Server — redémarrage : le seq des trames dépasse tout ce que les joueurs ont vu avant l\'arrêt', function () {
  this.timeout(20000)
  const apps: any[] = []
  afterEach(async () => { for (const app of apps.splice(0)) await app.stop() })

  async function serve(transport: MemoryTransport, adapter: any, def: any) {
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 } } as any)
    apps.push(app)
    app.game('jeu', def)
    await app.listen()
    return app
  }

  // partie jouée par le vrai client ; `lancer` démarre les diffusions qui ne sauvegardent rien (et attend la sauvegarde de ce qui les
  // lance) ; le client en voit au moins 5 de plus que la sauvegarde avant l'arrêt ; redémarrage sur la même sauvegarde, reprise, un coup
  async function scenario(def: any, lancer: (h: any, snapshot: () => any) => Promise<void>, avantArret = () => {}) {
    const transport = new MemoryTransport()
    const { store, adapter } = jsonStore()
    const first = await serve(transport, adapter, def)
    const µ     = clientMu(transport)
    const sock  = µ.socket('memory://x', { auth: () => ({ id: 'x' }), reconnect: { backoff: [400], jitter: 0 } })
    const h     = sock.game('jeu', { code: true })
    await attendre(() => h.state.status === 'playing', 'partie en cours')
    const id     = h.state.gameId
    const snapshot = () => (store.has(id) ? JSON.parse(store.get(id)!) : null)
    const stored   = () => snapshot()?.seq ?? -1
    await attendre(() => stored() >= 0, 'partie sauvegardée')
    await lancer(h, snapshot)
    await attendre(() => h.state.seq >= stored() + 5, () => 'le client voit 5 diffusions de plus que la sauvegarde (vu ' + h.state.seq + ', sauvegardé ' + stored() + ')')
    avantArret()
    apps.splice(apps.indexOf(first), 1)
    await first.stop()
    const seen = h.state.seq
    const after: number[] = []
    sock.on('µgame:state', (p: any) => { if (p.game === id) after.push(p.seq) })
    await serve(transport, adapter, def)
    // app.stop() envoie µ:bye : le client ne se reconnecte pas seul, l'appli le relance (la poignée reste 'playing')
    if (sock.state === 'closed') sock.connect()
    await attendre(() => sock.state === 'open', 'client reconnecté')
    await h.move('pose', { n: 5 })
    await attendre(() => after.length > 0, 'une trame après le coup')
    assert.ok(after[0] > seen, 'première trame après le redémarrage : seq ' + after[0] + ', le client avait vu ' + seen + ' (sauvegardé ' + stored() + ')')
    await attendre(() => (h.state.n ?? h.state.view?.n) === 5, () => 'le client voit le coup joué après le redémarrage (seq du client ' + h.state.seq + ', trames ' + JSON.stringify(after) + ')')
  }

  it('mode événementiel : une veille récurrente qui ne change rien a diffusé sans sauvegarder — le joueur voit le coup suivant', async () => {
    // veille rapide avant l'arrêt, lente après (une veille réaliste) : seuls les coups font alors avancer seq
    const pace = { ms: 10 }
    const def  = { seats: 1, code: true, emptyTtl: 60000, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }),
      moves: { pose: (g: any, _p: any, p: any) => { g.state.n = p.n }, arme: (g: any) => g.timer('veille', pace.ms) },
      timers: { veille: (g: any) => g.timer('veille', pace.ms) } }
    const lancer = async (h: any, snapshot: () => any) => {
      await h.move('arme')
      await attendre(() => snapshot()?.timers.some((x: any) => x.name === 'veille'), 'coup « arme » sauvegardé')
    }
    await scenario(def, lancer, () => { pace.ms = 5000 })
  })

  it('mode action : simulate qui ne change rien a diffusé à chaque tick sans sauvegarder — le joueur voit le coup suivant', async () => {
    const def = { seats: 1, code: true, emptyTtl: 60000, tick: 20, simulate: () => {}, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }),
      moves: { pose: (g: any, _p: any, p: any) => { g.state.n = p.n } } }
    await scenario(def, async () => {})
  })

  it('rafale de 5 000 changed() (plus d\'une diffusion par milliseconde) juste après un redémarrage, arrêt brutal, redémarrage aussitôt : le joueur voit le coup suivant', async () => {
    // stockage partagé ; `couper()` : plus rien n'y est écrit (le process s'arrête sans sauver)
    const store = new Map<string, string>()
    let coupe   = false
    const adapter = {
      load:   async () => Array.from(store.entries()).map(([id, txt]) => ({ id, data: JSON.parse(txt) })),
      save:   (id: string, data: any) => { if (!coupe) store.set(id, JSON.stringify(data)) },
      remove: (id: string) => { if (!coupe) store.delete(id) },
    }
    const def = { seats: 1, code: true, emptyTtl: 60000, state: () => ({ n: 0 }), view: (g: any) => ({ n: g.state.n }),
      moves: { inc: (g: any) => { g.state.n++ },
        rafale: (g: any, _j: any, p: any) => { let k = 0; const f = () => { if (k++ >= p.n) return; g.state.n++; g.changed(); setImmediate(f) }; f() } } }
    let transport = new MemoryTransport()
    let app       = await serve(transport, adapter, def)
    const µ    = clientMu(transport)
    const sock = µ.socket('memory://x', { auth: () => ({ id: 'x' }), reconnect: { enabled: false } })
    const h    = sock.game('jeu', { code: true })
    await attendre(() => h.state.status === 'playing', 'partie en cours')
    await h.move('inc')
    // arrêt propre, redémarrage : la rafale part juste après
    apps.splice(apps.indexOf(app), 1)
    await app.stop()
    transport = new MemoryTransport()
    ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
    app = await serve(transport, adapter, def)
    sock.connect()
    await attendre(() => sock.state === 'open' && h.state.n === 1, 'client revenu')
    const restaure = h.state.seq
    assert.ok(Number.isSafeInteger(restaure), 'seq restauré entier, sous 2^53 : ' + restaure)
    const t0 = Date.now()
    coupe = true
    await h.move('rafale', { n: 5000 })
    await attendre(() => h.state.n >= 5001, 'rafale vue')
    const vu = h.state.seq, duree = Date.now() - t0
    // arrêt brutal (rien de sauvé depuis le début de la rafale) et redémarrage aussitôt
    sock._mjs_ws.close(1006, 'coupure')
    transport = new MemoryTransport()
    coupe     = false
    app       = await serve(transport, adapter, def)
    const stocke = JSON.parse([...store.values()][0])
    sock.connect()
    await attendre(() => sock.state === 'open', 'client reconnecté')
    await h.move('inc')
    await attendre(() => h.state.n === stocke.state.n + 1, () => 'le client voit le coup joué après le redémarrage (client n=' + h.state.n + ' seq=' + h.state.seq + ', vu avant ' + vu + ' en ' + duree + ' ms, sauvegardé n=' + stocke.state.n + ')')
    assert.ok(Number.isSafeInteger(h.state.seq), 'seq entier, sous 2^53 : ' + h.state.seq)
  })
})
