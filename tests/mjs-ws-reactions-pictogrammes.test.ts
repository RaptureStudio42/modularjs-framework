// reactionsPackage : sans liste `emojis`, seuls des pictogrammes passent (émojis, drapeaux, touches,
// teintes de peau, familles liées) — avant, tout texte court était relayé à toute la page : un
// visiteur y écrivait ce qu'il voulait. Une liste écrite ouvre ce qu'elle nomme, texte compris.

import assert from 'node:assert/strict'
import { cleanEmoji } from '../src/mjs-ws/reactions.js'

describe('reactionsPackage — des pictogrammes par défaut', () => {
  it('pictogrammes acceptés', () => {
    for (const ok of ['🎉', '👍🏽', '❤', '❤️', '👨‍👩‍👧', '🇫🇷', '1️⃣', '🔥🔥', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) assert.equal(cleanEmoji(ok), ok, ok)
  })

  it('texte refusé : mots, chiffres, ponctuation, mélange', () => {
    for (const non of ['SALE CON', 'abc', '123', ':)', '🎉 bravo', 'a🎉', '', '#']) assert.equal(cleanEmoji(non), null, non)
  })

  it('une liste écrite ouvre ce qu\'elle nomme, et seulement cela', () => {
    assert.equal(cleanEmoji('Bravo', ['Bravo']), 'Bravo')
    assert.equal(cleanEmoji('🎉', ['Bravo']), null)
  })
})
