// Dans un script CoffeeScript, `for x in liste` parcourt les VALEURS et doit le rester : la conversion vers
// `for x of` (qui, en CoffeeScript, parcourt les CLÉS d'un objet) ne vaut que pour Civet. Avant, elle s'appliquait
// aussi au CoffeeScript : la boucle recevait « 0 », « 1 »… au lieu des éléments, sans erreur.

import assert from 'node:assert/strict'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.js'

describe('boucle for…in d\'un script CoffeeScript', () => {
  it('le sucre laisse `for x in` tel quel en CoffeeScript', () => {
    assert.equal(applyMjsSugarToScript('for x in [1, 2]\n  console.log x', 'coffee'), 'for x in [1, 2]\n  console.log x')
  })

  it('le composant CoffeeScript parcourt les valeurs (pas de `for (x in …)` émis)', async () => {
    const warn = console.warn
    console.warn = () => {}
    let r: { output: string }
    try {
      r = await transpile('<script lang="coffee">\n$somme = 0\nfor x in [10, 20]\n  $somme += x\n</script>\n<p>{$somme}</p>', { moduleName: 'boucle' })
    }
    finally {
      console.warn = warn
    }
    assert.doesNotMatch(r.output, /for \(x in \[10, 20\]\)/)
  })

  it('témoin Civet : `for x in` devient toujours `for x of`', () => {
    assert.equal(applyMjsSugarToScript('for x in [1, 2]\n  console.log x', 'civet'), 'for x of [1, 2]\n  console.log x')
  })
})
