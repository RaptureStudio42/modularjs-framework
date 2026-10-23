// Types : des messages qui disent vrai. Une plage posée sur une règle nommée ou un type mal écrit
// (`Percent 0..10`, `strin 3..`) ne parle pas de « deux plages » ; une faute dans une règle d'objet
// écrite sur plusieurs lignes est citée à SA ligne ; le texte affiché d'une règle garde les interdits
// écrits à l'usage (`Percent ! 50`, sinon le refus de 50 citerait une règle qui l'accepte) ; `any`
// se lit dans une alternative (`any | int`) ; deux règles de store qui ne diffèrent que par l'ordre
// de leurs valeurs, de leurs champs ou de leurs interdits sont la même règle.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { parseRule, ruleText, compileVars } from '../src/transpiler/var-types.js'

const W    = { bloc: '<vars>', ligne: 1 }
const DEFS = { Percent: parseRule('int 0..100', { bloc: '<types>', ligne: 1 }) }

// la table émise d'un bloc <vars>, évaluée
const table = (raw: string) => new Function(`return {${compileVars({ raw, startLine: 1 }, DEFS, true).vars.join(',')}}`)()

describe('types : lignes et textes des messages', () => {
  it('une plage sur une règle nommée : pas « deux plages », mais la règle nommée qui n\'en prend pas', () => {
    assert.throws(() => parseRule('Percent 0..10', W), (err: any) => /Percent/.test(err.message) && /plage/.test(err.message) && !/deux plages/.test(err.message))
  })

  it('pareil pour un type mal écrit, cité dans le composant', async () => {
    await assert.rejects(
      transpile('<vars>\n  $a int\n  $b strin 3..\n</vars>\n<p>{$a}{$b}</p>\n', { moduleName: 'types-plage-nommee' }),
      (err: any) => /ligne 3/.test(err.message) && /strin/.test(err.message) && !/deux plages/.test(err.message)
    )
  })

  it('any 0..10 : pas de plage sur un any', () => {
    assert.throws(() => parseRule('any 0..10', W), (err: any) => /any/.test(err.message) && !/deux plages/.test(err.message))
  })

  it('une règle inconnue dans une règle d\'objet sur plusieurs lignes : citée à sa ligne', async () => {
    await assert.rejects(
      transpile('<!-- l1 -->\n<vars>\n  $o {\n    a: int,\n    b: flot\n  }\n</vars>\n<p>{$o}</p>\n', { moduleName: 'types-objet-ligne' }),
      (err: any) => /ligne 5/.test(err.message) && /flot/.test(err.message)
    )
  })

  it('une faute de grammaire dans une règle d\'objet sur plusieurs lignes : citée à sa ligne', async () => {
    await assert.rejects(
      transpile('<vars>\n  $o {\n    a: int,\n    b: int 5..1\n  }\n</vars>\n<p>{$o}</p>\n', { moduleName: 'types-objet-grammaire' }),
      (err: any) => /ligne 4/.test(err.message) && /5\.\.1/.test(err.message)
    )
  })

  it('le texte affiché garde les interdits écrits à l\'usage d\'une règle nommée', () => {
    const regles = table('$v Percent ! 50\n$o { v: Percent ! 50 }\n')
    assert.equal(regles.v.d, 'Percent ! 50')
    assert.equal(regles.o.f.v.d, 'Percent ! 50')
  })

  it('any se lit dans une alternative', () => {
    assert.equal(ruleText(parseRule('any | int', W)), 'any | int')
    assert.equal(ruleText(parseRule("! 'admin'", W)), "! 'admin'")
  })

  it('deux règles de store qui ne diffèrent que par l\'ordre : la même règle', () => {
    const texte = (raw: string) => compileVars({ raw, startLine: 1 }, DEFS, false).storeTypes.x
    assert.equal(texte("$$x 'a' | 'b'"), texte("$$x 'b' | 'a'"))
    assert.equal(texte('$$x { a: int, b: string }'), texte('$$x { b: string, a: int }'))
    assert.equal(texte("$$x string ! 'a' | 'b'"), texte("$$x string ! 'b' | 'a'"))
    assert.notEqual(texte("$$x 'a' | 'b'"), texte("$$x 'a' | 'c'"))
  })
})
