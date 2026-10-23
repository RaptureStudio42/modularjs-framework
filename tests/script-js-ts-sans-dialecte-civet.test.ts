// Un <script lang="js"> ou lang="ts" s'écrit en JavaScript ou TypeScript ordinaire : le dialecte façon Coffee
// du Civet (`for x in`, `isnt`, interpolation `"#{…}"`, déclaration automatique `x .= …`) ne s'y applique pas.
// Avant, réaffecter un paramètre (`a = a || 1`) faisait ajouter `a .= undefined` en tête (construction
// refusée sur du code que l'auteur n'a pas écrit), et la chaîne `"prix #{n} €"` devenait un gabarit qui
// évaluait `n`.

import assert from 'node:assert/strict'
import { transpile, applyMjsSugarToScript } from '../src/transpiler/index.js'

const fonctions = 'function borne(a) {\n  a = a || 1\n  return a\n}\nconst g = (b) => {\n  b = b * 2\n  return b\n}'

describe('script js / ts : sans le dialecte du Civet', () => {
  for (const lang of ['js', 'ts']) {
    it(`${lang} : un paramètre réaffecté ne reçoit aucune déclaration ajoutée, le composant se construit`, async () => {
      assert.equal(applyMjsSugarToScript(fonctions, lang), fonctions)
      await assert.doesNotReject(transpile(`<script lang="${lang}">\n${fonctions}\n$n = borne(0) + g(1)\n</script>\n<p>{$n}</p>`, { moduleName: 'js-ts-' + lang }))
    })

    it(`${lang} : "prix #{n} €" reste une chaîne`, () => {
      assert.equal(applyMjsSugarToScript('const s = "prix #{n} €"', lang), 'const s = "prix #{n} €"')
    })
  }

  it('civet : l\'interpolation "#{…}" et la déclaration automatique demeurent', () => {
    const sortie = applyMjsSugarToScript('s = "prix #{n} €"', 'civet')
    assert.ok(sortie.includes('`prix ${n} €`'), sortie)
    assert.ok(sortie.includes('.='), sortie)
  })
})
