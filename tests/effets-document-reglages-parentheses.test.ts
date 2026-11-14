// Effets posés sur <@document> : leurs réglages se lisent comme ceux d'une balise, chaînes comprises.
// Une parenthèse écrite dans un texte (`*ripple(color: ')')`) ne ferme pas les réglages ; une
// parenthèse jamais refermée est signalée, au lieu de manger la dernière lettre du réglage (`red`
// devenait `re`).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('<@document *effet(…)> : les parenthèses des réglages', () => {
  it('une parenthèse dans un texte ne ferme pas les réglages', async () => {
    const { output, data } = await transpile("<@document *ripple(color: ')')>\n<p>x</p>\n", { moduleName: 'doc-parenthese-texte' })
    assert.deepEqual(data.macroErrors, [])
    assert.ok(output.includes('"ripple", {"color":")"}'), output.slice(output.indexOf('"ripple"') - 40, output.indexOf('"ripple"') + 60))
  })

  it('une parenthèse jamais refermée : la balise jamais refermée arrête la construction, rien de mangé en silence', async () => {
    await assert.rejects(transpile('<@document *ripple(color: red>\n<p>x</p>\n', { moduleName: 'doc-parenthese-ouverte' }), /\*ripple sur <@document> \(ligne 1\) : la parenthèse de ses réglages n'est jamais refermée — ajoutez le \) de fin/)
  })

  it('les réglages ordinaires ne changent pas', async () => {
    const { output, data } = await transpile('<@document *ripple(color: red)>\n<p>x</p>\n', { moduleName: 'doc-ordinaire' })
    assert.deepEqual(data.macroErrors, [])
    assert.ok(output.includes('"ripple", {"color":"red"}'))
  })
})
