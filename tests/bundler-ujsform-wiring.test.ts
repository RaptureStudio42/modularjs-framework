// L'option documentée `lint.ujsForm: false` (docs/32-cli-et-configuration.md) coupe
// l'avertissement « <form> sans action ni méthode » quand elle passe par `transpile()`
// directement (déjà couvert, tests/ujs-form-lint.test.ts) — mais `ujsForm` n'existait NULLE
// PART entre le Bundler et `transpile()` : ni dans les options du Bundler, ni sur son
// instance, ni dans le message échangé avec le pool de threads (TranspileMsg/
// transpileFromMsg), ni dans `compileSingle()`. Un build réel (`mjs build`, ou
// `new Bundler({ ujsForm: false })`) continuait donc d'avertir quel que soit le réglage —
// régression invisible au seul test qui appelle `transpile()` directement.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler } from '../src/bundler/index.js'

const repoRoot   = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORM_FAUTIF = '<form>\n  <input name="q">\n</form>\n'

// sous-processus DÉDIÉ (jamais un appel direct à Bundler dans CE fichier pour les deux
// premiers groupes) : un console.warn émis DANS un thread du pool écrit sur le fd hérité,
// invisible à un espion `console.warn` posé dans ce process de test — seule la sortie du
// SOUS-PROCESSUS, capturée de l'extérieur, prouve quoi que ce soit sur le chemin par threads.
function driverSource(root: string, ujsFormLiteral: string): string {
  const srcDir = JSON.stringify(join(root, 'src'))
  const outDir = JSON.stringify(join(root, 'out'))
  const bundlerPath = JSON.stringify(join(repoRoot, 'src/bundler/index.ts'))
  return [
    `import { Bundler, terminateSharedWorkerPool } from ${bundlerPath}`,
    // IIFE async : `tsx` compile ce fichier en CJS faute de `"type": "module"` dans le
    // dossier jetable — un top-level await y est refusé, l'IIFE l'évite sans rien changer
    // au comportement observé de l'extérieur (stdout/stderr du sous-processus).
    '(async () => {',
    `  const b = new Bundler({ sourceDir: ${srcDir}, outputDir: ${outDir}, manifestPath: ${JSON.stringify(join(root, 'bundle.js'))}, inlineTranspileLimit: 0${ujsFormLiteral} })`,
    '  const stats = await b.compile()',
    '  if (stats.errors.length > 0) { console.error(stats.errors.map(e => e.message).join("\\n")); process.exitCode = 1 }',
    '  await terminateSharedWorkerPool()',
    '})()',
  ].join('\n')
}

function runDriver(ujsFormLiteral: string): string {
  const root = mjsTmp('ujsform-worker')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'page.mjs'), FORM_FAUTIF)
  const script = join(root, 'driver.ts')
  writeFileSync(script, driverSource(root, ujsFormLiteral))
  const result = spawnSync('npx', ['tsx', script], { cwd: repoRoot, encoding: 'utf-8' })
  assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
  return result.stderr
}

describe('Bundler — lint.ujsForm câblé jusqu\'au bout (compile réel, pool de threads forcé)', function () {
  this.timeout(30000)

  it('sans option : le build réel avertit (comportement par défaut, ujsForm activé)', () => {
    const stderr = runDriver('')
    assert.match(stderr, /@noUJS/, `avertissement attendu, stderr : ${stderr}`)
  })

  it('ujsForm: false transmis au Bundler : AUCUN avertissement, même via le pool de threads', () => {
    const stderr = runDriver(', ujsForm: false')
    assert.equal(stderr.includes('@noUJS'), false, `aucun avertissement attendu, stderr : ${stderr}`)
  })
})

describe('cli.ts — lint.ujsForm:false de mjs.config.json coupe l\'avertissement au build réel', function () {
  this.timeout(60000)

  function construire(root: string): string {
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    return result.stderr
  }

  it('sans lint.ujsForm : mjs build avertit', () => {
    const root = mjsTmp('cli-ujsform-on')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'page.mjs'), FORM_FAUTIF)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs' }))
    assert.match(construire(root), /@noUJS/)
  })

  it('lint.ujsForm:false : mjs build n\'avertit plus', () => {
    const root = mjsTmp('cli-ujsform-off')
    mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', 'page.mjs'), FORM_FAUTIF)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'app/modularjs', outputDir: 'public/modularjs', lint: { ujsForm: false },
    }))
    const stderr = construire(root)
    assert.equal(stderr.includes('@noUJS'), false, `aucun avertissement attendu, stderr : ${stderr}`)
  })
})

describe('Bundler — compileSingle() respecte aussi ujsForm (chemin direct, même process)', () => {
  it('ujsForm: false : aucun avertissement', async () => {
    const root = mjsTmp('compile-single-ujsform')
    const bundler = new Bundler({
      sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'),
      ujsForm: false,
    } as any)
    const orig = console.warn
    const caught: string[] = []
    console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
    try {
      await bundler.compileSingle(FORM_FAUTIF, { fileName: 'page.mjs' })
    } finally {
      console.warn = orig
    }
    assert.equal(caught.some(m => m.includes('@noUJS')), false, `aucun avertissement attendu : ${JSON.stringify(caught)}`)
  })

  it('sans option (défaut ON) : compileSingle() avertit bien — témoin du test ci-dessus', async () => {
    const root = mjsTmp('compile-single-ujsform-on')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const orig = console.warn
    const caught: string[] = []
    console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
    try {
      await bundler.compileSingle(FORM_FAUTIF, { fileName: 'page.mjs' })
    } finally {
      console.warn = orig
    }
    assert.ok(caught.some(m => m.includes('@noUJS')), `avertissement attendu : ${JSON.stringify(caught)}`)
  })
})
