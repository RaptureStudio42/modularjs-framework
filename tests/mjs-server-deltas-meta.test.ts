// game.ts::_buildFrame (def.deltas: true) — un changement de phase/tour/_ack SANS changement de
// vue doit quand même partir (trame méta seule, sans `view` ni `delta`) ; à l'inverse, quand RIEN
// n'a changé (ni la vue ni la méta), toujours aucune trame.
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

describe('deltas — changement de méta sans changement de vue', () => {
  it('un changement de TOUR seul (aucune mutation de state) produit une trame MÉTA (sans view ni delta)', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('dm1', { seats: 2, state: () => ({ n: 0 }), moves: {}, turns: { order: 'roundrobin' }, deltas: true })
    const game = createGame(app, def, () => {}, 'dm1g')
    const c1 = fakeClient('p1'); const c2 = fakeClient('p2')
    game._createSeat(c1); game._createSeat(c2)
    await tick()   // pose la baseline (vue identique pour les 2)
    app._envoyes.length = 0

    game.next()   // change SEULEMENT this.turn — state (et la vue) ne bouge pas
    await tick()

    const versC1 = app._envoyes.filter((e: any) => e.client === c1 && e.type === 'µgame:state')
    assert.equal(versC1.length, 1, 'un changement de tour SEUL doit quand même produire une trame')
    assert.equal(versC1[0].p.turn, 'p1')
    assert.equal('view' in versC1[0].p, false, 'pas de view — la vue, elle, n’a pas changé')
    assert.equal('delta' in versC1[0].p, false, 'pas de delta non plus — rien à décrire côté vue')
    game._destroy()
  })

  it('sans AUCUN changement (ni méta ni vue), toujours aucune trame (comportement inchangé)', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('dm2', { seats: 1, state: () => ({ n: 0 }), moves: {}, deltas: true })
    const game = createGame(app, def, () => {}, 'dm2g')
    const c1 = fakeClient('p1')
    game._createSeat(c1)
    await tick()
    app._envoyes.length = 0

    game._markDirty()
    await tick()

    const versC1 = app._envoyes.filter((e: any) => e.client === c1 && e.type === 'µgame:state')
    assert.equal(versC1.length, 0, 'aucune trame quand rien n’a changé, ni la vue ni la méta')
    game._destroy()
  })

  it('un changement de VUE, lui, continue de partir normalement (non-régression)', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('dm3', { seats: 1, state: () => ({ n: 0 }), moves: {}, deltas: true })
    const game = createGame(app, def, () => {}, 'dm3g')
    const c1 = fakeClient('p1')
    game._createSeat(c1)
    await tick()
    app._envoyes.length = 0

    game.state.n = 1
    game._markDirty()
    await tick()

    const versC1 = app._envoyes.filter((e: any) => e.client === c1 && e.type === 'µgame:state')
    assert.equal(versC1.length, 1)
    game._destroy()
  })
})
