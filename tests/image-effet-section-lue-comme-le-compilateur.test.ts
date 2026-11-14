// images des effets (`*behind('photo.png')`) : le relevé de la construction lit les sections du composant comme le compilateur.
// Dans un projet CoffeeScript, un commentaire `#voir </script>` ne referme pas le script ; un script posé après un commentaire HTML
// sur sa ligne est un script. Un exemple d'effet cité dans le code (`'<p *behind("absent.jpg")>'`) n'est pas lu : la construction
// passe, et la vraie image de l'effet du gabarit est copiée

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

// [nom, composant, langue du projet]
const CAS: Array<[string, string, string?]> = [
  ['projet CoffeeScript, commentaire collé #voir </script>', `<script>\nx = 1 #voir </script>\ny = '<p *behind("absent.jpg")>t</p>'\n</script>\n<p *behind('b.png')>ok</p>\n`, 'coffee'],
  ['projet CoffeeScript, script lang="coffee" dans un projet Civet', `<script lang="coffee">\nx = 1 #voir </script>\ny = '<p *behind("absent.jpg")>t</p>'\n</script>\n<p *behind('b.png')>ok</p>\n`],
  ['commentaire HTML puis script sur la même ligne', `<!-- logique --><script>\n  fin = '</script >'\n  y = '<p *behind("absent.jpg")>t</p>'\n</script>\n<p *behind('b.png')>ok</p>\n`],
]

describe('images des effets : les sections se lisent comme le compilateur les lit', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, texte, langue] of CAS) {
    it(nom, async () => {
      const root = mjsTmp('image-effet-section')
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      mkdirSync(out)
      writeFileSync(join(src, 'b.png'), validPng(40, 30))
      writeFileSync(join(src, 'page.mjs'), texte)
      const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), ...(langue ? { defaultScriptLang: langue } : {}) } as ConstructorParameters<typeof Bundler>[0])
      const stats = await b.compile()
      await b.close()
      assert.deepEqual(stats.errors.map(e => e.message.split('\n')[0]), [])
      assert.equal(readdirSync(out).filter(f => f.endsWith('.png')).length, 1, 'la vraie image de l\'effet est copiée')
    })
  }
})
