// Le texte d'une règle (celui que le build compare entre deux composants qui déclarent le même store) écrit une
// liste dont l'élément est une union avec des parenthèses : `Mix[]` (Mix = `int | string`) devient
// `(int | string)[]`, et se distingue de `int | string[]` (un entier, ou une liste de chaînes)

import assert from 'node:assert/strict'
import { compileVars, parseRule, ruleText } from '../src/transpiler/var-types.js'

const OU = { bloc: '<types>', ligne: 1 }
const DEFS = {
  Mix:  parseRule('int | string', OU),
  Role: parseRule('\'admin\' | \'user\'', OU),
  Nom:  parseRule('string 1..20', OU)
}

// le texte canonique du store `x` déclaré par une ligne de <vars>
const canon = (regle: string): string => compileVars({ raw: `\n$$x ${regle}\n`, startLine: 1 }, DEFS, false).storeTypes.x

describe('texte d\'une règle : une liste dont l\'élément est une union', () => {
  it('`Mix[]` et `int | string[]` ne s\'écrivent pas pareil', () => {
    assert.notEqual(canon('Mix[]'), canon('int | string[]'))
  })

  it('l\'élément union est entre parenthèses', () => {
    assert.equal(canon('Mix[]'), '(int | string)[]')
    assert.equal(canon('int | string[]'), 'int | string[]')
  })

  it('une union de valeurs exactes en élément : parenthèses aussi, et la plage de la liste reste après', () => {
    assert.equal(canon('Role[]'), '(\'admin\' | \'user\')[]')
    assert.equal(canon('Role[] 1..3'), '(\'admin\' | \'user\')[] 1..3')
  })

  it('une liste de listes d\'union : les parenthèses se placent sur l\'union seule', () => {
    assert.equal(canon('Mix[][]'), '(int | string)[][]')
  })

  it('un élément sans union reste tel quel', () => {
    assert.equal(canon('Nom[]'), 'string 1..20[]')
    assert.equal(canon('int[]'), 'int[]')
  })

  it('un champ d\'objet qui porte une liste d\'union : les parenthèses y sont aussi', () => {
    assert.equal(canon('{ a: Mix[] }'), '{ a: (int | string)[] }')
  })

  it('le texte affiché garde le nom de la règle nommée, sans parenthèses', () => {
    const e = parseRule('Mix[]', OU)
    assert.equal(ruleText(e, { names: true }), 'Mix[]')
  })
})
