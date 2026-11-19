// un guillemet jamais refermé dans un attribut : l'erreur du parseur porte le dialecte de sa lecture (`mjsQuote.dialect`), que le
// transpileur relit pour retrouver ce guillemet dans le fichier où il est écrit (locateQuote, transpiler/index.ts). Écrit sous un nom,
// lu sous un autre, le dialecte se perdait : la relecture se faisait sans lui, une regex passée sans parenthèses (`f /"/`) n'y était
// plus lue comme le parseur l'avait lue
// Méthode : parse() sur un gabarit au guillemet ouvert, l'erreur levée lue telle que le transpileur la lit

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'

describe('guillemet jamais refermé : l\'erreur porte le dialecte que le transpileur relit', function () {
  it('mjsQuote : le dialecte de la lecture, le guillemet et les variables du message', () => {
    let caught: any = null
    try {
      parse('<p><b title="x>un</b></p>')
    }
    catch (e) {
      caught = e
    }
    assert.ok(caught?.mjsQuote, 'le parseur refuse le guillemet ouvert : ' + String(caught?.message))
    assert.equal(caught.mjsQuote.dialect, true)
    assert.equal(caught.mjsQuote.quote, '"')
    assert.equal(caught.mjsQuote.vars.attribute, 'title')
  })
})
