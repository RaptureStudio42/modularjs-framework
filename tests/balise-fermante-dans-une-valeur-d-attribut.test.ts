// Un `</script>` (ou `</style>`) écrit dans la valeur d'un attribut du gabarit (`title="a </script> b"`, du HTML valide)
// faisait refuser la construction : la garde des balises orphelines le prenait pour un reste de script échappé de
// l'extraction. Les valeurs entre guillemets des balises bien formées ne sont plus lues par cette garde ; un vrai reste
// (chaîne non fermée dans le script, `</script>` dans le texte) est toujours refusé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const T = (src: string) => transpile(src, { moduleName: 'balise-attribut' })

describe('balise fermante dans une valeur d\'attribut', () => {
  it('`</script>` dans un title, script avant ou après le gabarit : construit', async () => {
    for (const src of [
      '<script>\n$n = 1\n</script>\n<p title="a </script> b">{$n}</p>',
      '<p title="a </script> b">{$n}</p>\n<script>\n$n = 1\n</script>',
    ]) {
      const r = await T(src)
      // la chaîne du gabarit l'écrit `<\/script>` (même valeur) : elle ne refermerait pas la balise d'une page où ce code
      // serait mis en ligne
      assert.match(r.output, /a <\\\/script> b/)
    }
  })

  it('`</style>` entre apostrophes, balise sur plusieurs lignes, attribut d\'événement : construit', async () => {
    const r = await T("<script>\n$n = 1\n</script>\n<p\n  class=\"x\"\n  data-x='</style>'\n  @click={$n++}>{$n}</p>\n<style>\np\n  color: red\n</style>")
    assert.match(r.output, /<\/style>/)
  })

  it('témoins : reste de script (chaîne non fermée) et `</script>` dans le texte toujours refusés', async () => {
    await assert.rejects(T('<script>\nx = "abc</script>\ny = 2\n</script>\n<p>{x}</p>'), /orphelin/)
    await assert.rejects(T('<script>\n$n = 1\n</script>\n<p>a </script> b</p>'), /orphelin/)
    await assert.rejects(T('<script>\nx = "abc</script>\nif a <b then c\n</script>\n<p>{x}</p>'), /orphelin/)
  })

  describe('composant monté', function () {
    this.timeout(90000)
    let app: any

    before(async () => {
      const root   = mjsTmp('balise-fermante-attribut')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'attr-script.mjs'), '<script>\n$n = 1\n</script>\n<p class="v" title="a </script> b">{$n}</p>\n')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('la valeur de l\'attribut arrive telle quelle', async () => {
      const c = await app.mount('attr-script')
      try {
        assert.equal(c.find('.v').getAttribute('title'), 'a </script> b')
        assert.equal(c.text('.v'), '1')
      }
      finally { c.destroy() }
    })
  })
})
