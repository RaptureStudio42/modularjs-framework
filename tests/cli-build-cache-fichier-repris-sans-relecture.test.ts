// `mjs build --cache` : un fichier repris déjà en place n'est ni relu ni recopié depuis `files/` — son nom porte l'empreinte de son
// contenu, la même taille suffit ; une carte (`.map`, nommée d'après son .js) se compare par sa taille, puis par l'empreinte gardée dans
// l'entrée du cache, sans relire `files/`. Un fichier de sortie abîmé à la main sous le même nom et de même taille n'est pas vu par
// `--cache` : `--cache=verify` le voit, et la sortie reçoit celui de la construction complète (code 1)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { PNG, build, gaps, write } from './helpers/construction-cache.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const out    = (dir: string): string[] => ['--output', dir, '--manifest', join(dir, 'bundle.js')]

// deux composants, dont un qui publie une image, et un dossier node_modules (le cache s'y écrit)
function project(label: string): string {
  const root = mjsTmp(label)
  write(join(root, 'app/modularjs/accueil.mjs'), '<script>\n$titre = \'accueil\'\n</script>\n<h1>{$titre}</h1>\n<mjs-photo></mjs-photo>\n')
  write(join(root, 'app/modularjs/photo.mjs'), '<img src="µasset(\'point.png\')" alt="point">\n')
  write(join(root, 'app/modularjs/point.png'), PNG)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// module chargé avant la commande : chaque lecture (`readFileSync`) ou copie (`copyFileSync`) d'un fichier sous `kept` ajoute une
// ligne à `file`
function keptCounter(file: string, kept: string): string {
  const source = [
    'import fs from \'node:fs\'',
    'import { syncBuiltinESMExports } from \'node:module\'',
    'for (const name of [\'readFileSync\', \'copyFileSync\']) {',
    '  const original = fs[name]',
    `  fs[name] = function (path, ...rest) { if (String(path).startsWith(${JSON.stringify(kept + sep)})) fs.appendFileSync(${JSON.stringify(file)}, name + ' ' + path + '\\n'); return original.call(this, path, ...rest) }`,
    '}',
    'syncBuiltinESMExports()',
  ].join('\n')
  return 'data:text/javascript,' + encodeURIComponent(source)
}

// construction avec le cache, les lectures et copies de `files/` relevées
function buildCounted(root: string): { status: number, out: string, kept: string[] } {
  const file = join(root, 'files-lus.txt')
  const run  = spawnSync(process.execPath, ['--import', keptCounter(file, join(root, 'node_modules/.cache/mjs/build/files')), MJS, 'build', '--root', root, '--cache'], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  return { status: run.status ?? -1, out: `${run.stdout ?? ''}\n${run.stderr ?? ''}`, kept: existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [] }
}

describe('mjs build --cache : fichier repris sans relecture', function () {
  this.timeout(300_000)

  it('reconstruite sans changement : aucune lecture ni copie sous files/, sortie égale à une construction complète', function () {
    const root  = project('cache-repris-sans-relecture')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const place = join(root, 'public/modularjs')
    assert.ok(readdirSync(place).some(f => f.endsWith('.js.map')), `une carte au moins : ${readdirSync(place).join(', ')}`)
    assert.ok(readdirSync(place).some(f => /^point-\w+\.png$/.test(f)), `l'image publiée : ${readdirSync(place).join(', ')}`)
    const again = buildCounted(root)
    assert.equal(again.status, 0, again.out)
    assert.deepEqual(again.kept, [], 'fichiers de files/ relus ou recopiés alors que la sortie les a déjà')
    const full = build(root, out(join(root, 'complet')))
    assert.equal(full.status, 0, full.out)
    assert.deepEqual(gaps(place, join(root, 'complet')), [])
  })

  it('carte en place qui diffère de celle de l\'entrée (autre taille, ou même taille) : remise depuis files/', function () {
    const root  = project('cache-repris-carte-changee')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const place = join(root, 'public/modularjs')
    const map   = join(place, readdirSync(place).find(f => /^accueil.*\.js\.map$/.test(f))!)
    const right = readFileSync(map)
    const same  = Buffer.from(right)
    same[same.length - 2] = same[same.length - 2] === 0x41 ? 0x42 : 0x41
    for (const wrong of [Buffer.concat([right, Buffer.from(' ')]), same]) {
      assert.ok(!wrong.equals(right))
      writeFileSync(map, wrong)
      const again = build(root, ['--cache'])
      assert.equal(again.status, 0, again.out)
      assert.ok(readFileSync(map).equals(right), `carte non remise (${wrong.length} octets pour ${right.length})`)
    }
  })

  it('fichier .js abîmé à la main, même nom et même taille : --cache ne le voit pas, --cache=verify le voit et la sortie reçoit le juste', function () {
    const root  = project('cache-repris-abime')
    const first = build(root, ['--cache'])
    assert.equal(first.status, 0, first.out)
    const place = join(root, 'public/modularjs')
    const name  = readdirSync(place).find(f => /^accueil.*\.js$/.test(f))!
    const right = readFileSync(join(place, name))
    const wrong = Buffer.from(right.toString('latin1').replace('accueil', 'accueiL'), 'latin1')
    assert.equal(wrong.length, right.length)
    assert.ok(!wrong.equals(right))
    writeFileSync(join(place, name), wrong)
    const served = build(root, ['--cache'])
    assert.equal(served.status, 0, served.out)
    assert.ok(readFileSync(join(place, name)).equals(wrong), 'le fichier abîmé, de même taille, reste tel quel sous --cache')
    const checked = build(root, ['--cache=verify'])
    assert.equal(checked.status, 1, checked.out)
    assert.match(checked.out, /cache jeté/, checked.out)
    assert.ok(checked.out.includes(name), `le fichier qui diffère est nommé\n${checked.out}`)
    assert.ok(readFileSync(join(place, name)).equals(right), 'la sortie a reçu le fichier de la construction complète')
  })
})
