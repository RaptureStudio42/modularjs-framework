// dans un `<textarea>` ou un `<title>` HTML, le navigateur ne lit aucun commentaire : un `<!-- … -->` qui cite une balise du langage
// (`<@head>`, `<@window>`) y reste un texte, tel qu'écrit, sur une ligne comme sur plusieurs (chapitre 2, « Les commentaires »), comme
// celui qui n'en cite aucune ; il était retiré avec son texte. Dans le `<title>` d'un dessin et dans le texte courant, il reste retiré

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const gabarit = async (html: string): Promise<string> => {
  const r = await transpile(`<script>\n$a = 1\n</script>\n${html}\n`, { moduleName: 'champ-commentaire-cite' })
  const m = /_mjs_cloneTpl\("((?:[^"\\]|\\.)*)"\)/.exec(r.output)
  assert.ok(m, 'gabarit introuvable')
  return JSON.parse(`"${m![1]}"`)
}

describe('textarea et title : un commentaire qui cite une balise du langage y est un texte', () => {
  it('<textarea>, sur une ligne et sur plusieurs : tel qu\'écrit', async () => {
    assert.match(await gabarit('<div><textarea aria-label="t">avant<!-- voir <@head> -->après</textarea><p>{$a}</p></div>'), /<textarea aria-label='t'>avant<!-- voir <@head> -->après<\/textarea>/)
    assert.match(await gabarit('<div><textarea aria-label="t">avant<!-- voir\n<@window>\n-->après</textarea><p>{$a}</p></div>'), /<textarea aria-label='t'>avant<!-- voir\n<@window>\n-->après<\/textarea>/)
  })

  it('<title> HTML : tel qu\'écrit', async () => {
    assert.match(await gabarit('<div><title>t<!-- voir <@head> -->u</title><p>{$a}</p></div>'), /<title>t<!-- voir <@head> -->u<\/title>/)
  })

  it('le <title> d\'un dessin et le texte courant : retiré', async () => {
    assert.match(await gabarit('<svg><title>a<!-- voir <@head> -->b</title><g>{$a}</g></svg>'), /<title>ab<\/title>/)
    assert.match(await gabarit('<div>a<!-- voir <@head> -->b<p>{$a}</p></div>'), /<div>ab<p>/)
  })
})
