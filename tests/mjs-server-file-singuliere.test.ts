// matchmaking.ts — une connexion en file d'attente publique n'est JAMAIS dans deux files à la
// fois : s'inscrire pour un nouveau type retire d'abord le ticket d'un type précédent, sinon la
// déconnexion ne nettoie que la DERNIÈRE file et laisse un ticket fantôme dans la première.
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

describe('matchmaking — file d’attente publique, une connexion = une SEULE file', () => {
  it('rejoindre la file d’un 2e type retire le ticket du 1er ; la déconnexion ne laisse aucun fantôme derrière elle', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    app.game('typeA', { seats: 2, state: () => ({}), moves: {} })
    app.game('typeB', { seats: 2, state: () => ({}), moves: {} })

    const sX = connecter(transport, 'x'); sX.connect(); await tick()
    const repA1 = await sX.request('µgame:play', { type: 'typeA' })
    assert.deepEqual(repA1, { queue: 1 })
    const repB1 = await sX.request('µgame:play', { type: 'typeB' })   // même connexion, 2e type
    assert.deepEqual(repB1, { queue: 1 })

    sX._mjs_ws.close(1006, 'déconnexion pendant que x visait A puis B')
    await tick()

    const sY = connecter(transport, 'y'); sY.connect(); await tick()
    const repY = await sY.request('µgame:play', { type: 'typeA' })
    assert.deepEqual(repY, { queue: 1 }, 'y reste EN FILE — le ticket périmé de x doit avoir été retiré de la file A par le 2e µgame:play de x')
    await app.stop()
  })

  it('un client encore en vie qui change de file reste bien appariable dans la NOUVELLE file (non-régression)', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    app.game('typeC', { seats: 2, state: () => ({}), moves: {} })   // seats:2 — x SEUL y reste en file, jamais assis
    app.game('typeD', { seats: 1, state: () => ({}), moves: {} })

    const sX = connecter(transport, 'x2'); sX.connect(); await tick()
    await sX.request('µgame:play', { type: 'typeC' })
    const repD = await sX.request('µgame:play', { type: 'typeD' })   // change d’avis, vise D — seats:1 → assis immédiatement
    assert.equal(repD.seat, 0, 'x est bien assis dans la NOUVELLE file (typeD), son changement d’avis reste fonctionnel')
    await app.stop()
  })
})
