// Types : une forme `/…/` se recopie telle quelle dans le JS émis. Vide (`$x string //`), elle y
// devenait un commentaire (`r://`) et le module ne se chargeait plus, build vert ; elle est refusée,
// avec son texte et sa ligne (un commentaire, dans un <vars>, commence par #). Une forme qui contient
// un séparateur de ligne (U+2028, U+2029), valable pour `new RegExp`, ne l'est pas dans un littéral :
// elle est émise en `new RegExp(…)`, et la règle garde son sens.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// la table des règles émise pour le composant, évaluée comme le ferait le navigateur
function table(output: string): any {
  const m = /const _mjs_T_\w+ = (\{[^\n]*\});/.exec(output)
  assert.ok(m, 'table des règles émise')
  return new Function(`return ${m![1]}`)()
}

describe('types : la forme d\'une règle string dans le JS émis', () => {
  it('une forme vide est refusée, avec son texte et sa ligne', async () => {
    await assert.rejects(
      transpile('<vars>\n  $x string //\n</vars>\n<p>{$x}</p>\n', { moduleName: 'forme-vide' }),
      (err: any) => /ligne 2/.test(err.message) && err.message.includes('//') && /vide/.test(err.message)
    )
  })

  it('vide avec un drapeau aussi', async () => {
    await assert.rejects(
      transpile('<vars>\n  $x string 1..3 //i\n</vars>\n<p>{$x}</p>\n', { moduleName: 'forme-vide-drapeau' }),
      (err: any) => err.message.includes('//i') && /vide/.test(err.message)
    )
  })

  it('une forme avec un séparateur de ligne : le JS émis se charge, et la règle garde son sens', async () => {
    const { output } = await transpile('<vars>\n  $x string /^a\u2028b$/\n</vars>\n<p>{$x}</p>\n', { moduleName: 'forme-fin-de-ligne' })
    const regles = table(output)
    assert.equal(regles.x.r.test('a\u2028b'), true)
    assert.equal(regles.x.r.test('ab'), false)
  })

  it('une forme ordinaire reste un littéral', async () => {
    const { output } = await transpile('<vars>\n  $x string /^[a-z]+$/i\n</vars>\n<p>{$x}</p>\n', { moduleName: 'forme-ordinaire' })
    assert.match(output, /r:\/\^\[a-z\]\+\$\/i/)
    assert.equal(table(output).x.r.test('AbC'), true)
  })
})
