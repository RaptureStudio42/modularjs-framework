// Commande mal tapée : `mjs biuld`, `mjs serv`… lançaient un BUILD de développement complet et
// sortaient en 0 (simple avertissement) — sur un serveur de production, `mjs serv` écrasait la
// sortie servie. Désormais : message, commande la plus proche suggérée, code 1, rien d'écrit.
// `--root` absent ou fichier : le message disait « impossible d'écrire » avec le dossier COURANT ;
// il nomme maintenant la racine demandée.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

function runCli(args: string[], cwd = repoRoot) {
  return spawnSync(tsxBin, [cliPath, ...args], { cwd, encoding: 'utf-8' })
}

function projet(): string {
  const root = mjsTmp('cli-commande-inconnue')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'salut.mjs'), '<p>salut</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out' }))
  return root
}

describe('mjs — commande inconnue et racine absente', function () {
  this.timeout(60000)

  it('`mjs biuld` : code 1, suggestion « build », aucun fichier écrit', function () {
    const root = projet()
    const r = runCli(['biuld', '--root', root])
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /biuld/)
    assert.match(r.stderr, /mjs build/)
    assert.equal(existsSync(join(root, 'out')), false, 'aucun build ne doit avoir eu lieu')
  })

  it('`mjs serv` : suggestion « serve »', function () {
    const r = runCli(['serv', '--root', projet()])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /mjs serve\b/)
  })

  it('`--root` inexistant ou fichier : message qui nomme la racine demandée', function () {
    const base = mjsTmp('cli-racine-absente')
    const absent = join(base, 'inexistant')
    const fichier = join(base, 'fichier.txt')
    writeFileSync(fichier, 'x')
    for (const racine of [absent, fichier]) {
      const r = runCli(['build', '--root', racine])
      assert.equal(r.status, 1)
      assert.ok(r.stderr.includes(racine), r.stderr)
      assert.doesNotMatch(r.stderr, /impossible d'écrire/)
    }
  })
})
