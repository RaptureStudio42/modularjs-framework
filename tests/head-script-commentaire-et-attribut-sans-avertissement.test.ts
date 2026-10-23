// L'avertissement « ce <script> … ne s'exécutera jamais » de `<@head>` partait aussi pour un `<script>` écrit dans un
// commentaire ou dans une valeur d'attribut (`<meta content="<script>">`) : seule une vraie balise compte désormais

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const avertissements = async (head: string): Promise<string[]> => {
  const r = await transpile(`<script>\n$a = 1\n</script>\n<@head>${head}</@head>\n<div>{$a}</div>\n`, { moduleName: 'head-script' })
  return (r.data?.sectionWarnings ?? []).filter((w: string) => /<script>/.test(w))
}

describe('<@head> : un <script> dans un commentaire ou un attribut n\'est pas averti', () => {
  it('commentaire, valeur entre guillemets, entre apostrophes : aucun avertissement', async () => {
    assert.deepEqual(await avertissements('<!-- <script>a()</script> --><meta name="x" content="y">'), [])
    assert.deepEqual(await avertissements('<meta name="x" content="<script>">'), [])
    assert.deepEqual(await avertissements('<meta name=\'x\' content=\'<script src="a.js">\'>'), [])
  })

  it('témoins : un vrai script averti une fois, un script de données jamais', async () => {
    assert.equal((await avertissements('<script src="x.js"></script><!-- <script>a()</script> -->')).length, 1)
    assert.deepEqual(await avertissements('<script type="application/ld+json" data-x="a > b">{}</script>'), [])
  })
})
