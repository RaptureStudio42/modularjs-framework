// les balises du langage (`<@window>`, `<@document>`, `<@head>`…) sont lues dans l'arbre du gabarit : une telle balise
// écrite dans une valeur d'attribut, une chaîne d'expression ou le texte d'un <textarea> n'est qu'un texte (aucun
// écouteur global posé, aucun <head> touché, le texte gardé) ; une vraie balise agit comme avant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SCRIPT = '<script>\nf = -> 1\n</script>\n'

async function compile(html: string): Promise<{ output: string, erreurs: string[] }> {
  const orig = console.warn
  console.warn = () => {}
  try {
    const { output, data } = await transpile(SCRIPT + html + '\n', { moduleName: 'hote' })
    return { output, erreurs: data.macroErrors }
  }
  finally {
    console.warn = orig
  }
}

describe('une balise du langage écrite dans un texte du gabarit', () => {
  it('dans une valeur d\'attribut : aucun écouteur, l\'attribut garde son texte', async () => {
    const { output, erreurs } = await compile('<p title="<@window @resize={f}>">x</p>')
    assert.deepEqual(erreurs, [])
    assert.doesNotMatch(output, /addEventListener\('resize'/)
    assert.match(output, /@window @resize/)
  })

  it('dans une chaîne d\'expression : aucun écouteur', async () => {
    const { output } = await compile('<p>{\'<@window @resize={f}>\'}</p>')
    assert.doesNotMatch(output, /addEventListener\('resize'/)
  })

  it('dans le texte d\'un <textarea> : aucun écouteur', async () => {
    const { output } = await compile('<textarea aria-label="t"><@window @resize={f}></textarea>')
    assert.doesNotMatch(output, /addEventListener\('resize'/)
  })

  it('un <@head>…</@head> dans une valeur d\'attribut ne touche pas le <head>', async () => {
    const { output } = await compile('<p title="<@head><meta name=a></@head>">x</p>')
    assert.doesNotMatch(output, /_setHead/)
  })
})

describe('une vraie balise du langage', () => {
  it('<@window @resize={f}> pose son écouteur', async () => {
    const { output, erreurs } = await compile('<@window @resize={f}>\n<p>x</p>')
    assert.deepEqual(erreurs, [])
    assert.match(output, /window\.addEventListener\('resize'/)
  })

  it('<@head>…</@head> remplit le <head>', async () => {
    const { output } = await compile('<@head><meta name=a></@head>\n<p>x</p>')
    assert.match(output, /_setHead\(this, '<meta name=a>'\)/)
  })
})
