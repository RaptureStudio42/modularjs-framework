// <@@img> : une section que le compilateur lit hors de la tête de ligne du texte (commentaire HTML posé avant elle sur sa ligne,
// séparateur de ligne U+2028 / U+2029, section écrite dans un <textarea>, fichier en CRLF ou commençant par un BOM) se referme à sa
// vraie fermante pour le relevé des images : un exemple <@@img> cité dans son code n'est pas pris pour une image, la vraie <@@img> qui
// suit se prépare (empreinte, copie, adresse), en développement et en production, dans un composant et dans un partiel <@include>

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'

const CAS: Array<[string, string]> = [
  ["commentaire + script, exemple", "<!-- logique --><script>\n  const fin = '</script >'\n  const ex = '<@@img src=\"a.png\">'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["commentaire + script, accolade", "<!-- logique --><script>\n  fin = '</script >'\n  ex = '{'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["deux commentaires + script lang=js, exemple", "  <!-- a --> <!-- b --><script lang=\"js\">\n  const fin = '</script >'\n  const ex = '<@@img src=\"a.png\">'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["commentaire + script module, accolade", "<!-- m --><script module>\n  fin = '</script >'\n  ex = '{'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["commentaire + style sass, exemple", "<!-- c --><style>\n  p::after\n    content: '</style >'\n  p::before\n    content: '<@@img src=\"a.png\">'\n</style>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["commentaire + style sass, accolade", "<!-- c --><style>\n  p::after\n    content: '</style >'\n  p::before\n    content: '{'\n</style>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["U+2029 + script, exemple", "<p>a</p>\u2029<script>\n  const fin = '</script >'\n  const ex = '<@@img src=\"a.png\">'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["U+2028 + style sass, accolade", "<p>a</p>\u2028<style>\n  p::after\n    content: '</style >'\n  p::before\n    content: '{'\n</style>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["textarea + script, exemple", "<textarea>\n<script>\n  const fin = '</textarea>'\n  const ex = '<@@img src=\"a.png\">'\n</script>\n</textarea>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["textarea + script, accolade", "<textarea>\n<script>\n  fin = '</textarea>'\n  ex = '{'\n</script>\n</textarea>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
  ["CRLF commentaire + script, exemple", "<!-- logique --><script>\r\n  const fin = '</script >'\r\n  const ex = '<@@img src=\"a.png\">'\r\n</script>\r\n<p>ok</p>\r\n<@@img src=\"b.png\" alt=\"b\">\r\n"],
  ["BOM commentaire + script, accolade", "\ufeff<!-- logique --><script>\n  fin = '</script >'\n  ex = '{'\n</script>\n<p>ok</p>\n<@@img src=\"b.png\" alt=\"b\">\n"],
]

type Prepare = { preResolveAssets: (content: string, baseDir?: string) => Promise<{ images: Record<string, string> }> }

async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<{ erreurs: string[], balises: string[], copies: string[], images: string[] }> {
  const root = mjsTmp('img-section-hors-tete')
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

describe('<@@img> après une section lue par le compilateur hors de la tête de ligne du texte', function () {
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
