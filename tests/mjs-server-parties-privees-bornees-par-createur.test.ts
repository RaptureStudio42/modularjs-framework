// Un même créateur ne garde qu'un nombre borné de parties privées en cours (5 par défaut, réglable par
// opts.antiCheat.privateGamesPerCreator) : toutes ses parties par code pas encore finies où il siège encore comptent, complétées ou
// non, créées depuis une connexion ou plusieurs, quel que soit le type de jeu ; une table qu'il a quittée ne compte plus, même si
// d'autres y restent (une table vide qu'il quitte est fermée tout de suite). Un créateur anonyme est compté
// par adresse (par connexion quand le transport n'en donne pas). Sans cette borne, un jeu à une place, ou deux connexions qui se
// relaient (l'une crée, l'autre complète), gardaient vivantes autant de parties qu'elles envoyaient de demandes.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

/** MemoryTransport qui prête l'adresse `adresse` à chaque connexion ouverte (le transport mémoire n'en pose aucune) */
class TransportAdresse extends MemoryTransport {
  adresse: string | undefined = undefined
  onConnection(handler: (conn: any) => void): void {
    super.onConnection((conn: any) => { conn.remoteInfo.address = this.adresse; handler(conn) })
  }
}

async function startApp(opts: MjsServerOptions = {}, transport: MemoryTransport = new MemoryTransport()): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {}, ...opts })
  await app.listen()
  return { transport, app }
}

/** `id` absent : connexion anonyme (l'appli de test n'a alors pas d'`auth`) */
async function connecter(transport: MemoryTransport, id?: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + (id ?? 'anonyme'), id ? { auth: () => ({ id }), reconnect: { enabled: false } } : { reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

/** `n` demandes de création de partie par code depuis `sock`, chacune complétée par `complice` s'il est donné */
async function creer(sock: any, type: string, n: number, complice?: any): Promise<{ ids: string[]; refus: string[] }> {
  const ids: string[] = []
  const refus: string[] = []
  for (let i = 0; i < n; i++) {
    try {
      const r = await sock.request('µgame:play', { type, code: true })
      ids.push(r.game)
      if (complice) await complice.request('µgame:play', { type, code: r.code })
    }
    catch (e: any) {
      refus.push(String(e?.message ?? e))
    }
  }
  return { ids, refus }
}

async function vivantes(sock: any, ids: string[]): Promise<number> {
  let n = 0
  for (const id of ids) {
    try { await sock.request('µgame:resync', { game: id }); n++ }
    catch { /* partie disparue */ }
  }
  return n
}

const PLAFOND = /limite de parties privées en cours atteinte \(5\)/

describe('MJS-Server — parties privées en cours bornées par créateur', () => {
  it('deux connexions qui se relaient (A crée, B complète) : la 6e création est refusée, les 5 parties restent ; une table que A quitte ne compte plus', async () => {
    const { transport, app } = await startApp()
    app.game('salon', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const { ids, refus } = await creer(a, 'salon', 8, b)
    assert.equal(ids.length, 5)
    assert.equal(refus.length, 3)
    assert.match(refus[0], PLAFOND)
    assert.equal(await vivantes(a, ids), 5)
    await a.request('µgame:leave', { game: ids[0] })
    const sixieme = await a.request('µgame:play', { type: 'salon', code: true })
    // B siège déjà dans 5 parties privées (borne des joueurs assis, même valeur) : un autre invité complète la 6e
    const c = await connecter(transport, 'c')
    await c.request('µgame:play', { type: 'salon', code: sixieme.code })
    await assert.rejects(a.request('µgame:play', { type: 'salon', code: true }), PLAFOND)
    await app.stop()
  })

  it('jeu à une place, une seule connexion : 5 parties en cours au plus', async () => {
    const { transport, app } = await startApp()
    app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const { ids, refus } = await creer(a, 'solo', 8)
    assert.equal(ids.length, 5)
    assert.equal(refus.length, 3)
    assert.match(refus[2], PLAFOND)
    assert.equal(await vivantes(a, ids), 5)
    await app.stop()
  })

  it('la borne vaut pour l identité, toutes connexions et tous types de jeu confondus ; la partie en attente remplacée libère sa place', async () => {
    const { transport, app } = await startApp()
    app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a1 = await connecter(transport, 'a')
    const a2 = await connecter(transport, 'a')
    assert.equal((await creer(a1, 'solo', 3)).ids.length, 3)
    assert.equal((await creer(a2, 'solo', 1)).ids.length, 1)
    assert.equal((await creer(a2, 'duo', 1)).ids.length, 1)
    await assert.rejects(a1.request('µgame:play', { type: 'duo', code: true }), PLAFOND)
    // la partie « duo » en attente de a2 est remplacée par la nouvelle : le compte reste à 5
    const remplacante = await a2.request('µgame:play', { type: 'duo', code: true })
    assert.ok(remplacante.game)
    await app.stop()
  })

  it('une partie finie ne compte plus : son créateur peut en ouvrir une autre', async () => {
    const { transport, app } = await startApp()
    app.game('solo', { seats: 1, code: true, endTtl: 60000, state: () => ({}), moves: { fin: (g: any) => { g.end({ fini: true }) } } })
    const a = await connecter(transport, 'a')
    const { ids } = await creer(a, 'solo', 5)
    await assert.rejects(a.request('µgame:play', { type: 'solo', code: true }), PLAFOND)
    await a.request('µgame:move', { game: ids[0], move: 'fin' })
    const sixieme = await a.request('µgame:play', { type: 'solo', code: true })
    assert.ok(sixieme.game)
    await app.stop()
  })

  it('créateur anonyme : compté par adresse — deux connexions de la même adresse partagent la borne, une autre adresse a la sienne', async () => {
    const transport = new TransportAdresse()
    const app = mjsServer({ transport, heartbeat: 0, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    transport.adresse = '203.0.113.7'
    const x1 = await connecter(transport)
    const x2 = await connecter(transport)
    transport.adresse = '198.51.100.9'
    const y = await connecter(transport)
    assert.equal((await creer(x1, 'solo', 3)).ids.length, 3)
    const deuxieme = await creer(x2, 'solo', 4)
    assert.equal(deuxieme.ids.length, 2)
    assert.match(deuxieme.refus[0], PLAFOND)
    assert.equal((await creer(y, 'solo', 5)).ids.length, 5)
    await app.stop()
  })

  it('créateur anonyme sans adresse connue (transport mémoire) : compté par connexion', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    const c1 = await connecter(transport)
    const c2 = await connecter(transport)
    const premier = await creer(c1, 'solo', 6)
    assert.equal(premier.ids.length, 5)
    assert.match(premier.refus[0], PLAFOND)
    assert.equal((await creer(c2, 'solo', 5)).ids.length, 5)
    await app.stop()
  })

  it('réglable : antiCheat.privateGamesPerCreator abaisse la borne, null la retire, une valeur invalide est refusée au démarrage', async () => {
    const basse = await startApp({ antiCheat: { privateGamesPerCreator: 2 } })
    basse.app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    const a = await connecter(basse.transport, 'a')
    const r = await creer(a, 'solo', 3)
    assert.equal(r.ids.length, 2)
    assert.match(r.refus[0], /limite de parties privées en cours atteinte \(2\)/)
    await basse.app.stop()
    const sans = await startApp({ antiCheat: { privateGamesPerCreator: null } })
    sans.app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    const b = await connecter(sans.transport, 'b')
    assert.equal((await creer(b, 'solo', 8)).ids.length, 8)
    await sans.app.stop()
    for (const valeur of [0, 1.5, -2, Number.NaN, '3', [5]]) {
      assert.throws(() => mjsServer({ transport: new MemoryTransport(), antiCheat: { privateGamesPerCreator: valeur as any } }), /privateGamesPerCreator/, String(valeur))
    }
  })
})

describe('mjs.config.json — serveur.antiCheat.privateGamesPerCreator', () => {
  it('accepté (entier ≥ 1 ou null), refusé sinon', () => {
    for (const valeur of [3, null]) {
      const root = mjsTmp('cfg')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ serveur: { antiCheat: { privateGamesPerCreator: valeur } } }))
      assert.equal((findConfig(root)!.config.serveur as any).antiCheat.privateGamesPerCreator, valeur)
    }
    const root = mjsTmp('cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ serveur: { antiCheat: { privateGamesPerCreator: 0 } } }))
    assert.throws(() => findConfig(root), /privateGamesPerCreator/)
  })
})
