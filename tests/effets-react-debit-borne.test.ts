// *react : `rate` (les émojis envoyés par seconde, au plus) va de 1 à 10 — le serveur n'en relaie que 5
// par seconde et par visiteur (10 d'avance), et les trames des effets en direct ont leur part du débit
// de la connexion : au-delà, rien ne partirait de plus. Une valeur plus haute est refusée à la compilation.

import assert from 'node:assert/strict'
import { parseEffect } from '../src/effects/catalog.js'

describe('*react — un débit borné', () => {
  it('rate: 10 passe, rate: 11 est refusé', () => {
    assert.equal(parseEffect('react', '🎉, rate: 10').fixed.rate, 10)
    assert.throws(() => parseEffect('react', '🎉, rate: 11'), /rate/)
  })
})
