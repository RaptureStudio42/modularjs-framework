// bridge.ts — le nonce anti-rejeu doit rester retenu jusqu'à HORODATAGE SIGNÉ + fenêtre de validité,
// pas seulement jusqu'à RÉCEPTION + fenêtre : sinon un nonce peut être évincé (mémoire) alors que son
// horodatage signé est ENCORE jugé valide par verifyIncomingSignature — le rejeu redevient possible.
import assert from 'node:assert/strict'
import { createBridgeNonceStore, REPLAY_WINDOW_S } from '../src/mjs-ws/bridge.js'

describe('MJS-WS — bridge.ts, fenêtre du nonce alignée sur l\'horodatage SIGNÉ', () => {
  it('checkAndRecord prend l\'horodatage SIGNÉ en argument — pas seulement l\'instant de réception', () => {
    // arité : (nonce, signedTsMs, now?) — 2 paramètres SANS défaut (nonce, signedTsMs), le 3e
    // (now) a un défaut donc ne compte pas dans .length. Preuve STRUCTURELLE, indépendante de tout
    // calcul temporel : SANS ce paramètre, aucune formule de fenêtre ne peut suivre le ts signé.
    assert.ok(createBridgeNonceStore().checkAndRecord.length >= 2, 'checkAndRecord(nonce, signedTsMs, now?) attendu — signature actuelle trop courte')
  })

  it('rejeu après la fenêtre de RÉCEPTION mais dans la fenêtre de l\'horodatage SIGNÉ : toujours rejeté, PUIS relâché une fois SA fenêtre à lui dépassée', () => {
    const store = createBridgeNonceStore()
    const T = 1_700_000_000_000
    // horodatage signé tout juste dans la fenêtre FUTURE (horloge émetteur en avance) — valide à réception T
    const signedTsMs = T + (REPLAY_WINDOW_S - 0.001) * 1000
    const nonce = 'nonce-b19'
    assert.equal(store.checkAndRecord(nonce, signedTsMs, T), true, 'accepté + enregistré à T')

    // rejeu à T + fenêtre DE RÉCEPTION + 1ms — le MÊME horodatage signé, LUI, est ENCORE dans SA
    // fenêtre de validité (verifyIncomingSignature compare « maintenant » à CE ts, pas à l'instant
    // de réception d'origine) : le nonce doit rester bloqué ICI, la fenêtre de réception seule ne
    // suffit PAS à l'évincer.
    const finFenetreReception = T + REPLAY_WINDOW_S * 1000 + 1
    assert.equal(store.checkAndRecord(nonce, signedTsMs, finFenetreReception), false, 'le rejeu reste bloqué — le nonce n\'a pas été évincé avant que SON ts cesse d\'être valide')

    // ...mais une fois que LA FENÊTRE DU TS SIGNÉ LUI-MÊME (signedTsMs + fenêtre) est dépassée, le
    // nonce redevient éligible — mémoire alignée sur la BONNE référence, pas infinie pour autant.
    const finFenetreSignee = signedTsMs + REPLAY_WINDOW_S * 1000 + 1
    assert.equal(store.checkAndRecord(nonce, signedTsMs, finFenetreSignee), true, 'évincé une fois SA fenêtre (celle du ts signé) dépassée')
  })

  it('un ts signé pile à la réception (sans marge future) suit sa propre fenêtre, courte', () => {
    const store = createBridgeNonceStore()
    const T = 1_700_000_000_000
    const signedTsMs = T   // signé pile à la réception, aucune marge future
    const nonce = 'nonce-b19-court'
    assert.equal(store.checkAndRecord(nonce, signedTsMs, T), true)
    assert.equal(store.checkAndRecord(nonce, signedTsMs, T + 10), false, 'rejeu quasi immédiat — toujours bloqué')

    const bienApres = signedTsMs + REPLAY_WINDOW_S * 1000 + 1
    assert.equal(store.checkAndRecord(nonce, signedTsMs, bienApres), true, 'relâché dès que SA fenêtre (plus courte, pas de marge future) est dépassée')
  })
})
