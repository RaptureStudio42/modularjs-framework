// game.ts::_onMove — un coup ASYNCHRONE (def.moves renvoie une Promise) mute l'état APRÈS la
// résolution de son gestionnaire : la diffusion initiale (avant résolution) ne suffit pas, une
// 2e trame doit partir une fois le coup réellement appliqué.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeAppCapture(): any {
  const envoyes: any[] = []
  return { send: (client: any, type: string, p: any) => envoyes.push({ client, type, p }), _envoyes: envoyes }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}
const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

describe('coup asynchrone — rediffusion après résolution', () => {
  it('une trame supplémentaire part une fois le coup résolu, avec le NOUVEL état', async () => {
    const app = fakeAppCapture()
    let liberer: () => void = () => {}
    const attente = new Promise<void>(r => { liberer = r })
    const def = resolveGameDef('ca1', {
      seats: 1, state: () => ({ n: 0 }),
      moves: { asyncMove: async (g: any) => { await attente; g.state.n = 1 } },
    })
    const game = createGame(app, def, () => {}, 'ca1g')
    const client = fakeClient('x')
    game._createSeat(client)
    await tick()   // laisse partir la 1re diffusion (n=0), pose la baseline
    app._envoyes.length = 0

    const p = game._onMove(client, 'asyncMove', {})   // démarre le move, SUSPENDU à `await attente`
    await tick()   // laisse tourner la microtâche de diffusion programmée AVANT que le move ne reprenne
    const framesAvant = app._envoyes.filter((e: any) => e.type === 'µgame:state').length

    liberer()          // le move reprend, mute state.n = 1
    await p             // attend la résolution complète (comme matchmaking.ts::handlerMove avec `await`)
    await tick()

    const framesApres = app._envoyes.filter((e: any) => e.type === 'µgame:state')
    assert.ok(framesApres.length > framesAvant, 'une diffusion SUPPLÉMENTAIRE doit partir après résolution du coup async')
    assert.equal(framesApres[framesApres.length - 1].p.view.n, 1, 'la dernière trame reflète le NOUVEL état (n=1), pas l’ancien')
    game._destroy()
  })

  it('un coup synchrone continue de ne produire qu’une seule diffusion (non-régression)', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('ca2', { seats: 1, state: () => ({ n: 0 }), moves: { inc: (g: any) => { g.state.n++ } } })
    const game = createGame(app, def, () => {}, 'ca2g')
    const client = fakeClient('x')
    game._createSeat(client)
    await tick()
    app._envoyes.length = 0

    game._onMove(client, 'inc', {})
    await tick()
    await tick()

    const frames = app._envoyes.filter((e: any) => e.type === 'µgame:state')
    assert.equal(frames.length, 1, 'un coup SYNCHRONE ne doit toujours produire qu’une trame')
    game._destroy()
  })
})
