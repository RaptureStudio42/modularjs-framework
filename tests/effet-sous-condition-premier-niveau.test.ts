// µeffect / µinspect s'appellent pendant l'initialisation du composant : au premier niveau du <script>, y compris
// sous un `if` ou une boucle de premier niveau (ce code-là s'exécute lui aussi à l'initialisation, l'effet
// fonctionne). Seul le corps d'une fonction (gestionnaire, méthode, hook, minuterie) reste refusé : l'appel
// y arrive hors de l'initialisation et l'effet serait ignoré en silence.

import assert from 'node:assert/strict'
import { transpile, lintEffectTopLevel } from '../src/transpiler/index.js'

describe('µeffect sous une condition ou une boucle de premier niveau', () => {
  it('civet : sous un if de premier niveau, accepté', async () => {
    await assert.doesNotReject(transpile('<script>\n$x = 1\nif true\n  µeffect -> console.log($x)\n</script>\n<p>{$x}</p>', { moduleName: 'effet-if' }))
  })

  it('js : sous un if de premier niveau, accepté', async () => {
    await assert.doesNotReject(transpile('<script lang="js">\n$x = 1\nif (true) {\n  µeffect(() => console.log($x))\n}\n</script>\n<p>{$x}</p>', { moduleName: 'effet-if-js' }))
  })

  it('sous un else, un for, un unless de premier niveau : accepté', () => {
    assert.doesNotThrow(() => lintEffectTopLevel('if a\n  1\nelse\n  µeffect -> 1'))
    assert.doesNotThrow(() => lintEffectTopLevel('for x of [1, 2]\n  µeffect -> x'))
    assert.doesNotThrow(() => lintEffectTopLevel('unless a\n  if b\n    µinspect $n'))
    assert.doesNotThrow(() => lintEffectTopLevel('if (a) {\n  1\n} else {\n  µeffect(() => 1)\n}'))
  })

  it('dans le corps d\'une fonction, même sous un if : refusé', () => {
    assert.throws(() => lintEffectTopLevel('f = ->\n  µeffect -> 1'), /imbriqué \(ligne 2/)
    assert.throws(() => lintEffectTopLevel('if a\n  f = ->\n    µeffect -> 1'), /imbriqué \(ligne 3/)
    assert.throws(() => lintEffectTopLevel('f = ->\n  if a\n    µeffect -> 1'), /imbriqué \(ligne 3/)
    assert.throws(() => lintEffectTopLevel('if a\n  setTimeout -> µeffect -> 1'), /imbriqué/)
    assert.throws(() => lintEffectTopLevel('function f() {\n  if (a) {\n    µeffect(() => 1)\n  }\n}'), /imbriqué \(ligne 3/)
    assert.throws(() => lintEffectTopLevel('const f = () => {\n  µeffect(() => 1)\n}'), /imbriqué/)
    assert.throws(() => lintEffectTopLevel('µmount ->\n  if a\n    µeffect -> 1'), /imbriqué/)
  })

  it('dans une expression qui continue sur plusieurs lignes : toujours refusé', () => {
    assert.throws(() => lintEffectTopLevel('x = foo(\n  µeffect -> 1\n)'), /imbriqué/)
  })
})
