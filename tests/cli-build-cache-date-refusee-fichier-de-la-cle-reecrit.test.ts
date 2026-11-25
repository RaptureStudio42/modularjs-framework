// `mjs build --cache` : sans changement, la construction avance seulement la date du fichier de la clé du cache. Quand ce fichier
// appartient à un autre utilisateur (cache partagé entre deux comptes), le système refuse de changer sa date (EPERM) : la construction
// le réécrit alors comme un fichier changé, comme le faisaient les versions qui le réécrivaient à chaque fois, au lieu de dire « cache
// non écrit » et de sauter la trace du passage et le ménage des anciennes clés. Le refus est simulé dans le processus de `mjs` par un
// module chargé d'avance (`--import`), le seul moyen sans changer de compte

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

// refus de dater le fichier d'une clé du cache, comme pour un fichier d'un autre utilisateur ; les autres fichiers se datent comme avant
const REFUS = `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const vrai = fs.utimesSync
fs.utimesSync = function (path, ...rest) {
  if (/[\\\\/]\\.cache[\\\\/]mjs[\\\\/]build[\\\\/][0-9a-f]{16}\\.json$/.test(String(path))) {
    const error = new Error('EPERM: operation not permitted, utime ' + String(path))
    error.code  = 'EPERM'
    throw error
  }
  return vrai.call(this, path, ...rest)
}
syncBuiltinESMExports()
`

function project(label: string): string {
  const root = mjsTmp(label)
  for (const name of ['accueil', 'carte', 'pied']) write(join(root, `app/modularjs/${name}.mjs`), `<script>\n$n = 1\n</script>\n<p class="${name}">${name} {$n}</p>\n`)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

function keyFile(root: string): { ino: number, text: string, last: number } {
  const dir  = join(root, 'node_modules/.cache/mjs/build')
  const keys = readdirSync(dir).filter(f => /^[0-9a-f]{16}\.json$/.test(f))
  assert.equal(keys.length, 1, keys.join(', '))
  const path = join(dir, keys[0])
  return { ino: statSync(path).ino, text: readFileSync(path, 'utf-8'), last: statSync(join(dir, 'last.json')).mtimeMs }
}

describe('mjs build --cache : date du fichier de la clé refusée', function () {
  this.timeout(300_000)

  for (const prod of [false, true]) {
    it(`${prod ? 'production' : 'développement'} : le fichier de la clé est réécrit, sans « cache non écrit »`, function () {
      const root = project(`cache-date-refusee${prod ? '-prod' : ''}`)
      const args = prod ? ['--prod', '--cache'] : ['--cache']
      for (const pass of ['à froid', 'repris une fois']) {
        const done = build(root, args)
        assert.equal(done.status, 0, `${pass} :\n${done.out}`)
      }
      const before = keyFile(root)
      const refus  = join(root, 'refus-de-dater.mjs')
      writeFileSync(refus, REFUS)
      const options = process.env.NODE_OPTIONS
      process.env.NODE_OPTIONS = `${options ?? ''} --import=${pathToFileURL(refus).href}`.trim()
      let again: ReturnType<typeof build>
      try {
        again = build(root, args)
      }
      finally {
        if (options === undefined) delete process.env.NODE_OPTIONS
        else process.env.NODE_OPTIONS = options
      }
      assert.equal(again.status, 0, again.out)
      assert.match(again.out, /^cache : \d+ fichiers repris, 0 recompilé$/m, again.out)
      assert.doesNotMatch(again.out, /n'a pas pu être écrit|could not be written/, again.out)
      const after = keyFile(root)
      assert.equal(after.text, before.text, 'contenu du fichier de la clé changé sans aucun changement des sources')
      assert.notEqual(after.ino, before.ino, 'date refusée : le fichier de la clé doit être réécrit')
      assert.ok(after.last > before.last, 'last.json non écrit')
    })
  }
})
