// lockstep.ts::receiveHash + matchmaking.ts::handlerHash — un numéro de tick NON ENTIER ne doit
// jamais être retenu : sans le garde-fou, une infinité de valeurs fractionnaires distinctes
// contournerait le plafond d'entrées conservées pour la détection de divergence.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLockstep } from '../src/mjs-server/lockstep.js'
import { mjsServer, resolveGameDef, createGame } from '../src/mjs-server/index.js'
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
function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('lockstep — tick non entier rejeté', () => {
  it('createLockstep().receiveHash ignore les ticks fractionnaires (aucune entrée retenue)', () => {
    const ls = createLockstep('t1', null)
    // i part de 1 — i*0.001 avec i=0 vaudrait 0, un tick ENTIER légitime (0*0.001===0), pas
    // fractionnaire : ce n'est pas le cas qu'on veut prouver ici
    for (let i = 1; i < 100; i++) ls.receiveHash('p1', i * 0.001, 'hash-' + i, 2)
    assert.equal(ls._hashSize(), 0, 'aucune entrée fractionnaire ne doit être retenue')
  })

  it('game._receiveHash (mode lockstep) ignore aussi un tick non entier reçu depuis l’extérieur', () => {
    const def = resolveGameDef('t2', { seats: 2, mode: 'lockstep', tick: 10, moves: {} })
    const game = createGame(fakeApp(), def, () => {}, 't2g')
    const c1 = fakeClient('p1')
    game._createSeat(c1)
    assert.doesNotThrow(() => game._receiveHash(c1, 0.5, 'unhash'))
    assert.equal(game._lockstep!._hashSize(), 0)
    game._destroy()
  })

  it('sur le fil (µgame:hash), un tick fractionnaire est silencieusement ignoré — jamais de divergence, même auto-contradictoire', async () => {
    const { transport, app } = await startApp({ onLog: () => {} })
    const divergences: any[] = []
    app.game('lk-frac', { seats: 2, mode: 'lockstep', tick: 20, moves: {}, onDivergence: (_g: any, d: any) => divergences.push(d) })
    const sx = connecter(transport, 'x'); sx.connect(); await tick()
    const sy = connecter(transport, 'y'); sy.connect(); await tick()
    await sx.request('µgame:play', { type: 'lk-frac' })              // mis en file
    const repY = await sy.request('µgame:play', { type: 'lk-frac' }) // appariement : porte l'id de la partie
    assert.equal(typeof repY.game, 'string', 'la partie doit exister pour que les trames atteignent le moteur lockstep')

    // même siège, MÊME tick fractionnaire, deux hash CONTRADICTOIRES — accepté, ce serait une
    // auto-contradiction immédiate (cf. lockstep.ts) ; rejeté (non entier), silence total attendu
    sx.send('µgame:hash', { game: repY.game, tick: 1.5, h: 'aaa' })
    sx.send('µgame:hash', { game: repY.game, tick: 1.5, h: 'zzz' })
    await tick(50)
    assert.equal(divergences.length, 0, 'aucune divergence — un tick fractionnaire n’aurait jamais dû être retenu')

    // témoin : le même geste sur un tick ENTIER atteint bien le moteur (la trame n'est pas
    // écartée plus tôt pour une autre raison) et révèle l'auto-contradiction
    sx.send('µgame:hash', { game: repY.game, tick: 2, h: 'aaa' })
    sx.send('µgame:hash', { game: repY.game, tick: 2, h: 'zzz' })
    await tick(50)
    assert.equal(divergences.length, 1, 'un tick entier contradictoire doit être détecté sur le fil')
    await app.stop()
  })
})
