// La même image citée par plusieurs composants était réencodée par sharp pour chacun (largeurs × formats), à chaque
// construction froide, et de nouveau à chaque recompilation d'un de ces composants en `mjs dev`. Les variantes sont
// maintenant gardées par fichier source et réglages, sous l'empreinte du contenu : une image n'est encodée qu'une fois
// tant qu'elle ne change pas. `sharp` est un sharp factice qui compte ses encodages (dossier courant d'un autre processus).

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const FAUX_SHARP = [
  'globalThis.encodages = 0',
  'module.exports = function sharp(bytes) {',
  '  let width = 0',
  '  const chain = {',
  '    resize(options) { width = options.width; return chain },',
  '    webp() { return chain },',
  '    toBuffer() { globalThis.encodages++; return Promise.resolve({ data: Buffer.concat([Buffer.from(\'variante \' + width + \' \'), bytes]), info: { width } }) },',
  '  }',
  '  return chain',
  '}',
].join('\n') + '\n'

const SCENARIO = [
  'import { readFileSync, writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl, heroBis] = process.argv.slice(2)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'const src     = join(root, \'src\')',
  'const out     = join(root, \'out\')',
  'const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, \'bundle.js\'), image: { widths: [320, 640], formats: [\'webp\'] } })',
  'const errors  = []',
  'const compte  = []',
  'errors.push(...(await bundler.compile()).errors.map(e => e.message))',
  'compte.push(globalThis.encodages)',
  'writeFileSync(join(src, \'a.mjs\'), readFileSync(join(src, \'a.mjs\'), \'utf8\').replace(\'<p>a</p>\', \'<p>a modifié</p>\'))',
  'errors.push(...(await bundler.compile()).errors.map(e => e.message))',
  'compte.push(globalThis.encodages)',
  'writeFileSync(join(src, \'hero.png\'), Buffer.from(heroBis, \'base64\'))',
  'errors.push(...(await bundler.compile()).errors.map(e => e.message))',
  'compte.push(globalThis.encodages)',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'console.log(\'RESULT \' + JSON.stringify({ errors, compte }))',
  'process.exit(0)',
].join('\n') + '\n'

const u32  = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const png  = (w: number, h: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0]), u32(0)])

describe('bundler — une image citée par plusieurs composants n\'est encodée qu\'une fois', function () {
  this.timeout(120000)

  it('trois composants, deux largeurs : deux encodages ; recompilation d\'un composant : aucun ; image modifiée : deux de plus', () => {
    const root = mjsTmp('image-variantes-une-fois')
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAUX_SHARP)
    writeFileSync(join(root, 'src/hero.png'), png(1200, 800))
    for (const nom of ['a', 'b', 'c']) writeFileSync(join(root, `src/${nom}.mjs`), `<script>\n  photo = µimage('hero.png')\n</script>\n<p>${nom}</p>\n`)
    writeFileSync(join(root, 'scenario.mts'), SCENARIO)
    const run  = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href, png(1200, 900).toString('base64')], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000 })
    const line = (run.stdout ?? '').split('\n').find(l => l.startsWith('RESULT '))
    assert.ok(line, `le scénario n'a rien rendu : ${run.stderr}`)
    const { errors, compte } = JSON.parse(line.slice('RESULT '.length))
    assert.deepEqual(errors, [])
    assert.deepEqual(compte, [2, 2, 4], `encodages cumulés après chaque construction : ${JSON.stringify(compte)}`)
  })
})
