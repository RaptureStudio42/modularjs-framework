// Une partie neuve ne prend jamais l'identifiant d'une sauvegarde encore présente dans le stockage, même quand cette sauvegarde n'a
// pas été restaurée au démarrage (type de jeu retiré, instantané invalide, load() en échec) : le compteur repartait de game1 à chaque
// démarrage, la partie neuve écrasait la sauvegarde puis l'effaçait à sa fin. Chaîne réelle : vrai serveur MJS-Server, vrai client
// µ.socket (MemoryTransport), adaptateur mémoire partagé d'un démarrage à l'autre.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, MemoryPersistAdapter } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerPersistAdapter } from '../src/mjs-server/index.js'

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

// la sauvegarde d'une partie de la veille, d'un type que l'appli ne déclare plus
const veille = (id: string) => ({ id, type: 'ancien-jeu', code: null, state: { precieux: 'partie de la veille' }, phase: null, turn: null, seq: 3, journal: [], seats: [null, null], timers: [] })

interface Demarrage { app: MjsServerApp; ids: string[] }

// démarre un serveur sur `adapter` avec le jeu `type`, puis le joueur `joueur` crée `n` parties privées (rend leurs ids, une fois
// chacune sauvée). `horloge` : l'heure que lit le serveur à sa construction, pour rejouer une horloge qui a reculé entre deux démarrages
async function demarrer(adapter: MjsServerPersistAdapter, type: string, joueur: string, n: number, horloge?: number): Promise<Demarrage> {
  const transport = new MemoryTransport()
  const vraiNow   = Date.now
  if (horloge !== undefined) Date.now = () => horloge
  let app: MjsServerApp
  try {
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, persist: { adapter, debounce: 5 } })
  }
  finally {
    Date.now = vraiNow
  }
  app.game(type, { seats: 2, code: true, state: () => ({ n: 0, joueur: joueur }), moves: {} })
  await app.listen()
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    // une connexion par partie : une même connexion ne tient qu'une partie privée en attente à la fois (la suivante fermerait celle-ci)
    const sock = makeClient(transport, joueur + i)
    await tick()
    ids.push((await sock.request('µgame:play', { type: type, code: true })).game)
  }
  await tick(60)
  return { app, ids }
}

async function lire(store: MemoryPersistAdapter, id: string): Promise<any> {
  return (await store.load()).find(entry => entry.id === id)?.data
}

describe('MJS-Server — un identifiant de partie neuve ne reprend jamais celui d\'une sauvegarde du stockage', function () {
  this.timeout(10000)
  const vivants: MjsServerApp[] = []
  afterEach(async () => { for (const app of vivants.splice(0)) await app.stop() })

  it('type de jeu retiré : la partie neuve prend un autre identifiant, la sauvegarde de la veille reste intacte', async () => {
    const store = new MemoryPersistAdapter()
    store.save('game1', veille('game1') as any)
    const { app, ids } = await demarrer(store, 'compteur', 'a', 1)
    vivants.push(app)
    assert.notEqual(ids[0], 'game1', 'la partie neuve a repris l\'identifiant de la sauvegarde de la veille')
    const gardee = await lire(store, 'game1')
    assert.equal(gardee?.type, 'ancien-jeu', 'la sauvegarde de la veille a été écrasée : ' + JSON.stringify(gardee))
    assert.deepEqual(gardee?.state, { precieux: 'partie de la veille' })
  })

  it('load() en échec : la partie neuve prend un autre identifiant, la sauvegarde restée dans le stockage est intacte', async () => {
    const store = new MemoryPersistAdapter()
    store.save('game1', veille('game1') as any)
    const panne: MjsServerPersistAdapter = { load: () => Promise.reject(new Error('stockage injoignable au démarrage')), save: (id, data) => store.save(id, data), remove: id => store.remove(id) }
    const { app, ids } = await demarrer(panne, 'compteur', 'a', 1)
    vivants.push(app)
    assert.notEqual(ids[0], 'game1', 'la partie neuve a repris l\'identifiant de la sauvegarde restée dans le stockage')
    assert.equal((await lire(store, 'game1'))?.type, 'ancien-jeu', 'la sauvegarde restée dans le stockage a été écrasée')
  })

  it('deux démarrages sur le même stockage, le second sans restauration : aucun identifiant du premier n\'est réattribué', async () => {
    const store = new MemoryPersistAdapter()
    const premier = await demarrer(store, 'compteur', 'a', 3)
    await premier.app.stop()
    const panne: MjsServerPersistAdapter = { load: () => Promise.reject(new Error('stockage injoignable au démarrage')), save: (id, data) => store.save(id, data), remove: id => store.remove(id) }
    const second = await demarrer(panne, 'compteur', 'b', 3)
    vivants.push(second.app)
    assert.deepEqual(second.ids.filter(id => premier.ids.includes(id)), [], 'identifiants réattribués : premier ' + premier.ids.join(', ') + ' / second ' + second.ids.join(', '))
    for (const id of premier.ids) assert.equal((await lire(store, id))?.state.joueur, 'a', 'la sauvegarde ' + id + ' du premier démarrage a été écrasée')
  })

  for (const cas of ['type de jeu retiré', 'instantané invalide']) {
    it('horloge qui a reculé depuis le démarrage précédent, ' + cas + ' : un identifiant lu au chargement n\'est jamais réattribué', async () => {
      const store   = new MemoryPersistAdapter()
      const premier = await demarrer(store, 'compteur', 'a', 3)
      await premier.app.stop()
      const amorce = Number(premier.ids[0].replace(/^game/, '')) - 1
      if (cas === 'instantané invalide') for (const id of premier.ids) store.save(id, { ...(await lire(store, id)), timers: 'abîmé' } as any)
      // même heure lue qu'au premier démarrage : seul l'identifiant relu au chargement peut écarter les siens
      const second = await demarrer(store, cas === 'type de jeu retiré' ? 'autre-jeu' : 'compteur', 'b', 3, amorce)
      vivants.push(second.app)
      assert.deepEqual(second.ids.filter(id => premier.ids.includes(id)), [], 'identifiants réattribués : premier ' + premier.ids.join(', ') + ' / second ' + second.ids.join(', '))
      for (const id of premier.ids) assert.equal((await lire(store, id))?.state.joueur, 'a', 'la sauvegarde ' + id + ' du premier démarrage a été écrasée')
    })
  }
})
