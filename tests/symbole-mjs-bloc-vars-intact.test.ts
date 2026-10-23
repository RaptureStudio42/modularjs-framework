// Symbole ASCII (`sigil: 'mjs'`) : `mjs.x` s'écrit pour `µ.x` dans le code du composant. Une règle
// du bloc <vars> ne contient aucune rune : ses textes et ses formes restent tels qu'écrits — `'mjs.fr'`
// ne devient pas `'µ.fr'` (la variable refuserait alors la valeur que la règle annonce). Le code, lui,
// garde l'alias.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const table = (output: string): any => {
  const m = /const _mjs_T_\w+ = (\{[^\n]*\});/.exec(output)
  assert.ok(m, 'table des règles émise')
  return new Function(`return ${m![1]}`)()
}

describe('symbole mjs : le bloc <vars> tel qu\'écrit', () => {
  it('les textes et les formes d\'une règle ne sont pas réécrits', async () => {
    const src = "<vars>\n  $d 'mjs.fr' | 'autre.fr'\n  $u string /^mjs\\.fr$/\n</vars>\n<script>\n  $d = 'autre.fr'\n  $u = 'mjs.fr'\n</script>\n<p>{$d}{$u}</p>\n"
    const { output } = await transpile(src, { moduleName: 'symbole-vars', sigil: 'mjs' })
    const regles = table(output)
    assert.deepEqual(regles.d.v, ['mjs.fr', 'autre.fr'])
    assert.equal(regles.u.r.test('mjs.fr'), true)
  })

  it('le code du composant garde l\'alias', async () => {
    const { output } = await transpile("<vars>\n  $n int\n</vars>\n<script>\n  $n = 1\n  mjs.effect -> console.log $n\n</script>\n<p>{$n}</p>\n", { moduleName: 'symbole-code', sigil: 'mjs' })
    assert.doesNotMatch(output, /\bmjs\.effect/)
  })
})
