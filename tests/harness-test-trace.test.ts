// garde du HARNAIS, pas du produit : le crochet commun (tests/helpers/tmp-sweep.ts) relève, pour chaque fichier de
// test, les fichiers du projet lus pendant son passage (au chargement comme dans un test, par node:fs comme par
// node:fs/promises), sa durée et ses rouges ; MJS_MOTEURS y écarte un moteur non voulu en sautant le crochet qui le
// lance, sauf dans un fichier qui déclare les moteurs qu'il exige ; et l'outil des tests liés joue chaque voie dans un
// vrai mocha sous l'enclos, puis rejoue SEUL chaque rouge. Chaque cas lance de vrais mocha enfants, TMPDIR à eux

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { executeRun, realRunner, type Candidate } from '../script/related-tests.js'

const repoRoot   = join(dirname(fileURLToPath(import.meta.url)), '..')
const mocha      = join(repoRoot, 'node_modules', 'mocha', 'bin', 'mocha.js')
const hook       = join(repoRoot, 'tests', 'helpers', 'tmp-sweep.ts')
const PLAYWRIGHT = pathToFileURL(join(repoRoot, 'node_modules', 'playwright', 'index.mjs')).href   //le témoin vit hors du paquet : Playwright du paquet, par son chemin

// mocha enfant chargé du crochet commun, relevé écrit dans un fichier à lui, aucune config implicite
function runChild(dir: string, spec: string, env: Record<string, string> = {}) {
  const tmp      = join(dir, 't')
  const specPath = join(dir, 'temoin.test.ts')
  const trace    = join(dir, 'releve.json')
  mkdirSync(tmp, { recursive: true })
  writeFileSync(specPath, spec)
  const r        = spawnSync(process.execPath, [mocha, '--no-config', '--no-package', '--require', 'tsx/esm', '--require', hook, '--exit', specPath], { cwd: repoRoot, env: { ...process.env, MJS_MOTEURS: '', ...env, TMPDIR: tmp, MJS_TEST_TRACE: join(dir, 'cache'), MJS_TEST_TRACE_FILE: trace }, encoding: 'utf-8', timeout: 60000 })
  const fragment = existsSync(trace) ? JSON.parse(readFileSync(trace, 'utf-8')) : null
  return { status: r.status, out: `${r.stdout}${r.stderr}`, file: fragment?.files?.[specPath] }
}

const LECTURES = [
  "import { readFileSync } from 'node:fs'",
  "import { readFile } from 'node:fs/promises'",
  `const racine = ${JSON.stringify(repoRoot)}`,
  "readFileSync(racine + '/src/runtime/mjs_if.ts', 'utf-8')",
  "describe('témoin du relevé', function () {",
  "  it('lit un fichier du runtime', function () { readFileSync(racine + '/src/runtime/mjs_for.ts', 'utf-8') })",
  "  it('lit par les promesses', async function () { await readFile(racine + '/src/runtime/mjs_key.ts', 'utf-8') })",
  "  it('rouge voulu', function () { throw new Error('rouge voulu') })",
  '})'
].join('\n')

const MOTEUR = (declaration: string) => [
  declaration,
  "describe('témoin des moteurs', function () {",
  '  let browser: any = null',
  `  before(async function () { browser = await (await import(${JSON.stringify(PLAYWRIGHT)})).firefox.launch({ executablePath: '/chemin/absent/firefox' }) })`,
  '  after(async function () { if (browser) await browser.close() })',
  "  it('joue sous firefox', function () {})",
  '})'
].join('\n')

describe('relevé des tests : le crochet commun note ce que chaque fichier lit vraiment', function () {
  this.timeout(60000)

  it('lectures au chargement, dans un test, par les promesses ; durée, nombre de tests et rouges du fichier', function () {
    const r = runChild(mjsTmp('releve-lectures'), LECTURES)
    assert.equal(r.status, 1, r.out)
    assert.ok(r.file, `fragment du relevé absent ou sans ce fichier :\n${r.out}`)
    for (const lu of ['src/runtime/mjs_if.ts', 'src/runtime/mjs_for.ts', 'src/runtime/mjs_key.ts']) assert.ok(r.file.reads.includes(lu), `${lu} absent du relevé : ${JSON.stringify(r.file.reads)}`)
    assert.equal(r.file.tests, 3)
    assert.equal(r.file.failures, 1)
    assert.equal(r.file.done, true)
    assert.equal(typeof r.file.ms, 'number')
  })
})

describe('MJS_MOTEURS : le crochet commun ne lance que les moteurs voulus', function () {
  this.timeout(60000)

  it('moteur écarté : le crochet qui le lance est sauté, la suite reste verte, le saut est compté', function () {
    const r = runChild(mjsTmp('moteurs-ecarte'), MOTEUR(''), { MJS_MOTEURS: 'chromium' })
    assert.equal(r.status, 0, r.out)
    assert.equal(r.file.failures, 0)
    assert.equal(r.file.pending, 1)
    assert.deepEqual(r.file.skippedEngines, { firefox: 1 })
    assert.match(r.out, /MJS_MOTEURS=chromium/)
  })

  it('fichier qui déclare « moteurs exigés : firefox » : son lancement passe (ici vers un exécutable absent, donc rouge)', function () {
    const r = runChild(mjsTmp('moteurs-exiges'), MOTEUR('// moteurs exigés : firefox'), { MJS_MOTEURS: 'chromium' })
    assert.equal(r.status, 1, r.out)
    assert.ok(r.file.failures >= 1)
    assert.deepEqual(r.file.skippedEngines, {})
  })

  it('sans MJS_MOTEURS : tous les moteurs passent, comme avant', function () {
    const r = runChild(mjsTmp('moteurs-tous'), MOTEUR(''))
    assert.equal(r.status, 1, r.out)
    assert.deepEqual(r.file.skippedEngines, {})
  })
})

describe('tests liés : un vrai mocha par voie, sous l\'enclos, puis le rejeu seul des rouges', function () {
  this.timeout(120000)

  it('un rouge de passage revient vert seul (« instable »), un rouge têtu reste « rouge », le vert reste vert', async function () {
    const dir    = mjsTmp('tests-lies-rejeu')
    const marque = join(dir, 'deja-vu')
    writeFileSync(join(dir, 'passage.test.ts'), ["import { existsSync, writeFileSync } from 'node:fs'", `const marque = ${JSON.stringify(marque)}`, "describe('rouge de passage', function () { it('rouge au premier passage seulement', function () { if (!existsSync(marque)) { writeFileSync(marque, '1'); throw new Error('rouge de passage') } }) })"].join('\n'))
    writeFileSync(join(dir, 'tetu.test.ts'), "describe('rouge têtu', function () { it('toujours rouge', function () { throw new Error('toujours') }) })")
    writeFileSync(join(dir, 'vert.test.ts'), "describe('vert', function () { it('vert', function () {}) })")
    const runner  = realRunner({ root: repoRoot, passDir: join(dir, 'passe'), fragmentDir: join(dir, 'passe'), tmpBase: dir, env: { MJS_MOTEURS: 'chromium', MJS_TEST_TRACE: '0' } })
    const c       = (f: string): Candidate => ({ file: join(dir, f), level: 1, why: '', traced: true, ms: 1000, family: f, kind: 'statique' })
    const outcome = await executeRun({ lanes: [[c('passage.test.ts'), c('vert.test.ts')], [c('tetu.test.ts')]] }, { runner, mainDeadline: Date.now() + 90000, endDeadline: Date.now() + 110000, overheadMs: 5000 })
    assert.equal(outcome.status.get(join(dir, 'vert.test.ts')), 'vert')
    assert.equal(outcome.status.get(join(dir, 'passage.test.ts')), 'instable')
    assert.equal(outcome.status.get(join(dir, 'tetu.test.ts')), 'rouge')
    assert.deepEqual(outcome.replays, [join(dir, 'passage.test.ts'), join(dir, 'tetu.test.ts')])
  })
})
