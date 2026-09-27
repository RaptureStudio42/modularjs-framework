// Contrôle d'équilibre des balises mjs-* (preprocessHtml) : une fausse fermeture CITÉE dans une
// interpolation de TEXTE (`{'exemple : </mjs-card> en trop'}`, prose affichée, pas un attribut)
// faisait rejeter un composant pourtant équilibré (« Ouvertures : 1, Fermetures : 2 ») — seules
// les valeurs d'attribut étaient neutralisées avant comptage (maskAttrQuotes), jamais le texte
// d'une interpolation. Un vrai déséquilibre (balise réellement non refermée) doit rester détecté.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('isométrie mjs-* — une fausse fermeture citée en interpolation de texte n\'est plus comptée', () => {
  it("<mjs-card>…</mjs-card> équilibré + un texte affichant '</mjs-card>' en exemple → compile", async () => {
    const src = "<mjs-card>contenu</mjs-card>\n<p>{'exemple : </mjs-card> en trop, cité en documentation'}</p>"
    const res = await transpile(src, { moduleName: 'iso-interpolation-texte' })
    assert.ok(res.output.length > 0, 'la compilation doit réussir (composant réellement équilibré)')
  })

  it("le même texte cité DEUX fois (deux interpolations) reste sans effet sur le comptage", async () => {
    const src = "<mjs-card>contenu</mjs-card>\n<p>{'</mjs-card>'}</p>\n<p>{'</mjs-card>'}</p>"
    const res = await transpile(src, { moduleName: 'iso-interpolation-texte-double' })
    assert.ok(res.output.length > 0, 'la compilation doit réussir')
  })

  it('un vrai déséquilibre (balise réellement non refermée) reste détecté', async () => {
    const src = '<mjs-card>contenu<mjs-card>encore</mjs-card>'
    await assert.rejects(
      transpile(src, { moduleName: 'iso-vrai-desequilibre' }),
      /déséquilibre structurel/
    )
  })

  it('une fausse OUVERTURE citée en interpolation de texte ne doit pas non plus fausser le comptage', async () => {
    const src = "<mjs-card>contenu</mjs-card>\n<p>{'exemple : <mjs-card> en trop, cité en documentation'}</p>"
    const res = await transpile(src, { moduleName: 'iso-interpolation-texte-ouverture' })
    assert.ok(res.output.length > 0, 'la compilation doit réussir (composant réellement équilibré)')
  })
})
