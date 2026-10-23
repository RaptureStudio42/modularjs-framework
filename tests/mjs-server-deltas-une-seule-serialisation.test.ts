// Mode deltas (def.deltas) : la vue de chaque joueur était sérialisée deux fois par trame, la seconde seulement pour mesurer sa
// longueur (le seuil « delta trop gros », 60 % de la vue). La longueur est désormais celle de la chaîne déjà produite : une seule
// sérialisation de la vue par trame et par connexion, pour la même trame.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// une sérialisation comptée : un JSON.stringify appelé depuis le serveur de jeu (src/mjs-server/), lu sur la pile d'appel ; le reste
// du process ne compte pas
const parLeServeur = (): boolean => /[\\/]src[\\/]mjs-server[\\/]/.test(new Error().stack ?? '')

// compte les sérialisations de la vue (repérée par sa marque) faites par le serveur pendant `fn`
function serialisationsDeLaVue(fn: () => unknown): { appels: number; retour: any } {
  const original = JSON.stringify
  let appels = 0
  let total  = 0
  let retour: any
  JSON.stringify = function(valeur: any, ...reste: any[]) {
    if (parLeServeur()) {
      total++
      if (valeur && typeof valeur === 'object' && valeur.marque === 'vue') appels++
    }
    return (original as any).call(JSON, valeur, ...reste)
  } as typeof JSON.stringify
  try {
    retour = fn()
  }
  finally {
    JSON.stringify = original
  }
  assert.ok(total > 0, 'aucune sérialisation du serveur comptée : le compte ne la voit plus')
  return { appels, retour }
}

function partie(): { game: any; joueur: any; client: any } {
  const def    = resolveGameDef('deltas', { seats: 1, deltas: true, state: () => ({ marque: 'vue', n: 0, liste: Array.from({ length: 50 }, (_v, i) => 'case-' + i) }), moves: {} })
  const game   = createGame({ send() {} } as any, def, () => {}, 'g1')
  const client = fakeClient('A')
  const joueur = game._createSeat(client)
  game._buildFrame(joueur, client)
  return { game, joueur, client }
}

describe('mode deltas — une seule sérialisation de la vue par trame', () => {
  it('trame delta : la vue n\'est sérialisée qu\'une fois, le delta est le même', () => {
    const { game, joueur, client } = partie()
    game.state.n = 1
    const { appels, retour } = serialisationsDeLaVue(() => game._buildFrame(joueur, client))
    assert.deepEqual(retour.delta, [{ p: 'n', v: 1 }])
    assert.equal(appels, 1)
    game._destroy()
  })

  it('delta trop gros : repli sur la vue complète, au même seuil (non-régression)', () => {
    const { game, joueur, client } = partie()
    game.state.liste = game.state.liste.map((c: string) => c + '-bis')
    const { appels, retour } = serialisationsDeLaVue(() => game._buildFrame(joueur, client))
    assert.equal(retour.delta, undefined)
    assert.equal(retour.view.liste[0], 'case-0-bis')
    assert.equal(appels, 1)
    game._destroy()
  })
})
