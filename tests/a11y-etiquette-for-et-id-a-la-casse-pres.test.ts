// Le contrôle d'accessibilité relie un <label for> à un champ comme le navigateur : le `for` doit être l'`id` du champ à la lettre près,
// majuscules comprises. `<label for="Nom">` ne désigne pas `<input id="nom">` dans Chromium, Firefox ni WebKit (mode standard comme mode
// quirks) : le champ reste sans étiquette, l'alerte « sans étiquette » est due.

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

const alertes = (src: string) => checkA11y(src + '\n', 'casse')

describe('lint.a11y — un <label for> désigne le champ dont l\'id est le même, à la casse près', () => {
  it('<label for="Nom"> et <input id="nom"> : le navigateur ne les relie pas, l\'alerte reste', () => {
    const a = alertes('<label for="Nom">Nom</label>\n<input id="nom">')
    assert.equal(a.length, 1)
    assert.match(a[0], /<input>/)
    assert.match(a[0], /(ligne|line) 2\b/)
  })

  it('la casse compte dans les deux sens, pour <select> et <textarea> aussi', () => {
    assert.equal(alertes('<label for="mail">Courriel</label>\n<input id="MAIL">').length, 1, 'for en minuscules, id en majuscules')
    assert.equal(alertes('<label for="Pays">Pays</label>\n<select id="pays"><option>FR</option></select>').length, 1, 'select')
    assert.equal(alertes('<label for="Note">Note</label>\n<textarea id="note"></textarea>').length, 1, 'textarea')
  })

  it('le même id, lettre pour lettre : le champ est étiqueté, aucune alerte', () => {
    assert.deepEqual(alertes('<label for="Nom">Nom</label>\n<input id="Nom">'), [])
    assert.deepEqual(alertes('<label for="nom">Nom</label>\n<input id="nom">'), [])
    assert.deepEqual(alertes('<label for=Nom>Nom</label>\n<select id="Nom"><option>a</option></select>'), [], 'for sans guillemets')
  })
})
