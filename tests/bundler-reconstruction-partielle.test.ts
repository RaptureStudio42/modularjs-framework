// Une reconstruction partielle (la même instance recompile, comme `mjs dev`) republie le même site que
// celle à froid : `mjs-precache.json` garde les images et les sons des composants restés en cache, et
// la carte de source d'un composant suit son nouveau contenu même quand son code compilé, donc son nom
// à empreinte, n'a pas changé (des lignes déplacées dans le .mjs).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function projet(prefixe: string, fichiers: Record<string, string | Buffer>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const precache = (outDir: string): string[] => JSON.parse(readFileSync(join(outDir, 'mjs-precache.json'), 'utf8')).assets
const medias   = (assets: string[]) => assets.filter(a => /\.(png|mp3)$/.test(a))

describe('bundler — reconstruction partielle', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['split', 'bundle'] as const) it(`mjs-precache.json garde l'image et le son d'un composant resté en cache (js: '${mode}')`, async () => {
    const p = projet('partielle-precache-' + mode, {
      'a.mjs': '<script>\n  go = -> [µasset(\'img/logo.png\'), µasset(\'snd/ding.mp3\')]\n</script>\n<p>a</p>\n',
      'b.mjs': '<script>\n  go = -> µasset(\'img/fond.png\')\n</script>\n<p>b</p>\n',
      'img/logo.png': PNG, 'img/fond.png': Buffer.concat([PNG, Buffer.from([1])]), 'snd/ding.mp3': Buffer.from('ID3 son de pacotille'),
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, js: mode })
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const avant = medias(precache(p.outDir))
      assert.equal(avant.length, 3, `les trois médias au premier build : ${avant.join(', ')}`)
      writeFileSync(join(p.srcDir, 'b.mjs'), '<script>\n  go = -> µasset(\'img/fond.png\')\n</script>\n<p>b modifié</p>\n')
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      assert.deepEqual(medias(precache(p.outDir)), avant, 'a.mjs n\'a pas bougé : ses médias restent au précache')
    }
    finally {
      await bundler.close()
    }
  })

  it('la carte de source suit le nouveau contenu quand seules des lignes ont bougé', async () => {
    const v1 = '<script>\n  $n = 1\n</script>\n<p>{$n}</p>\n'
    const v2 = '\n\n<script>\n  $n = 1\n</script>\n\n<p>{$n}</p>\n'
    const carte = (outDir: string) => JSON.parse(readFileSync(join(outDir, readdirSync(outDir).find(f => /^carte-[0-9a-z]{5}\.js\.map$/.test(f))!), 'utf8'))
    const p = projet('partielle-carte', { 'carte.mjs': v1 })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      const nomAvant = readdirSync(p.outDir).find(f => /^carte-[0-9a-z]{5}\.js$/.test(f))
      writeFileSync(join(p.srcDir, 'carte.mjs'), v2)
      assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [])
      assert.equal(readdirSync(p.outDir).find(f => /^carte-[0-9a-z]{5}\.js$/.test(f)), nomAvant, 'le code compilé est le même : même nom (sinon ce test ne prouve rien)')
      const frais = projet('partielle-carte-frais', { 'carte.mjs': v2 })
      const neuf  = new Bundler({ sourceDir: frais.srcDir, outputDir: frais.outDir, manifestPath: frais.manifest })
      try {
        assert.deepEqual((await neuf.compile()).errors.map((e: any) => e.message), [])
      }
      finally {
        await neuf.close()
      }
      const incrementale = carte(p.outDir)
      const aFroid       = carte(frais.outDir)
      assert.equal(incrementale.mappings, aFroid.mappings, 'les positions de la carte sont celles du nouveau fichier')
      assert.equal(incrementale.sourcesContent?.[0], v2, 'et la source embarquée est le nouveau contenu')
    }
    finally {
      await bundler.close()
    }
  })
})
