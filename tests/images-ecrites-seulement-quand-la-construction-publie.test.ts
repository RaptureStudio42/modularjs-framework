// une construction refusée (celle de `mjs build`) ne laisse aucune image dans la sortie, même quand le refus tombe après le relevé des
// images : une image dans <@head>, une erreur de Civet, un autre composant refusé. Les images s'écrivent quand la construction publie ;
// le tour suivant, réussi, les écrit, celles d'une unité reprise du cache comprises. En développement, un composant en échec garde sa
// dernière version bonne et la construction publie : les images des autres composants y sont écrites

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { validPng } from './helpers/valid-png.js'

const IMG    = '<@@img src="z1.png" alt="z">\n'
const FAUTIF = '<script>\n  x = = 1\n</script>\n<p>b</p>\n'

function projet(fichiers: Record<string, string>): { src: string, out: string } {
  const root = mjsTmp('images-a-la-publication')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const f of ['z1.png', 'e0.png']) writeFileSync(join(src, f), validPng(10, 10))
  for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
  return { src, out }
}

async function tour(b: Bundler, out: string): Promise<{ erreurs: number, copies: string[] }> {
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  try {
    const stats = await b.compile()
    return { erreurs: stats.errors.length, copies: existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.png')) : [] }
  }
  finally {
    Object.assign(console, garde)
  }
}

const REFUSES: Array<[string, Record<string, string>]> = [
  ['une image dans <@head>', { 'page.mjs': '<@head>\n  <@@img src="e0.png" alt="x">\n</@head>\n' + IMG }],
  ['une erreur de Civet après le relevé', { 'page.mjs': '<p>y</p>\n' + IMG + '<script>\n  x = = 1\n</script>\n' }],
  ['un autre composant refusé', { 'a.mjs': '<p>y</p>\n' + IMG, 'b.mjs': FAUTIF }]
]

describe('images écrites seulement quand la construction publie', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'prod' : 'dev'

    for (const [nom, fichiers] of REFUSES) {
      it(`${env}, construction refusée (${nom}) : aucune image dans la sortie`, async () => {
        const { src, out } = projet(fichiers)
        const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, keepFailedComponents: false })
        const r = await tour(b, out)
        await b.close()
        assert.ok(r.erreurs > 0, 'la construction est refusée')
        assert.deepEqual(r.copies, [])
      })
    }

    it(`${env}, refusée puis corrigée : le tour réussi écrit les images, l'unité reprise du cache comprise`, async () => {
      const { src, out } = projet({ 'a.mjs': '<p>y</p>\n' + IMG, 'b.mjs': FAUTIF })
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, keepFailedComponents: false })
      const refuse = await tour(b, out)
      assert.ok(refuse.erreurs > 0)
      assert.deepEqual(refuse.copies, [])
      writeFileSync(join(src, 'b.mjs'), '<p>b</p>\n')
      const reussi = await tour(b, out)
      await b.close()
      assert.equal(reussi.erreurs, 0)
      assert.equal(reussi.copies.filter(f => /^z1-/.test(f)).length, 1, reussi.copies.join(', '))
    })

    it(`${env}, développement (un composant en échec garde sa version bonne) : la construction publie, les images des autres écrites`, async () => {
      const { src, out } = projet({ 'a.mjs': '<p>y</p>\n' + IMG, 'b.mjs': FAUTIF })
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, keepFailedComponents: true })
      const r = await tour(b, out)
      await b.close()
      assert.ok(r.erreurs > 0)
      assert.equal(r.copies.filter(f => /^z1-/.test(f)).length, 1, r.copies.join(', '))
    })
  }
})
