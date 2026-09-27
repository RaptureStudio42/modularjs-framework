// La garde µderived-hors-racine (analyze(), src/analyzer/index.ts) testait
// `modifiedCode.includes('_mjs_forceDeps(')` SANS contexte : un simple texte mentionnant
// "_mjs_forceDeps(" dans une chaîne littérale (jamais un vrai µderived) faisait échouer tout le
// build, avec un message trompeur (« µderived doit être déclaré au niveau racine »), alors
// qu'aucun µderived n'a été écrit. Remède : tester sur le code MASQUÉ (chaînes et commentaires
// neutralisés, maskInertSameLength du lexer), pas sur le code brut.

import assert from 'node:assert/strict'
import { analyze } from '../src/analyzer/index.js'

describe('analyzer — garde µderived-hors-racine : contexte (chaîne/commentaire) ignoré à raison', () => {
  it('une chaîne littérale mentionnant "_mjs_forceDeps(" ne fait plus échouer le build', () => {
    assert.doesNotThrow(() => analyze(`$.msg = "on appelle _mjs_forceDeps( ici)";`))
  })

  it('un commentaire mentionnant "_mjs_forceDeps(" ne fait plus échouer le build', () => {
    assert.doesNotThrow(() => analyze(`$.x = 1; // _mjs_forceDeps(\n`))
  })

  it('non-régression — un VRAI marqueur hors racine (dans une fonction) lève toujours', () => {
    assert.throws(
      () => analyze(`const inc = () => { $.x = µ._mjs_forceDeps($.a + 1, $.b); };`),
      /µderived[\s\S]*niveau racine/
    )
  })
})
