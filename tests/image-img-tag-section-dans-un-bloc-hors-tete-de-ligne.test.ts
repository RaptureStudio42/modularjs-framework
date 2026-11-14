// <@@img> : dans un bloc <@head> ou <@failed>, que le compilateur émet tel quel, un <script> ou un <style> posé hors de la tête de
// ligne (après une balise ou un commentaire HTML sur sa ligne), et une autre section (<vars>, <theme>, <types>…) posée après un
// commentaire HTML sur sa ligne, cachent leur contenu au relevé des images : un exemple <@@img> cité dans leur code, même après une
// fermante citée dans une chaîne ou un commentaire, n'est pas pris pour une image (la construction passe, son fichier peut manquer),
// la vraie <@@img> qui suit le bloc se prépare (empreinte, copie, adresse), en développement et en production, dans un composant
// et dans un partiel <@include>

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'

const CAS: Array<[string, string]> = [
  ['<@head>, commentaire + script, fermante citée', `<@head>\n<!-- c --><script>\n  fin = '</script >'\n  ex = '<@@img src="a.png">'\n</script>\n</@head>\n<p>ok</p>\n${IMG}\n`],
  ['<@head>, balise + script lang=ts, fermante citée', `<@head>\n<p>a</p> <script lang="ts">\n  const fin = '</script >'\n  const ex = '<@@img src="a.png">'\n</script>\n</@head>\n<p>ok</p>\n${IMG}\n`],
  ['<@head>, balise + style sass, fermante citée', `<@head>\n<p>a</p> <style lang="sass">\n  a\n    content: '</style >'\n  // <@@img src="a.png">\n</style>\n</@head>\n<p>ok</p>\n${IMG}\n`],
  ['<@failed>, commentaire + vars', `<@failed err reset>\n<!-- c --><vars>\n  d: '<@@img src="a.png">'\n</vars>\n<p>oups</p>\n</@failed>\n<p>ok</p>\n${IMG}\n`],
  ['<@head>, deux commentaires + theme', `<@head>\n<!-- a --> <!-- b --><theme>\n  d: '<@@img src="a.png">'\n  a: 1\n</theme>\n</@head>\n<p>ok</p>\n${IMG}\n`],
  ['<@head>, commentaire de plusieurs lignes + types', `<@head>\n<!--\nc\n--><types>\n  d: '<@@img src="a.png">'\n</types>\n</@head>\n<p>ok</p>\n${IMG}\n`],
]

type Prepare = { preResolveAssets: (content: string, baseDir?: string) => Promise<{ images: Record<string, string> }> }

async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<{ erreurs: string[], balises: string[], copies: string[], images: string[] }> {
  const root = mjsTmp('img-section-bloc')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  const page = partiel ? '<div><@include cas></div>\n' : gabarit
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), gabarit)
  writeFileSync(join(src, 'page.mjs'), page)
  const b      = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats  = await b.compile()
  const images = Object.keys((await (b as unknown as Prepare).preResolveAssets(page, src)).images)
  await b.close()
  const sortie = readdirSync(out)
  const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { erreurs: stats.errors.map(e => e.message.split('\n')[0]), balises: js.match(/<mjs-core-img\b[^>]*>/g) ?? [], copies: sortie.filter(f => /\.png$/.test(f)), images }
}

describe('<@@img> après une section d\'un bloc <@head> / <@failed> posée hors de la tête de ligne', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        for (const [nom, gabarit] of CAS) {
          it(nom, async () => {
            const vu = await construire(gabarit, prod, partiel)
            assert.deepEqual(vu.erreurs, [])
            assert.deepEqual(vu.images, [IMG], 'la vraie balise se prépare, l\'exemple non')
            assert.equal(vu.copies.length, 1, JSON.stringify(vu.copies))
            assert.ok(vu.balises.some(t => /src=.\/out\/b-[a-f0-9]{8}\.png/.test(t)), vu.balises.join('\n'))
          })
        }
      })
    }
  }
})
