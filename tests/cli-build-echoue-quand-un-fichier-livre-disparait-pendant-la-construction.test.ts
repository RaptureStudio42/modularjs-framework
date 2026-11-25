// `mjs build` vérifie à la fin que chaque fichier qu'il a écrit, gardé ou repris du cache est encore là : un autre programme (le balai
// d'une série de tests, une seconde construction, un nettoyage) peut effacer la sortie pendant qu'elle tourne, et les dossiers se
// recréent sans rien dire. Un fichier livré qui manque fait échouer la construction (code 1), le message le nomme, dit la cause probable
// et le remède ; la construction suivante sous `--cache` remet ce qui manquait. Ce que la construction retire elle-même (ancienne
// empreinte, orphelin purgé) n'est jamais un manque
// l'effacement est fait au bilan de la compilation (`✅ … écrits`), avant le prérendu, la purge et la fin de la commande : aucune attente

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const out    = (dir: string): string[] => ['--output', dir, '--manifest', join(dir, 'bundle.js')]

interface Plan { files?: string[], dir?: string, names?: string, emptied?: string }

// deux composants, dont un qui cite une classe globale (sortie pour Node : `node/Outils.js`), et un dossier node_modules (le cache s'y écrit)
function project(label: string): string {
  const root = mjsTmp(label)
  write(join(root, 'app/modularjs/accueil.mjs'), '<script>\n$titre = \'accueil\'\n</script>\n<h1>{$titre}</h1>\n<mjs-outil></mjs-outil>\n')
  write(join(root, 'app/modularjs/outil.mjs'), '<button @click={µOutils.un()}>un</button>\n')
  write(join(root, 'app/modularjs/Outils.class.mjs'), 'class Outils\n  un = -> 1\n')
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// module chargé avant la commande : au bilan de la compilation, retire les fichiers nommés (chemins entiers, ou noms du dossier `dir`
// qui répondent au motif `names`) ou vide le dossier `emptied` (retiré puis recréé), et inscrit chaque chemin retiré dans `witness`
function eraser(plan: Plan, witness: string): string {
  const source = [
    'import fs from \'node:fs\'',
    'import path from \'node:path\'',
    `const plan    = ${JSON.stringify(plan)}`,
    `const witness = ${JSON.stringify(witness)}`,
    'const log     = console.log',
    'let done      = false',
    'const erase   = f => { fs.rmSync(f, { recursive: true }); fs.appendFileSync(witness, f + \'\\n\') }',
    'console.log = function (...args) {',
    '  if (!done && args.some(a => typeof a === \'string\' && /✅ \\d+ fichiers? écrits?/.test(a))) {',
    '    done = true',
    '    for (const f of plan.files ?? []) erase(f)',
    '    if (plan.names) for (const n of fs.readdirSync(plan.dir)) if (new RegExp(plan.names).test(n)) erase(path.join(plan.dir, n))',
    '    if (plan.emptied) { erase(plan.emptied); fs.mkdirSync(plan.emptied) }',
    '  }',
    '  return log.apply(this, args)',
    '}',
  ].join('\n')
  return 'data:text/javascript,' + encodeURIComponent(source)
}

// construction dont une partie de la sortie est effacée pendant qu'elle tourne : son code, sa sortie, les chemins effacés
function buildErased(root: string, plan: Plan, args: string[] = []): { status: number, out: string, erased: string[] } {
  const witness = join(root, 'effaces.txt')
  const run     = spawnSync(process.execPath, ['--import', eraser(plan, witness), MJS, 'build', '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  return { status: run.status ?? -1, out: `${run.stdout ?? ''}\n${run.stderr ?? ''}`, erased: existsSync(witness) ? readFileSync(witness, 'utf-8').split('\n').filter(Boolean) : [] }
}

const CAUSE = /Cause probable : un autre programme a effacé une partie de la sortie pendant la construction \(une série de tests, une seconde construction en même temps, un nettoyage\)\. Relancez la construction\./

describe('mjs build : un fichier livré qui disparaît pendant la construction la fait échouer', function () {
  this.timeout(300_000)

  it('classe globale : son module pour Node effacé pendant la construction, échec et message qui le nomme', function () {
    const root  = project('garde-fin-classe')
    const place = join(root, 'public/modularjs')
    const run   = buildErased(root, { files: [join(place, 'node/Outils.js')] })
    assert.deepEqual(run.erased, [join(place, 'node/Outils.js')], run.out)
    assert.equal(run.status, 1, run.out)
    assert.match(run.out, /❌ 1 fichier de cette construction manque à la fin :/)
    assert.ok(run.out.includes(`   ${join('public/modularjs', 'node', 'Outils.js')}\n`), run.out)
    assert.match(run.out, CAUSE)
  })

  it('sortie web : le fichier d\'un composant effacé pendant la construction, échec et message qui le nomme', function () {
    const root  = project('garde-fin-web')
    const place = join(root, 'public/modularjs')
    const run   = buildErased(root, { dir: place, names: '^outil-[0-9a-z]{5}\\.js$' })
    assert.equal(run.erased.length, 1, run.out)
    assert.equal(run.status, 1, run.out)
    assert.match(run.out, /❌ 1 fichier de cette construction manque à la fin :/)
    assert.ok(run.out.includes(`   ${relative(root, run.erased[0])}\n`), run.out)
    assert.match(run.out, CAUSE)
  })

  it('dossier de sortie effacé puis recréé vide : échec, le nombre de fichiers manquants et les dix premiers', function () {
    const root  = project('garde-fin-dossier')
    const place = join(root, 'public/modularjs')
    const run   = buildErased(root, { emptied: place })
    assert.deepEqual(run.erased, [place], run.out)
    assert.deepEqual(readdirSync(place), [], 'personne ne réécrit la sortie après l\'effacement')
    assert.equal(run.status, 1, run.out)
    const count = Number(/❌ (\d+) fichiers de cette construction manquent à la fin :/.exec(run.out)?.[1] ?? 0)
    assert.ok(count >= 5, run.out)
    for (const name of ['bundle.js', join('node', 'Outils.js')]) assert.ok(run.out.includes(`   ${join('public/modularjs', name)}\n`), run.out)
    const listed = run.out.split('\n').filter(l => l.startsWith(`   ${join('public', 'modularjs')}`))
    assert.equal(listed.length, Math.min(count, 10), run.out)
    if (count > 10) assert.ok(run.out.includes(`… et ${count - 10} autre`), run.out)
    assert.match(run.out, CAUSE)
  })

  it('--cache : la construction suivante remet ce qui manquait, réussit, sortie égale à une construction complète', function () {
    const root  = project('garde-fin-cache')
    const place = join(root, 'public/modularjs')
    const first = buildErased(root, { files: [join(place, 'node/Outils.js')], dir: place, names: '^accueil-[0-9a-z]{5}\\.js$' }, ['--cache'])
    assert.equal(first.erased.length, 2, first.out)
    assert.equal(first.status, 1, first.out)
    assert.match(first.out, /❌ 2 fichiers de cette construction manquent à la fin :/)
    for (const f of first.erased) assert.ok(first.out.includes(`   ${relative(root, f)}\n`), first.out)
    const again = build(root, ['--cache'])
    assert.equal(again.status, 0, again.out)
    assert.doesNotMatch(again.out, /manquent? à la fin/)
    for (const f of first.erased) assert.ok(existsSync(f), `${f} n'est pas remis : ${again.out}`)
    assert.ok(again.served > 0, again.out)
    const full = build(root, out(join(root, 'complet')))
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(place, join(root, 'complet')), [])
  })

  it('--cache, construction toute reprise du cache : le manifeste resté identique, effacé pendant la construction, est nommé', function () {
    const root  = project('garde-fin-manifeste')
    const place = join(root, 'public/modularjs')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const again = buildErased(root, { files: [join(place, 'bundle.js')] }, ['--cache'])
    assert.deepEqual(again.erased, [join(place, 'bundle.js')], again.out)
    assert.match(again.out, /^cache : \d+ fichiers? repris, 0 recompilés?$/m)
    assert.equal(again.status, 1, again.out)
    assert.match(again.out, /❌ 1 fichier de cette construction manque à la fin :/)
    assert.ok(again.out.includes(`   ${join('public/modularjs', 'bundle.js')}\n`), again.out)
  })

  it('ancienne empreinte et orphelin retirés par la construction elle-même : aucune fausse alerte', function () {
    const root  = project('garde-fin-retrait')
    const place = join(root, 'public/modularjs')
    write(join(root, 'app/modularjs/note.mjs'), '<p>note</p>\n')
    const first = build(root, [])
    assert.equal(first.status, 0, first.out)
    const old  = readdirSync(place).find(n => /^accueil-[0-9a-z]{5}\.js$/.test(n))!
    const note = readdirSync(place).find(n => /^note-[0-9a-z]{5}\.js$/.test(n))!
    assert.ok(old !== undefined && note !== undefined, readdirSync(place).join(', '))
    write(join(root, 'app/modularjs/accueil.mjs'), '<script>\n$titre = \'bienvenue\'\n</script>\n<h1>{$titre}</h1>\n<mjs-outil></mjs-outil>\n')
    rmSync(join(root, 'app/modularjs/note.mjs'))
    const second = build(root, [])
    assert.equal(second.status, 0, second.out)
    assert.ok(!existsSync(join(place, old)), `ancienne empreinte encore là : ${old}`)
    assert.ok(!existsSync(join(place, note)), `orphelin encore là : ${note}`)
    assert.ok(readdirSync(place).some(n => /^accueil-[0-9a-z]{5}\.js$/.test(n) && n !== old), readdirSync(place).join(', '))
    assert.doesNotMatch(second.out, /manquent? à la fin/)
  })
})
