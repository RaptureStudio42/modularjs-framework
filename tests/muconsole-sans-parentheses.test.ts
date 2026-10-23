// µconsole sans parenthèses prend un argument simple : un texte entre guillemets simples ou doubles,
// ou un nom (`$$panier.total`, `false`), suivi de la fin de l'instruction. Au-delà, l'argument était
// mal découpé en silence (`µconsole foo(1)` → `µ.console(foo)(1)`, un texte à triples guillemets
// coupé en deux, `µconsole $x, 'label'` qui perdait son second argument) ou finissait en erreur
// cryptique (`µconsole @el`) ; le build demande maintenant les parenthèses.

import assert from 'node:assert/strict'
import { applyMjsSugarToScript } from '../src/transpiler/index.js'

const sucre = (src: string) => applyMjsSugarToScript(src, 'civet')

describe('µconsole sans parenthèses', () => {
  for (const src of ['µconsole foo(1)', 'µconsole @el', 'µconsole """titre"""', "µconsole $x, 'label'"]) {
    it(`${src} : les parenthèses sont demandées`, () => {
      assert.throws(() => sucre(src), (err: any) => err.message.includes('µconsole(') && err.message.includes(src))
    })
  }

  it('les formes simples restent permises, sans changement', () => {
    assert.equal(sucre('µconsole'), "(µ.console && µ.console((typeof _mjsThis != 'undefined' && _mjsThis) || null))")
    assert.equal(sucre("µconsole '.panier'"), "(µ.console && µ.console('.panier'))")
    assert.equal(sucre('µconsole $$panier.total'), '(µ.console && µ.console($$panier.total))')
    assert.equal(sucre('µconsole false'), '(µ.console && µ.console(false))')
    assert.equal(sucre("µconsole('#a', 2)"), "(µ.console && µ.console('#a', 2))")
    assert.equal(sucre('µ.console.log(1)'), 'µ.console.log(1)')
  })

  it('suivie d\'un mot de la langue, d\'un commentaire ou d\'une fin de ligne : permise', () => {
    assert.match(sucre('if ok then µconsole else x'), /then \(µ\.console && µ\.console\(/)
    assert.match(sucre('µconsole $x if debug'), /µ\.console\(\$x\)\) if debug/)
    assert.match(sucre("µconsole '.a'  # ouvre le panneau"), /µ\.console\('\.a'\)\)/)
    assert.match(sucre('µconsole\n  x = 1'), /µ\.console\(/)
  })
})
