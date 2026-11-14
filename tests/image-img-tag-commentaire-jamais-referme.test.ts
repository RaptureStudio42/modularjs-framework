// <@@img> : un `<!--` jamais refermé dans le gabarit (cité dans un <script> écrit en milieu de ligne, qui n'est pas une section,
// ou après un `</title>` cité), ou refermé plus loin qu'une section de plusieurs lignes, n'arrête pas le relevé des images. Le
// compilateur retire les sections avant de lire le gabarit, et une section de plusieurs lignes y laisse un commentaire de même
// hauteur : ce `<!--` se referme à la fin de la première qui le suit, quand elle vient avant le premier `-->` du texte (commentaire
// refermé, valeur d'attribut, texte). Le relevé lit de même : la vraie <@@img> qui suit se prépare (empreinte, copie, adresse), une
// <@@img> écrite avant cette fin est dans le commentaire et ne l'est pas, en développement et en production, dans un composant et
// dans un partiel <@include>

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'
const L28 = String.fromCharCode(0x2028)

const CAS: Array<[string, string]> = [
  ['script en milieu de ligne, chaîne <!--, section <style> plus loin', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<style lang="css">\n  p { color: red }\n</style>\n</div>\n${IMG}\n`],
  ['script en milieu de ligne, chaîne <!--, image citée avant la section <style>', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<@@img src="absent.png" alt="a">\n<style lang="css">\n  p { color: red }\n</style>\n</div>\n${IMG}\n`],
  ['script en milieu de ligne, section d\'une ligne puis section <theme>', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<style lang="css">p { color: red }</style>\n<@@img src="absent.png" alt="a">\n<theme>\n  c: 1\n</theme>\n</div>\n${IMG}\n`],
  ['title puis script lang=ts qui cite </title> et <!--, section <style> plus loin', `<title>\n<p>a</p><script lang="ts">\n  const g = '</title>'\n  const d = '<!--'\n</script>\n</title>\n<style lang="css">\n  p { color: red }\n</style>\n${IMG}\n`],
  ['commentaire jamais refermé dans le texte, section <script> plus loin', `<p>a</p>\n<!-- c\n<@@img src="absent.png" alt="a">\n<script>\n  x = 1\n</script>\n${IMG}\n`],
  ['section <theme> dans une valeur d\'attribut', `<pre>\n<style lang="sass">\n  // fin </style> ici\n  a\n    content: '</style >'\n</style>\n</pre>\r\n<p>"</p>\r\n<p title="<!--">t</p>\n<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n</div>\n<div title="\n<theme>\n  b: '</vars >'\n  f: '</script>'\n</theme>\n">t</div>\n${IMG}\n`],
  ['title, script lang=ts, valeur qui cite </script>, séparateurs U+2028', `<title>\n<p>a</p><script lang="ts">\n  g = '</title>'\n  d = '<!--'\n</script>\n</title>\n<input value="</script>">\r\n<p>t</p>${L28}<p>a</p>${L28}<style lang="sass">\n  p\n    color: blue\n</style>${L28}${IMG}\n`],
  ['script en milieu de ligne, chaîne <!--, section <style>, commentaire refermé après l\'image', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<style lang="css">\n  p { color: red }\n</style>\n</div>\n${IMG}\n<!-- x -->\n`],
  ['script en milieu de ligne, chaîne <!--, section <style>, valeur d\'attribut --> après l\'image', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<style lang="css">\n  p { color: red }\n</style>\n</div>\n${IMG}\n<p title="-->">t</p>\n`],
  ['script en milieu de ligne, chaîne <!--, section <style>, texte --> après l\'image', `<div>\n<p>a</p><script>\n  d = '<!--'\n</script>\n<style lang="css">\n  p { color: red }\n</style>\n</div>\n${IMG}\n<p>--></p>\n`],
]

async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<{ erreurs: string[], balises: string[], copies: string[] }> {
  const root = mjsTmp('img-commentaire-jamais-referme')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), gabarit)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div><@include cas></div>\n' : gabarit)
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  const sortie = readdirSync(out)
  const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), balises: js.match(/<mjs-core-img\b[^>]*>/g) ?? [], copies: sortie.filter(f => /\.png$/.test(f)) }
}

describe('<@@img> après un <!-- jamais refermé du gabarit', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        for (const [nom, gabarit] of CAS) {
          it(nom, async () => {
            const vu = await construire(gabarit, prod, partiel)
            assert.deepEqual(vu.erreurs, [])
            assert.equal(vu.copies.length, 1, JSON.stringify(vu.copies))
            assert.ok(vu.balises.some(t => /src=.\/out\/b-[a-f0-9]{8}\.png/.test(t)), vu.balises.join('\n'))
          })
        }
      })
    }
  }
})
