// Mode action : une intention termine la partie (game.end()) pendant un tick. Les intentions suivantes du MÊME tick (l'autre joueur)
// et def.simulate tournaient encore après la fin et modifiaient l'état final (le score de l'autre joueur compté après la victoire).
// Après la fin, plus rien ne tourne dans ce tick ; l'état final, lui, part encore aux joueurs (c'est la dernière trame).
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function recordingApp(): any {
  const sent: any[] = []
  return { send(c: any, type: string, p: any) { sent.push({ c, type, p: JSON.parse(JSON.stringify(p)) }) }, sent }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('mode action — fin de partie décidée par une intention', () => {
  it('ni les intentions suivantes du tick ni simulate ne tournent après la fin ; l\'état final est diffusé', () => {
    const app = recordingApp()
    const def = resolveGameDef('but-en-or', {
      seats: 2, tick: 20,
      state: () => ({ score: {} as Record<string, number>, intentionsApresFin: 0, simulationsApresFin: 0 }),
      intents: {
        but: (g: any, p: any) => {
          if (g._ended) g.state.intentionsApresFin++
          g.state.score[p.id] = (g.state.score[p.id] ?? 0) + 1
          g.end({ gagnant: p.id })
        },
      },
      simulate: (g: any) => { if (g._ended) g.state.simulationsApresFin++ },
      moves: {},
    })
    const game = createGame(app, def, () => {}, 'g1')
    const A = fakeClient('A')
    const B = fakeClient('B')
    game._createSeat(A)
    game._createSeat(B)
    game._stopTickLoop()
    game._onMove(A, 'but', {})
    game._onMove(B, 'but', {})
    app.sent.length = 0
    game._runTick()
    const etat = game.state as any
    assert.deepEqual(etat.score, { A: 1 })
    assert.equal(etat.intentionsApresFin, 0)
    assert.equal(etat.simulationsApresFin, 0)
    const fins = app.sent.filter((s: any) => s.type === 'µgame:end')
    assert.equal(fins.length, 2, 'une fin par siège')
    assert.deepEqual(fins[0].p.result, { gagnant: 'A' })
    const trames = app.sent.filter((s: any) => s.type === 'µgame:state')
    assert.equal(trames.length, 2, 'l\'état final part à chaque siège')
    assert.deepEqual(trames[trames.length - 1].p.view.score, { A: 1 })
    assert.equal(game._intentQueue.size, 0, 'la file des intentions est vidée')
    game._destroy()
  })
})
