// Le contrôle d'accessibilité ne lit que du vrai balisage : un commentaire HTML ou la valeur d'un attribut qui
// contient du HTML (`data-x="<input>"`) ne sont pas des balises. Sans ça, un `<input>` commenté en tête d'un
// <@@field> volait le nom du vrai champ, et une valeur d'attribut passait pour un champ sans étiquette.

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

describe('lint.a11y — commentaires HTML et valeurs d\'attributs', () => {
  it('un <input> commenté avant le vrai champ du <@@field> : le vrai champ est nommé, aucune alerte', () => {
    assert.deepEqual(checkA11y('<@@field label="X"><!-- <input name="z"> --><input name="a"></@@field>\n', 'commentaire'), [])
  })

  it('un <input> dans la valeur d\'un attribut avant le vrai champ du <@@field> : aucune alerte', () => {
    assert.deepEqual(checkA11y('<@@field label="X"><span data-x="<input>">?</span><input name="a"></@@field>\n', 'valeur'), [])
  })

  it('un <input> dans la valeur d\'un attribut, seul : ce n\'est pas un champ', () => {
    assert.deepEqual(checkA11y('<span data-x="<input>">?</span>\n', 'valeur-seule'), [])
    assert.deepEqual(checkA11y('<span title=\'<img src="a.png">\'>?</span>\n', 'valeur-img'), [])
  })

  it('un <input> commenté, seul : ce n\'est pas un champ', () => {
    assert.deepEqual(checkA11y('<!-- <input name="z"> -->\n<p>a</p>\n', 'commentaire-seul'), [])
  })

  it('un vrai champ sans étiquette après un commentaire garde son alerte, à la bonne ligne', () => {
    const alertes = checkA11y('<!-- a\nb -->\n<input name="z">\n', 'vrai')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 3/)
  })
})
