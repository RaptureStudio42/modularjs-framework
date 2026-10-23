// Le texte canonique d'une règle de store (celui que le build compare entre deux composants qui déclarent le
// même store) range les alternatives d'une union de valeurs exactes (`'a' | 'b'`, que deux règles nommées
// forment une fois résolues) : l'ordre écrit ne change rien à l'exécution, `Role | Statut` et
// `Statut | Role` s'écrivent pareil. Une union de types qui convertissent garde son ordre : `int | string` et
// `string | int` ne sont pas équivalents (la première règle qui sait convertir gagne).

import assert from 'node:assert/strict'
import { compileVars, parseRule, ruleText } from '../src/transpiler/var-types.js'

const OU = { bloc: '<types>', ligne: 1 }
const DEFS = {
  Role:   parseRule('\'admin\' | \'user\'', OU),
  Statut: parseRule('\'actif\' | \'ferme\'', OU),
  Un:     parseRule('1', OU),
  Deux:   parseRule('2', OU),
  Nom:    parseRule('string 1..20', OU)
}

// le texte canonique du store `x` déclaré par une ligne de <vars>
const canon = (regle: string): string => compileVars({ raw: `\n$$x ${regle}\n`, startLine: 1 }, DEFS, false).storeTypes.x

describe('texte canonique d\'une règle de store : l\'ordre des alternatives', () => {
  it('une union de valeurs exactes se range : Role | Statut = Statut | Role', () => {
    assert.equal(canon('Role | Statut'), canon('Statut | Role'))
    assert.equal(canon('Role | Statut'), '\'actif\' | \'ferme\' | \'admin\' | \'user\'')
  })

  it('trois règles nommées de valeurs : toutes les permutations s\'écrivent pareil', () => {
    const textes = new Set(['Un | Deux | Role', 'Role | Un | Deux', 'Deux | Role | Un', 'Role | Deux | Un'].map(canon))
    assert.equal(textes.size, 1, [...textes].join(' / '))
  })

  it('des valeurs écrites en ligne : déjà rangées, comme avant', () => {
    assert.equal(canon('\'b\' | \'a\''), canon('\'a\' | \'b\''))
    assert.equal(canon('\'a\' | \'b\''), '\'a\' | \'b\'')
  })

  it('int | string et string | int ne s\'écrivent PAS pareil : l\'ordre décide de la conversion', () => {
    assert.notEqual(canon('int | string'), canon('string | int'))
    assert.equal(canon('int | string'), 'int | string')
    assert.equal(canon('string | int'), 'string | int')
  })

  it('int | float, float | int : l\'ordre écrit est gardé', () => {
    assert.notEqual(canon('int | float'), canon('float | int'))
  })

  it('des plages et des types nommés : l\'ordre écrit est gardé', () => {
    assert.notEqual(canon('int 0..9 | int 10..99'), canon('int 10..99 | int 0..9'))
    assert.notEqual(canon('Nom | int'), canon('int | Nom'))
  })

  it('une union mêlant valeurs et types : l\'ordre écrit est gardé', () => {
    assert.notEqual(canon('Role | int'), canon('int | Role'))
  })

  it('les champs d\'un objet restent rangés, comme avant', () => {
    assert.equal(canon('{ b: int, a: int }'), canon('{ a: int, b: int }'))
  })

  it('le texte affiché, lui, garde l\'ordre écrit', () => {
    const regle = parseRule('int | string', OU)
    assert.equal(ruleText(regle), 'int | string')
    assert.equal(ruleText(parseRule('string | int', OU)), 'string | int')
  })

  it('le texte rangé d\'une union de règles nommées de valeurs ne change pas le texte affiché', () => {
    const { vars } = compileVars({ raw: '\n$x Role | Statut\n', startLine: 1 }, DEFS, true)
    assert.match(vars[0], /d:"Role \| Statut"/)
  })
})
