// parseMixedString — la détection « isPure » (tout l'attribut est UNE SEULE expression
// entre accolades) comptait les { et } sans tenir compte des chaînes : un `}` littéral
// DANS une chaîne de l'expression (`{$flag != '}'}`)  fermait le comptage trop tôt, la
// valeur repartait « mixte » → toujours convertie en template literal (coercion en
// chaîne). Un booléen s'inverse alors silencieusement au rendu (`disabled="{expr fausse}"`
// devient la CHAÎNE "false", toujours truthy).

import assert from 'node:assert/strict'
import { parseMixedString } from '../src/generator/utils.js'

describe('parseMixedString — cas pur simple, inchangé', () => {
  it('{$flag} reste une expression brute, pas un template literal', () => {
    const out = parseMixedString('{$flag}', [])
    assert.equal(out, '$.flag')
  })
})

describe('parseMixedString — accolade/chaîne mêlées, isPure conscient des chaînes', () => {
  it("un '}' dans une chaîne de l'expression n'interrompt pas le comptage — reste PUR", () => {
    const out = parseMixedString("{$flag != '}'}", [])
    assert.equal(out.startsWith('`'), false, `attendu une expression brute (pas de template literal) : ${out}`)
    assert.equal(out, "$.flag !== '}'")
  })

  it("symétrique avec un '{' dans la chaîne — reste PUR", () => {
    const out = parseMixedString("{$flag != '{'}", [])
    assert.equal(out.startsWith('`'), false, `attendu une expression brute (pas de template literal) : ${out}`)
  })

  it('un vrai mélange texte + expression reste un template literal', () => {
    const out = parseMixedString('a {$x} b', [])
    assert.equal(out.startsWith('`'), true)
  })
})
