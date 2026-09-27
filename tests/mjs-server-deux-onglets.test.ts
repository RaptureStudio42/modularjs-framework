// game.ts::_buildFrame/_lastViews (def.deltas: true) — deux connexions pour la MÊME identité
// (deux onglets d'un même siège) doivent suivre leur PROPRE baseline de delta, PAR CONNEXION :
// la resynchronisation de l'une ne doit jamais figer/avancer la baseline de l'autre.
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

describe('deux onglets, une identité — baseline de delta PAR CONNEXION', () => {
  it('le resync du 2e onglet n’empêche pas le 1er de recevoir la trame suivante', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('do1', { seats: 1, state: () => ({ n: 0 }), moves: { bump: (g: any) => { g.state.n++ } }, deltas: true })
    const game = createGame(app, def, () => {}, 'do1g')
    const c1 = fakeClient('x')
    game._createSeat(c1)
    await tick()   // pose la baseline initiale (n=0) pour la connexion c1
    app._envoyes.length = 0

    game._onMove(c1, 'bump', {})   // state 0→1, SYNCHRONE — _markDirty() programme la diffusion (pas encore exécutée)
    const c2 = fakeClient('x')      // MÊME identité 'x', 2e onglet
    game._resync(c2)                // pose la baseline de c2 à la vue COURANTE (n=1), AVANT la diffusion

    await tick()   // laisse la microtâche de diffusion programmée par bump() s'exécuter

    const versC1 = app._envoyes.filter((e: any) => e.client === c1 && e.type === 'µgame:state')
    assert.equal(versC1.length, 1, 'le 1er onglet reçoit bien la trame suivante — sa baseline lui reste propre')
    const versC2 = app._envoyes.filter((e: any) => e.client === c2 && e.type === 'µgame:state')
    assert.equal(versC2.length, 0, 'le 2e onglet, lui, vient déjà de recevoir sa vue via le resync — rien de neuf pour lui ce round')
    game._destroy()
  })

  it('après le resync du 1er onglet (déconnexion/retour), le 2nd continue de recevoir ses propres deltas (non-régression)', async () => {
    const app = fakeAppCapture()
    const def = resolveGameDef('do2', { seats: 1, state: () => ({ n: 0 }), moves: { bump: (g: any) => { g.state.n++ } }, deltas: true })
    const game = createGame(app, def, () => {}, 'do2g')
    const c1 = fakeClient('y')
    game._createSeat(c1)
    await tick()
    const c2 = fakeClient('y')
    game._resync(c2)
    app._envoyes.length = 0

    game._onMove(c1, 'bump', {})
    await tick()

    const versC2 = app._envoyes.filter((e: any) => e.client === c2 && e.type === 'µgame:state')
    assert.equal(versC2.length, 1, 'le 2e onglet doit recevoir le changement, sa baseline n’a pas été gelée par le resync du 1er')
    game._destroy()
  })
})
