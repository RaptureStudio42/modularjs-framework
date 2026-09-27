// matchmaking.ts::joinWithCode/joinAsSpectator — le TYPE demandé doit correspondre au type RÉEL de
// la partie visée par un code, sinon µgame:play {type:B, code:codeDeA} rejoindrait intégralement
// la partie A (vue/état RÉELS de A renvoyés à une requête déclarée B).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
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
function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function (url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}
async function startApp(opts: MjsServerOptions = {}): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...opts })
  await app.listen()
  return { transport, app }
}
function connecter(transport: MemoryTransport, id: string): any {
  const µ = makeClient(transport)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
}

describe('matchmaking — code de partie privée scopé au type', () => {
  it('µgame:play {type:B, code:codeDeA} est refusé « code inconnu » — jamais la vue/état de A', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    app.game('typeA', { seats: 2, code: true, state: () => ({ marqueur: 'etat-A' }), moves: {}, view: (g: any) => g.state })
    app.game('typeB', { seats: 2, code: true, state: () => ({ marqueur: 'etat-B' }), moves: {}, view: (g: any) => g.state })

    const fondateur = connecter(transport, 'f'); fondateur.connect(); await tick()
    const repFondateur = await fondateur.request('µgame:play', { type: 'typeA', code: true })

    const intrus = connecter(transport, 'i'); intrus.connect(); await tick()
    await assert.rejects(
      intrus.request('µgame:play', { type: 'typeB', code: repFondateur.code }),
      (e: any) => /code inconnu/i.test(String(e)),
      'une requête déclarée typeB avec le code d’une partie typeA doit être refusée',
    )
    await app.stop()
  })

  it('le rejoindre par le BON type fonctionne toujours (non-régression)', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    app.game('typeA', { seats: 2, code: true, state: () => ({ marqueur: 'etat-A' }), moves: {}, view: (g: any) => g.state })

    const fondateur = connecter(transport, 'f2'); fondateur.connect(); await tick()
    const repFondateur = await fondateur.request('µgame:play', { type: 'typeA', code: true })
    const rejoint = connecter(transport, 'j2'); rejoint.connect(); await tick()
    const repRejoint = await rejoint.request('µgame:play', { type: 'typeA', code: repFondateur.code })
    assert.equal(repRejoint.game, repFondateur.game)
    assert.deepEqual(repRejoint.view, { marqueur: 'etat-A' })
    await app.stop()
  })

  it('même refus côté spectateur — {type:B, code:codeDeA, spectator:true} refusé « code inconnu »', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    app.game('typeA', { seats: 2, code: true, state: () => ({}), moves: {} })
    app.game('typeB', { seats: 2, code: true, state: () => ({}), moves: {} })

    const fondateur = connecter(transport, 'f3'); fondateur.connect(); await tick()
    const repFondateur = await fondateur.request('µgame:play', { type: 'typeA', code: true })
    const regardeur = connecter(transport, 'r3'); regardeur.connect(); await tick()
    await assert.rejects(
      regardeur.request('µgame:play', { type: 'typeB', code: repFondateur.code, spectator: true }),
      (e: any) => /code inconnu/i.test(String(e)),
    )
    await app.stop()
  })
})
