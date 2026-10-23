// Un composant auto-fermé dont une expression d'attribut contient une expression régulière avec un guillemet ou
// une accolade (`<mjs-x v={$s.replace(/"/g, '').length > 0} />`) se ferme bien sur son `/>` : avant, le guillemet
// de l'expression régulière ouvrait une chaîne fantôme, la balise se coupait au `>` de la comparaison et le
// composant était refusé pour un déséquilibre de structure.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('composant auto-fermé — expression régulière dans une expression d\'attribut', () => {
  for (const [nom, re] of [['guillemet double', '/"/g'], ['apostrophe', "/'/g"], ['accolade', '/[{}]/g']]) {
    it(`${nom} dans la regex, puis un \`>\` : compile`, async () => {
      const src = `<script>\n$s = 'a'\n</script>\n<mjs-x v={$s.replace(${re}, '').length > 0} />\n<p class="fin">fin</p>`
      await assert.doesNotReject(transpile(src, { moduleName: 'auto' }))
    })
  }

  it('témoin : regex sans guillemet, compile', async () => {
    await assert.doesNotReject(transpile("<script>\n$s = 'a'\n</script>\n<mjs-x v={$s.replace(/x/g, '').length > 0} />\n<p>fin</p>", { moduleName: 'auto' }))
  })
})
