// `journal.viewer: true` en production : le démarrage annonçait « la page … est servie SANS
// authentification » alors que la page n'est PAS servie (404, défaut documenté « hors production
// seulement ») — un message de sécurité faux. Il dit désormais que l'option est ignorée.

import assert from 'node:assert/strict'
import { warnIfJournalViewerOpenInProd } from '../src/server/viewer-page.js'

describe('journal.viewer: true en production — avertissement exact', () => {
  it('ne prétend plus que la page est servie', () => {
    const origError = console.error
    const lignes: string[] = []
    console.error = (...a: any[]) => { lignes.push(a.join(' ')) }
    try {
      warnIfJournalViewerOpenInProd(true, 'prod')
    } finally {
      console.error = origError
    }
    assert.equal(lignes.length, 1)
    assert.doesNotMatch(lignes[0], /servie SANS authentification/)
    assert.match(lignes[0], /n'est pas servie/)
  })
})
