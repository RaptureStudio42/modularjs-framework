// `<@document *lang(chars: l'été)>` : l'apostrophe d'un mot ouvre un texte que rien ne referme. La balise du langage est
// lue dans l'arbre du gabarit, comme toute balise : jamais refermée, elle arrête la construction avec le message du
// gabarit, qui nomme le texte resté ouvert (ou la parenthèse oubliée) et sa ligne. La valeur entre guillemets doubles passe

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const lire = async (html: string) => (await transpile(html, { moduleName: 'doc-apostrophe' }))

describe('<@document *effet(…)> : un texte resté ouvert dans les réglages', () => {
  it('une apostrophe dans un mot : le texte resté ouvert est nommé, avec sa ligne', async () => {
    await assert.rejects(lire("<@document *lang(chars: l'été)>\n<p>x</p>\n"), /\*lang sur <@document> \(ligne 1\) : un texte entre guillemets n'est jamais refermé dans ses réglages/)
  })

  it('un guillemet double jamais refermé : le texte resté ouvert est nommé, sans parler de parenthèse', async () => {
    await assert.rejects(lire('<@document *lang(chars: "abc)>\n<p>x</p>\n'), (e: Error) => /\*lang sur <@document> \(ligne 1\) : un guillemet double n'est jamais refermé dans ses réglages/.test(e.message) && !/parenthèse/.test(e.message))
  })

  it('un guillemet double jamais refermé, en anglais', async () => {
    setMessagesLang('en')
    try {
      await assert.rejects(lire('<@document *lang(chars: "abc)>\n<p>x</p>\n'), /\*lang on <@document> \(line 1\): a double quote in its settings is never closed/)
    }
    finally { setMessagesLang('fr') }
  })

  it('la parenthèse oubliée : l\'expression restée ouverte est nommée', async () => {
    await assert.rejects(lire('<@document *ripple(color: red>\n<p>x</p>\n'), /\*ripple sur <@document> \(ligne 1\) : la parenthèse de ses réglages n'est jamais refermée/)
  })

  it('la valeur entre guillemets doubles, ou l\'apostrophe échappée dans un texte : aucune erreur', async () => {
    const doubles = await lire('<@document *lang(chars: "l\'été")>\n<p>x</p>\n')
    assert.deepEqual(doubles.data.macroErrors, [])
    assert.ok(doubles.output.includes('"lang", {"chars":"l\'été"}'))
    const echappee = await lire("<@document *lang(chars: 'l\\'été')>\n<p>x</p>\n")
    assert.deepEqual(echappee.data.macroErrors, [])
  })
})
