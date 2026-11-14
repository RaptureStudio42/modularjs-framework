// valeur dérivée signalée par `µrefresh($d)`, ou écrite avec sa propre valeur (`$d = $d`, refusé comme toute auto-affectation) : le
// message cite la forme que l'auteur a écrite, jamais celle que la construction en tire

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// un composant dont `$d` est une valeur dérivée, et un gestionnaire qui porte le geste refusé
const avecDerivee = (geste: string): string => `<script>\n$a = 1\n$d = $a * 2\n@f = -> ${geste}\n</script>\n<p>{$d}</p>\n`

describe('valeur dérivée rafraîchie : le refus cite la forme écrite', () => {
  it('`$d = $d` dans le script : le message cite « $d = $d »', async () => {
    await assert.rejects(transpile(avecDerivee('$d = $d'), { moduleName: 'derivee-reecrite' }), (e: Error) => /« \$d = \$d » : \$d est une valeur dérivée/.test(e.message) && !e.message.includes('µrefresh($d)'))
  })

  it('`$d = $d` dans un gestionnaire du gabarit : le message cite « $d = $d »', async () => {
    const src = `<script>\n$a = 1\n$d = $a * 2\n</script>\n<button @click={$d = $d}>{$d}</button>\n`
    await assert.rejects(transpile(src, { moduleName: 'derivee-reecrite-gabarit' }), (e: Error) => /« \$d = \$d » : \$d est une valeur dérivée/.test(e.message) && !e.message.includes('µrefresh($d)'))
  })

  it('`µrefresh($d)` : le message cite « µrefresh($d) »', async () => {
    await assert.rejects(transpile(avecDerivee('µrefresh($d)'), { moduleName: 'derivee-rafraichie' }), /« µrefresh\(\$d\) » : \$d est une valeur dérivée/)
  })

  it('`µrefresh $d`, sans parenthèses : le message cite « µrefresh($d) »', async () => {
    await assert.rejects(transpile(avecDerivee('µrefresh $d'), { moduleName: 'derivee-rafraichie-nue' }), /« µrefresh\(\$d\) » : \$d est une valeur dérivée/)
  })
})
