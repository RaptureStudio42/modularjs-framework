// Une même identité ne siège que dans un nombre borné de parties privées en cours (la valeur de antiCheat.privateGamesPerCreator,
// 5 par défaut), qu'elle les ait créées ou rejointes par code : vérifié à la création comme à l'entrée par code. Avant, deux
// connexions qui se relayaient (A crée, B complète, A quitte) gardaient vivantes autant de parties qu'elles en demandaient : la
// borne des créateurs ne compte que les parties où le créateur siège encore, et B, simple invité, n'était borné nulle part.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {}, ...opts })
  await app.listen()
  app.game('duo', { seats: 2, code: true, endTtl: 60000, state: () => ({}), moves: { fin: (g: any) => { g.end({ fini: true }) } } })
  app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

/** `n` relais : `createur` crée une partie « duo », `invite` la complète par son code, puis `createur` la quitte (s'il est dit) */
async function relayer(createur: any, invite: any, n: number, quitter = true): Promise<{ ids: string[]; codes: string[]; refus: string[] }> {
  const ids: string[] = []
  const codes: string[] = []
  const refus: string[] = []
  for (let i = 0; i < n; i++) {
    const r = await createur.request('µgame:play', { type: 'duo', code: true })
    try {
      await invite.request('µgame:play', { type: 'duo', code: r.code })
      ids.push(r.game)
      codes.push(r.code)
    }
    catch (e: any) {
      refus.push(String(e?.message ?? e))
    }
    if (quitter) await createur.request('µgame:leave', { game: r.game })
  }
  return { ids, codes, refus }
}

async function vivantes(sock: any, ids: string[]): Promise<number> {
  let n = 0
  for (const id of ids) {
    try { await sock.request('µgame:resync', { game: id }); n++ }
    catch { /* partie disparue */ }
  }
  return n
}

const SIEGES = /vous siégez déjà dans 5 parties privées en cours/

describe('MJS-Server — parties privées en cours bornées par joueur assis, créateur ou invité', () => {
  it('relais A crée, B complète, A quitte : B ne siège que dans 5 parties, la 6e entrée par code est refusée et la partie vide fermée', async () => {
    const { transport, app } = await startApp()
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const { ids, refus } = await relayer(a, b, 8)
    assert.equal(ids.length, 5)
    assert.equal(refus.length, 3)
    assert.match(refus[0], SIEGES)
    assert.equal(await vivantes(b, ids), 5)
    // une partie que B quitte libère sa place
    await b.request('µgame:leave', { game: ids[0] })
    assert.equal((await relayer(a, b, 1)).ids.length, 1)
    await app.stop()
  })

  it('à la création aussi : assis comme invité dans 3 parties et comme créateur dans 2, B ne peut pas en créer une 6e, toutes connexions et tous types confondus', async () => {
    const { transport, app } = await startApp()
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    assert.equal((await relayer(a, b, 3)).ids.length, 3)
    assert.ok((await b.request('µgame:play', { type: 'solo', code: true })).game)
    assert.ok((await b.request('µgame:play', { type: 'duo', code: true })).game)
    // la partie « duo » en attente de B est remplacée par la nouvelle : le compte reste à 5
    assert.ok((await b.request('µgame:play', { type: 'duo', code: true })).game)
    const b2 = await connecter(transport, 'b')
    await assert.rejects(b2.request('µgame:play', { type: 'solo', code: true }), SIEGES)
    await app.stop()
  })

  it('un 2e onglet de la même identité se rattache toujours à une partie où elle siège déjà, même à la borne', async () => {
    const { transport, app } = await startApp()
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const { codes } = await relayer(a, b, 5)
    const b2 = await connecter(transport, 'b')
    const r = await b2.request('µgame:play', { type: 'duo', code: codes[4] })
    assert.equal(typeof r.seat, 'number')
    await app.stop()
  })

  it('une partie finie ne compte plus : l invité peut en rejoindre une autre', async () => {
    const { transport, app } = await startApp()
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const { ids } = await relayer(a, b, 5, false)
    const c = await connecter(transport, 'c')
    assert.equal((await relayer(c, b, 1)).refus.length, 1)
    await b.request('µgame:move', { game: ids[0], move: 'fin' })
    assert.equal((await relayer(c, b, 1)).ids.length, 1)
    await app.stop()
  })

  it('un joueur ordinaire, assis dans quelques parties privées créées ou rejointes, ne voit jamais la borne', async () => {
    const { transport, app } = await startApp()
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    assert.equal((await relayer(a, b, 2, false)).refus.length, 0)
    assert.equal((await relayer(b, a, 2, false)).refus.length, 0)
    await app.stop()
  })

  it('réglable par la même valeur : antiCheat.privateGamesPerCreator abaisse la borne, null la retire', async () => {
    const basse = await startApp({ antiCheat: { privateGamesPerCreator: 2 } })
    const r = await relayer(await connecter(basse.transport, 'a'), await connecter(basse.transport, 'b'), 3)
    assert.equal(r.ids.length, 2)
    assert.match(r.refus[0], /vous siégez déjà dans 2 parties privées en cours/)
    await basse.app.stop()
    const sans = await startApp({ antiCheat: { privateGamesPerCreator: null } })
    assert.equal((await relayer(await connecter(sans.transport, 'a'), await connecter(sans.transport, 'b'), 8)).ids.length, 8)
    await sans.app.stop()
  })

  it('le refus a son message en français et en anglais, au vouvoiement', () => {
    const vars = { max: 5 }
    assert.match((fr as any)['serveur.matchmaking-parties-privees-siege-limite'](vars), SIEGES)
    assert.match((en as any)['serveur.matchmaking-parties-privees-siege-limite'](vars), /you already have a seat in 5 private games in progress/)
  })
})
