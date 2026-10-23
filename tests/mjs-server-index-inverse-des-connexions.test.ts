// Index inverse du matchmaking : une déconnexion ne visite plus que les parties où la connexion a pris place (siège ou regard), et
// une entrée en file publique ne cherche plus le joueur que dans les parties où son identité est assise. Les deux balayaient
// jusqu'ici TOUTES les parties vivantes à chaque appel (O(parties)). Les comportements restent ceux d'avant : sièges marqués
// déconnectés dans chaque partie du client, spectateur retiré, 2e onglet rattaché à sa partie, y compris une partie restaurée.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer, MemoryPersistAdapter, Game } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

/** serveur démarré, jeux déclarés AVANT le démarrage (une partie sauvegardée n'est restaurée que si son type est déjà connu) */
async function startApp(opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, ...opts })
  declarer(app)
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

function declarer(app: MjsServerApp): void {
  app.game('salon', { seats: 2, code: true, emptyTtl: 60000, state: () => ({}), moves: {} })
  app.game('duel', { seats: 2, emptyTtl: 60000, state: () => ({}), moves: {} })
}

// espion posé sur le prototype de Game le temps d'un test : rend chaque appel visible, puis rétabli
const originaux = { _onDisconnect: Game.prototype._onDisconnect, _createSeat: Game.prototype._createSeat }
afterEach(() => {
  Game.prototype._onDisconnect = originaux._onDisconnect
  Game.prototype._createSeat   = originaux._createSeat
})

describe('MJS-Server — index inverse des connexions et des identités', () => {
  it('une déconnexion ne visite que les parties de la connexion, pas toutes les parties vivantes', async () => {
    const { transport, app } = await startApp()
    for (let i = 0; i < 20; i++) {
      const hote = await connecter(transport, 'hote' + i)
      await hote.request('µgame:play', { type: 'salon', code: true })
    }
    const x = await connecter(transport, 'x')
    const sienne = await x.request('µgame:play', { type: 'salon', code: true })
    const visitees: string[] = []
    Game.prototype._onDisconnect = function(this: any, client: any) {
      visitees.push(this.id)
      return originaux._onDisconnect.call(this, client)
    }
    x.close()
    await tick(20)
    assert.deepEqual(visitees, [sienne.game])
    await app.stop()
  })

  it('une entrée en file publique ne lit les sièges d aucune partie où le joueur n est pas assis', async () => {
    const { transport, app } = await startApp()
    const parties: any[] = []
    Game.prototype._createSeat = function(this: any, ...args: any[]) {
      if (!parties.includes(this)) parties.push(this)
      return (originaux._createSeat as any).apply(this, args)
    }
    for (let i = 0; i < 20; i++) {
      const hote = await connecter(transport, 'hote' + i)
      await hote.request('µgame:play', { type: 'salon', code: true })
    }
    let lectures = 0
    for (const partie of parties) {
      partie.players = new Proxy(partie.players, { get(cible: any, cle: any) { lectures++; return cible[cle] } })
    }
    const q = await connecter(transport, 'q')
    lectures = 0
    assert.deepEqual(await q.request('µgame:play', { type: 'salon' }), { queue: 1 })
    assert.equal(lectures, 0)
    await app.stop()
  })

  it('un client assis dans deux parties de types différents : sa déconnexion marque ses deux sièges déconnectés', async () => {
    const { transport, app } = await startApp()
    const x = await connecter(transport, 'x')
    const b = await connecter(transport, 'b')
    const c = await connecter(transport, 'c')
    const salon = await x.request('µgame:play', { type: 'salon', code: true })
    await b.request('µgame:play', { type: 'salon', code: salon.code })
    await c.request('µgame:play', { type: 'duel' })
    const duel = await x.request('µgame:play', { type: 'duel' })
    const rostersB: any[] = []
    const rostersC: any[] = []
    b.on('µgame:seat', (p: any) => rostersB.push(p))
    c.on('µgame:seat', (p: any) => rostersC.push(p))
    x.close()
    await tick(20)
    const dernierB = rostersB.filter(p => p.game === salon.game).pop()
    const dernierC = rostersC.filter(p => p.game === duel.game).pop()
    assert.equal(dernierB.seats[salon.seat].connected, false)
    assert.equal(dernierC.seats[duel.seat].connected, false)
    await app.stop()
  })

  it('un spectateur qui se déconnecte est retiré des spectateurs de la partie regardée', async () => {
    const { transport, app } = await startApp()
    const parties: any[] = []
    Game.prototype._createSeat = function(this: any, ...args: any[]) {
      if (!parties.includes(this)) parties.push(this)
      return (originaux._createSeat as any).apply(this, args)
    }
    const hote = await connecter(transport, 'hote')
    const partie = await hote.request('µgame:play', { type: 'salon', code: true })
    const regard = await connecter(transport, 'regard')
    await regard.request('µgame:play', { type: 'salon', code: partie.code, spectator: true })
    assert.equal(parties[0]._spectators.size, 1)
    regard.close()
    await tick(20)
    assert.equal(parties[0]._spectators.size, 0)
    await app.stop()
  })

  it('après un redémarrage, le 2e onglet d un joueur d une partie restaurée y est rattaché par µgame:play', async () => {
    const store = new MemoryPersistAdapter()
    const premier = await startApp({ persist: { adapter: store, debounce: 10 } })
    const a = await connecter(premier.transport, 'a')
    const b = await connecter(premier.transport, 'b')
    await a.request('µgame:play', { type: 'duel' })
    const partie = await b.request('µgame:play', { type: 'duel' })
    await tick(40)
    await premier.app.stop()
    const second = await startApp({ persist: { adapter: store, debounce: 10 } })
    const a2 = await connecter(second.transport, 'a')
    const rattache = await a2.request('µgame:play', { type: 'duel' })
    assert.equal(rattache.game, partie.game)
    assert.equal(rattache.seat, 0)
    await second.app.stop()
  })
})
