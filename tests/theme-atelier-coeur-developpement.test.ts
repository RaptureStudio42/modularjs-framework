// L'atelier /__mjs/theme est compilé à la volée par le serveur de développement et partage le cœur de l'application :
// il appelle des fonctions du cœur (mutations profondes, listes, blocs {if}, crochets de vie) que le cœur n'embarque
// que si un composant de l'application les emploie. Une application qui n'en emploie aucune servait un atelier
// qui lève `µ._mjs_deepSet is not a function` au premier dépliage.
// - un build de développement joint au cœur tout ce que l'atelier compilé appelle, avec ou sans composant qui s'en sert ;
// - un build de production ne prend rien : l'atelier n'y est pas servi ;
// - un cœur nu (`runtime: []`) reste nu, comme pour le panneau de développement ;
// - la liste jointe suit l'atelier : tout ce que son code compilé appelle y figure.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const ATELIER = join(ICI, '..', 'src', 'server', 'theme-viewer.mjs')

// définitions telles qu'écrites dans le module (rien n'est minifié dans ces builds)
const MARQUE_DEEP = 'µ._mjs_deepSet = function'

// l'application sans mutation profonde, sans liste, sans {if} ni crochet de vie
const NU    = { 'hop.mjs': '<script>\n$t = \'ok\'\n</script>\n<p>{$t}</p>\n' }
const ECRIT = { 'hop.mjs': '<script>\n$o = { n: 1 }\nmaj = -> $o.n = 2\n</script>\n<p @click={maj()}>{$o.n}</p>\n' }

async function construire(cfgExtra: any, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp('atelier-coeur')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, contenu] of Object.entries(sources)) writeFileSync(join(srcDir, nom), contenu)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), defaultScriptLang: 'civet', lint: { a11y: false }, ...cfgExtra } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const coeur = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
  assert.ok(coeur, 'mjs_core-*.js doit exister')
  return readFileSync(join(outDir, coeur!), 'utf-8')
}

// les fichiers du cœur d'un build dont aucun composant n'emploie rien (le cas de l'application nue)
function fichiersDuCoeur(cfgExtra: any): string[] {
  const root    = mjsTmp('atelier-coeur-liste')
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...cfgExtra } as any)
  return bundler.resolveRuntimeFiles(new Set<string>()).files
}

describe('l\'atelier de thème et le cœur de l\'application', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('développement : une application sans mutation profonde embarque pourtant celle de l\'atelier', async () => {
    const coeur = await construire({}, NU)
    assert.ok(coeur.includes(MARQUE_DEEP), 'le cœur de développement porte les mutations profondes')
  })

  for (const [titre, cfg] of [['par défaut', {}], ['avec une liste `runtime` explicite', { runtime: ['ajax'] }]] as const) {
    it(`développement, ${titre} : tout ce que le code compilé de l'atelier appelle est dans le cœur d'une application nue`, async () => {
      const { output } = await transpile(localizeViewerSource(readFileSync(ATELIER, 'utf8')), { moduleName: 'theme-viewer' })
      const appeles    = [...scanCompiledFeatures(output)].sort()
      assert.ok(appeles.length >= 5, `garde muette : l'atelier appelle plusieurs fonctions du cœur (${appeles.join(', ')})`)
      const fichiers = fichiersDuCoeur(cfg)
      const manque   = appeles.filter((f) => !fichiers.includes('mjs_' + f + '.ts'))
      assert.deepEqual(manque, [], `l'atelier appelle ces fonctions que le cœur de développement n'embarque pas : ${manque.join(', ')}`)
    })
  }

  it('production : le cœur ne prend rien de l\'atelier', async () => {
    assert.equal((await construire({ env: 'prod', minify: false }, NU)).includes(MARQUE_DEEP), false)
    const fichiers = fichiersDuCoeur({ env: 'prod' })
    const joints   = ['mjs_deep.ts', 'mjs_if.ts', 'mjs_for_nested.ts', 'mjs_destroy_hooks.ts'].filter((f) => fichiers.includes(f))
    assert.deepEqual(joints, [], `la production embarque ce que seul l'atelier appelle : ${joints.join(', ')}`)
  })

  it('production : le cœur garde la mutation profonde quand un composant l\'emploie (le test de l\'absence ne se tait pas)', async () => {
    assert.ok((await construire({ env: 'prod', minify: false }, ECRIT)).includes(MARQUE_DEEP))
  })

  it('un cœur nu (runtime: []) reste nu en développement', async () => {
    assert.equal((await construire({ runtime: [] }, NU)).includes(MARQUE_DEEP), false)
  })

  it('une liste explicite qui n\'est pas un cœur nu reçoit ce que l\'atelier appelle', async () => {
    assert.ok((await construire({ runtime: ['ajax'] }, NU)).includes(MARQUE_DEEP))
  })
})
