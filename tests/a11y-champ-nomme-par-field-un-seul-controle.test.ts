// <@@field label="…"> ne nomme, à l'exécution, que le PREMIER champ qu'il enveloppe : le module pose
// le libellé en aria-label sur ce champ seul. Le contrôle d'accessibilité ne compte donc comme nommé
// que ce premier champ — un second champ dans le même <@@field> garde son alerte — et un libellé
// vide ne nomme rien. Un libellé dynamique (inconnu au build) reste cru sur parole.

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

describe('lint.a11y — <@@field label> ne nomme qu\'un seul champ', () => {
  it('deux champs dans un seul <@@field label> : le premier est nommé, le second garde son alerte', () => {
    const alertes = checkA11y('<@@field label="Deux champs">\n  <input name="a">\n  <input name="b">\n</@@field>\n', 'champ-nomme')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 3/)
    assert.match(alertes[0], /<input>/)
  })

  it('le premier champ dans un conteneur (icône, affixe) est nommé ; un champ de plus ne l\'est pas', () => {
    const html = '<@@field label="Prix">\n  <div class="w"><span>€</span><input name="prix"></div>\n  <textarea name="note"></textarea>\n</@@field>\n'
    const alertes = checkA11y(html, 'champ-nomme')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /ligne 3/)
    assert.match(alertes[0], /<textarea>/)
  })

  it('la forme <mjs-core-field> compte pareil', () => {
    const alertes = checkA11y('<mjs-core-field label="Deux">\n  <input name="a">\n  <select name="b"></select>\n</mjs-core-field>\n', 'champ-nomme')
    assert.equal(alertes.length, 1)
    assert.match(alertes[0], /<select>/)
  })

  it('un libellé vide ne nomme rien : guillemets doubles, simples, ou seulement des espaces', () => {
    for (const label of ['label=""', 'label=\'\'', 'label="   "']) {
      const alertes = checkA11y(`<@@field ${label}>\n  <input name="nom">\n</@@field>\n`, 'champ-nomme')
      assert.equal(alertes.length, 1, `${label} : le champ reste sans étiquette`)
      assert.match(alertes[0], /ligne 2/)
    }
  })

  it('un libellé écrit ou dynamique nomme son champ ; deux <@@field label> de suite nomment chacun le leur', () => {
    assert.deepEqual(checkA11y('<@@field label="Nom">\n  <input name="nom">\n</@@field>\n', 'champ-nomme'), [])
    assert.deepEqual(checkA11y('<script>\n$l = \'Message\'\n</script>\n<@@field label={$l}><textarea name="m"></textarea></@@field>\n', 'champ-nomme'), [])
    assert.deepEqual(checkA11y('<@@field label="A"><input name="a"></@@field>\n<@@field label="B"><input name="b"></@@field>\n', 'champ-nomme'), [])
  })

  it('le champ de plus qui porte son propre nom (aria-label, ou <label for>) ne reçoit pas d\'alerte', () => {
    assert.deepEqual(checkA11y('<@@field label="Deux">\n  <input name="a">\n  <input name="b" aria-label="Second">\n</@@field>\n', 'champ-nomme'), [])
    assert.deepEqual(checkA11y('<@@field label="Deux">\n  <input name="a">\n  <input id="b" name="b">\n</@@field>\n<label for="b">Second</label>\n', 'champ-nomme'), [])
  })

  it('sans label, ou un champ hors du <@@field> : l\'alerte reste', () => {
    assert.equal(checkA11y('<@@field><input name="nom"></@@field>\n', 'champ-nomme').length, 1)
    assert.equal(checkA11y('<@@field label="A"><input name="a"></@@field>\n<input name="b">\n', 'champ-nomme').length, 1)
  })
})
