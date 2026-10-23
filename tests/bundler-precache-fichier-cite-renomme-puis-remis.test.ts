// Un fichier cité (image, son, .js) renommé puis remis à sa place, sur la même instance qui recompile (`mjs dev`) : l'unité
// qui le cite est restée en cache et ne republie rien, mais le fichier est sur le disque. Le précache est alors celui d'un build
// à froid, composant comme module de script.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function project(prefix: string, files: Record<string, string | Buffer>) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(srcDir, path)), { recursive: true })
    writeFileSync(join(srcDir, path), content)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const precache = (outDir: string): string[] => JSON.parse(readFileSync(join(outDir, 'mjs-precache.json'), 'utf8')).assets
const logos   = (outDir: string) => readdirSync(outDir).filter(f => /^logo-[a-f0-9]{8}\.png$/.test(f))

const cases: Array<{ name: string, files: (other: string) => Record<string, string | Buffer> }> = [
  { name: 'un composant cite une image', files: other => ({ 'hote.mjs': '<img src="µasset(\'img/logo.png\')" alt="x">\n<p>h</p>\n', 'autre.mjs': `<p>${other}</p>\n`, 'img/logo.png': PNG }) },
  { name: 'un module de script cite une image', files: other => ({ 'util.civet': 'export logo = µasset(\'img/logo.png\')\n', 'autre.mjs': `<p>${other}</p>\n`, 'img/logo.png': PNG }) },
  { name: 'un composant importe un module de script qui cite une image', files: other => ({ 'util.civet': 'export logo = µasset(\'img/logo.png\')\n', 'hote.mjs': '@import logo \'util.civet\'\n<script>\n  go = -> logo\n</script>\n<p>h</p>\n', 'autre.mjs': `<p>${other}</p>\n`, 'img/logo.png': PNG }) },
]

describe('bundler — le précache après qu\'un fichier cité a été renommé puis remis', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const c of cases) it(`${c.name} : le précache est celui d'un build à froid`, async () => {
    const warm    = project('precache-remis', c.files('b1'))
    const bundler = new Bundler({ sourceDir: warm.srcDir, outputDir: warm.outDir, manifestPath: warm.manifest })
    let rebuilt: string[] = []
    try {
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      renameSync(join(warm.srcDir, 'img/logo.png'), join(warm.srcDir, 'img/logo-x.png'))
      assert.ok((await bundler.compile()).errors.length > 0, 'le fichier cité a disparu : le build le dit (sinon ce test ne prouve rien)')
      renameSync(join(warm.srcDir, 'img/logo-x.png'), join(warm.srcDir, 'img/logo.png'))
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      assert.equal(logos(warm.outDir).length, 1, 'le fichier publié est sur le disque')
      assert.ok(precache(warm.outDir).some(a => /\/logo-[a-f0-9]{8}\.png$/.test(a)), `remis à sa place, le fichier cité est au précache : ${precache(warm.outDir).join(', ')}`)
      writeFileSync(join(warm.srcDir, 'autre.mjs'), '<p>b2</p>\n')
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      rebuilt = precache(warm.outDir)
    }
    finally {
      await bundler.close()
    }
    const cold  = project('precache-froid', c.files('b2'))
    const fresh = new Bundler({ sourceDir: cold.srcDir, outputDir: cold.outDir, manifestPath: cold.manifest })
    try {
      assert.deepEqual((await fresh.compile()).errors.map(e => e.message), [])
    }
    finally {
      await fresh.close()
    }
    assert.deepEqual(rebuilt, precache(cold.outDir), 'le précache de la reconstruction partielle est celui du build à froid')
  })

  it('un fichier supprimé pour de bon, avec le composant qui le citait, ne reste pas dans la table des fichiers publiés', async () => {
    const p       = project('precache-supprime', { 'hote.mjs': '<img src="µasset(\'img/logo.png\')" alt="x">\n<p>h</p>\n', 'autre.mjs': '<p>b1</p>\n', 'img/logo.png': PNG })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    const table   = () => (bundler as any).publishedAssets as Map<string, unknown>
    try {
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      assert.ok(table().has(join(p.srcDir, 'img/logo.png')), 'la table connaît la source publiée')
      writeFileSync(join(p.srcDir, 'hote.mjs'), '<p>h ne cite plus rien</p>\n')
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      renameSync(join(p.srcDir, 'img/logo.png'), join(p.srcDir, 'img/logo-x.png'))
      assert.deepEqual((await bundler.compile()).errors.map(e => e.message), [])
      assert.equal(table().has(join(p.srcDir, 'img/logo.png')), false, 'plus aucune unité ne cite la source disparue : elle sort de la table')
    }
    finally {
      await bundler.close()
    }
  })
})
