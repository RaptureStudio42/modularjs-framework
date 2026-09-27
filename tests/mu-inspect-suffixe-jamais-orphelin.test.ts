// µinspect($x.foo) — un chemin FIXE derrière le symbole suit $x entier mais filtre l'affichage
// à ce seul chemin (cf. sigils.ts cheminInspectPlat) : compilé en
// µ.inspect('x', 'foo'), jamais une parenthèse orpheline ni un résidu qui n'échouerait qu'à
// l'exécution. Les deux formes documentées (nue et parenthésée, docs/18-pieges.md §8) restent
// inchangées.

import assert from 'node:assert/strict'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

describe('µinspect($x) — formes documentées, inchangées', () => {
  it('forme nue : µinspect $x → µ.inspect(\'x\')', () => {
    assert.equal(cleanJs('µinspect $x'), "µ.inspect('x')")
  })

  it('forme parenthésée : µinspect($x) → µ.inspect(\'x\')', () => {
    assert.equal(cleanJs('µinspect($x)'), "µ.inspect('x')")
  })

  it('un accès APRÈS l\'appel (µinspect($x).foo) reste un appel valide', () => {
    assert.equal(cleanJs('µinspect($x).foo'), "µ.inspect('x').foo")
  })
})

describe('µinspect($x.foo) — chemin FIXE accepté, compilé en µ.inspect(\'x\', \'foo\')', () => {
  it('forme parenthésée', () => {
    assert.equal(cleanJs('µinspect($x.foo)'), "µ.inspect('x', 'foo')")
  })

  it('forme nue', () => {
    assert.equal(cleanJs('µinspect $x.foo'), "µ.inspect('x', 'foo')")
  })

  it('dans une expression de gabarit (cleanJsExpr)', () => {
    assert.match(cleanJsExpr('µinspect($x.foo)'), /µ\.inspect\(\s*'x'\s*,\s*'foo'\s*\)/)
  })

  it('dans le <script> d\'un composant : la compilation réussit', async () => {
    const src = '<script>\n$x = {foo: 1}\nµinspect($x.foo)\n</script>\n<p>{$x.foo}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'inspect-chemin' }))
  })
})
