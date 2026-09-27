// applyContextSetters (setters de contexte §x = …/§§x = …) tournait sur le texte BRUT, avant
// toute segmentation des chaînes : un gestionnaire qui assigne une PHRASE contenant, en toutes
// lettres, « §theme = … » (documentation, message affiché à l'utilisateur…) était pris pour un
// VRAI setter et cassait la compilation. Un setter RÉEL, lui, hors de toute chaîne, continue de
// fonctionner à l'identique — RHS chaîne littérale comprise (régression historique déjà couverte
// par tests/cleanjs-keywords-context.test.ts, relancé à côté).

import assert from 'node:assert/strict'
import { cleanJs } from '../src/generator/utils.js'

describe('setter de contexte réel — inchangé', () => {
  it("§theme = 'dark' → this._mjs_setContext('theme', 'dark')", () => {
    assert.equal(cleanJs("§theme = 'dark'"), "this._mjs_setContext('theme', 'dark')")
  })

  it("§§lang = 'fr' → this._mjs_setRCtx('lang', 'fr')", () => {
    assert.equal(cleanJs("§§lang = 'fr'"), "this._mjs_setRCtx('lang', 'fr')")
  })
})

describe('« §theme = … » en PROSE dans une chaîne — jamais pris pour un setter', () => {
  it('ne lève pas — la phrase reste une chaîne JS valide', () => {
    const src = "$msg = 'Exemple : §theme = \"sombre\" definit un contexte partage'"
    assert.doesNotThrow(() => cleanJs(src))
  })

  it('le texte de la chaîne ressort intact, aucun this._mjs_setContext injecté dedans', () => {
    const src = "$msg = 'Exemple : §theme = \"sombre\" definit un contexte partage'"
    const out = cleanJs(src)
    assert.equal(out, "$.msg = 'Exemple : §theme = \"sombre\" definit un contexte partage'")
    assert.equal(out.includes('_mjs_setContext'), false, out)
  })

  it("un handler qui assigne une PHRASE avec §§ en prose compile sans corruption", () => {
    const src = "$msg = 'Exemple : §§lang = \\'fr\\' definit un contexte partage'"
    const out = cleanJs(src)
    assert.equal(out.includes('_mjs_setRCtx'), false, out)
  })
})
