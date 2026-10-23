// `<@document *lang(chars: l'été)>` : l'apostrophe d'un mot ouvre un texte que rien ne referme ; le
// message parlait d'une parenthèse jamais refermée. Il dit maintenant que c'est un texte resté ouvert
// (une apostrophe dans un mot) et comment l'écrire : la valeur entre guillemets doubles. La vraie
// parenthèse oubliée garde son message.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const lire = async (html: string) => (await transpile(html, { moduleName: 'doc-apostrophe' }))

describe('<@document *effet(…)> : un texte resté ouvert dans les réglages', () => {
  it('une apostrophe dans un mot : le message la nomme et dit de passer aux guillemets doubles', async () => {
    const { data } = await lire("<@document *lang(chars: l'été)>\n<p>x</p>\n")
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\*lang/)
    assert.match(data.macroErrors[0], /apostrophe/)
    assert.match(data.macroErrors[0], /guillemets doubles/)
    assert.doesNotMatch(data.macroErrors[0], /parenthèse/)
  })

  it('un guillemet double jamais refermé : le message le dit, sans parler d\'apostrophe ni de parenthèse', async () => {
    const { data } = await lire('<@document *lang(chars: "abc)>\n<p>x</p>\n')
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\*lang/)
    assert.match(data.macroErrors[0], /guillemet double/)
    assert.match(data.macroErrors[0], /jamais refermé/)
    assert.doesNotMatch(data.macroErrors[0], /apostrophe/)
    assert.doesNotMatch(data.macroErrors[0], /parenthèse/)
  })

  it('un guillemet double jamais refermé, en anglais', async () => {
    setMessagesLang('en')
    try {
      const { data } = await lire('<@document *lang(chars: "abc)>\n<p>x</p>\n')
      assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
      assert.match(data.macroErrors[0], /double quote/)
      assert.match(data.macroErrors[0], /never closed/)
      assert.doesNotMatch(data.macroErrors[0], /apostrophe/)
    }
    finally { setMessagesLang('fr') }
  })

  it('la parenthèse oubliée garde son message', async () => {
    const { data } = await lire('<@document *ripple(color: red>\n<p>x</p>\n')
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /parenthèse/)
    assert.doesNotMatch(data.macroErrors[0], /apostrophe/)
  })

  it('la valeur entre guillemets doubles, ou l\'apostrophe échappée dans un texte : aucune erreur', async () => {
    const doubles = await lire('<@document *lang(chars: "l\'été")>\n<p>x</p>\n')
    assert.deepEqual(doubles.data.macroErrors, [])
    assert.ok(doubles.output.includes('"lang", {"chars":"l\'été"}'))
    const echappee = await lire("<@document *lang(chars: 'l\\'été')>\n<p>x</p>\n")
    assert.deepEqual(echappee.data.macroErrors, [])
  })
})
