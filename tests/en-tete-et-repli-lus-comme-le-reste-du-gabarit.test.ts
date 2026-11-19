// le <@head> et le repli d'un <@failed> se lisent comme le reste du gabarit : une fermante de bloc (`</vars>`, `</types>`, `</routes>`…)
// qui n'y referme aucun bloc ouvert en tête de ligne y est orpheline, avec le refus du reste du gabarit, en développement et en
// production, et une <@@img> seulement citée dans le texte de ce faux bloc n'est jamais refusée comme une image de l'en-tête. Une ligne
// y finit sur un saut de ligne, jamais sur U+2028 ni U+2029 ; un en-tête versé par un partiel se lit de même. Les <script> et <style>
// de l'en-tête courent jusqu'à leur fermante : un `</types>` ou un `</vars>` cité dans leur texte, un JSON-LD compris, y reste permis,
// comme un bloc ouvert en tête de ligne

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG = '<@@img src="z1.png" alt="z">\n'

async function construire(fichiers: Record<string, string>, prod: boolean): Promise<{ erreurs: string[], copies: string[] }> {
  const root = mjsTmp('tete-comme-le-reste')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const f of ['z1.png', 'e0.png']) writeFileSync(join(src, f), validPng(10, 10))
  for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  let erreurs: string[]
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: prod ? 'prod' : 'dev' })
    const stats = await b.compile()
    await b.close()
    erreurs = stats.errors.map(e => e.message.split('\n')[0])
  }
  finally {
    Object.assign(console, garde)
  }
  return { erreurs, copies: existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.png')) : [] }
}

// nom, fichiers, fermante orpheline attendue
const REFUS: Array<[string, Record<string, string>, string]> = [
  ['en-tête, <vars> en milieu de ligne', { 'page.mjs': '<@head>\n<p>a</p> <vars>\n  d: \'<@@img src="e0.png" alt="x">\'\n</vars>\n</@head>\n' + IMG }, '</vars>'],
  ['en-tête, <types> après U+2029', { 'page.mjs': '<@head>\n<p>a</p> <types>\n  d: \'<@@img src="e0.png" alt="x">\'\n</types>\n</@head>\n' + IMG }, '</types>'],
  ['en-tête, <routes> après U+2028', { 'page.mjs': '<@head>\n<p>a</p> <routes target="main">\n  d: \'<@@img src="e0.png" alt="x">\'\n</routes>\n</@head>\n' + IMG }, '</routes>'],
  ['repli d\'un <@failed>', { 'page.mjs': '<@failed err>\n  <p>r</p> <vars>\n  </vars>\n</@failed>\n<p>y</p>\n' + IMG }, '</vars>'],
  ['en-tête versé par un partiel', { 'page.mjs': '<div>a</div>\n<@include tete>\n' + IMG, '_tete.mjs': '<@head>\n<p>a</p><vars>\n  d: 1\n</vars>\n</@head>\n' }, '</vars>']
]

const ACCEPTES: Array<[string, string]> = [
  ['JSON-LD, script et style qui citent </types> et </vars>', '<@head>\n  <script type="application/ld+json">{"a": "</types>"}</script>\n  <title>t</title><script>window.x = \'</vars>\'</script>\n  <style>\n    a { content: "</types>" }\n  </style>\n</@head>\n<p>y</p>\n' + IMG],
  ['style en milieu de ligne qui cite </vars>', '<@head><meta charset="utf-8"><style>a { content: "</vars>" }</style></@head>\n<p>y</p>\n' + IMG],
  ['bloc ouvert en tête de ligne', '<@head>\n<vars>\n  d: 1\n</vars>\n</@head>\n<p>y</p>\n' + IMG]
]

describe('<@head> et <@failed> lus comme le reste du gabarit : fermante de bloc orpheline', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'

    for (const [nom, fichiers, fermante] of REFUS) {
      it(`${mode} : ${nom} — « ${fermante} orphelin », jamais « pas sa place »`, async () => {
        const r = await construire(fichiers, prod)
        assert.equal(r.erreurs.length, 1, r.erreurs.join('\n'))
        assert.match(r.erreurs[0], new RegExp(`un ${fermante} orphelin traîne`))
        assert.doesNotMatch(r.erreurs[0], /n'a pas sa place dans <@head>/)
      })
    }

    for (const [nom, page] of ACCEPTES) {
      it(`${mode} : ${nom} — accepté, image préparée`, async () => {
        const r = await construire({ 'page.mjs': page }, prod)
        assert.deepEqual(r.erreurs, [])
        assert.equal(r.copies.filter(f => /^z1-/.test(f)).length, 1, r.copies.join(', '))
      })
    }
  }
})
