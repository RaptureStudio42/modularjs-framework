// une section <script> ou <style> du composant (en tête de ligne) se lit jusqu'à son fermant exact hors de ses chaînes et de ses
// commentaires, comme la lit le compilateur : un `</script >`, `</scripts>`, `</script-x>`, `</style >`, `</styles>`, ou même un
// `</script>` exact, écrit dans une chaîne ou un commentaire de la section ne la ferme pas. Un exemple `<@@img>` cité plus bas dans
// la section n'est pas pris pour une image (ni préparé, ni récrit), et la vraie balise qui suit la section se prépare comme toute
// `<@@img>` ; en développement et en production, dans un composant et dans un partiel `<@include>`

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="b.png" alt="b">'

// [nom, gabarit] : l'exemple `a.png`, absent du disque, cité dans la section après un fermant approché, puis la vraie balise
const EXEMPLES: Array<[string, string]> = [
  ['chaîne </script > puis exemple dans une chaîne', `<script>\nconst fin = '</script >'\nconst ex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['chaîne </scripts> puis exemple dans une chaîne', `<script>\nconst fin = '</scripts>'\nconst ex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['chaîne </script-x> puis exemple dans une chaîne', `<script>\nconst fin = '</script-x>'\nconst ex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['chaîne </script> exacte puis exemple dans une chaîne', `<script>\nconst fin = '</script>'\nconst ex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['civet, commentaire # </script > puis exemple', `<script lang="civet">\n# fin </script > ici\nex := '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['civet, commentaire ### </scripts> ### puis exemple', `<script lang="civet">\n### </scripts> ###\nex := '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['coffee, bloc ### </script > ### puis exemple', `<script lang="coffee">\n###\n</script >\n###\nex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['coffee, commentaire collé #voir </script> puis exemple', `<script lang="coffee">\nx = 1 #voir </script>\nex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['<script module>, chaîne </script > puis exemple', `<script module>\nexport const fin = '</script >'\nexport const ex = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['style css, commentaire </style > puis exemple en commentaire', `<style lang="css">\n/* fin </style > */\n/* <@@img src="a.png"> */\n</style>\n${IMG}\n`],
  ['style sass, commentaire // </styles> puis exemple en commentaire', `<style>\n// fin </styles>\n// <@@img src="a.png">\n</style>\n${IMG}\n`],
]

// [nom, gabarit] : une accolade ouvrante citée dans la section après un fermant approché, puis la vraie balise
const ACCOLADES: Array<[string, string]> = [
  ['chaîne </script > puis chaîne {', `<script>\nconst fin = '</script >'\nconst s = '{'\n</script>\n${IMG}\n`],
  ['civet, commentaire # </scripts> puis chaîne {', `<script lang="civet">\n# </scripts>\ns := '{'\n</script>\n${IMG}\n`],
  ['coffee, commentaire collé #voir </script> puis chaîne {', `<script lang="coffee">\nx = 1 #voir </script>\ns = '{'\n</script>\n${IMG}\n`],
  ['style css, commentaire /* </styles> */ puis { dans un commentaire', `<style lang="css">\n/* </styles> */\n.a { color: red }\n/* { */\n</style>\n${IMG}\n`],
]

// l'exemple cite une image présente sur le disque, sans vraie balise dans le gabarit : la chaîne du script reste telle quelle
const PRESENTE = `<script>\nconst fin = '</script >'\nconst ex = '<@@img src="b.png">'\n</script>\n<p>x</p>\n`

type Prepare = { preResolveAssets: (content: string, baseDir?: string) => Promise<{ images: Record<string, string> }> }

interface Construit {
  erreurs: string[]
  balises: string[]
  copies:  string[]
  images:  string[]
}

// la construction d'un gabarit écrit dans le composant ou dans son partiel `_cas.mjs` : erreurs, images de la page écrite, images
// copiées, balises `<@@img>` préparées
async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<Construit> {
  const root = mjsTmp('img-fin-de-section')
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

describe('<@@img> après une section <script> ou <style> dont une chaîne ou un commentaire cite un fermant', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        for (const [nom, gabarit] of [...EXEMPLES, ...ACCOLADES]) {
          it(nom, async () => {
            const vu = await construire(gabarit, prod, partiel)
            assert.deepEqual(vu.erreurs, [])
            assert.deepEqual(vu.images, [IMG], 'seule la vraie balise se prépare')
            assert.equal(vu.balises.length, 1, vu.balises.join('\n'))
            assert.match(vu.balises[0], /src=.\/out\/b-[a-f0-9]{8}\.png/)
          })
        }

        it('exemple d\'une image présente sur le disque : ni préparé, ni copié', async () => {
          const vu = await construire(PRESENTE, prod, partiel)
          assert.deepEqual(vu.erreurs, [])
          assert.deepEqual(vu.images, [])
          assert.deepEqual(vu.copies, [])
        })
      })
    }
  }
})
