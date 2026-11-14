// une <@@img> écrite dans un <@head> arrête la construction : l'en-tête du document ne s'affiche jamais, l'image n'y a pas de
// place ; le message cite sa ligne dans le fichier qui l'écrit et dit où l'écrire. Elle sortait telle quelle dans le <head>, en
// texte, l'image copiée pour rien. En développement et en production, dans un composant et dans un partiel <@include>. Une
// <@@img> citée dans le code d'un <script> du <@head> ou dans une section posée après des commentaires n'est pas une balise : rien
// n'est refusé, même hors de la tête de ligne après une fermante inexacte citée (lu jusqu'à sa fermante exacte, comme le relevé des images)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const DANS_HEAD = '<@head>\n  <meta name="a" content="1">\n  <@@img src="b.png" alt="b">\n</@head>\n<p>ok</p>\n<script>\n  x = 1\n</script>\n'
const CITEES: Array<[string, string]> = [
  ['un <script> de données', '<@head>\n  <script type="application/ld+json">{"image": "<@@img src=b.png>"}</script>\n</@head>\n<p>ok</p>\n<@@img src="b.png" alt="b">\n<script>\n  x = 1\n</script>\n'],
  ['un <script> hors de la tête de ligne, fermante inexacte citée', '<@head>\n<p>a</p> <script lang="ts">\n  const fin = \'</script >\'\n  const ex = \'<@@img src="a.png">\'\n</script>\n</@head>\n<p>ok</p>\n<@@img src="b.png" alt="b">\n<script>\n  x = 1\n</script>\n'],
  ['une section <theme> après des commentaires sur sa ligne', '<@head>\n<!-- a --> <!-- b --><theme>\n  d: \'<@@img src="a.png">\'\n  a: 1\n</theme>\n</@head>\n<p>ok</p>\n<@@img src="b.png" alt="b">\n<script>\n  x = 1\n</script>\n'],
]

// la construction du composant `page.mjs`, ou d'une page qui inclut le partiel `_cas.mjs` : les messages d'erreur
async function construire(texte: string, prod: boolean, partiel: boolean): Promise<string[]> {
  const root = mjsTmp('img-head')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), texte)
  writeFileSync(join(src, 'page.mjs'), partiel ? '<div>\n<@include cas>\n</div>\n' : texte)
  const b     = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' })
  const stats = await b.compile()
  await b.close()
  return stats.errors.map(e => e.message)
}

describe('<@@img> dans un <@head> : refusée à la construction', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    for (const partiel of [false, true]) {
      describe(`${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`, () => {
        it('la balise écrite dans le <@head> arrête la construction, à sa ligne', async () => {
          const erreurs = await construire(DANS_HEAD, prod, partiel)
          const ligne   = partiel ? '3 de _cas.mjs' : '3'
          assert.equal(erreurs.length, 1, erreurs.join('\n'))
          assert.ok(erreurs[0].includes(`[ModularJS] <@head> ligne ${ligne} : une image <@@img> n'a pas sa place dans <@head> — l'en-tête du document ne s'affiche jamais. Écrivez <@@img> dans le gabarit, hors de <@head>.`), erreurs[0])
        })
        for (const [nom, gabarit] of CITEES) {
          it(`citée dans ${nom} du <@head>, elle n'est pas refusée`, async () => {
            assert.deepEqual(await construire(gabarit, prod, partiel), [])
          })
        }
      })
    }
  }
})
