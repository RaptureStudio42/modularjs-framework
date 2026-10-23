// les variantes de largeur d'une image (`photo-320-….webp`, fabriquées par `sharp`, dépendance optionnelle) ne sont
// publiées que pour une image dont l'effet lit le `srcset` (*behind, *pixels…) : une image que l'effet prend
// telle quelle (*scrub(images:), *offline(logo:)) n'en fabrique aucune. `sharp` est un faux : le test ne dépend pas de
// son installation. Le scénario tourne dans un autre processus, dont le dossier courant porte ce faux
// `node_modules/sharp`, que le bundler essaie en premier.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  'import { existsSync, readFileSync, readdirSync, writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl, options] = process.argv.slice(2)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'const out     = join(root, \'out\')',
  'const bundler = new Bundler({ sourceDir: join(root, \'src\'), outputDir: out, manifestPath: join(root, \'bundle.js\'), image: { widths: [320, 640], formats: [\'webp\'] }, ...JSON.parse(options) })',
  'const stats   = await bundler.compile()',
  'const files   = readdirSync(out)',
  'const fichiers = [...files.filter(f => f.endsWith(\'.js\')).map(f => join(out, f)), join(root, \'bundle.js\')]',
  'const code    = fichiers.filter(f => existsSync(f)).map(f => readFileSync(f, \'utf8\')).join(\'\\n\')',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'writeFileSync(join(root, \'resultat.json\'), JSON.stringify({ errors: stats.errors.map(e => e.message), files, code }))',
  'process.exit(0)',
].join('\n') + '\n'

const u32  = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const HERO = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(1200), u32(800), Buffer.from([8, 2, 0, 0, 0]), u32(0)])

const COMPOSANTS: Record<string, string> = {
  'fx-behind.mjs': "<div class=\"a\" *behind('photo.png', depth: 71)></div>",
  'fx-pixels.mjs': "<div class=\"a\" *pixels(swap, image: 'seconde.png', spread: 73)>x</div>",
  'fx-scrub.mjs':  "<canvas class=\"a\" *scrub(images: ['suite.png', 'photo.png'], first: 74)></canvas>",
  'fx-logo.mjs':   "<@document *offline(logo: 'logo.png', delay: 75ms)></@document>\n<p>x</p>"
}

// le scénario, avec les options de Bundler données : les erreurs, les fichiers publiés, les scripts
function construire(etiquette: string, options: Record<string, unknown>): { errors: string[], files: string[], code: string } {
  const root = mjsTmp('chemins-images-variantes-' + etiquette)
  mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAKE_SHARP)
  for (const nom of ['photo', 'seconde', 'suite', 'logo']) writeFileSync(join(root, 'src', nom + '.png'), HERO)
  for (const [fichier, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(root, 'src', fichier), texte)
  writeFileSync(join(root, 'scenario.mts'), SCENARIO)
  const run  = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href, JSON.stringify(options)], { cwd: repoRoot, encoding: 'utf-8', timeout: 100000 })
  assert.ok(existsSync(join(root, 'resultat.json')), `le scénario n'a rien rendu : ${run.stderr}`)
  return JSON.parse(readFileSync(join(root, 'resultat.json'), 'utf-8'))
}

const variantes = (files: string[], nom: string) => files.filter(f => new RegExp(`^${nom}-(320|640)-[0-9a-f]{8}\\.webp$`).test(f))

describe('effets — les variantes de largeur ne sont fabriquées que pour une image dont l\'effet lit le srcset', function () {
  this.timeout(240000)

  const cas: Array<[string, Record<string, unknown>]> = [['développement', {}], ['production, un fichier', { env: 'prod', js: 'bundle' }], ['production, fichiers séparés', { env: 'prod', js: 'split' }]]
  for (const [nom, options] of cas) {
    describe(nom, () => {
      let res: { errors: string[], files: string[], code: string }

      before(() => { res = construire(nom.replace(/\W+/g, '-'), options) })

      it('le projet se construit sans erreur', () => {
        assert.deepEqual(res.errors, [])
      })

      it('*behind et *pixels lisent le srcset : leurs images ont leurs variantes, et le srcset est dans le script', () => {
        for (const image of ['photo', 'seconde']) assert.equal(variantes(res.files, image).length, 2, `${image} : ${res.files.join(', ')}`)
        assert.match(res.code, /photo-320-[0-9a-f]{8}\.webp 320w/, 'le srcset de *behind est publié')
        assert.match(res.code, /seconde-320-[0-9a-f]{8}\.webp 320w/, 'le srcset de *pixels est publié')
      })

      it('*scrub(images:) et *offline(logo:) prennent l\'adresse seule : aucune variante pour leurs images', () => {
        assert.deepEqual(variantes(res.files, 'suite'), [])
        assert.deepEqual(variantes(res.files, 'logo'), [])
        assert.ok(res.files.some(f => /^suite-[0-9a-f]{8}\.png$/.test(f)), 'l\'image elle-même est publiée : ' + res.files.join(', '))
        assert.ok(res.files.some(f => /^logo-[0-9a-f]{8}\.png$/.test(f)), 'le logo lui-même est publié : ' + res.files.join(', '))
      })

      it('une image que *scrub prend telle quelle, mais qu\'un autre effet lit avec son srcset, garde ses variantes', () => {
        assert.equal(variantes(res.files, 'photo').length, 2)
      })
    })
  }
})
