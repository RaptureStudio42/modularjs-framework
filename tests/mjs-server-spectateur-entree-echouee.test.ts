// Entrée d'un spectateur dont la vue lève (repli sur la `view` de l'auteur, appelée sans joueur) : la requête échouait, mais la
// connexion restait inscrite comme spectatrice — une erreur au journal à chaque diffusion (jusqu'à 60 par seconde en mode action).
// La vue est désormais calculée avant l'inscription : une entrée qui échoue ne laisse rien derrière elle.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('spectateur — entrée qui échoue', () => {
  it('la vue qui lève : requête en échec, connexion non inscrite, aucune erreur aux diffusions suivantes', () => {
    const journal: string[] = []
    const def  = resolveGameDef('main-par-siege', { seats: 2, code: true, state: () => ({}), view: (_g: any, p: any) => ({ main: p.seat }), moves: {} }, (_niveau: any, msg: string) => journal.push(msg))
    const game = createGame({ send() {} } as any, def, () => {}, 'g1')
    game._createSeat(fakeClient('A'))
    assert.throws(() => game._addSpectator(fakeClient('S')))
    assert.equal(game._spectators.size, 0)
    journal.length = 0
    game._broadcastToPlayers()
    game._broadcastToPlayers()
    assert.deepEqual(journal.filter(l => /spectat/i.test(l)), [])
    game._destroy()
  })

  it('une vue spectateur qui marche : la connexion est inscrite et reçoit sa vue (non-régression)', () => {
    const def  = resolveGameDef('vue-publique', { seats: 2, code: true, state: () => ({ tour: 1 }), spectatorView: (g: any) => ({ tour: g.state.tour }), moves: {} })
    const game = createGame({ send() {} } as any, def, () => {}, 'g2')
    const info = game._addSpectator(fakeClient('S'))
    assert.deepEqual(info, { view: { tour: 1 } })
    assert.equal(game._spectators.size, 1)
    game._destroy()
  })
})
