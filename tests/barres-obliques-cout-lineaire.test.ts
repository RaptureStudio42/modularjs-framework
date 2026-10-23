// Sur un gros script, chaque `/` de code relisait toute la sortie déjà construite pour savoir s'il ouvre
// une regex ou s'il divise (le lexeur, et la conversion des commentaires `#` du dialecte Civet) : coût
// quadratique, plusieurs secondes au-delà de 200 Ko. Les mêmes lignes avec et sans `/` doivent coûter du
// même ordre, et la décision regex / division ne change pas.

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { applyMjsSugarToScript } from '../src/transpiler/index.js'

function meilleur(fn: () => void): number {
  let best = Infinity
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now()
    fn()
    best = Math.min(best, performance.now() - t0)
  }
  return best
}

const lignes = (op: string) => Array.from({ length: 16000 }, (_, i) => `$v${i} = ($w ${op} 3) + $k`).join('\n')

describe('barres obliques : coût linéaire sur un gros script', function () {
  this.timeout(120000)

  it('lexeur : 16 000 lignes avec `/` coûtent du même ordre que sans', () => {
    const avec  = lignes('/')
    const sans  = lignes('*')
    const tAvec = meilleur(() => tokenize(avec))
    const tSans = meilleur(() => tokenize(sans))
    assert.ok(tAvec < 4 * tSans + 50, `avec / : ${Math.round(tAvec)} ms, sans : ${Math.round(tSans)} ms`)
  })

  it('dialecte Civet : 16 000 lignes avec `/` coûtent du même ordre que sans', () => {
    const avec  = lignes('/')
    const sans  = lignes('*')
    const tAvec = meilleur(() => applyMjsSugarToScript(avec, 'civet'))
    const tSans = meilleur(() => applyMjsSugarToScript(sans, 'civet'))
    assert.ok(tAvec < 4 * tSans + 50, `avec / : ${Math.round(tAvec)} ms, sans : ${Math.round(tSans)} ms`)
  })

  it('lexeur : regex et division reconnues comme avant', () => {
    assert.equal(tokenize('a = $w / 2 / $k\nb = /x\\/y/.test($s)'), 'a = $.w / 2 / $.k\nb = /x\\/y/.test($.s)')
    assert.equal(tokenize('re = /µTotal/'), 're = /µTotal/')
    assert.equal(tokenize('d = $aaaaaaaaaaaaaaaaaaaaaaaa / µTotal / 2'), 'd = $.aaaaaaaaaaaaaaaaaaaaaaaa / µ.Total / 2')
    // une longue suite de blancs avant le `/` : le signe qui la précède décide toujours
    const blancs = '\n'.repeat(40)
    assert.equal(tokenize('x = 1 +' + blancs + '/µTotal/.test(s)'), 'x = 1 +' + blancs + '/µTotal/.test(s)')
    assert.equal(tokenize('x = $n' + blancs + '/ µTotal / 2'), 'x = $.n' + blancs + '/ µ.Total / 2')
    assert.equal(tokenize('f = -> return /µTotal/'), 'f = -> return /µTotal/')
  })

  it('dialecte Civet : un `#` dans une regex n\'est pas un commentaire, après un commentaire converti', () => {
    const sortie = applyMjsSugarToScript('x = 1 # note\nre = /#\\d/\n', 'civet')
    assert.ok(sortie.includes('// note'), sortie)
    assert.ok(sortie.includes('/#\\d/'), sortie)
  })
})
