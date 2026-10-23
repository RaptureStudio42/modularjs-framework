// Une partie non finie qui disparaît prévient ses spectateurs : `µgame:end { result: { cancelled: true, reason } }`. Avant, leur vue
// restait figée sur le dernier état quand la partie était fermée faute de joueurs (dernier siège parti d'une table jamais complète,
// ou grâce `emptyTtl` échue) ou annulée (`replaced`, `seat-expired`, envoyée aux seuls sièges). Une partie finie les a déjà prévenus
// à `.end()`, et l'arrêt du serveur ne leur dit rien : la partie sauvegardée revivra au redémarrage
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function fakeAppCapture(): any {
  const envoyes: any[] = []
  return { send: (client: any, type: string, p: any) => envoyes.push({ client, type, p }), _envoyes: envoyes }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}
const finsVers = (app: any, client: any) => app._envoyes.filter((e: any) => e.client === client && e.type === 'µgame:end').map((e: any) => e.p)

describe('MJS-Server — spectateurs prévenus de la fermeture d une partie non finie', () => {
  it('table jamais complète dont le dernier joueur part : µgame:end abandoned aux spectateurs', () => {
    const app  = fakeAppCapture()
    const game = createGame(app, resolveGameDef('table', { seats: 2, state: () => ({}), moves: {} }), () => {}, 'p1')
    const regardeur = fakeClient('r')
    game._addSpectator(regardeur)
    const joueur = fakeClient('j')
    game._createSeat(joueur)
    game._leave(joueur)
    assert.equal(game._destroyed, true)
    assert.deepEqual(finsVers(app, regardeur), [{ game: 'p1', result: { cancelled: true, reason: 'abandoned' } }])
  })

  it('partie commencée dont la grâce emptyTtl échue : µgame:end abandoned aux spectateurs', async () => {
    const app  = fakeAppCapture()
    const game = createGame(app, resolveGameDef('table', { seats: 2, emptyTtl: 20, state: () => ({}), moves: {} }), () => {}, 'p2')
    const regardeur = fakeClient('r')
    game._addSpectator(regardeur)
    const j1 = fakeClient('j1')
    const j2 = fakeClient('j2')
    game._createSeat(j1)
    game._createSeat(j2)
    game._started = true
    game._onDisconnect(j1)
    game._onDisconnect(j2)
    assert.equal(game._destroyed, false, 'la grâce attend le retour des joueurs')
    assert.deepEqual(finsVers(app, regardeur), [])
    await tick(80)
    assert.equal(game._destroyed, true)
    assert.deepEqual(finsVers(app, regardeur), [{ game: 'p2', result: { cancelled: true, reason: 'abandoned' } }])
  })

  it('annulation (partie privée remplacée) : les spectateurs reçoivent la même fin que les sièges', () => {
    const app  = fakeAppCapture()
    const game = createGame(app, resolveGameDef('table', { seats: 2, state: () => ({}), moves: {} }), () => {}, 'p3')
    const regardeur = fakeClient('r')
    game._addSpectator(regardeur)
    const createur = fakeClient('c')
    game._createSeat(createur)
    game._cancel('replaced')
    const attendu = [{ game: 'p3', result: { cancelled: true, reason: 'replaced' } }]
    assert.deepEqual(finsVers(app, createur), attendu)
    assert.deepEqual(finsVers(app, regardeur), attendu)
  })

  it('partie finie : une seule fin, celle de .end() ; arrêt du serveur : aucune fin', async () => {
    const app  = fakeAppCapture()
    const finie = createGame(app, resolveGameDef('table', { seats: 1, endTtl: 20, state: () => ({}), moves: {} }), () => {}, 'p4')
    const regardeur = fakeClient('r')
    finie._addSpectator(regardeur)
    finie._createSeat(fakeClient('j'))
    finie.end({ gagnant: 0 })
    await tick(80)
    assert.equal(finie._destroyed, true)
    assert.deepEqual(finsVers(app, regardeur), [{ game: 'p4', result: { gagnant: 0 } }])

    const vivante = createGame(app, resolveGameDef('table', { seats: 1, state: () => ({}), moves: {} }), () => {}, 'p5')
    const autre = fakeClient('r2')
    vivante._addSpectator(autre)
    vivante._createSeat(fakeClient('j2'))
    vivante._destroy()
    assert.deepEqual(finsVers(app, autre), [])
  })
})
