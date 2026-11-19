// une commande inconnue sans voisine proche (`mjs zzzz`) fait lister les commandes du CLI : la liste, en français comme en anglais, est
// celle de `mjs --help`, dans le même ordre ; une commande retirée ou renommée n'y reste pas, une commande ajoutée y entre
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')
const runCli   = (args: string[]) => spawnSync(tsxBin, [cliPath, ...args], { cwd: repoRoot, encoding: 'utf-8' })

// les commandes d'une ligne « Commandes : a, b, c — voir … »
const liste = (ligne: string): string[] => ligne.replace(/^[^:]*:\s*/, '').replace(/\s+—.*$/, '').split(',').map(c => c.trim())

describe('mjs — une commande inconnue fait lister les commandes de `mjs --help`', function () {
  this.timeout(60000)
  const aide = [...runCli(['--help']).stdout.matchAll(/^ {2}mjs ([a-z]+)\s/gm)].map(m => m[1])

  it('`mjs --help` nomme des commandes', function () {
    assert.ok(aide.length >= 5, aide.join(', '))
  })

  it('`mjs zzzz` : code 1, la liste affichée est celle de l\'aide', function () {
    const r = runCli(['zzzz'])
    assert.equal(r.status, 1, r.stdout + r.stderr)
    const ligne = r.stderr.split('\n').find(l => /Commandes :/.test(l))
    assert.ok(ligne, r.stderr)
    assert.deepEqual(liste(ligne!), aide)
  })

  it('le texte anglais nomme les mêmes commandes que le texte français', function () {
    assert.deepEqual(liste(en['cli.command-see-help'] as string), aide)
    assert.deepEqual(liste(fr['cli.command-see-help'] as string), aide)
  })
})
