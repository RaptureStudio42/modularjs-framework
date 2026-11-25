// `mjs build --cache` : une classe globale reprise du cache sur disque ne se recompile pas. Son module côté serveur (`node/<Classe>.js`,
// nom fixe) est gardé sous `files/` avec l'empreinte de son contenu, et remis à sa place quand il manque ; la sortie reste celle d'une
// construction complète. Un autre framework change la clé du cache : la classe se recompile

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const FRAMEWORK = fileURLToPath(new URL('..', import.meta.url))
const CONFIG    = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const out       = (dir: string): string[] => ['--output', dir, '--manifest', join(dir, 'bundle.js')]

// un composant qui cite une classe globale, et un dossier node_modules (le cache s'y écrit)
function project(label: string): string {
  const root = mjsTmp(label)
  write(join(root, 'app/modularjs/outil.mjs'), '<button @click={µOutils.un()}>un</button>\n')
  write(join(root, 'app/modularjs/Outils.class.mjs'), 'class Outils\n  un = -> 1\n')
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// copie du framework construit (`dist/`), ses sources et ses paquets liés : un fichier de `dist/` changé en fait une autre version
function frameworkCopy(root: string): string {
  const copy = join(root, 'framework')
  assert.ok(existsSync(join(FRAMEWORK, 'dist/cli.js')), 'framework non construit : npm run build:self')
  cpSync(join(FRAMEWORK, 'bin'), join(copy, 'bin'), { recursive: true })
  cpSync(join(FRAMEWORK, 'dist'), join(copy, 'dist'), { recursive: true })
  cpSync(join(FRAMEWORK, 'package.json'), join(copy, 'package.json'))
  symlinkSync(join(FRAMEWORK, 'src'), join(copy, 'src'))
  symlinkSync(join(FRAMEWORK, 'node_modules'), join(copy, 'node_modules'))
  return join(copy, 'bin/mjs')
}

// bilan d'une construction lancée par le framework donné : son code, sa sortie, sa ligne de cache
function buildWith(mjs: string, root: string, args: string[]): { status: number, out: string, line: string } {
  const run  = spawnSync(process.execPath, [mjs, 'build', '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  return { status: run.status ?? -1, out: text, line: text.split('\n').map(l => l.trim()).filter(l => /^cache( :| écarté)/.test(l)).join(' | ') }
}

describe('mjs build --cache : classe reprise sans recompiler son module côté serveur', function () {
  this.timeout(300_000)

  it('reconstruite sur place sans changement : aucune recompilation, sortie égale à une construction complète', function () {
    const root  = project('cache-classe-reprise')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const again = build(root, ['--cache'])
    assert.equal(again.status, 0, again.out)
    assert.equal(again.cold, 0, `classe recompilée alors que rien n'a changé :\n${again.out}`)
    const full = build(root, out(join(root, 'complet')))
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(join(root, 'public/modularjs'), join(root, 'complet')), [])
  })

  it('production, dossier de sortie neuf : node/<Classe>.js remis depuis le cache, aucune recompilation, sortie égale', function () {
    const root  = project('cache-classe-reprise-prod')
    const first = build(root, ['--prod', '--cache', ...out(join(root, 'runs/a'))])
    assert.equal(first.status, 0, first.out)
    const fresh = build(root, ['--prod', '--cache', ...out(join(root, 'runs/b'))])
    assert.equal(fresh.status, 0, fresh.out)
    assert.equal(fresh.cold, 0, `classe recompilée dans un dossier neuf :\n${fresh.out}`)
    const full = build(root, ['--prod', ...out(join(root, 'runs/c'))])
    assert.equal(full.status, 0, full.out)
    assert.ok(existsSync(join(root, 'runs/c/node/Outils.js')))
    assert.deepEqual(gaps(join(root, 'runs/b'), join(root, 'runs/c')), [])
  })

  it('node/<Classe>.js effacé de la sortie : remis tel quel depuis le cache, sans recompiler', function () {
    const root  = project('cache-classe-node-efface')
    const place = join(root, 'public/modularjs/node/Outils.js')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const before = readFileSync(place)
    rmSync(place)
    const again = build(root, ['--cache'])
    assert.equal(again.status, 0, again.out)
    assert.ok(existsSync(place), `node/Outils.js non remis :\n${again.out}`)
    assert.ok(before.equals(readFileSync(place)), 'node/Outils.js remis avec un autre contenu')
    assert.equal(again.cold, 0, `classe recompilée pour remettre son module :\n${again.out}`)
  })

  it('autre version du framework : la clé du cache change, la classe se recompile', function () {
    const root  = project('cache-classe-autre-framework')
    const mjs   = frameworkCopy(root)
    const first = buildWith(mjs, root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const again = buildWith(mjs, root, ['--cache'])
    assert.match(again.line, /^cache : \d+ fichiers? repris, 0 recompilé$/, again.out)
    appendFileSync(join(root, 'framework/dist/cli.js'), '\n// autre version\n')
    const other = buildWith(mjs, root, ['--cache'])
    assert.equal(other.status, 0, other.out)
    const all = /construction complète \((\d+) fichiers compilés\)$/.exec(first.line)
    assert.ok(all, first.out)
    assert.equal(other.line, `cache écarté — nouvelle version du framework : construction complète (${all[1]} fichiers compilés)`, other.out)
    const full = buildWith(mjs, root, out(join(root, 'complet')))
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(join(root, 'public/modularjs'), join(root, 'complet')), [])
  })
})
