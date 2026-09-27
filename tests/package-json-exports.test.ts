// package.json (exports) — les points d'entrée publiés du paquet, ceux qu'un consommateur peut
// réellement `import`er par leur nom. `./package.json` en manquait : certains outils (bundlers,
// résolveurs de version) lisent le package.json d'une dépendance via son chemin exporté, pas par
// un accès direct au dossier node_modules/<pkg>/package.json.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg      = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))

describe('package.json — points d\'entrée publiés (exports)', function () {
  it('les 5 points d\'entrée du framework sont déclarés', function () {
    for (const entry of ['.', './cli', './testing', './ws', './mjs-server']) {
      assert.ok(Object.hasOwn(pkg.exports, entry), `point d'entrée manquant : ${entry}`)
    }
  })

  it('./package.json est exporté (lisible par un résolveur sans accès direct au dossier)', function () {
    assert.equal(pkg.exports['./package.json'], './package.json')
  })
})
