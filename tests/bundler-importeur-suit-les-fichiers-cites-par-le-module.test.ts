// Un module de script (.civet, .coffee) change de nom publié quand un fichier qu'il cite par `µasset(…)` change : image, son,
// .js, ou voisin d'un .js cité. Son importeur (composant ou autre module), resté en cache sur la même instance (`mjs dev`), doit
// le suivre : la fermeture des fichiers dont il dépend comprend ce que cite chaque module de la chaîne. Jamais une référence
// vers l'ancien nom, que le ménage des empreintes a retiré du dossier de sortie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG      = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const withByte = (byte: number) => Buffer.concat([PNG, Buffer.from([byte])])

function project(prefix: string, files: Record<string, string | Buffer>) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(srcDir, path)), { recursive: true })
    writeFileSync(join(srcDir, path), content)
  }
  return { root, srcDir, outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
}

// les noms à empreinte que citent les .js du dossier de sortie (et le fichier unique du mode bundle) sans que le dossier les contienne
function dangling(root: string, outDir: string): string[] {
  const names = readdirSync(outDir)
  const texts = names.filter(f => f.endsWith('.js')).map(f => [f, readFileSync(join(outDir, f), 'utf8')])
  if (existsSync(join(root, 'bundle.js'))) texts.push(['bundle.js', readFileSync(join(root, 'bundle.js'), 'utf8')])
  const lost = new Set<string>()
  for (const [file, code] of texts) {
    for (const m of code.matchAll(/[A-Za-z0-9_.-]+-(?:[0-9a-z]{5}|[a-f0-9]{8})\.(?:js|png|mp3)/g)) if (!names.includes(m[0])) lost.add(`${file} -> ${m[0]}`)
  }
  return [...lost]
}

const published = (outDir: string, base: string) => readdirSync(outDir).filter(f => new RegExp(`^${base.replace(/\./g, '\\.')}-[0-9a-z]{5}\\.js$`).test(f))
const messages  = (list: Array<{ message: string }>) => list.map(e => e.message)
const host      = (importLine: string, name: string) => `${importLine}\n<script>\n  go = -> ${name}\n</script>\n<p>a</p>\n`

// `importers` : de l'intérieur vers l'extérieur de la chaîne, ce qui importe le module qui cite le fichier
interface Scenario {
  name: string
  files: Record<string, string | Buffer>
  edit: [string, string | Buffer]
  module: string
  importers: Array<{ file: string, stem: string, imports: string }>
  tracked: string[]
}

const scenarios: Scenario[] = [
  {
    name: 'le module cite une image',
    files: { 'util.civet': 'export logo = µasset(\'img/logo.png\')\n', 'a.mjs': host('@import logo \'util.civet\'', 'logo'), 'img/logo.png': withByte(1) },
    edit: ['img/logo.png', withByte(2)], module: 'util', importers: [{ file: 'a.mjs', stem: 'a', imports: 'util' }], tracked: ['img/logo.png'],
  },
  {
    name: 'le module cite un son (module .coffee)',
    files: { 'vieux.coffee': 'export son = µasset(\'snd/ding.mp3\')\n', 'a.mjs': host('@import son \'vieux.coffee\'', 'son'), 'snd/ding.mp3': Buffer.from('ID3 son un') },
    edit: ['snd/ding.mp3', Buffer.from('ID3 son deux')], module: 'vieux', importers: [{ file: 'a.mjs', stem: 'a', imports: 'vieux' }], tracked: ['snd/ding.mp3'],
  },
  {
    name: 'le module cite un .js',
    files: { 'util.civet': 'export lib = µasset(\'lib/main.js\')\n', 'a.mjs': host('@import lib \'util.civet\'', 'lib'), 'lib/main.js': 'export const d = 1\n' },
    edit: ['lib/main.js', 'export const d = 2\n'], module: 'util', importers: [{ file: 'a.mjs', stem: 'a', imports: 'util' }], tracked: ['lib/main.js'],
  },
  {
    name: 'le module cite un .js dont le voisin change',
    files: { 'util.civet': 'export lib = µasset(\'lib/main.js\')\n', 'a.mjs': host('@import lib \'util.civet\'', 'lib'), 'lib/main.js': 'import { r } from \'./rng.js\'\nexport const d = r\n', 'lib/rng.js': 'export const r = 1\n' },
    edit: ['lib/rng.js', 'export const r = 2\n'], module: 'util', importers: [{ file: 'a.mjs', stem: 'a', imports: 'util' }], tracked: ['lib/main.js', 'lib/rng.js'],
  },
  {
    name: 'une chaîne de deux modules : A importe B, B cite une image, le composant importe A',
    files: {
      'b.module.civet': 'export logo = µasset(\'img/logo.png\')\n',
      'a.module.civet': '@import logo \'b.module.civet\'\nexport l = logo\n',
      'c.mjs': host('@import l \'a.module.civet\'', 'l'),
      'img/logo.png': withByte(1),
    },
    edit: ['img/logo.png', withByte(2)], module: 'b.module',
    importers: [{ file: 'a.module.civet', stem: 'a.module', imports: 'b.module' }, { file: 'c.mjs', stem: 'c', imports: 'a.module' }], tracked: ['img/logo.png'],
  },
]

describe('bundler — l\'importeur d\'un module de script suit les fichiers que le module cite, sur la même instance qui recompile', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const sc of scenarios) for (const mode of ['split', 'bundle'] as const) it(`${sc.name} (js: '${mode}') : aucune référence vers un fichier disparu`, async () => {
    const p       = project('importeur-module', sc.files)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, js: mode })
    try {
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      assert.deepEqual(dangling(p.root, p.outDir), [], 'à froid, aucune référence pendante')
      const before = mode === 'split' ? published(p.outDir, sc.module) : []
      writeFileSync(join(p.srcDir, sc.edit[0]), sc.edit[1])
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      assert.deepEqual(dangling(p.root, p.outDir), [], 'après le changement du fichier cité, aucune référence pendante')
      if (mode === 'split') {
        const after = published(p.outDir, sc.module)
        assert.equal(after.length, 1, `un seul fichier pour le module : ${after.join(', ')}`)
        assert.notDeepEqual(after, before, 'le module a changé de nom (sinon ce scénario ne prouve rien)')
        for (const importer of sc.importers) {
          const files = published(p.outDir, importer.stem)
          assert.equal(files.length, 1, `un seul fichier pour ${importer.file} : ${files.join(', ')}`)
          const imported = published(p.outDir, importer.imports)
          assert.ok(readFileSync(join(p.outDir, files[0]), 'utf8').includes(imported[0]), `${importer.file} vise ${imported[0]}`)
        }
      }
    }
    finally {
      await bundler.close()
    }
  })

  for (const sc of scenarios) it(`${sc.name} : chaque importeur dépend des fichiers cités par le module (son empreinte, et le suivi de \`mjs dev\`)`, async () => {
    const p       = project('importeur-module-deps', sc.files)
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      assert.deepEqual(messages((await bundler.compile()).errors), [])
      for (const importer of sc.importers) {
        const entry = bundler.cache.get(join(p.srcDir, importer.file))
        assert.ok(entry !== undefined, `${importer.file} est en cache`)
        for (const file of sc.tracked) {
          const abs = join(p.srcDir, file)
          assert.ok((entry!.importedModules ?? []).includes(abs), `${importer.file} dépend de ${file} : ${JSON.stringify(entry!.importedModules)}`)
          if (importer.file.endsWith('.mjs')) assert.ok(bundler.partialDependents.get(abs)?.has(join(p.srcDir, importer.file)), `modifier ${file} fait recompiler ${importer.file} sous \`mjs dev\``)
        }
      }
    }
    finally {
      await bundler.close()
    }
  })

  it('un voisin absent d\'un .js que cite le module n\'est dit qu\'au module, jamais à son importeur', async () => {
    const p       = project('importeur-module-voisin', {
      'util.civet': 'export lib = µasset(\'lib/main.js\')\n',
      'a.mjs': host('@import lib \'util.civet\'', 'lib'),
      'lib/main.js': 'import { r } from \'./rgn.js\'\nexport const d = r\n',
      'lib/rng.js': 'export const r = 1\n',
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      const stats = await bundler.compile()
      assert.deepEqual(messages(stats.errors), [])
      const said = stats.warnings.filter(w => /rgn\.js/.test(w))
      assert.equal(said.length, 1, `un seul avertissement : ${JSON.stringify(stats.warnings)}`)
      assert.ok(said[0].includes('util.civet'), `il nomme le module qui cite le .js : ${said[0]}`)
      assert.ok(!said[0].includes('a.mjs'), `jamais l'importeur, qui ne cite pas ce .js : ${said[0]}`)
    }
    finally {
      await bundler.close()
    }
  })

  it('deux modules qui se citent l\'un l\'autre par `µasset` ne font pas boucler la fermeture, chacun entre dans la fermeture de l\'autre', async () => {
    const p       = project('importeur-module-cycle', {
      'x.civet': 'export a = µasset(\'y.civet\')\n',
      'y.civet': 'export b = µasset(\'x.civet\')\nexport c = µasset(\'img/logo.png\')\n',
      'img/logo.png': withByte(1),
    })
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest })
    try {
      const closure = (bundler as any).collectTransitiveImportClosure([join(p.srcDir, 'x.civet')]) as string[]
      assert.deepEqual(closure.map(f => f.slice(p.srcDir.length + 1)).sort(), ['img/logo.png', 'x.civet', 'y.civet'])
    }
    finally {
      await bundler.close()
    }
  })
})
