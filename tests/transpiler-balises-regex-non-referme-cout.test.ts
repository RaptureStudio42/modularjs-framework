// découpage d'une balise ouverte : un `/` qui ouvre un littéral regex jamais refermé sur sa ligne ne coûte pas un
// parcours de la ligne par `/` ; la lecture reste la même (regex refermé, classe `[...]`, division)

import assert from 'node:assert/strict'
import { tagReader } from '../src/transpiler/tag-reader.js'

const duree = (f: () => void): number => {
  const t = process.hrtime.bigint()
  f()
  return Number(process.hrtime.bigint() - t) / 1e6
}

describe('découpage de balise : regex non refermé sur une très longue ligne', () => {
  it('40 000 `/` ouvrants dont aucun ne se referme (classe jamais fermée) : moins de 100 ms', () => {
    const s = '{' + '/[('.repeat(40000)
    const ms = duree(() => assert.equal(tagReader(s).braceEnd(1), -1))
    assert.ok(ms < 100, `${ms.toFixed(0)} ms`)
  })

  it('40 000 `/a ` après un `(` : moins de 100 ms', () => {
    const s = '{' + '(/a '.repeat(40000)
    const ms = duree(() => assert.equal(tagReader(s).braceEnd(1), -1))
    assert.ok(ms < 100, `${ms.toFixed(0)} ms`)
  })

  it('40 000 `/a ` collés : moins de 100 ms', () => {
    const s = '{' + '/a '.repeat(40000)
    const ms = duree(() => assert.equal(tagReader(s).braceEnd(1), -1))
    assert.ok(ms < 100, `${ms.toFixed(0)} ms`)
  })

  it('la lecture ne change pas : regex refermé, `/` dans une classe, regex non refermé suivi d\'une accolade', () => {
    assert.equal(tagReader('{ /a}/ }').braceEnd(1), 7, 'le `}` du regex ne ferme rien')
    assert.equal(tagReader('{ /[/}]/ }').braceEnd(1), 9, 'un `/` en classe n\'ouvre ni ne ferme')
    assert.equal(tagReader('{ (/[ }').braceEnd(1), 6, 'regex non refermé : l\'accolade ferme')
    assert.equal(tagReader('{ a / b }').braceEnd(1), 8, 'une division')
    assert.equal(tagReader('{ (/[/[/ }').braceEnd(1), 9, 'regex refermé après deux `[`')
  })
})
