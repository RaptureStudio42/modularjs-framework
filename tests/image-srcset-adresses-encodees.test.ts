// une image dont le nom porte une espace (`photo de vacances.png`), avec ses variantes de largeur : chaque adresse du
// `srcset` est encodée (`photo%20de%20vacances-320-….webp 320w`). Une espace brute coupe l'adresse en deux : le
// navigateur rejette alors tout le `srcset` et charge l'original, quelle que soit la largeur — pour <@@img>, pour
// µimage(…) et pour une image en réglage d'effet. `src` nomme toujours l'image d'origine, publiée. `sharp` est un
// faux : le scénario tourne dans un autre processus, dont le dossier courant porte ce faux `node_modules/sharp`, que
// le bundler essaie en premier.

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
  'import { readFileSync, readdirSync, writeFileSync } from \'node:fs\'',
  'import { join } from \'node:path\'',
  'const [root, bundlerUrl] = process.argv.slice(2)',
  'process.chdir(join(root, \'cwd\'))',
  'const { Bundler, terminateSharedWorkerPool } = await import(bundlerUrl)',
  'const out     = join(root, \'out\')',
  'const bundler = new Bundler({ sourceDir: join(root, \'src\'), outputDir: out, manifestPath: join(root, \'bundle.js\'), image: { widths: [320, 640], formats: [\'webp\'] } })',
  'const stats   = await bundler.compile()',
  'const files   = readdirSync(out)',
  'const code    = files.filter(f => f.endsWith(\'.js\')).map(f => readFileSync(join(out, f), \'utf8\')).join(\'\\n\')',
  'await bundler.close()',
  'await terminateSharedWorkerPool()',
  'writeFileSync(join(root, \'resultat.json\'), JSON.stringify({ errors: stats.errors.map(e => e.message), files, code }))',
  'process.exit(0)',
].join('\n') + '\n'

const u32   = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const PHOTO = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(1200), u32(800), Buffer.from([8, 2, 0, 0, 0]), u32(0)])

const PAGE = [
  '<script>',
  '$photo = µimage(\'photo de vacances.png\')',
  '</script>',
  '',
  '<@@img src="photo de vacances.png" alt="Une photo"></@@img>',
  '<div class="a" *behind(\'photo de vacances.png\')></div>',
].join('\n') + '\n'

describe('images — les adresses du srcset sont encodées (nom de fichier avec une espace)', function () {
  this.timeout(240000)

  let res: { errors: string[], files: string[], code: string }
  let srcsets: string[]

  before(() => {
    const root = mjsTmp('image-srcset-adresses-encodees')
    mkdirSync(join(root, 'cwd/node_modules/sharp'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'cwd/node_modules/sharp/index.js'), FAKE_SHARP)
    writeFileSync(join(root, 'src', 'photo de vacances.png'), PHOTO)
    writeFileSync(join(root, 'src', 'page.mjs'), PAGE)
    writeFileSync(join(root, 'scenario.mts'), SCENARIO)
    const run = spawnSync('npx', ['tsx', join(root, 'scenario.mts'), root, pathToFileURL(join(repoRoot, 'src/bundler/index.ts')).href], { cwd: repoRoot, encoding: 'utf-8', timeout: 200000 })
    assert.ok(existsSync(join(root, 'resultat.json')), `le scénario n'a rien rendu : ${run.stderr}`)
    res     = JSON.parse(readFileSync(join(root, 'resultat.json'), 'utf-8'))
    srcsets = [...res.code.matchAll(/srcset='([^']+)'|"srcset":"([^"]+)"/g)].map(m => m[1] ?? m[2])
  })

  it('la construction passe, les variantes sont publiées', () => {
    assert.deepEqual(res.errors, [])
    assert.equal(res.files.filter(f => /^photo de vacances-(320|640)-[0-9a-f]{8}\.webp$/.test(f)).length, 2, res.files.join(' | '))
  })

  it('<@@img>, µimage(…) et le réglage d\'effet portent chacun un srcset', () => {
    assert.ok(srcsets.length >= 3, `srcset trouvés : ${JSON.stringify(srcsets)}`)
  })

  it('chaque entrée du srcset est « adresse largeur », l\'adresse sans espace brute', () => {
    for (const srcset of srcsets) {
      for (const entree of srcset.split(/,\s+/)) assert.match(entree, /^\S+ \d+w$/, `entrée invalide : « ${entree} » dans « ${srcset} »`)
    }
  })

  it('chaque adresse du srcset, décodée, nomme une variante publiée', () => {
    for (const srcset of srcsets) {
      for (const entree of srcset.split(/,\s+/)) {
        const nom = decodeURIComponent(entree.split(' ')[0].split('/').pop() ?? '')
        assert.ok(res.files.includes(nom), `« ${nom} » absent des fichiers publiés : ${res.files.join(' | ')}`)
      }
    }
  })

  it('src nomme l\'image d\'origine, publiée', () => {
    const sources = [...res.code.matchAll(/src='([^']*photo[^']*)'|"src":"([^"]*photo[^"]*)"/g)].map(m => m[1] ?? m[2])
    assert.ok(sources.length >= 3, `src trouvés : ${JSON.stringify(sources)}`)
    for (const src of sources) {
      const nom = decodeURIComponent(src.split('/').pop() ?? '')
      assert.match(nom, /^photo de vacances-[0-9a-f]{8}\.png$/)
      assert.ok(res.files.includes(nom), `« ${nom} » absent des fichiers publiés`)
    }
  })
})
