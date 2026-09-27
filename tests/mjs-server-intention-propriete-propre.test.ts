// game.ts::_onMove — la liste blanche des coups/intentions n'accepte qu'une propriété PROPRE
// (Object.hasOwn) : un nom hérité de Object.prototype ('toString', 'valueOf'…) ne doit jamais être
// confondu avec un move/une intention réellement déclarés par l'auteur.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('_onMove — liste blanche par propriété propre (Object.hasOwn)', () => {
  it('"toString" comme move classique (aucun move déclaré) est rejeté « coup inconnu », jamais exécuté', () => {
    const def = resolveGameDef('ip1', { seats: 1, state: () => ({}), moves: {} })
    const game = createGame(fakeApp(), def, () => {}, 'ip1g')
    const client = fakeClient('p1')
    game._createSeat(client)
    assert.throws(() => game._onMove(client, 'toString', { x: 1 }), /coup inconnu/i)
    game._destroy()
  })

  it('"toString" comme intention (mode action, aucune intention déclarée) est rejeté — jamais mis en file orpheline', () => {
    const def = resolveGameDef('ip2', { seats: 1, tick: 10, state: () => ({}), moves: {} })
    const game = createGame(fakeApp(), def, () => {}, 'ip2g')
    const client = fakeClient('p1')
    game._createSeat(client)
    assert.throws(() => game._onMove(client, 'toString', { x: 1 }), /coup inconnu/i)
    assert.equal(game._intentQueue.size, 0, 'aucune file d’intention créée pour un nom hérité')
    game._destroy()
  })

  it('un VRAI move déclaré nommé "constructor" reste utilisable (non-régression — la liste blanche ne bloque pas un nom légitime qui collisionne avec le prototype)', () => {
    let appele = false
    const def = resolveGameDef('ip3', { seats: 1, state: () => ({}), moves: { constructor: () => { appele = true } } })
    const game = createGame(fakeApp(), def, () => {}, 'ip3g')
    const client = fakeClient('p1')
    game._createSeat(client)
    assert.doesNotThrow(() => game._onMove(client, 'constructor', {}))
    assert.equal(appele, true, 'un move légitimement nommé "constructor" doit toujours s’exécuter')
    game._destroy()
  })
})
