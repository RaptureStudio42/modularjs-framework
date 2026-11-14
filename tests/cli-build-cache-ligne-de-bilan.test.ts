// `mjs build --cache` : une ligne de bilan à chaque construction (fichiers repris et recompilés), ou la raison d'un cache écarté
// (premier passage, mjs.config.json changé, nouvelle version du framework, options changées, fichier illisible, aucun dossier
// node_modules). Sans `--cache`, rien ne change : aucun dossier de cache, aucune ligne. `--prod --cache` a la même ligne et son propre
// cache, à part de celui du développement. Hors de `mjs build`, l'option est ignorée, et la commande le dit.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const CONFIG = '{ "sourceDir": "app/modularjs", "outputDir": "public/modularjs", "manifestPath": "public/modularjs/bundle.js" }\n'

// un petit projet : trois composants, une configuration, et un dossier node_modules sauf demande contraire
function project(label: string, withModules = true): string {
  const root = mjsTmp(`cache-bilan-${label}`)
  mkdirSync(join(root, 'app/modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), CONFIG)
  writeFileSync(join(root, 'app/modularjs/accueil.mjs'), '<h1>accueil</h1>\n<mjs-carte></mjs-carte>\n')
  writeFileSync(join(root, 'app/modularjs/carte.mjs'), '<p class="c">carte</p>\n')
  writeFileSync(join(root, 'app/modularjs/pied.mjs'), '<footer>pied</footer>\n')
  if (withModules) mkdirSync(join(root, 'node_modules'))
  return root
}

function run(root: string, args: string[], command = 'build'): { status: number, out: string, line: string } {
  const done = spawnSync(process.execPath, [MJS, command, '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  const out  = `${done.stdout ?? ''}\n${done.stderr ?? ''}`
  return { status: done.status ?? -1, out, line: out.split('\n').map(l => l.trim()).filter(l => /^cache( :| écarté)/.test(l)).join(' | ') }
}

const cacheDir = (root: string): string => join(root, 'node_modules/.cache/mjs/build')
const keyFiles = (root: string): string[] => readdirSync(cacheDir(root)).filter(f => /^[0-9a-f]{16}\.json$/.test(f))

describe('mjs build --cache : ligne de bilan', function () {
  this.timeout(180_000)

  it('premier passage, reprise, fichier illisible, nouvelle version du framework, options changées, mjs.config.json changé', function () {
    const root  = project('raisons')
    const last  = join(cacheDir(root), 'dernier.json')
    const first = run(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    assert.match(first.line, /^cache écarté — premier passage : construction complète \(\d+ fichiers compilés\)$/, first.out)
    const again = run(root, ['--cache'])
    assert.match(again.line, /^cache : \d+ fichiers repris, 0 recompilé$/, again.out)
    assert.equal(keyFiles(root).length, 1, readdirSync(cacheDir(root)).join(', '))
    const key = join(cacheDir(root), keyFiles(root)[0])
    writeFileSync(key, '{')
    assert.match(run(root, ['--cache']).line, /^cache écarté — fichier du cache illisible : construction complète/)
    // fichier de la clé absent : la trace du dernier passage dit ce qui a changé
    rmSync(key)
    writeFileSync(last, JSON.stringify({ ...JSON.parse(readFileSync(last, 'utf-8')), framework: 'une version d\'avant' }))
    assert.match(run(root, ['--cache']).line, /^cache écarté — nouvelle version du framework : construction complète/)
    rmSync(key)
    assert.match(run(root, ['--cache']).line, /^cache écarté — options de la construction changées : construction complète/)
    writeFileSync(join(root, 'mjs.config.json'), CONFIG.replace(' }', ', "prune": true }'))
    const config = run(root, ['--cache'])
    assert.equal(config.status, 0, config.out)
    assert.match(config.line, /^cache écarté — mjs.config.json a changé : construction complète \(\d+ fichiers compilés\)$/, config.out)
  })

  it('sans --cache : aucun dossier de cache, aucune ligne', function () {
    const root = project('sans')
    const done = run(root, [])
    assert.equal(done.status, 0, done.out)
    assert.equal(done.line, '', done.out)
    assert.ok(!existsSync(cacheDir(root)), `dossier de cache créé sans --cache : ${cacheDir(root)}`)
  })

  it('--prod --cache : premier passage, puis le cache sert ; une construction de développement ne le reprend pas', function () {
    const root  = project('prod')
    const first = run(root, ['--prod', '--cache'])
    assert.equal(first.status, 0, first.out)
    assert.match(first.line, /^cache écarté — premier passage : construction complète \(\d+ fichiers compilés\)$/, first.out)
    const again = run(root, ['--prod', '--cache'])
    assert.equal(again.status, 0, again.out)
    assert.match(again.line, /^cache : \d+ fichiers repris, 0 recompilé$/, again.out)
    const dev = run(root, ['--cache'])
    assert.equal(dev.status, 0, dev.out)
    assert.match(dev.line, /^cache écarté — options de la construction changées : construction complète/, dev.out)
  })

  it('sans dossier node_modules : construction complète, la ligne le dit, rien n\'est créé', function () {
    const root = project('sans-modules', false)
    const done = run(root, ['--cache'])
    assert.equal(done.status, 0, done.out)
    assert.match(done.line, /^cache écarté — aucun dossier node_modules : construction complète/, done.out)
    assert.ok(!existsSync(join(root, 'node_modules')), 'dossier node_modules créé par --cache')
  })

  it('--cache hors de mjs build : ignoré, et dit', function () {
    const root = project('check')
    const done = run(root, ['--cache'], 'check')
    assert.match(done.out, /--cache ignoré : l'option ne vaut que pour « mjs build » \(commande : « mjs check »\)\./, done.out)
    assert.equal(done.line, '', done.out)
    assert.ok(!existsSync(cacheDir(root)), 'dossier de cache créé par mjs check')
  })
})
