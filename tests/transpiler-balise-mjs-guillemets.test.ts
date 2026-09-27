// preprocessHtml comptait les ouvertures/fermetures `<mjs-*>` par simple regex sur le HTML
// BRUT, aveugle aux guillemets : un texte `</mjs-carte>` posé dans une valeur d'ATTRIBUT (ex.
// `title="voir </mjs-carte> pour plus"`) comptait comme une VRAIE fermeture — un composant
// pourtant équilibré (2 ouvertures, 2 fermetures réelles) se faisait rejeter avec un message
// mensonger (« Ouvertures : 2, Fermetures : 3 »).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.ts'

describe('déséquilibre structurel <mjs-*> : aveugle aux guillemets', function () {
  this.timeout(8000)

  it('un texte `</mjs-carte>` DANS un attribut ne compte pas comme une vraie fermeture — composant équilibré accepté', async function () {
    const src = [
      '<p>x</p>',
      '<mjs-carte title="voir </mjs-carte> pour plus">A</mjs-carte>',
      '<mjs-carte>B</mjs-carte>',
    ].join('\n')
    await assert.doesNotReject(() => transpile(src, { moduleName: 'guillemet-fausse-fermeture' }))
  })

  it('non-régression — un VRAI déséquilibre (2 ouvertures, 1 fermeture) est toujours rejeté', async function () {
    const src = [
      '<p>x</p>',
      '<mjs-carte title="voir X pour plus">A</mjs-carte>',
      '<mjs-carte>B',
    ].join('\n')
    await assert.rejects(
      () => transpile(src, { moduleName: 'guillemet-vrai-desequilibre' }),
      /déséquilibre structurel[\s\S]*Ouvertures : 2, Fermetures : 1/,
    )
  })
})
