// <@@field label="…"> nomme, à l'exécution, le PREMIER CHAMP de son corps — le premier input, select, textarea
// ou composant de saisie du cœur — et pas le premier élément : un texte d'aide ou une icône peut passer devant.
// Le contrôle d'accessibilité vise le même élément. Un composant de saisie du cœur placé en tête reçoit le
// nom : un input natif qui le suit reste sans étiquette et garde son alerte. Un `label` nu (sans valeur) ne
// nomme rien.

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

describe('lint.a11y — <@@field label> nomme le premier champ, composants du cœur compris', () => {
  it('une aide ou une icône avant le champ : le champ est nommé par le module, aucune alerte', () => {
    assert.deepEqual(checkA11y('<@@field label="Autre"><span class="aide">€</span><input name="autre"></@@field>\n', 'premier-champ'), [])
    assert.deepEqual(checkA11y('<@@field label="Autre">\n  <p class="aide">Aide</p>\n  <input name="autre">\n</@@field>\n', 'premier-champ'), [])
  })

  it('un composant de saisie du cœur en tête reçoit le nom : l\'input natif qui le suit garde son alerte', () => {
    for (const balise of ['@@select', '@@number', '@@checkbox', '@@switch', '@@radio', '@@knob', '@@gauge', '@@editor', 'mjs-core-select', 'mjs-core-number', 'mjs-core-editor']) {
      const alertes = checkA11y(`<@@field label="Deux">\n  <${balise} name="a"></${balise}>\n  <input name="b">\n</@@field>\n`, 'premier-champ')
      assert.equal(alertes.length, 1, `${balise} en tête : l'<input> qui suit n'est pas nommé`)
      assert.match(alertes[0], /ligne 3/)
      assert.match(alertes[0], /<input>/)
    }
  })

  it('un composant de saisie du cœur seul dans le <@@field> : rien à signaler (le contrôle ne regarde que les champs natifs)', () => {
    assert.deepEqual(checkA11y('<@@field label="Pays"><@@select name="pays"><@@option value="fr">France</@@option></@@select></@@field>\n', 'premier-champ'), [])
    assert.deepEqual(checkA11y('<@@field label="Contrat"><@@editor name="contrat"></@@editor></@@field>\n', 'premier-champ'), [])
  })

  it('un composant qui n\'est pas une saisie (onglets, jauge, horloge, menu) ne passe pas devant le champ', () => {
    for (const balise of ['@@tabs', '@@progress', '@@clock', '@@menu']) {
      assert.deepEqual(checkA11y(`<@@field label="Nom">\n  <${balise}></${balise}>\n  <input name="nom">\n</@@field>\n`, 'premier-champ'), [], `${balise} devant l'<input> : l'<input> reste le premier champ`)
    }
  })

  it('un label nu, sans valeur, ne nomme rien : le champ garde son alerte', () => {
    for (const ouverture of ['<@@field label>', '<@@field label >', '<mjs-core-field label>', '<@@field name="x" label>']) {
      const fermeture = ouverture.startsWith('<mjs') ? '</mjs-core-field>' : '</@@field>'
      const alertes   = checkA11y(`${ouverture}\n  <input name="nom">\n${fermeture}\n`, 'premier-champ')
      assert.equal(alertes.length, 1, `${ouverture} : le champ reste sans étiquette`)
      assert.match(alertes[0], /ligne 2/)
    }
  })

  it('un libellé dynamique ou écrit nomme toujours son champ (inchangé)', () => {
    assert.deepEqual(checkA11y('<script>\n$l = \'Message\'\n</script>\n<@@field label={$l}><textarea name="m"></textarea></@@field>\n', 'premier-champ'), [])
    assert.deepEqual(checkA11y('<@@field label="Nom"><input name="nom"></@@field>\n', 'premier-champ'), [])
  })
})
