// une fonction dont le corps n'est pas indenté (`function plusTard() {` puis `if (c) {` en colonne 0) : le µeffect
// placé sous ce `if` paraissait de premier niveau à la seule lecture des retraits. La construction était verte et
// l'effet, armé plus tard hors de l'initialisation, ignoré sans un mot. Les accolades encore ouvertes comptent
// désormais : chacune doit appartenir à un bloc de contrôle

import assert from 'node:assert/strict'
import { transpile, lintEffectTopLevel } from '../src/transpiler/index.js'

describe('µeffect dans une fonction au corps sans retrait', () => {
  it('sous un if en colonne 0 dans une function : refusé', async () => {
    const src = '<p>{$n}</p>\n<script lang="js">\nlet c = true\n$n = 0\nfunction plusTard() {\nif (c) {\n  µeffect(() => console.log($n))\n}\n}\n</script>'
    await assert.rejects(transpile(src, { moduleName: 'effet-fonction-sans-retrait' }), /imbriqué/)
  })

  it('fonction fléchée, méthode d\'objet, boucle : refusé', () => {
    assert.throws(() => lintEffectTopLevel('function f() {\nif (c) {\n  µeffect(() => 1)\n}\n}'), /imbriqué \(ligne 3/)
    assert.throws(() => lintEffectTopLevel('const f = () => {\nfor (const x of l) {\n  µinspect($n)\n}\n}'), /imbriqué \(ligne 3/)
    assert.throws(() => lintEffectTopLevel('const o = {\nm() {\nif (c) {\n  µeffect(() => 1)\n}\n}\n}'), /imbriqué \(ligne 4/)
    assert.throws(() => lintEffectTopLevel('if (c) {\n  setTimeout(function () { µeffect(() => 1) })\n}'), /imbriqué \(ligne 2/)
  })

  it('témoins : blocs de contrôle de premier niveau, même sans retrait entre eux, acceptés', () => {
    assert.doesNotThrow(() => lintEffectTopLevel('if (c) {\n  µeffect(() => 1)\n}'))
    assert.doesNotThrow(() => lintEffectTopLevel('if (a) {\nif (b) {\n  µeffect(() => 1)\n}\n}'))
    assert.doesNotThrow(() => lintEffectTopLevel('function f() {\n  return 1\n}\nif (c) {\n  µeffect(() => f())\n}'))
    assert.doesNotThrow(() => lintEffectTopLevel('const o = { a: \'{\' }\nif (c) {\n  µeffect(() => o)\n} else {\n  µinspect($n)\n}'))
  })
})
