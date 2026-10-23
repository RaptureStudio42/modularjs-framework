// Relevé des balises `mjs-*` d'une page prérendue : un commentaire HTML s'y lit avec les bornes du navigateur, la
// lecture commune du compilateur (readHtmlComment). `<!-->` et `<!--->` sont des commentaires vides, refermés aussitôt,
// et `--!>` referme un commentaire comme `-->`. Avant, la fin était cherchée par le premier `-->` : un commentaire vide
// avalait les balises qui le suivent jusqu'au commentaire suivant, et le fragment de démarrage les oubliait.

import assert from 'node:assert/strict'
import { collectTags } from '../src/server/prerender.js'

describe('prerender — relevé des balises : commentaires lus comme le navigateur', () => {
  for (const [nom, vide] of [['<!-->', '<!-->'], ['<!--->', '<!--->']]) {
    it(`commentaire vide ${nom} : la balise qui le suit est relevée`, () => {
      const html = `<div>${vide}<mjs-carte></mjs-carte><!-- fin --></div>`
      assert.deepEqual(collectTags(html), ['mjs-carte'])
    })
  }

  it('`--!>` referme le commentaire : la balise qui le suit est relevée', () => {
    const html = '<!-- note --!><mjs-carte></mjs-carte><!-- fin -->'
    assert.deepEqual(collectTags(html), ['mjs-carte'])
  })

  it('témoin : une balise DANS un commentaire ordinaire n\'est pas relevée', () => {
    const html = '<!-- <mjs-cachee></mjs-cachee> --><mjs-carte></mjs-carte>'
    assert.deepEqual(collectTags(html), ['mjs-carte'])
  })

  it('témoin : un commentaire jamais refermé couvre la fin de la page', () => {
    const html = '<mjs-carte></mjs-carte><!-- <mjs-apres></mjs-apres>'
    assert.deepEqual(collectTags(html), ['mjs-carte'])
  })
})
