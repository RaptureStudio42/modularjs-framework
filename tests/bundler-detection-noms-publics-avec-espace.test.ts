// Relevé des briques du cœur (src/bundler/features.ts) : `µ.Store`, `µ.interpolate` et `µ.Ticker` n'étaient reconnus que
// collés à leur point, alors que `µ.every` l'est blancs compris. Le contrat du cœur (src/bundler/core-contract.ts), qui lit
// les jetons, voit `new µ .Store({ n: 1 })` : il réclamait `µ.Store` à un cœur parti sans lui, et la construction était
// refusée (« Cœur incomplet ») au lieu d'embarquer la brique. Un composant ne peut pas l'écrire (le compilateur refuse une
// rune séparée de `µ`), mais un fichier JavaScript lu tel quel par le manifeste externe, si. L'indice qui décide du masque
// des chaînes ne voyait pas non plus ces formes : `"µ .every(1)"` écrit dans une chaîne embarquait `every`. Les quatre noms
// se lisent désormais de la même façon des deux côtés : une espace ou un retour à la ligne autour du point ne change rien,
// une mention en prose ne compte pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { collectCoreCalls } from '../src/bundler/core-contract.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const BRIQUES = ['store', 'every', 'interpolate', 'ticker']

// le relevé et le contrat sur le même texte : les briques embarquées, les fonctions réclamées au cœur
function lectures(js: string): { briques: string[]; reclamees: string[] } {
  const used = scanCompiledFeatures(js)
  return {
    briques:   BRIQUES.filter(k => used.has(k)),
    reclamees: [...collectCoreCalls(js)].filter(n => n.startsWith('µ.')).sort(),
  }
}

describe('relevé des briques — µ.Store, µ.interpolate, µ.Ticker et µ.every écrits avec des blancs autour du point', function () {
  this.timeout(60000)
  after(() => { terminateSharedWorkerPool() })

  it('une espace ou un retour à la ligne autour du point : la brique est relevée, comme le contrat la réclame', () => {
    const cas: Array<[string, string, string]> = [
      ['const s = new µ .Store({ n: 1 })', 'store', 'µ.Store'],
      ['const s = new µ. Store({ n: 1 })', 'store', 'µ.Store'],
      ['const s = new µ\n  .Store({ n: 1 })', 'store', 'µ.Store'],
      ['const p = µ .interpolate(0, 400)', 'interpolate', 'µ.interpolate'],
      ['const p = µ\n  .interpolate(0, 400)', 'interpolate', 'µ.interpolate'],
      ['µ .Ticker.add(tache)', 'ticker', 'µ.Ticker'],
      ['µ\n  .Ticker.add(tache)', 'ticker', 'µ.Ticker'],
      ['µ .every(1000, f)', 'every', 'µ.every'],
    ]
    for (const [js, brique, nom] of cas) {
      assert.deepEqual(lectures(js), { briques: [brique], reclamees: [nom] }, JSON.stringify(js))
    }
  })

  it('témoin : une mention en chaîne ou en commentaire, blancs compris, ne compte toujours pas', () => {
    const prose = [
      "const doc = 'µ .Store et µ .Ticker'",
      'const aide = "µ . interpolate et µ .every(1)"',
      '// µ .Store en commentaire',
    ].join('\n')
    assert.deepEqual(lectures(prose), { briques: [], reclamees: [] })
  })

  it('un vrai build embarque µ.Store pour `new µ .Store(…)` écrit dans un fichier du manifeste externe, au lieu de refuser de finir', async () => {
    const root   = mjsTmp('briques-espace')
    const srcDir = join(root, 'app/modularjs')
    mkdirSync(join(srcDir, 'lib'), { recursive: true })
    writeFileSync(join(srcDir, 'manifest.civet'), '#= require ./lib/reserve\n')
    writeFileSync(join(srcDir, 'lib/reserve.js'), 'globalThis.reserve = new µ .Store({ n: 1 })\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'bundle.js', manifestExternal: 'app/modularjs/manifest.civet' }))
    const found = findConfig(root)
    assert.ok(found, 'mjs.config.json doit être trouvé')
    const stats = await new Bundler(resolveBundlerOpts(found!.config, found!.configDir) as never).compile()
    assert.deepEqual(stats.errors.map(e => e.message), [], 'un build sain ne doit rien signaler')
    const outDir = join(root, 'out')
    const f      = readdirSync(outDir).find((n) => /^mjs_core-/.test(n))
    assert.ok(f, 'mjs_core-*.js doit exister')
    assert.ok(readFileSync(join(outDir, f!), 'utf-8').includes('µ.Store = class Store'), 'µ.Store doit être défini dans le cœur')
  })
})
