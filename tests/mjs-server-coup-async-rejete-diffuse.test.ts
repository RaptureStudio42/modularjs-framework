// Un coup ASYNCHRONE modifie l'état puis rejette (paiement refusé après débit, par exemple) : la modification restait sur le serveur
// mais n'était diffusée à personne jusqu'à la mutation suivante (seule la réussite du coup déclenchait une 2e diffusion). Elle part
// désormais dans les deux cas, comme après une minuterie de l'appli : les joueurs voient l'état réel du serveur, et il est sauvegardé.
// Rien n'est annulé : ce que le coup a fait avant de rejeter reste fait, comme pour un coup synchrone qui lève.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

function recordingApp(): any {
  const sent: any[] = []
  return { send(c: any, type: string, p: any) { sent.push({ c, type, p: JSON.parse(JSON.stringify(p)) }) }, sent }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

describe('coup asynchrone qui modifie l\'état puis rejette', () => {
  it('la modification est diffusée et sauvegardée ; l\'erreur remonte à l\'appelant', async () => {
    const app = recordingApp()
    let sauvegardes = 0
    const def = resolveGameDef('achat', { seats: 1, state: () => ({ n: 0 }), moves: { acheter: async (g: any) => { await tick(5); g.state.n = 42; throw new Error('paiement refusé après débit') } } })
    const game = createGame(app, def, () => {}, 'g1')
    game._onMutate = () => { sauvegardes++ }
    const A = fakeClient('A')
    game._createSeat(A)
    await tick(5)
    const savAvant = sauvegardes
    let erreur: string | null = null
    try { await game._onMove(A, 'acheter', {}) } catch (err: any) { erreur = err.message }
    await tick(20)
    assert.equal(erreur, 'paiement refusé après débit')
    const trames = app.sent.filter((s: any) => s.type === 'µgame:state')
    assert.equal(trames[trames.length - 1].p.view.n, 42, 'la dernière vue diffusée ne montre pas l\'état du serveur')
    assert.ok(sauvegardes - savAvant >= 2, 'l\'état modifié n\'a pas été sauvegardé après le rejet')
    game._destroy()
  })
})
