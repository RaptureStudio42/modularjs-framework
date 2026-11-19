// la passe en microtâche des `µeffect` (bloc `<reffets-pass>` de `_mjs_invalidate`, mjs_element.ts : plusieurs écritures du même tour, une
// seule passe des reffets qui les lisent, sur l'état final) n'entre au cœur qu'avec mjs_effect.ts, seul fichier qui inscrit un reffet
// (`_mjs_effects`) : sans lui, elle ne tourne jamais — en production, en développement, et avec le cœur demandé tout entier (`runtime: 'all'`),
// qui n'emporte mjs_effect.ts qu'avec un reffet. Une appli qui écrit `µeffect` la garde. Cœur non minifié : les noms internes y gardent leur texte

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const SANS = '<script>\n$n = 0\n@plus = -> $n += 1\n</script>\n<p>{$n}</p>\n'
const AVEC = '<script>\n$n = 0\n$vu = 0\nµeffect -> $vu = $n * 2\n@plus = -> $n += 1\n</script>\n<p>{$n} {$vu}</p>\n'

const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

const coeur = async (used: Set<string>, opts: Record<string, unknown> = {}) => {
  const out     = mjsTmp('reffets-passe')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const chemin  = await bundler.bundleRuntime(used)
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(chemin)), 'utf-8')
}

// la passe, par deux de ses lignes
const PASSE  = ['const __vars = this._mjs_ue_pending;', '__ue = this._mjs_ue_pending = new Set();']
const valide = (texte: string) => assert.doesNotThrow(() => acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }), 'le cœur n\'est plus du JavaScript valide')

describe('cœur : la passe des µeffect seulement avec mjs_effect.ts', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('une appli sans µeffect : ni mjs_effect.ts ni la passe, aucune marque restée seule, en production comme en développement', async () => {
    for (const [cas, opts] of [['production', { env: 'prod' }], ['développement', {}], ['runtime: \'all\'', { env: 'prod', runtime: 'all' }]] as const) {
      const texte = await coeur(await signaux(SANS), opts)
      assert.ok(!texte.includes('// === mjs_effect.ts ==='), `${cas} : mjs_effect.ts entre au cœur, ce cas ne prouve plus rien`)
      for (const j of PASSE) assert.ok(!texte.includes(j), `${cas} : « ${j} » est encore là`)
      assert.doesNotMatch(texte, /^[ \t]*\/\/ <\/?reffets-passe>$/m, `${cas} : une marque du bloc est restée seule`)
      valide(texte)
    }
  })

  it('une appli qui écrit µeffect garde la passe, en production comme en développement', async () => {
    for (const [cas, opts] of [['production', { env: 'prod' }], ['développement', {}]] as const) {
      const texte = await coeur(await signaux(AVEC), opts)
      assert.ok(texte.includes('// === mjs_effect.ts ==='), `${cas} : mjs_effect.ts manque au cœur`)
      for (const j of PASSE) assert.ok(texte.includes(j), `${cas} : « ${j} » manque`)
      valide(texte)
    }
  })
})
