// Le contrôle « µeffect imbriqué » lisait mal deux sortes de chaînes : une chaîne sur plusieurs lignes (`"""…"""`,
// `'''…'''`) et un gabarit dans un gabarit (`` `x ${ `{` } y` ``). Une accolade écrite dedans comptait comme du code :
// un µeffect de premier niveau était refusé à tort, ou un µeffect dans une fonction passait pour du premier niveau.

import assert from 'node:assert/strict'
import { transpile, lintEffectTopLevel } from '../src/transpiler/index.js'

describe('µeffect : chaînes sur plusieurs lignes et gabarits imbriqués', () => {
  it('une accolade dans une chaîne sur plusieurs lignes ou un gabarit imbriqué : premier niveau accepté', () => {
    assert.doesNotThrow(() => lintEffectTopLevel('aide = """\n  {\n"""\nµeffect -> console.log $n'))
    assert.doesNotThrow(() => lintEffectTopLevel("aide = '''\n  {\n'''\nµeffect -> console.log $n"))
    assert.doesNotThrow(() => lintEffectTopLevel('s = `x ${ `{` } y`\nµeffect -> console.log $n'))
    assert.doesNotThrow(() => lintEffectTopLevel('s = `a ${ "`{" } b`\nµeffect(() => console.log($n))'))
  })

  it('une accolade fermante dans ces chaînes ne fait pas sortir d\'une fonction : refusé', () => {
    assert.throws(() => lintEffectTopLevel('function f() {\n  aide = """\n}\n"""\nµeffect -> console.log $n\n}'), /imbriqué \(ligne 5/)
    assert.throws(() => lintEffectTopLevel('function f() {\n  s = `x ${ `}` } y`\nµeffect -> console.log $n\n}'), /imbriqué \(ligne 3/)
  })

  it('composant : construit', async () => {
    const r = await transpile('<script>\n$n = 1\naide = """\n  {\n"""\nµeffect -> console.log $n\n</script>\n<p>{$n}</p>', { moduleName: 'effet-chaine-multiligne' })
    assert.match(r.output, /effect/)
  })
})
