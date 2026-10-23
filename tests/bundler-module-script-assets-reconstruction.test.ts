// Un module de script (.civet, .coffee) qui cite un fichier par `µasset(…)` le garde quand la MÊME instance
// recompile, comme `mjs dev` : le module resté en cache ne republie rien, mais ses images, ses sons et les .js
// qu'il cite (voisins compris) restent au précache, et le ménage des anciennes empreintes ne les retire pas.
// Un module dont le fichier cité change est recompilé, comme un composant : jamais il ne garde l'ancien nom.
// Un .js cité par un module qui importe un voisin absent est signalé, comme pour un composant.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, extname, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG      = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const withByte = (byte: number) => Buffer.concat([PNG, Buffer.from([byte])])
const digest   = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex').slice(0, 8)

function project(prefix: string, files: Record<string, string | Buffer>) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(srcDir, path)), { recursive: true })
    writeFileSync(join(srcDir, path), content)
  }
  return { srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

const precache  = (outDir: string): string[] => JSON.parse(readFileSync(join(outDir, 'mjs-precache.json'), 'utf8')).assets
const published = (outDir: string, base: string, ext: string) => readdirSync(outDir).filter(f => new RegExp(`^${base}-(?:[0-9a-z]{5}|[a-f0-9]{8})\\.${ext}$`).test(f))
const messages  = (list: Array<{ message: string }>) => list.map(e => e.message)

describe('bundler — les fichiers cités par un module de script, sur la même instance qui recompile', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const files = (b: string): Record<string, string | Buffer> => ({
    'util.civet': 'export logo = µasset(\'img/logo.png\')\n',
    'vieux.coffee': 'export son = µasset(\'snd/ding.mp3\')\n',
    'outils.civet': 'export lib = µasset(\'lib/main.js\')\n',
    'lib/main.js': 'import { r } from \'./rng.js\'\nexport const d = r\n',
    'lib/rng.js': 'export const r = 1\n',
    'a.mjs': '@import logo \'util.civet\'\n<script>\n  go = -> logo\n</script>\n<p>a</p>\n',
    'b.mjs': `<p>${b}</p>\n`,
    'img/logo.png': PNG,
    'snd/ding.mp3': Buffer.from('ID3 son de pacotille'),
  })

  for (const mode of ['split', 'bundle'] as const) it(`le précache d'une reconstruction partielle est celui d'un build à froid, modules de script compris (js: '${mode}')`, async () => {
    const partial = project('module-precache-partiel-' + mode, files('b1'))
    const bundler = new Bundler({ sourceDir: partial.srcDir, outputDir: partial.outDir, manifestPath: partial.manifest, js: mode })
    const modules = ['util.civet', 'vieux.coffee', 'outils.civet'].map(f => join(partial.srcDir, f))
    let rebuilt: string[] = []
    try {
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      const entries = modules.map(f => bundler.cache.get(f))
      writeFileSync(join(partial.srcDir, 'b.mjs'), '<p>b2</p>\n')
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      modules.forEach((f, i) => assert.ok(entries[i] !== undefined && bundler.cache.get(f) === entries[i], `${basename(f)} est resté en cache (sinon ce test ne prouve rien)`))
      rebuilt = precache(partial.outDir)
    }
    finally {
      await bundler.close()
    }
    const cold  = project('module-precache-froid-' + mode, files('b2'))
    const fresh = new Bundler({ sourceDir: cold.srcDir, outputDir: cold.outDir, manifestPath: cold.manifest, js: mode })
    try {
      assert.deepEqual(messages((await fresh.compile()).errors), [])
    }
    finally {
      await fresh.close()
    }
    const wanted = precache(cold.outDir)
    for (const re of [/\/logo-[a-f0-9]{8}\.png$/, /\/ding-[a-f0-9]{8}\.mp3$/, /\/main-[a-f0-9]{8}\.js$/, /\/rng-[a-f0-9]{8}\.js$/]) {
      assert.ok(wanted.some(a => re.test(a)), `le build à froid liste ${re} (sinon ce test ne prouve rien) : ${wanted.join(', ')}`)
    }
    assert.deepEqual(rebuilt, wanted, 'la reconstruction partielle liste les mêmes fichiers que le build à froid')
  })

  it('un module dont le fichier cité change est recompilé : il vise le nouveau nom, l\'ancien est retiré, le précache nomme le nouveau', async () => {
    const p = project('module-asset-modifie', { 'util.civet': 'export logo = µasset(\'img/logo.png\')\n', 'a.mjs': '@import logo \'util.civet\'\n<script>\n  go = -> logo\n</script>\n<p>a</p>\n', 'img/logo.png': withByte(1) })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      writeFileSync(join(p.srcDir, 'img/logo.png'), withByte(2))
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      const now = `logo-${digest(withByte(2))}.png`
      assert.deepEqual(published(p.outDir, 'logo', 'png'), [now], 'un seul logo publié : le nouveau')
      const code = readFileSync(join(p.outDir, published(p.outDir, 'util', 'js')[0]), 'utf8')
      assert.ok(code.includes(now), `util.civet vise ${now} : ${code.slice(0, 200)}`)
      assert.ok(precache(p.outDir).some(a => a.endsWith('/' + now)), 'le précache nomme le nouveau logo')
    }
    finally {
      await bundler.close()
    }
  })

  it('le fichier que cite un module resté en cache survit au ménage d\'un homonyme republié', async () => {
    const p = project('module-asset-homonyme', { 'util.civet': 'export logo = µasset(\'x/logo.png\')\n', 'hote.mjs': '<img src="µasset(\'y/logo.png\')">\n<p>h</p>\n', 'x/logo.png': withByte(1), 'y/logo.png': withByte(2) })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      assert.equal(published(p.outDir, 'logo', 'png').length, 2, 'les deux logos à froid')
      writeFileSync(join(p.srcDir, 'y/logo.png'), withByte(3))
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      const cited = `logo-${digest(withByte(1))}.png`
      const fresh = `logo-${digest(withByte(3))}.png`
      assert.deepEqual(published(p.outDir, 'logo', 'png').sort(), [cited, fresh].sort(), 'le logo du module et le nouveau logo de l\'hôte, rien d\'autre')
      assert.ok(existsSync(join(p.outDir, cited)), 'le fichier que le module cite est encore là')
      assert.ok(readFileSync(join(p.outDir, published(p.outDir, 'util', 'js')[0]), 'utf8').includes(cited), 'et le module le vise toujours')
      const listed = precache(p.outDir)
      assert.ok(listed.some(a => a.endsWith('/' + cited)) && listed.some(a => a.endsWith('/' + fresh)), `les deux au précache : ${listed.join(', ')}`)
    }
    finally {
      await bundler.close()
    }
  })

  for (const host of ['util.civet', 'vieux.coffee']) it(`un voisin .js absent d'un .js cité par ${host} est dit une fois, avec le module et le chemin : au premier tour, resté en cache, recompilé après un changement du cœur`, async () => {
    const p = project('module-voisin-absent-' + extname(host).slice(1), {
      [host]: 'export lib = µasset(\'lib/main.js\')\n',
      'autre.mjs': '<p>a</p>\n',
      'lib/main.js': 'import { r } from \'./rgn.js\'\nexport const d = r\n',
      'lib/rng.js': 'export const r = 1\n',
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    const core    = () => readdirSync(p.outDir).filter(f => /^mjs_core-[0-9a-z]{5}\.js$/.test(f)).join()
    const said    = (warnings: string[]) => warnings.filter(w => /rgn\.js/.test(w))
    try {
      const first = await bundler.compile()
      assert.deepEqual(messages(first.errors), [])
      const dits = said(first.warnings)
      assert.equal(dits.length, 1, `un avertissement attendu, reçu : ${JSON.stringify(first.warnings)}`)
      assert.ok(dits[0].includes(host), `nomme le module : ${dits[0]}`)
      assert.match(dits[0], /lib\/main\.js/, 'nomme le fichier qui importe')
      assert.match(dits[0], /lib\/rgn\.js/, 'nomme le chemin qui manque')
      writeFileSync(join(p.srcDir, 'autre.mjs'), '<p>b</p>\n')
      const entry  = bundler.cache.get(join(p.srcDir, host))
      const cached = said((await bundler.compile()).warnings)
      assert.ok(entry !== undefined && bundler.cache.get(join(p.srcDir, host)) === entry, `${host} est resté en cache (sinon ce tour ne prouve rien)`)
      assert.equal(cached.length, 1, 'le module resté en cache garde son avertissement, une seule fois')
      assert.ok(cached[0].includes(host))
      const coreBefore = core()
      writeFileSync(join(p.srcDir, 'autre.mjs'), '<p *scramble>x</p>\n')
      const rebuilt = said((await bundler.compile()).warnings)
      assert.notEqual(core(), coreBefore, 'le cœur a changé (sinon ce tour ne prouve rien)')
      assert.equal(rebuilt.length, 1, `le module recompilé parce que le cœur a changé ne le dit pas deux fois : ${JSON.stringify(rebuilt)}`)
    }
    finally {
      await bundler.close()
    }
  })
})
