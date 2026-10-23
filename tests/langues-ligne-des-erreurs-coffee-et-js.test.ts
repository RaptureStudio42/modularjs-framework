// Une faute de syntaxe ligne 6 du fichier était annoncée ligne 3 (la ligne dans le script seul) en
// `lang="coffee"` et en `lang="js"` ; Civet et TypeScript citaient déjà la bonne ligne.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const tete = '<p>un</p>\n<p>deux</p>\n<p>trois</p>\n'
const cas: Record<string, string> = {
  coffee: tete + '<script lang="coffee">\na = 1\nb = [1, 2)\n</script>\n',
  js: tete + '<script lang="js">\nconst a = 1\nconst b = [1, 2)\n</script>\n',
  civet: tete + '<script>\na = 1\nb = [1, 2)\n</script>\n',
  ts: tete + '<script lang="ts">\nconst a: number = 1\nconst b = [1, 2)\n</script>\n',
}

async function erreur(src: string, nom: string): Promise<string> {
  const ow = console.warn
  console.warn = () => {}
  try { await transpile(src, { moduleName: nom }) }
  catch (e: any) { return String(e.message) }
  finally { console.warn = ow }
  return ''
}

describe('langues — ligne des erreurs de syntaxe du script', () => {
  for (const [lang, src] of Object.entries(cas)) {
    it(`${lang} : la faute est citée ligne 6 du fichier`, async () => {
      const message = await erreur(src, 'lignes' + lang)
      assert.match(message, /\.script:6:\d+/, message)
    })
  }

  it('js : le message est traduit', async () => {
    assert.match(await erreur(cas.js, 'lignes-js-fr'), /erreur de syntaxe JavaScript/)
  })

  it('témoin : un script js valide se construit', async () => {
    const { output } = await transpile('<script lang="js">\nconst a = 1\n$n = a + 1\n</script>\n<p>{$n}</p>', { moduleName: 'js-valide' })
    assert.ok(output.length > 0)
  })
})
