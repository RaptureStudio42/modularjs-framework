// sock.lobby — après une reconnexion, lobby:enter doit être rejoué : .members (et plus généralement
// l'état du hall) ne doit pas rester figé sur ce qu'il était au premier accès. Même patron que
// tests/socket-lobby.test.ts (VRAI serveur MJS-WS + lobbyPackage, MemoryTransport) + technique de
// coupure réelle de tests/mjs-ws-resume.test.ts (`_mjs_ws.close(1006, …)`, backoff court).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import type { MjsWsLobbyOptions } from '../src/mjs-ws/lobby.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const lobbySrc  = readFileSync(join(__dirname, '../src/runtime/mjs_lobby.ts'), 'utf8')
const clientSrc = socketSrc + '\n' + lobbySrc

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function reactiveState(init: any): any { return { ...init } }

function makeMu(): any {
  const µ: any = { state: reactiveState, error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}

async function startApp(lobbyOpts: MjsWsLobbyOptions = {}, wsOpts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, ...wsOpts })
  app.use(lobbyPackage({ onLog: () => {}, ...lobbyOpts }))
  await app.listen()
  return { transport, app }
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('sock.lobby — reconnexion : lobby:enter rejoué', () => {
  it('une coupure puis reconnexion rafraîchit .members avec ce qui a changé pendant la coupure', async () => {
    const { transport, app } = await startApp()
    const µA = makeClient(transport)
    const sA = µA.socket('memory://reco-a', { auth: () => zora, reconnect: { backoff: [30], jitter: 0 } })
    const hallA = sA.lobby()
    await tick()
    assert.equal(hallA.members.length, 1, 'A seul au hall pour commencer')

    sA._mjs_ws.close(1006, 'coupure simulée')   // coupure réseau — PAS un close() volontaire
    await tick()
    assert.equal(sA.state, 'reconnecting')

    // pendant que A est hors ligne, Theo rejoint le hall
    const µB = makeClient(transport)
    const sB = µB.socket('memory://reco-b', { auth: () => theo, reconnect: { enabled: false } })
    const hallB = sB.lobby()
    await tick()
    assert.equal(hallB.members.length, 2, 'Theo voit déjà Zora ET lui-même')

    await tick(60)   // le backoff (30ms) reconnecte A automatiquement
    assert.equal(sA.state, 'open')
    assert.equal(hallA.members.length, 2, 'lobby:enter rejoué à la reconnexion : A voit maintenant Theo aussi')
    assert.ok(hallA.members.some((p: any) => p.name === 'Theo'))

    sA.destroy(); sB.destroy(); await app.stop()
  })
})
