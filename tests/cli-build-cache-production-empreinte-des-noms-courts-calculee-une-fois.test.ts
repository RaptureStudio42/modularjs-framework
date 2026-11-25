// `mjs build --prod --cache` repris sur place sans changement : l'empreinte du cache des noms courts, qui situe chaque fichier dans la
// suite des minifications, n'est calculée qu'une fois quand aucun fichier n'y change rien, au lieu d'une fois par fichier ; la suite
// gardée dans le cache (l'empreinte avant chaque fichier) et la sortie restent les mêmes

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { build, files, write } from './helpers/construction-cache.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

// six composants, chacun avec son état (des propriétés internes que la minification raccourcit), et un dossier node_modules
function project(label: string): string {
  const root = mjsTmp(label)
  for (const name of ['un', 'deux', 'trois', 'quatre', 'cinq', 'six']) write(join(root, `app/modularjs/${name}.mjs`), `<script>\n$n = 1\n$titre = '${name}'\n</script>\n<button @click={$n++}>{$titre} {$n}</button>\n`)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// module chargé avant la commande : chaque empreinte du cache des noms courts (le texte haché est la liste triée de ses paires,
// `[["…`, ou `[]` vide) ajoute une ligne à `file`
function digestCounter(file: string): string {
  const source = [
    'import crypto from \'node:crypto\'',
    'import { appendFileSync } from \'node:fs\'',
    'import { syncBuiltinESMExports } from \'node:module\'',
    'const createHash = crypto.createHash',
    'crypto.createHash = function (...args) {',
    '  const hash   = createHash.apply(this, args)',
    '  const update = hash.update',
    `  hash.update  = function (data, ...rest) { if (typeof data === 'string' && (data === '[]' || data.startsWith('[["'))) appendFileSync(${JSON.stringify(file)}, 'empreinte\\n'); return update.call(this, data, ...rest) }`,
    '  return hash',
    '}',
    'syncBuiltinESMExports()',
  ].join('\n')
  return 'data:text/javascript,' + encodeURIComponent(source)
}

// trace de la suite des minifications gardée dans le fichier de la clé du cache : fichier → empreinte avant lui
function trail(root: string): string {
  const dir = join(root, 'node_modules/.cache/mjs/build')
  const key = readdirSync(dir).filter(f => /^[0-9a-f]{16}\.json$/.test(f))
  assert.equal(key.length, 1, key.join(', '))
  return JSON.stringify((JSON.parse(readFileSync(join(dir, key[0]), 'utf-8')).trail ?? []).map(([file, step]: [string, { before: string }]) => [file, step.before]))
}

describe('mjs build --prod --cache : empreinte des noms courts calculée une fois', function () {
  this.timeout(300_000)

  it('reprise sur place sans changement : une seule empreinte, même suite gardée, même sortie', function () {
    const root  = project('cache-empreinte-noms-courts')
    const place = join(root, 'public/modularjs')
    for (const pass of ['à froid', 'repris']) {
      const done = build(root, ['--prod', '--cache'])
      assert.equal(done.status, 0, `${pass} :\n${done.out}`)
    }
    const before = files(place)
    const steps  = trail(root)
    assert.ok(JSON.parse(steps).length >= 6, steps)
    const file = join(root, 'empreintes.txt')
    const run  = spawnSync(process.execPath, ['--import', digestCounter(file), MJS, 'build', '--root', root, '--prod', '--cache'], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
    const out  = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
    assert.equal(run.status, 0, out)
    assert.match(out, /^cache : \d+ fichiers repris, 0 recompilé$/m, out)
    const counted = readFileSync(file, 'utf-8').split('\n').filter(Boolean).length
    assert.equal(counted, 1, `empreintes du cache des noms courts : ${counted}`)
    assert.equal(trail(root), steps, 'la suite gardée (empreinte avant chaque fichier) a changé')
    const after = files(place)
    assert.deepEqual([...after.keys()], [...before.keys()])
    for (const [rel, data] of before) assert.ok(data.equals(after.get(rel)!), `différent : ${rel}`)
  })
})
