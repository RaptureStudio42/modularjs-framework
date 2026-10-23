// après la parenthèse d'une condition (`if (s.length > 0) /'/.test(s)`), le `/` ouvre une regex. Le lexeur ne
// gardait que les 16 derniers caractères de sa sortie : une condition plus longue n'était plus retrouvée, le `/` lu
// comme une division laissait l'apostrophe de la regex ouvrir une fausse chaîne. Un état écrit plus loin sur la
// ligne n'était plus réécrit, et le texte d'une chaîne était modifié (`'$y'` devenait `'$.y'`)

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { transpile } from '../src/transpiler/index.js'

describe('lexeur — regex après une longue condition', () => {
  it('la chaîne qui suit garde son texte', () => {
    const src = "if (s.length > 0) /'/.test(s) && (t = '$y')"
    assert.equal(tokenize(src), src)
  })

  it('condition de 300 caractères : même lecture', () => {
    const src = 'if (' + 'a && '.repeat(60) + "b) /'/.test(s) && (t = '$y')"
    assert.equal(tokenize(src), src)
  })

  it('un état écrit plus loin sur la ligne est réécrit (lang="js")', async () => {
    const { output } = await transpile("<script lang=\"js\">\nlet s = 'a'\n$n = 0\nif (s.length > 0) /'/.test(s) && ($n = 1) && (s = 'b')\n</script>\n<p>{$n}</p>", { moduleName: 'regex-longue-condition' })
    assert.doesNotMatch(output, /\(\$n = 1\)/)
  })

  it('témoin : une division après un appel reste une division', () => {
    assert.equal(tokenize('x = f(a, b) / 2 + $y'), 'x = f(a, b) / 2 + $.y')
  })
})
