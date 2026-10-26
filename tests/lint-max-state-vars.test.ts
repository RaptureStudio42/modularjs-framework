// Lint « trop de variables d'état » (lint.maxStateVars) —
// au-delà de N `$x` distinctes dans UN composant (défaut 40, 0 = désactivé),
// transpile() émet un AVERTISSEMENT console (jamais bloquant) qui oriente vers
// le découpage en sous-composants/écrans. Étalonnage réel : modules sains
// 5-20 vars, monolithe pathologique vu à 182. Configurable par le bloc
// `"lint": { "maxStateVars": N }` de mjs.config.json (validation stricte).
// Les modules du cœur (`<@@nom>`, catalogue du framework) n'y sont pas soumis : leur nombre de variables
// est l'affaire du framework, jamais de l'appli qui les emploie ; un composant du projet reste soumis au seuil.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

// composant généré : n variables d'état distinctes `$v1 = 1` … `$vN = N`
function sourceWithVars(n: number): string {
  const decls = Array.from({ length: n }, (_, i) => `$v${i + 1} = ${i + 1}`).join('\n')
  return `<script>\n${decls}\n</script>\n<p>{$v1}</p>`
}

// espionne console.warn le temps d'un transpile (motif analyzer.test.ts)
async function warnsTooMany(src: string, opts: Record<string, unknown> = {}): Promise<string | null> {
  const orig = console.warn
  let caught: string | null = null
  console.warn = (...a: unknown[]) => { const s = String(a[0]); if (s.includes('variables d\'état')) caught = s }
  try { await transpile(src, { moduleName: 'stress-vars', ...opts }) } finally { console.warn = orig }
  return caught
}

describe('lint maxStateVars — avertissement « trop de variables d\'état »', function () {
  this.timeout(30000)

  it('41 vars, seuil défaut 40 → warn orientant (nom, compte, seuil, réglage)', async () => {
    const msg = await warnsTooMany(sourceWithVars(41))
    assert.ok(msg, 'un avertissement devait être émis')
    assert.match(msg as unknown as string, /41 variables d'état/)
    assert.match(msg as unknown as string, /seuil 40/)
    assert.match(msg as unknown as string, /lint\.maxStateVars/)
    assert.match(msg as unknown as string, /stress-vars/)
  })

  it('40 vars pile (= seuil) → silence', async () => {
    assert.equal(await warnsTooMany(sourceWithVars(40)), null)
  })

  it('seuil 10 passé en option → warn à 11, silence à 10', async () => {
    assert.ok(await warnsTooMany(sourceWithVars(11), { maxStateVars: 10 }))
    assert.equal(await warnsTooMany(sourceWithVars(10), { maxStateVars: 10 }), null)
  })

  it('0 = désactivé → jamais de warn, même à 100 vars', async () => {
    assert.equal(await warnsTooMany(sourceWithVars(100), { maxStateVars: 0 }), null)
  })
})

// une appli jetable construite par le bundler (catalogue cœur fabriqué, ou le réel quand `catalogue` est null) : les lignes
// du lint imprimées pendant la construction ; transpilation dans le processus, pour que la console les voie
async function lintLinesOfBuild(files: Record<string, string>, catalogue: Record<string, string> | null, opts: Record<string, unknown> = {}): Promise<string[]> {
  const root   = mjsTmp('lint-coeur')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  let coreDir: string | undefined
  if (catalogue) {
    coreDir = join(root, 'core-modules')
    mkdirSync(coreDir, { recursive: true })
    for (const [rel, content] of Object.entries(catalogue)) writeFileSync(join(coreDir, rel), content)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), inlineTranspileLimit: 1e6, ...(coreDir ? { coreModulesDir: coreDir } : {}), ...opts })
  const orig  = console.warn
  const lines: string[] = []
  console.warn = (...a: unknown[]) => { const s = String(a[0]); if (s.includes('[lint.maxStateVars]')) lines.push(s) }
  try {
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  }
  finally {
    console.warn = orig
  }
  return lines
}

describe('lint maxStateVars — les modules du cœur en sont exemptés', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un module du catalogue cœur à 41 variables ne le montre pas ; un composant du projet à 41 variables le montre toujours', async () => {
    const lines = await lintLinesOfBuild({ 'page.mjs': '<@@stress></@@stress>', 'gros.mjs': sourceWithVars(41) }, { 'stress.mjs': sourceWithVars(41) })
    assert.ok(!lines.some(l => /stress/.test(l)), `le module du cœur ne doit pas être signalé :\n${lines.join('\n')}`)
    assert.equal(lines.length, 1, `seul le composant du projet est signalé :\n${lines.join('\n')}`)
    assert.match(lines[0], /\bgros\b.*\b41\b/)
  })

  it('catalogue réel, seuil 1 : aucun module du cœur ne le montre, le composant du projet qui les emploie le montre', async () => {
    const HOST = '<script>\n$a = 1\n$b = 2\n</script>\n<p>{$a} {$b}</p>\n<@@select name="pays" search><@@option value="fr">France</@@option></@@select>'
    const lines = await lintLinesOfBuild({ 'hote.mjs': HOST }, null, { maxStateVars: 1 })
    assert.ok(!lines.some(l => /core-/.test(l)), `aucun module du cœur ne doit être signalé :\n${lines.join('\n')}`)
    assert.equal(lines.length, 1, `seul le composant du projet est signalé :\n${lines.join('\n')}`)
    assert.match(lines[0], /\bhote\b/)
  })
})

describe('mjs.config.json — validation stricte du bloc lint', () => {
  it('accepte { lint: { maxStateVars: 40 } } et resolveBundlerOpts le transmet', () => {
    const root = mjsTmp('cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { maxStateVars: 40 } }))
    const found = findConfig(root)
    assert.ok(found)
    assert.equal(found!.config.lint!.maxStateVars, 40)
    const opts = resolveBundlerOpts(found!.config, root)
    assert.equal(opts.maxStateVars, 40)
  })

  it('throw sur clé inconnue dans lint, avec la liste des clés admises', () => {
    const root = mjsTmp('cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { maxStateVarz: 40 } }))
    // liste des clés valides désormais longue (un type par avertissement de build, cf.
    // src/diagnostics.ts) — on vérifie juste que maxStateVars y figure, pas sa position exacte
    assert.throws(() => findConfig(root), /lint\.maxStateVarz : clé inconnue[\s\S]*Clés valides : [\s\S]*\bmaxStateVars\b/)
  })

  it('throw sur lint non-objet', () => {
    const root = mjsTmp('cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: 40 }))
    assert.throws(() => findConfig(root), /'lint' doit être un objet/)
  })

  it('throw sur maxStateVars non entier, négatif ou non numérique', () => {
    for (const bad of [40.5, -1, '40']) {
      const root = mjsTmp('cfg')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { maxStateVars: bad } }))
      assert.throws(() => findConfig(root), /lint\.maxStateVars doit être un entier/)
    }
  })

  it('maxStateVars: 0 (désactivation) reste accepté par la validation', () => {
    const root = mjsTmp('cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ lint: { maxStateVars: 0 } }))
    assert.doesNotThrow(() => findConfig(root))
  })
})
