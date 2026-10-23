// game.journal (les 200 derniers coups acceptés, usage interne) ne garde plus la charge `p` des coups : `{ move, player, at }`,
// la forme que garde déjà la sauvegarde. Avant, chaque partie retenait jusqu'à 200 charges de 64 Ko (12,8 Mo) que rien ne relisait
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('MJS-Server — journal des coups sans la charge des coups', () => {
  it('un coup accepté est journalisé { move, player, at }, sans sa charge, et le coup reçoit bien sa charge', () => {
    const recus: unknown[] = []
    const def  = resolveGameDef('journal', { seats: 1, state: () => ({ n: 0 }), moves: { pose: (g: any, _j: any, p: any) => { recus.push(p); g.state.n++ } } })
    const game = createGame(fakeApp(), def, () => {}, 'jx')
    try {
      const joueur = fakeClient('a')
      game._createSeat(joueur)
      const charge = { gros: 'x'.repeat(60000) }
      game._onMove(joueur, 'pose', charge)
      assert.equal(recus[0], charge)
      assert.equal(game.state.n, 1)
      assert.equal(game.journal.length, 1)
      assert.deepEqual(Object.keys(game.journal[0]).sort(), ['at', 'move', 'player'])
      assert.equal(game.journal[0].move, 'pose')
      assert.equal(game.journal[0].player, 'a')
    }
    finally {
      game._destroy()
    }
  })
})
