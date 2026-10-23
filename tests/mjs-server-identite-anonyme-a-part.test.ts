// Un joueur anonyme (sans identité stable) a pour identité de siège une valeur tirée de son id de connexion ; un compte dont l'id
// valait cet id de connexion (`c5`, dans une appli où l'on choisit son pseudo) faisait µgame:resync et reprenait le siège de
// l'anonyme, avec sa vue secrète. Les deux espaces de noms sont désormais séparés : l'identité d'un anonyme est `anon:` suivi de son
// id de connexion. Un identity.id objet sans conversion propre (`[object Object]` pour tous) est traité comme une absence d'identité
// stable : sinon tous ces joueurs partageaient le même siège.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, peerIdOf } from '../src/mjs-server/index.js'

function client(connId: string, identity: unknown): any {
  return { id: connId, identity, latency: null, meta: {}, send() {}, close() {} }
}

function partie(): any {
  const def = resolveGameDef('main-cachee', { seats: 2, state: () => ({}), view: (_g: any, p: any) => ({ secret: p ? 'main-du-siege-' + p.seat : null }), moves: {} })
  return createGame({ send() {} } as any, def, () => {}, 'g1')
}

describe('identité de siège — anonymes et comptes séparés', () => {
  it('l\'identité d\'un anonyme est préfixée : elle ne vaut jamais un id de compte', () => {
    assert.equal(peerIdOf(client('c5', null)), 'anon:c5')
    assert.equal(peerIdOf(client('c5', { id: 'c5' })), 'c5')
    assert.notEqual(peerIdOf(client('c5', null)), peerIdOf(client('c9', { id: 'c5' })))
  })

  it('un compte dont l\'id vaut l\'id de connexion d\'un anonyme ne reprend pas son siège (resync refusé)', () => {
    const game = partie()
    const anonyme = client('c5', null)
    game._createSeat(anonyme)
    const intrus = client('c9', { id: 'c5' })
    assert.throws(() => game._resync(intrus))
    assert.deepEqual(Array.from(game.players[0].clients).map((c: any) => c.id), ['c5'])
    game._destroy()
  })

  it('un compte dont l\'id recopie l\'identité diffusée de l\'anonyme (`anon:c5`) ne reprend pas son siège non plus', () => {
    const game = partie()
    game._createSeat(client('c5', null))
    assert.equal(game.players[0].id, 'anon:c5')
    assert.throws(() => game._resync(client('c9', { id: 'anon:c5' })))
    assert.equal(peerIdOf(client('c9', { id: 'anon:c5' })), 'anon:anon:c5')
    assert.equal(peerIdOf(client('c9', { id: 'anon:c5' })), peerIdOf(client('c10', { id: 'anon:c5' })), 'ce compte garde une identité stable')
    game._destroy()
  })

  it('ce compte qui entre dans la partie prend un autre siège', () => {
    const game = partie()
    game._createSeat(client('c5', null))
    const siege = game._createSeat(client('c9', { id: 'c5' }))
    assert.equal(siege.seat, 1)
    assert.equal(game.players.filter((j: any) => j).length, 2)
    game._destroy()
  })

  it('identity.id objet sans conversion propre : chaque connexion a son propre siège', () => {
    const game = partie()
    const a = game._createSeat(client('c1', { id: {} }))
    const b = game._createSeat(client('c2', { id: { nom: 'x' } }))
    assert.notEqual(a.seat, b.seat)
    assert.equal(peerIdOf(client('c1', { id: {} })), 'anon:c1')
    game._destroy()
  })

  it('identity.id objet qui se convertit en chaîne (identifiant de base de données) : identité stable gardée', () => {
    const oid = { toString: () => '65f0c0ffee' }
    assert.equal(peerIdOf(client('c1', { id: oid })), '65f0c0ffee')
    assert.equal(peerIdOf(client('c2', { id: 42 })), '42')
  })
})
