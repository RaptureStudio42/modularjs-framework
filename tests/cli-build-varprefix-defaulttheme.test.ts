// `mjs build` doit transmettre `varPrefix` et `defaultTheme` de mjs.config.json au
// compilateur : `resolveBundlerOpts()` les résout mais le littéral `new Bundler({...})` de
// cli.ts ne les passait pas — les variables de thème restaient préfixées `--mjs-*` (jamais le
// préfixe du projet) et le thème par défaut ne recevait pas sa règle `:where(:root)` (une page
// nue restait sans le thème censé s'appliquer sans attribut). Le rendu serveur, lui, les
// transmettait déjà : build et SSR divergeaient.
//
// Test par un VRAI sous-processus (cli.ts exécute `run(process.argv)` à son chargement), même
// patron que tests/cli-build-render-transmis.test.ts.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function fixture(): string {
  const root = mjsTmp('cli-varprefix')
  mkdirSync(join(root, 'app', 'modularjs', 'themes'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'themes', 'nuit.theme.mjs'), '<theme>\n  $$brand: #ff0000\n</theme>\n')
  writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<div class="carte">x</div>\n<style>\n  .carte\n    color: $$brand\n</style>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir:    'app/modularjs',
    outputDir:    'public/modularjs',
    varPrefix:    'acme',
    defaultTheme: 'nuit',
  }, null, 2))
  return root
}

/** concatène TOUT ce que ce build a écrit — la variable de thème peut sortir dans mjs_core.js
 *  (registre des thèmes) ET dans le fichier du composant (sa propre feuille scopée). */
function construire(root: string): string {
  const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
  assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
  const outDir = join(root, 'public', 'modularjs')
  const fichiers = readdirSync(outDir).filter(f => f.endsWith('.js'))
  assert.ok(fichiers.some(f => /^mjs_core-/.test(f)), 'mjs_core-*.js doit exister')
  return fichiers.map(f => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

describe("cli.ts — 'mjs build' transmet varPrefix et defaultTheme au compilateur", function () {
  this.timeout(60000)

  it('varPrefix du projet : les variables de thème sortent avec CE préfixe, jamais --mjs-*', () => {
    const sortie = construire(fixture())
    assert.match(sortie, /--acme-brand/, 'le préfixe configuré doit apparaître (registre des thèmes ou composant)')
    assert.equal(sortie.includes('--mjs-brand'), false, 'le préfixe par défaut ne doit plus apparaître')
  })

  it('defaultTheme du projet : sa règle porte aussi :where(:root) (visible sans attribut posé)', () => {
    const sortie = construire(fixture())
    assert.match(sortie, /:where\(:root\)/, 'le thème par défaut doit aussi cibler :root')
  })
})

describe('Bundler — varPrefix atteint la compilation des composants même par le pool de threads', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un seul composant, pool forcé (inlineTranspileLimit: 0) : $$brand compile avec le préfixe du projet', async () => {
    const root   = mjsTmp('bundler-varprefix-worker')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), '<div class="carte">x</div>\n<style>\n  .carte\n    color: $$brand\n</style>\n')

    const bundler = new Bundler({
      sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'),
      varPrefix: 'acme', inlineTranspileLimit: 0,
    })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    const sortie = readdirSync(bundler.outputDir).filter(f => f.endsWith('.js'))
      .map(f => readFileSync(join(bundler.outputDir, f), 'utf-8')).join('\n')
    assert.match(sortie, /--acme-brand/, 'le préfixe doit survivre au passage par un worker')
  })
})
