// Relevé des briques du cœur (src/bundler/features.ts) et contrat du cœur (src/bundler/core-contract.ts), sur un fichier
// JavaScript lu tel quel par le manifeste externe : `µ?.Store` (chaînage optionnel) n'était vu ni par l'un ni par l'autre,
// et `µ.inspect (…)`, `µ.play (…)`, `µ.effect (…)` écrits avec une espace avant la parenthèse (ou un retour à la ligne
// autour du point) échappaient au relevé, hors du contrat. Le build finissait vert sur un cœur sans la brique, et la page
// s'arrêtait à l'exécution (« is not a constructor », « is not a function »). Les deux lisent maintenant ces écritures
// de la même façon ; une mention en chaîne ou en commentaire ne réclame toujours rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { collectCoreCalls, missingCoreSymbols } from '../src/bundler/core-contract.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const BRIQUES = ['store', 'interpolate', 'ticker', 'every', 'inspect', 'play', 'effect']

// le relevé et le contrat sur le même texte : les briques embarquées, les fonctions réclamées au cœur
function lectures(js: string): { briques: string[]; reclamees: string[] } {
  const used = scanCompiledFeatures(js)
  return {
    briques:   BRIQUES.filter(k => used.has(k)),
    reclamees: [...collectCoreCalls(js)].filter(n => n.startsWith('µ.')).sort(),
  }
}

describe('relevé des briques et contrat du cœur — chaînage optionnel et appels écrits avec des blancs', function () {
  this.timeout(60000)
  after(() => { terminateSharedWorkerPool() })

  it('µ?.Store, µ?.interpolate, µ?.Ticker, µ?.every : la brique est relevée et le contrat la réclame', () => {
    const cas: Array<[string, string, string]> = [
      ['const Reserve = µ?.Store\nglobalThis.r = new Reserve({ n: 1 })', 'store', 'µ.Store'],
      ['const p = µ?.interpolate(0, 400)', 'interpolate', 'µ.interpolate'],
      ['µ?.Ticker.add(tache)', 'ticker', 'µ.Ticker'],
      ['µ?.every(1000, f)', 'every', 'µ.every'],
    ]
    for (const [js, brique, nom] of cas) {
      assert.deepEqual(lectures(js), { briques: [brique], reclamees: [nom] }, JSON.stringify(js))
    }
  })

  it('µ.inspect, µ.play, µ.effect appelés avec des blancs : la brique est relevée et le contrat la réclame', () => {
    const cas: Array<[string, string, string]> = [
      ["µ.inspect ('n')", 'inspect', 'µ.inspect'],
      ["µ\n  .inspect('n')", 'inspect', 'µ.inspect'],
      ["µ?.inspect('n')", 'inspect', 'µ.inspect'],
      ["µ.play (noeud, 'pulse')", 'play', 'µ.play'],
      ["µ .play(noeud, 'pulse')", 'play', 'µ.play'],
      ['µ.effect (() => 1)', 'effect', 'µ.effect'],
      ['µ.\n  effect(() => 1)', 'effect', 'µ.effect'],
    ]
    for (const [js, brique, nom] of cas) {
      assert.deepEqual(lectures(js), { briques: [brique], reclamees: [nom] }, JSON.stringify(js))
    }
  })

  it('le contrat refuse un cœur sans la définition réclamée, et accepte celui qui la porte', () => {
    const appels = collectCoreCalls("µ.inspect ('n')\nµ.play (noeud, 'pulse')\nµ.effect (() => 1)")
    assert.deepEqual(missingCoreSymbols('µ.Store = class Store {}', appels), ['µ.effect', 'µ.inspect', 'µ.play'])
    assert.deepEqual(missingCoreSymbols('µ.inspect = function() {}\nµ.play = function() {}\nµ.effect = function() {}', appels), [])
  })

  it('témoin : une mention en chaîne ou en commentaire ne réclame rien', () => {
    const prose = [
      "const doc = 'µ?.Store et µ.inspect (n)'",
      'const aide = "µ.play (x) et µ.effect (f)"',
      '// µ?.Store et µ.effect (f) en commentaire',
    ].join('\n')
    assert.deepEqual([...collectCoreCalls(prose)].filter(n => n.startsWith('µ.')), [])
    assert.equal(scanCompiledFeatures(prose).has('store'), false)
  })

  it('un vrai build embarque µ.Store et µ.inspect pour un fichier du manifeste externe qui les écrit ainsi', async () => {
    const root   = mjsTmp('releve-chainage-optionnel')
    const srcDir = join(root, 'app/modularjs')
    mkdirSync(join(srcDir, 'lib'), { recursive: true })
    writeFileSync(join(srcDir, 'manifest.civet'), '#= require ./lib/reserve\n')
    writeFileSync(join(srcDir, 'lib/reserve.js'), "const Reserve = µ?.Store\nglobalThis.reserve = new Reserve({ n: 1 })\nglobalThis.voir = () => µ.inspect ('n')\n")
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'bundle.js', manifestExternal: 'app/modularjs/manifest.civet' }))
    const found = findConfig(root)
    assert.ok(found, 'mjs.config.json doit être trouvé')
    const stats = await new Bundler(resolveBundlerOpts(found!.config, found!.configDir) as never).compile()
    assert.deepEqual(stats.errors.map(e => e.message), [], 'un build sain ne doit rien signaler')
    const outDir = join(root, 'out')
    const f      = readdirSync(outDir).find((n) => /^mjs_core-/.test(n))
    assert.ok(f, 'mjs_core-*.js doit exister')
    const coeur = readFileSync(join(outDir, f!), 'utf-8')
    assert.ok(coeur.includes('µ.Store = class Store'), 'µ.Store doit être défini dans le cœur')
    assert.ok(coeur.includes('µ.inspect = function'), 'µ.inspect doit être défini dans le cœur')
  })
})
