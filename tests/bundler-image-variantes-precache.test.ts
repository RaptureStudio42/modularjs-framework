// Les variantes d'une image (`hero-320-….webp`) sont des fichiers du site comme l'image elle-même : après une
// reconstruction partielle, `mjs-precache.json` les garde avec l'image du composant resté en cache. `sharp`, dépendance
// optionnelle, est un sharp factice : le test ne dépend pas de son installation. Le scénario tourne dans un autre
// processus, dont le dossier courant porte ce faux `node_modules/sharp`, que le bundler essaie en premier.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const FAKE_SHARP = [
  'module.exports = function sharp() {',
  '  let width = 0',
  '  const chain = {',
  '    resize(options) { width = options.width; return chain },',
  '    webp() { return chain },',
  '    toBuffer() { return Promise.resolve({ data: Buffer.from(\'variante \' + width), info: { width } }) },',
  '  }',
  '  return chain',
  '}',
].join('\n') + '\n'

const SCENARIO = [
  'import { readFileSync, writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl] = process.argv.slice(2)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'const src      = join(root, \'src\')',
  'const out      = join(root, \'out\')',
  'const precache = () => JSON.parse(readFileSync(join(out, \'mjs-precache.json\'), \'utf8\')).assets',
  'const bundler  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, \'bundle.js\'), image: { widths: [320, 640], formats: [\'webp\'] } })',
  'const errors   = []',
  'errors.push(...(await bundler.compile()).errors.map(e => e.message))',
  'const before = precache()',
  'writeFileSync(join(src, \'b.mjs\'), \'<p>b2</p>\\n\')',
  'errors.push(...(await bundler.compile()).errors.map(e => e.message))',
  'const after = precache()',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'console.log(\'RESULT \' + JSON.stringify({ errors, before, after }))',
  'process.exit(0)',
].join('\n') + '\n'

const u32  = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const HERO = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(1200), u32(800), Buffer.from([8, 2, 0, 0, 0]), u32(0)])

describe('bundler — les variantes d\'image au précache d\'une reconstruction partielle', function () {
  this.timeout(120000)

  it('hero-320-….webp et hero-640-….webp restent au précache quand le composant qui cite l\'image reste en cache', () => {
    const root = mjsTmp('image-variantes-precache')
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAKE_SHARP)
    writeFileSync(join(root, 'src/hero.png'), HERO)
    writeFileSync(join(root, 'src/a.mjs'), '<script>\n  photo = µimage(\'hero.png\')\n</script>\n<p>a</p>\n')
    writeFileSync(join(root, 'src/b.mjs'), '<p>b</p>\n')
    writeFileSync(join(root, 'scenario.mts'), SCENARIO)
    const run  = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000 })
    const line = (run.stdout ?? '').split('\n').find(l => l.startsWith('RESULT '))
    assert.ok(line, `le scénario n'a rien rendu : ${run.stderr}`)
    const { errors, before, after } = JSON.parse(line.slice('RESULT '.length))
    assert.deepEqual(errors, [])
    const variants = (list: string[]) => list.filter(a => /\/hero-(320|640)-[a-f0-9]{8}\.webp$/.test(a))
    assert.equal(variants(before).length, 2, `les deux variantes au premier build : ${before.join(', ')}`)
    assert.deepEqual(variants(after), variants(before), 'les variantes restent au précache')
  })
})
