// game.ts — une partie TERMINÉE (.end() déjà appelé) doit le rester : une resynchronisation d'un
// siège encore connecté ne doit ni annuler son compte à rebours de fermeture (µempty) ni relancer
// sa boucle de simulation ; persistée puis rechargée après un redémarrage, elle refuse toujours
// les coups et ne rappelle jamais son hook de fin.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('partie terminée — reste terminée', () => {
  it('une resynchronisation après .end() ne désarme pas µempty et ne relance pas la boucle de tick', () => {
    const def = resolveGameDef('pt1', { seats: 1, tick: 10, state: () => ({ n: 0 }), moves: {}, emptyTtl: 5000 })
    const game = createGame(fakeApp(), def, () => {}, 'pt1g')
    const client = fakeClient('p1')
    game._createSeat(client)
    assert.notEqual(game._tickHandle, null, 'sanity : la boucle de tick tourne après création du siège')

    game.end({ ok: true })
    assert.equal(game._tickHandle, null, 'sanity : .end() coupe bien la boucle')
    assert.equal(game._timers.has('µempty'), true, 'sanity : .end() arme bien la grâce de fermeture')

    game._resync(client)   // même client, toujours connecté

    assert.equal(game._timers.has('µempty'), true, 'la resync d’une partie finie ne doit PAS désarmer la grâce de fermeture')
    assert.equal(game._tickHandle, null, 'la resync d’une partie finie ne doit PAS relancer la boucle de tick')
    game._destroy()
  })

  it('serialize()/restoreGame conservent l’état terminé et le résultat — un coup après restauration reste refusé, onEnd n’est jamais rappelé', () => {
    let onEndAppele = 0
    const def = resolveGameDef('pt2', {
      seats: 1, state: () => ({ n: 0 }),
      moves: { jouer: (g: any) => { g.state.n++ }, finir: (g: any) => { g.end({ gagnant: true }) } },
      hooks: { onEnd: () => { onEndAppele++ } },
    })
    const game = createGame(fakeApp(), def, () => {}, 'pt2g')
    const client = fakeClient('x')
    game._createSeat(client)
    game._onMove(client, 'finir', {})
    assert.equal(onEndAppele, 1)
    assert.throws(() => game._onMove(client, 'jouer', {}), /termin/i, 'sanity : un coup après .end() est refusé sur l’instance ORIGINALE')

    const snap = game.serialize()
    const json = JSON.parse(JSON.stringify(snap))
    assert.equal(json.ended, true, 'l’état terminé doit apparaître dans l’instantané')
    assert.deepEqual(json.result, { gagnant: true }, 'le résultat de .end() doit apparaître dans l’instantané')

    const restored = restoreGame(fakeApp(), def, () => {}, json)
    assert.equal(restored._ended, true, 'la partie restaurée doit se savoir terminée')

    const client2 = fakeClient('x')   // même identité, nouvelle connexion — cas normal après redémarrage
    assert.throws(() => restored._onMove(client2, 'jouer', {}), /termin/i, 'un coup après restauration doit rester refusé')
    assert.equal((restored.state as any).n, 0, 'le coup refusé n’a jamais muté l’état')
    assert.equal(onEndAppele, 1, 'onEnd ne doit JAMAIS être rappelé par une restauration (idempotence de .end())')
    restored._destroy()
    game._destroy()
  })
})
