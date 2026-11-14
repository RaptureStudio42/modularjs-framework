// <@@img> : un composant ou un partiel écrit avec des fins de ligne CR seules (ou commençant par un BOM) se lit pour le relevé des
// images comme le transpileur le lit, fins de ligne changées en LF : un commentaire de script qui cite `</script>` ne coupe pas la
// section, la vraie <@@img> qui suit se prépare (empreinte, copie, adresse), en développement et en production, dans un composant et
// dans un partiel <@include>

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'
const BOM = String.fromCharCode(0xfeff)

const CAS: Array<[string, string]> = [
  ['CR seuls, commentaire Civet qui cite </script>', `<script>\r  x = 1\r  # voir </script> ici\r</script>\r<p>ok</p>\r${IMG}\r`],
  ['CR seuls, balise puis script lang=civet, commentaire qui cite </script>', `<p>a</p>\r<script lang="civet">\r  x = 1\r  # voir </script> ici\r</script>\r<p>ok</p>\r${IMG}\r`],
  ['CR seuls, script lang=js, commentaire qui cite </script>', `<script lang="js">\r  const x = 1\r  // voir </script> ici\r</script>\r<p>ok</p>\r${IMG}\r`],
  ['BOM et CR seuls, commentaire Civet qui cite </script>', `${BOM}<script>\r  x = 1\r  # voir </script> ici\r</script>\r<p>ok</p>\r${IMG}\r`],
]

async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<{ erreurs: string[], balises: string[], copies: string[] }> {
  const root = mjsTmp('img-cr-seules')
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

describe('<@@img> d\'un fichier aux fins de ligne CR seules', function () {
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
