// Avec le nonce anti-rejeu actif, chaque requête signée parcourait TOUS les nonces retenus (fenêtre jusqu'à
// 10 min) pour purger les échus : coût quadratique dès que le back pousse beaucoup (40 000 requêtes : 6,3 s).
// Désormais la purge passe au plus une fois par seconde ; la décision pour le nonce reçu reste exacte (son
// échéance à lui est toujours comparée), et la mémoire reste bornée.
import assert from 'node:assert/strict'
import { createBridgeNonceStore, REPLAY_WINDOW_S } from '../src/mjs-ws/bridge.js'

const T = 1_700_000_000_000

describe('MJS-WS — pont : nonces anti-rejeu purgés au plus une fois par seconde', () => {
  it('une requête qui suit la précédente de moins d\'une seconde ne parcourt pas la table', () => {
    const store = createBridgeNonceStore()
    // signé 300 s avant T : son échéance tombe pile à T
    assert.equal(store.checkAndRecord('nonce-ancien', T - REPLAY_WINDOW_S * 1000, T), true)
    // 1 ms plus tard, l'ancien est échu ; aucune purge n'a lieu pour autant
    assert.equal(store.checkAndRecord('nonce-neuf', T, T + 1), true)
    assert.equal(store.size, 2, 'la table a été parcourue à la deuxième requête')
  })

  it('la décision reste exacte sans purge : un nonce échu est de nouveau admis, un rejeu dans sa fenêtre refusé', () => {
    const store = createBridgeNonceStore()
    assert.equal(store.checkAndRecord('nonce-a', T - REPLAY_WINDOW_S * 1000, T), true)
    assert.equal(store.checkAndRecord('nonce-b', T, T + 1), true)
    assert.equal(store.checkAndRecord('nonce-a', T, T + 2), true, 'nonce-a échu (non purgé) : de nouveau admis')
    assert.equal(store.checkAndRecord('nonce-b', T, T + 3), false, 'rejeu de nonce-b dans sa fenêtre : refusé')
    assert.equal(store.checkAndRecord('nonce-a', T, T + 4), false, 'rejeu de nonce-a réenregistré : refusé')
  })

  it('la purge passe dès qu\'une seconde s\'est écoulée : les nonces échus quittent la table', () => {
    const store = createBridgeNonceStore()
    for (let i = 0; i < 100; i++) store.checkAndRecord('nonce-'+ i, T, T + i)
    assert.equal(store.size, 100)
    const apres = T + REPLAY_WINDOW_S * 1000 + 1
    assert.equal(store.checkAndRecord('nonce-tardif', apres, apres), true)
    assert.equal(store.size, 1, 'les 100 nonces échus devaient être purgés')
  })

  it('une horloge qui recule ne suspend pas la purge', () => {
    const store = createBridgeNonceStore()
    store.checkAndRecord('nonce-1', T + 3_600_000, T + 3_600_000)
    // l'horloge recule d'une heure : la purge passe quand même, le nonce déjà échu à ce nouvel instant part
    store.checkAndRecord('nonce-2', T - REPLAY_WINDOW_S * 1000 - 10, T)
    assert.equal(store.size, 1)
  })
})
