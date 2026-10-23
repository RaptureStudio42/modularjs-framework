// Tour par tour : le joueur qui a la main quitte son siège (départ volontaire, ou entrée refusée après coup par hooks.onJoin).
// En « roundrobin », le tour revenait au PREMIER siège au lieu du suivant (un joueur rejouait aussitôt, un autre était sauté) ;
// un joueur refusé après coup gardait le tour (l'autre recevait « ce n'est pas votre tour » jusqu'à l'échéance de turns.timeout).
// Le tour passe désormais au siège occupé qui suit celui qu'il vient de quitter, en bouclant.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

function partie(seats: number, extra: any = {}): any {
  const def = resolveGameDef('tour-' + seats, { seats, state: () => ({}), moves: { jouer: (g: any) => { g.next() } }, turns: { order: 'roundrobin', timeout: 60000 }, ...extra })
  return createGame({ send() {} } as any, def, () => {}, 'g-' + seats)
}

describe('tour par tour — le détenteur du tour quitte son siège', () => {
  it('départ du 2e de trois : le tour va au 3e, pas au 1er', () => {
    const game = partie(3)
    const [A, B, C] = ['A', 'B', 'C'].map(fakeClient)
    game._createSeat(A); game._createSeat(B); game._createSeat(C)
    game.next()
    game._onMove(A, 'jouer', {})
    assert.equal(game.turn, 'B')
    game._leave(B)
    assert.equal(game.turn, 'C')
    game._destroy()
  })

  it('départ du 2e de quatre : le tour va au 3e', () => {
    const game = partie(4)
    const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(fakeClient)
    for (const c of [A, B, C, D]) game._createSeat(c)
    game.next()
    game._onMove(A, 'jouer', {})
    game._leave(B)
    assert.equal(game.turn, 'C')
    game._destroy()
  })

  it('départ du dernier siège : le tour boucle sur le premier', () => {
    const game = partie(3)
    const [A, B, C] = ['A', 'B', 'C'].map(fakeClient)
    game._createSeat(A); game._createSeat(B); game._createSeat(C)
    game.next()
    game._onMove(A, 'jouer', {})
    game._onMove(B, 'jouer', {})
    assert.equal(game.turn, 'C')
    game._leave(C)
    assert.equal(game.turn, 'A')
    game._destroy()
  })

  it('entrée refusée après coup (Promise de onJoin rejetée) du joueur qui a la main : le tour passe, l\'autre joue sans attendre', async () => {
    let rejeterB: (err: Error) => void = () => {}
    const game = partie(2, { hooks: { onJoin: (_g: any, p: any) => { if (p.id === 'B') return new Promise((_r: any, rej: any) => { rejeterB = rej }) } } })
    const [A, B] = ['A', 'B'].map(fakeClient)
    game._createSeat(A); game._createSeat(B)
    game.next()
    game._onMove(A, 'jouer', {})
    assert.equal(game.turn, 'B')
    rejeterB(new Error('banni'))
    await tick(10)
    assert.equal(game.players[1], null, 'B aurait dû être retiré')
    assert.equal(game.turn, 'A')
    assert.equal(game._timers.has('µturn'), true, 'la minuterie du tour est réarmée pour A')
    game._onMove(A, 'jouer', {})
    game._destroy()
  })

  it('siège défait avant son annonce alors qu\'il avait la main : le tour passe au siège suivant', () => {
    const game = partie(3)
    const [A, B, C] = ['A', 'B', 'C'].map(fakeClient)
    game._createSeat(A)
    const siegeB = game._createSeat(B)
    game._createSeat(C)
    game.turn = 'B'
    game._dropSeat(siegeB)
    assert.equal(game.players[1], null)
    assert.equal(game.turn, 'C')
    game._destroy()
  })
})
