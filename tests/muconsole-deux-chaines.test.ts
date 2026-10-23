// `µconsole 'a' 'b'` : le second texte, blanchi par le masquage des chaînes, passait pour la fin de
// l'instruction ; le code produit, `(µ.console && µ.console('a'))('b')`, plante en production, où
// `µ.console` est faux. Refusé au build, comme les autres formes sans parenthèses à plusieurs jetons :
// le message demande `µconsole(…)`. Un commentaire après l'argument reste permis, même s'il contient
// des guillemets.

import assert from 'node:assert/strict'
import { applyMjsSugarToScript } from '../src/transpiler/index.js'

const sucre = (src: string) => applyMjsSugarToScript(src, 'civet')

describe('µconsole avec deux textes ou un texte et un nom à la suite', () => {
  for (const src of ["µconsole 'a' 'b'", 'µconsole "a" "b"', "µconsole 'a' \"b\"", "µconsole 'a'  'b'", "µconsole 'a' $x", "µconsole 'a' `b`"]) {
    it(`${src} : les parenthèses sont demandées`, () => {
      assert.throws(() => sucre(src), (err: any) => err.message.includes('µconsole(') && err.message.includes(src))
    })
  }

  it('avec parenthèses, ou un seul argument suivi d\'un commentaire : permis', () => {
    assert.equal(sucre("µconsole('a', 'b')"), "(µ.console && µ.console('a', 'b'))")
    assert.equal(sucre("µconsole 'a'"), "(µ.console && µ.console('a'))")
    assert.match(sucre("µconsole '.a'  # ouvre 'le' panneau"), /µ\.console\('\.a'\)\)/)
    assert.match(sucre("µconsole '.a'\nx = 'b'"), /µ\.console\('\.a'\)\)\nx/)
  })
})
