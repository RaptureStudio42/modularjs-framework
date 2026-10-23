// Dans un `<textarea>` ou un `<title>` HTML, le navigateur ne lit aucun commentaire : `<textarea>a<!-->b</textarea>`
// affiche `a<!-->b`, `<textarea><!-- x --></textarea>` affiche `<!-- x -->`. Le compilateur retirait ces commentaires
// (le texte disparaissait en silence) et refusait un `<!--` sans fin écrit dans le champ. Ils sont désormais gardés comme
// texte, jusqu'au `-->` sans dépasser la fermante ; ailleurs, un commentaire reste retiré

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const gabarit = async (html: string): Promise<string> => {
  const r = await transpile(`<script>\n$a = 1\n</script>\n${html}\n`, { moduleName: 'champ-commentaire' })
  const m = /_mjs_cloneTpl\("((?:[^"\\]|\\.)*)"\)/.exec(r.output)
  assert.ok(m, 'gabarit introuvable')
  return JSON.parse(`"${m![1]}"`)
}

describe('textarea et title : un commentaire y est un texte', () => {
  it('`<!-->` et `<!-- x -->` restent dans le champ, tels qu\'écrits', async () => {
    assert.match(await gabarit('<div><textarea aria-label="t">a<!-->b</textarea><p>{$a}</p></div>'), /<textarea aria-label='t'>a<!-->b<\/textarea>/)
    assert.match(await gabarit('<div><textarea aria-label="t"><!-- x --></textarea><p>{$a}</p></div>'), /<textarea aria-label='t'><!-- x --><\/textarea>/)
  })

  it('un `<!--` sans fin dans le champ est un texte, pas un commentaire non fermé', async () => {
    assert.match(await gabarit('<div><textarea aria-label="t">a<!--b</textarea><p>{$a}</p></div>'), /<textarea aria-label='t'>a<!--b<\/textarea><p>/)
  })

  it('la fermante du champ l\'emporte sur le `-->` qui suit', async () => {
    const html = await gabarit('<div><textarea aria-label="t">a<!-- </textarea><p>{$a}</p> --></div>')
    assert.match(html, /<textarea aria-label='t'>a<!-- <\/textarea><p>/)
    assert.match(html, /<\/p> --><\/div>/)
  })

  it('une valeur `{…}` dans le texte du commentaire n\'est pas lue, celle qui suit l\'est', async () => {
    const r = await transpile('<script>\n$a = 1\n</script>\n<div><textarea aria-label="t"><!-- {$a} -->{$a}</textarea></div>\n', { moduleName: 'champ-commentaire' })
    assert.match(r.output, /<!-- \{\$a\} -->/)
    // le contenu du champ se lie à son texte : le commentaire y reste un texte, la valeur qui suit est lue
    assert.match(r.output, /"<!-- \{\$a\} -->" \+ \(\(\$\.a\) \?\? ''\)/)
  })

  it('`<title>` HTML : commentaire gardé ; `<title>` d\'un dessin et texte courant : commentaire retiré', async () => {
    assert.match(await gabarit('<div><title>a<!-- x -->b</title><p>{$a}</p></div>'), /<title>a<!-- x -->b<\/title>/)
    assert.match(await gabarit('<svg><title>a<!-- x -->b</title><g>{$a}</g></svg>'), /<title>ab<\/title>/)
    assert.match(await gabarit('<div>a<!-- x -->b<p>{$a}</p></div>'), /<div>ab<p>/)
  })
})
