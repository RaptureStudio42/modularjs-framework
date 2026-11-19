// `{(/b/.test($t))}` : des parenthèses qui entourent toute l'expression et s'ouvrent sur une regex — Civet lisait `(/` comme une
// section d'opérateur (une fonction, comme `(/ 2)`), le gabarit affichait une fonction ; la regex se lit comme en tête de `{if}`,
// sans parenthèses ; une regex entre parenthèses suivie d'autre chose, et une division entre parenthèses, se lisent comme avant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(expr: string): Promise<string> {
  const r: any = await transpile(`<script>\n$t = 'abc'\n$n = 4\n</script>\n<p>{${expr}}</p>\n`, { moduleName: 'Cas' })
  return String(r.output).split('\n').find(l => l.includes('_mjs_updText')) ?? ''
}

describe('gabarit : une regex entre les parenthèses de toute l\'expression reste une regex', function () {
  this.timeout(60000)

  it('{(/b/.test($t))} lit la regex, pas une section d\'opérateur', async () => {
    const l = await construire('(/b/.test($t))')
    assert.match(l, /\/b\/\.test\(\$\.t\)/, l)
    assert.doesNotMatch(l, /\$1/, l)
  })

  it('{( /b/.test($t) )} : les blancs autour ne changent rien', async () => {
    const l = await construire('( /b/.test($t) )')
    assert.match(l, /\/b\/\.test\(\$\.t\)/, l)
    assert.doesNotMatch(l, /\$1/, l)
  })

  it('témoin : {/b/.test($t)} et {($n / 2)} se lisent comme avant', async () => {
    assert.match(await construire('/b/.test($t)'), /\/b\/\.test\(\$\.t\)/)
    assert.match(await construire('($n / 2)'), /\$\.n \/ 2/)
  })
})
