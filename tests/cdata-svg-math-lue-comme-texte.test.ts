// `<![CDATA[…]]>` dans un `<svg>` ou un `<math>` est un texte pour le navigateur, jusqu'au `]]>`. Le parseur y lisait le
// `<` comme une balise : `<![CDATA[a<b]]>{$a}` devenait une balise `<b>` et le gabarit ouvrait une section jamais refermée
// qui avalait la valeur suivante (jamais affichée). La section part désormais telle qu'écrite, refermée ; sans `]]>`, elle
// avalerait toute la suite du composant : refusée

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const T = (html: string) => transpile(`<script>\n$a = 1\n</script>\n${html}\n`, { moduleName: 'cdata-dessin' })

describe('CDATA dans un dessin : un texte jusqu\'au ]]>', () => {
  it('svg : la section est refermée, la valeur qui suit a son marqueur', async () => {
    const r = await T('<svg><text><![CDATA[a<b]]>{$a}</text></svg>')
    assert.match(r.output, /<svg><text><!\[CDATA\[a<b\]\]><!--\$--><\/text><\/svg>/)
    assert.doesNotMatch(r.output, /<b>/)
  })

  it('math : `<` et accolades dans la section restent du texte', async () => {
    const r = await T('<math><mi><![CDATA[x<y {z}]]></mi><mn>{$a}</mn></math>')
    assert.match(r.output, /<mi><!\[CDATA\[x<y \{z\}\]\]><\/mi>/)
  })

  it('sans `]]>` : refusée, avec la ligne', async () => {
    await assert.rejects(T('<p>{$a}</p>\n<svg><text><![CDATA[a<b</text></svg>'), /CDATA NON FERMÉE[\s\S]*ligne 5/)
  })

  it('témoin : hors d\'un dessin, rien ne change', async () => {
    const r = await T('<div><![CDATA[a]]>{$a}</div>')
    assert.match(r.output, /<div><!\[CDATA\[a\]\]><!--\$--><\/div>/)
  })
})
