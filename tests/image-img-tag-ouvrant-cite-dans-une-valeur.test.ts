// le bundler lit les `<@@img>` d'un composant et de ses partiels dans l'arbre du gabarit, comme le transpileur : une vraie
// balise se prépare à la construction comme toute `<@@img>` (même empreinte, même copie, même adresse), même quand un ouvrant
// de commentaire, de `<pre>`, `<code>`, `<script>` ou `<style>` est cité plus haut dans une valeur d'attribut ou une chaîne
// d'expression et son fermant plus bas ; un exemple affiché dans un `<pre>`, un `<code>`, le corps d'une section `<script>` ou
// `<style>`, un commentaire, une chaîne ou une regex n'est pas pris pour une image. En développement et en production, dans un
// composant et dans un partiel `<@include>`

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG    = '<@@img src="b.png" alt="b">'
const TEMOIN = `<p>a</p>\n${IMG}\n<p>b</p>\n`

// [nom, gabarit, page écrite] : la vraie balise entre un ouvrant cité dans une valeur et un fermant cité plus bas
const CITES: Array<[string, string, boolean]> = [
  ['ouvrant de commentaire dans une expression', `<p>{'<!--'}</p>\n${IMG}\n<p>{'-->'}</p>\n`, true],
  ['ouvrant de commentaire dans un attribut', `<p title="<!--">x</p>\n${IMG}\n<p title="-->">y</p>\n`, true],
  ['<pre> dans un attribut', `<p title="<pre>">x</p>\n${IMG}\n<p title="</pre>">y</p>\n`, true],
  ['<code> dans une expression', `<p>{'<code>'}</p>\n${IMG}\n<p>{'</code>'}</p>\n`, true],
  // le transpileur refuse ce gabarit pour une autre raison (le `</script>` cité, lu comme un fermant orphelin) : la construction
  // échoue sur ce refus, sans préparer d'image ; la variante suivante, refermée par la section `<script>` du composant, se construit
  ['<script> dans une expression', `<p>{'<script>'}</p>\n${IMG}\n<p>{'</script>'}</p>\n`, false],
  ['<script> dans une expression, refermé par la section <script>', `<p>{'<script>'}</p>\n${IMG}\n\n<script>\n$x = 1\n</script>\n`, true],
  ['<style> dans un attribut', `<p data-x="<style>">x</p>\n${IMG}\n<p data-x="</style>">y</p>\n`, true],
]

// [nom, gabarit, vraie balise si ce n'est pas IMG, '' : aucune] : l'exemple `a.png`, absent du disque, n'est jamais préparé
const EXEMPLES: Array<[string, string, string?]> = [
  ['script, chaîne', `<script>\nconst s = '<@@img src="a.png">'\n</script>\n${IMG}\n`],
  ['script lang civet, chaîne et regex', `<script lang="civet">\ns := '<@@img src="a.png">'\nr := /<!--/\n</script>\n${IMG}\n<!-- -->\n`],
  ['script, gabarit à substitution', '<script>\nconst s = `<@@img src="${x}.png">`\n</script>\n'+ IMG +'\n'],
  ['style, contenu', `<style>\n/* <@@img src="a.png"> */\n</style>\n${IMG}\n`],
  ['commentaire HTML', `<!-- <@@img src="a.png"> -->\n${IMG}\n`],
  ['commentaire HTML multiligne', `<!--\n<@@img src="a.png">\n-->\n${IMG}\n`],
  ['exemple pre', `<pre><@@img src="a.png"></pre>\n${IMG}\n`],
  ['exemple code', `<p><code>&lt;@@img&gt; <@@img src="a.png"></code></p>\n${IMG}\n`],
  ['valeur d\'attribut', `<p title='<@@img src="a.png">'>x</p>\n${IMG}\n`],
  ['expression, chaîne', `<p>{'<@@img src="a.png">'}</p>\n${IMG}\n`],
  ['expression, regex', `<p>{$s.replace(/<@@img src="a.png">/g, '')}</p>\n${IMG}\n`],
  // refusé par le transpileur (le `</script>` d'un script en milieu de ligne est un fermant orphelin) : aucune image préparée
  ['script du gabarit (non racine)', `<div><script type="text/plain"><@@img src="a.png"></script></div>\n${IMG}\n`, ''],
  ['regex de script qui ouvre un commentaire', `<script>\nconst r = /<!--/\n</script>\n${IMG}\n<p>-->x</p>\n`],
  ['chaîne de script qui ferme un pre', `<script>\nconst s = '</pre>'\n</script>\n<pre>a</pre>\n${IMG}\n`],
  ['textarea', `<textarea><@@img src="a.png"></textarea>\n${IMG}\n`],
  ['title', `<title><@@img src="a.png"></title>\n${IMG}\n`],
  ['partiel sans script', `<div>\n  ${IMG}\n  <!-- <@@img src="a.png"> -->\n</div>\n`],
  ['majuscules', '<!-- <@@IMG src="a.png"> -->\n<@@IMG src="b.png">\n', '<@@IMG src="b.png">'],
  ['bloc if', `{if $x}\n${IMG}\n{else}\n<pre><@@img src="a.png"></pre>\n{end}\n`],
  ['commentaire non refermé', `${IMG}\n<!-- <@@img src="a.png">\n`],
  ['script non refermé', `${IMG}\n<script>\nconst a = 1\n`],
]

type Prepare = { preResolveAssets: (content: string, baseDir?: string) => Promise<{ images: Record<string, string> }> }

interface Construit {
  copies:  string[]
  images:  Record<string, string>
  balises: string[]
  erreurs: string[]
}

// le projet d'un gabarit, écrit dans le composant ou dans son partiel `_cas.mjs`, et son bundler
function projet(gabarit: string, prod: boolean, partiel: boolean): { bundler: Bundler; src: string; out: string; page: string } {
  const root = mjsTmp('img-ouvrant-cite')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  const page = partiel ? '<div><@include cas></div>\n' : gabarit
  mkdirSync(src, { recursive: true })
  mkdirSync(out)
  writeFileSync(join(src, 'b.png'), validPng(40, 30))
  if (partiel) writeFileSync(join(src, '_cas.mjs'), gabarit)
  writeFileSync(join(src, 'page.mjs'), page)
  return { bundler: new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), env: prod ? 'prod' : 'dev' }), src, out, page }
}

// la construction d'un gabarit : images copiées, balises `<@@img>` préparées, images de la page écrite, erreurs
async function construire(gabarit: string, prod: boolean, partiel: boolean): Promise<Construit> {
  const p      = projet(gabarit, prod, partiel)
  const stats  = await p.bundler.compile()
  const sortie = readdirSync(p.out)
  const js     = sortie.filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(p.out, f), 'utf-8')).join('\n')
  const copies = sortie.filter(f => /\.(?:png|webp|avif)$/.test(f)).sort()
  const images = (await (p.bundler as unknown as Prepare).preResolveAssets(p.page, p.src)).images
  await p.bundler.close()
  return { copies, images, balises: js.match(/<mjs-core-img\b[^>]*>/g) ?? [], erreurs: stats.errors.map(e => e.message) }
}

const MODES = [false, true]
const LIEUX = [false, true]
const nomDe = (prod: boolean, partiel: boolean): string => `${prod ? 'production' : 'développement'}, ${partiel ? 'dans un partiel <@include>' : 'dans un composant'}`

describe('<@@img> après un ouvrant cité dans une valeur : préparée comme toute <@@img>', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of MODES) {
    for (const partiel of LIEUX) {
      describe(nomDe(prod, partiel), () => {
        let temoin: Construit

        before(async () => {
          temoin = await construire(TEMOIN, prod, partiel)
          assert.deepEqual(temoin.erreurs, [])
          assert.deepEqual(Object.keys(temoin.images), [IMG])
          assert.ok(temoin.copies.some(f => /^b-[a-f0-9]{8}\.png$/.test(f)), `image copiée sous empreinte attendue : ${temoin.copies.join(', ')}`)
          assert.equal(temoin.balises.length, 1, temoin.balises.join('\n'))
          assert.match(temoin.balises[0], /src=.\/out\/b-[a-f0-9]{8}\.png/)
        })

        for (const [nom, gabarit, pageEcrite] of CITES) {
          it(nom, async () => {
            const vu = await construire(gabarit, prod, partiel)
            if (!pageEcrite) {
              assert.ok(vu.erreurs.length === 1 && /<\/script> orphelin/.test(vu.erreurs[0]), vu.erreurs.join('\n'))
              assert.deepEqual(vu.images, {}, 'un fichier refusé ne prépare aucune image')
              return
            }
            assert.deepEqual(vu.copies, temoin.copies, 'même empreinte, même copie que la balise ordinaire')
            assert.deepEqual(vu.images, temoin.images, 'même balise préparée que la balise ordinaire')
            assert.deepEqual(vu.erreurs, [])
            assert.deepEqual(vu.balises, temoin.balises, 'même adresse dans la page que la balise ordinaire')
          })
        }
      })
    }
  }
})

describe('<@@img> : un exemple affiché n\'est toujours pas pris pour une image', function () {
  this.timeout(120000)

  for (const prod of MODES) {
    for (const partiel of LIEUX) {
      it(`${nomDe(prod, partiel)} : seule la vraie balise se prépare (${EXEMPLES.length} cas)`, async () => {
        const ecarts: string[] = []
        for (const [nom, gabarit, vraie = IMG] of EXEMPLES) {
          const p    = projet(gabarit, prod, partiel)
          const cles = await (p.bundler as unknown as Prepare).preResolveAssets(p.page, p.src).then(r => Object.keys(r.images), (e: Error) => ['erreur : '+ e.message.split('\n')[0]])
          await p.bundler.close()
          if (JSON.stringify(cles) !== JSON.stringify(vraie === '' ? [] : [vraie])) ecarts.push(`${nom} : ${JSON.stringify(cles)}`)
        }
        assert.deepEqual(ecarts, [])
      })
    }
  }
})
