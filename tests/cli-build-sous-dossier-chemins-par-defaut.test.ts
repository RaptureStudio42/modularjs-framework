// `mjs build` lancé depuis un sous-dossier du projet trouve mjs.config.json plus haut et en lit les chemins depuis son dossier. Les
// chemins que la config ne donne pas (`manifestPath`, `stylesheetsDir`, `manifestExternal`, et de même `sourceDir`, `outputDir`)
// partaient, eux, du dossier courant : le manifeste s'écrivait dans le sous-dossier. Ils partent désormais du dossier de la config ;
// sans config, du dossier courant, comme avant.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function depuis<T>(dossier: string, faire: () => T): T {
  const avant = process.cwd()
  process.chdir(dossier)
  try {
    return faire()
  }
  finally {
    process.chdir(avant)
  }
}

describe('chemins par défaut depuis le dossier de mjs.config.json, lancé d\'un sous-dossier', function () {
  this.timeout(180000)

  it('mjs build depuis un sous-dossier, sans manifestPath : le manifeste va à côté de la config, rien dans le sous-dossier', () => {
    const root = mjsTmp('sous-dossier-build')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'outils'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs' }))
    writeFileSync(join(root, 'src', 'salut.mjs'), '<p>salut</p>\n')
    const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', join(root, 'outils')], { cwd: repoRoot, encoding: 'utf-8', timeout: 120000 })
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''))
    assert.ok(existsSync(join(root, 'public', 'modularjs', 'bundle.js')), 'manifeste à côté de la config')
    assert.equal(existsSync(join(root, 'outils', 'public')), false, 'rien écrit dans le sous-dossier')
  })

  it('par l\'API, depuis un sous-dossier du projet : chaque chemin non donné part du dossier de la config', () => {
    const root = mjsTmp('sous-dossier-api')
    mkdirSync(join(root, 'outils'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), '{}')
    const b = depuis(join(root, 'outils'), () => new Bundler({})) as any
    assert.equal(b.sourceDir, join(root, 'app', 'modularjs'))
    assert.equal(b.outputDir, join(root, 'public', 'modularjs'))
    assert.equal(b.manifestPath, join(root, 'public', 'modularjs', 'bundle.js'))
    assert.equal(b.stylesheetsDir, join(root, 'app', 'modularjs', 'styles'))
    assert.equal(b.manifestExternal, join(root, 'app', 'modularjs', 'manifest.coffee'))
  })

  it('témoin : sans config, les chemins non donnés partent du dossier courant ; un chemin donné aussi', () => {
    const root = mjsTmp('sous-dossier-sans-config')
    mkdirSync(join(root, 'outils'), { recursive: true })
    const b = depuis(join(root, 'outils'), () => new Bundler({ outputDir: 'sortie' })) as any
    assert.equal(b.sourceDir, join(root, 'outils', 'app', 'modularjs'))
    assert.equal(b.outputDir, join(root, 'outils', 'sortie'))
    assert.equal(b.manifestPath, join(root, 'outils', 'public', 'modularjs', 'bundle.js'))
  })
})
