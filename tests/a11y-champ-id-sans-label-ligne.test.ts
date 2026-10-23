// Un champ dont l'`id` n'a aucun <label for> dans le gabarit est signalé sur sa propre ligne, comptée depuis la
// première ligne du HTML (le HTML d'un composant est rogné en tête).

import assert from 'node:assert/strict'
import { checkA11y } from '../src/transpiler/a11y.js'

const lignes = (messages: string[]) => messages.map(m => Number((m.match(/ligne (\d+)/i) ?? [])[1]))

describe('checkA11y — champ avec id sans label for', () => {
  it('la ligne citée tient compte de la première ligne du HTML', () => {
    const html = '<p>a</p>\n<input id="nom" type="text">'
    assert.deepEqual(lignes(checkA11y(html, 'm')), [2])
    assert.deepEqual(lignes(checkA11y(html, 'm', 6)), [7])
  })

  it('un label for du même id : rien à signaler', () => {
    assert.deepEqual(checkA11y('<label for="nom">Nom</label>\n<input id="nom" type="text">', 'm', 6), [])
  })
})
