// Lockstep — détection de divergence : seuls comptent les hash des joueurs assis au moment du décompte. Le hash d'un joueur parti
// restait compté : un menteur qui annonce un faux hash puis cède sa place à un complice faisait figer la référence sur le faux, à
// deux voix dont une seule assise, et les joueurs honnêtes passaient pour suspects. Le hash d'un joueur parti est oublié (ni compté
// ni blâmé), celui qui prend son siège ne vote que pour lui ; une référence déjà figée ne bouge plus
import assert from 'node:assert/strict'
import { createLockstep, resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}
function partie(id: string, divergences: any[]): any {
  const def = resolveGameDef('lockstep-parti', { mode: 'lockstep', seats: 3, tick: 10, moves: {}, onDivergence: (_g: any, info: any) => divergences.push(info) } as any)
  return createGame(fakeApp(), def, () => {}, id)
}

describe('MJS-Server — lockstep : le hash d\'un joueur parti ne compte plus', () => {
  it('un menteur annonce un faux hash puis part, son complice prend le siège et annonce le même : la référence ne se fige pas sur le faux, le complice est le seul suspect', () => {
    const divergences: any[] = []
    const game = partie('pparti1', divergences)
    const h1 = fakeClient('h1'), h2 = fakeClient('h2'), menteur = fakeClient('menteur'), complice = fakeClient('complice')
    game._createSeat(h1); game._createSeat(h2); game._createSeat(menteur)
    game._receiveHash(menteur, 3, 'faux')
    game._leave(menteur)
    game._createSeat(complice)
    game._receiveHash(complice, 3, 'faux')
    assert.deepEqual(divergences, [], 'un seul joueur assis annonce le faux : pas de majorité')
    game._receiveHash(h1, 3, 'vrai')
    game._receiveHash(h2, 3, 'vrai')
    assert.deepEqual(divergences, [{ tick: 3, suspects: ['complice'], reason: 'quorum' }], 'les honnêtes ne sont jamais suspects')
    game._destroy()
  })

  it('un joueur parti avant le décompte n\'est ni compté ni blâmé', () => {
    const divergences: any[] = []
    const game = partie('pparti2', divergences)
    const a = fakeClient('a'), b = fakeClient('b'), c = fakeClient('c')
    game._createSeat(a); game._createSeat(b); game._createSeat(c)
    game._receiveHash(c, 2, 'autre')
    game._leave(c)
    game._receiveHash(a, 2, 'pareil')
    game._receiveHash(b, 2, 'pareil')
    assert.deepEqual(divergences, [], 'c est parti : son hash est oublié')
    game._destroy()
  })

  it('receiveHash ne compte que les joueurs assis qu\'on lui passe, relus à chaque appel', () => {
    const ls = createLockstep('pparti3')
    assert.equal(ls.receiveHash('menteur', 1, 'faux', ['h1', 'h2', 'menteur']), null)
    assert.equal(ls.receiveHash('complice', 1, 'faux', ['h1', 'h2', 'complice']), null, 'le hash du menteur parti est oublié')
    assert.equal(ls.receiveHash('h1', 1, 'vrai', ['h1', 'h2', 'complice']), null)
    assert.deepEqual(ls.receiveHash('h2', 1, 'vrai', ['h1', 'h2', 'complice']), { tick: 1, suspects: ['complice'], reason: 'quorum' })
    assert.equal(ls.receiveHash('intrus', 1, 'autre', ['h1', 'h2', 'complice']), null, 'un joueur qui n\'est pas assis ne vote pas')
  })

  it('le joueur revenu sur un siège ne vote qu\'une fois, pour lui', () => {
    const ls = createLockstep('pparti4')
    ls.receiveHash('a', 1, 'A', ['a', 'b', 'c'])
    assert.equal(ls.receiveHash('c', 1, 'B', ['b', 'c']), null, 'a est parti : son vote est oublié')
    assert.equal(ls.receiveHash('a', 1, 'A', ['a', 'b', 'c']), null, 'a revient : un vote, le sien seul')
    assert.deepEqual(ls.receiveHash('b', 1, 'A', ['a', 'b', 'c']), { tick: 1, suspects: ['c'], reason: 'quorum' }, 'a et b, deux joueurs assis sur trois')
  })

  it('une référence figée ne bouge plus quand ses votants partent', () => {
    const ls = createLockstep('pparti5')
    ls.receiveHash('a', 1, 'A', ['a', 'b', 'c'])
    ls.receiveHash('b', 1, 'A', ['a', 'b', 'c'])
    assert.deepEqual(ls.receiveHash('d', 1, 'B', ['c', 'd']), { tick: 1, suspects: ['d'], reason: 'quorum' }, 'figée à deux voix sur trois, elle tient après leur départ')
  })
})
