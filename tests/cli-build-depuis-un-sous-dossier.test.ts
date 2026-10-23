// `mjs build` lancé depuis un sous-dossier du projet (mjs.config.json trouvé en remontant) : un fichier du projet hors de
// sourceDir que réunit le manifeste externe (`#= require ../../vendor/lib`) est permis, comme depuis la racine. La garde
// « hors du projet » prenait le dossier courant pour racine du projet, pas le dossier de mjs.config.json : la construction
// échouait sur un `vendor/` du projet.
//
// Sous-processus réels : cli.ts appelle `run(process.argv)` à son chargement, l'importer lancerait une vraie CLI.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

describe('mjs build depuis un sous-dossier du projet : fichiers du manifeste externe', function () {
  this.timeout(300000)

  for (const depuis of ['.', 'app']) {
    it(`lancé depuis « ${depuis} » : vendor/lib.js du projet réuni, code 0`, () => {
      const root = mjsTmp('build-sous-dossier')
      mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
      mkdirSync(join(root, 'vendor'), { recursive: true })
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', manifestExternal: 'app/modularjs/manifest.coffee' }))
      writeFileSync(join(root, 'app', 'modularjs', 'carte.mjs'), '<p>carte</p>\n')
      writeFileSync(join(root, 'app', 'modularjs', 'manifest.coffee'), '#= require ../../vendor/lib\n')
      writeFileSync(join(root, 'vendor', 'lib.js'), 'window.LIB_VENDOR = 1\n')
      const r = spawnSync(tsxBin, [cliPath, 'build'], { cwd: join(root, depuis), encoding: 'utf-8', timeout: 240000 })
      assert.equal(r.status, 0, `code ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
      const out = join(root, 'public', 'modularjs')
      const ext = existsSync(out) ? readdirSync(out).find(f => f.startsWith('mjs_external-') && f.endsWith('.js')) : undefined
      assert.ok(ext !== undefined && readFileSync(join(out, ext), 'utf-8').includes('LIB_VENDOR'), 'vendor/lib.js du projet réuni')
    })
  }
})
