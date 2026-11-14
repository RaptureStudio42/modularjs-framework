// "languages": { "template": "js" } est refusé à la lecture de la configuration : le gabarit se lit toujours en Civet. Le message dit
// quoi faire (retirer le réglage) et ce qui change pour le JavaScript courant lu en Civet ; `mjs build` s'arrête dessus, en échec. La
// même valeur passée au compilateur par programme (option `templateLang`) est refusée de même, plutôt que lue en Civet sans un mot

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { transpile } from '../src/transpiler/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFUS    = /languages\.template : la valeur « js » n'est plus acceptée[\s\S]*Retirez ce réglage/
const ECARTS   = ['a ? b : c', '(v) => v * 2', '===', '$a / 2', '#{…}']

function projet(languages: Record<string, unknown>): string {
  const root = mjsTmp('gabarit-js-refuse')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'home.mjs'), '<script>\n$n = 1\n</script>\n<p>{$n}</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', languages }, null, 2))
  return root
}

describe('"languages": { "template": "js" } refusé à la lecture de la configuration', function () {
  this.timeout(60000)

  it('la lecture de la configuration lève le refus : retirer le réglage, et ce qui change pour le JavaScript lu en Civet', () => {
    assert.throws(() => findConfig(projet({ template: 'js' })), (err: any) => {
      assert.match(err.message, REFUS)
      for (const ecart of ECARTS) assert.ok(err.message.includes(ecart), `${ecart} absent de :\n${err.message}`)
      return true
    })
  })

  it('mjs build s\'arrête en échec sur le refus, rien n\'est construit', () => {
    const root = projet({ template: 'js' })
    const r    = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`)
    assert.match(r.stderr, REFUS)
    assert.equal(existsSync(join(root, 'public', 'modularjs')), false)
  })

  it('"template": "civet", le défaut, reste accepté', () => {
    assert.doesNotThrow(() => findConfig(projet({ template: 'civet' })))
  })

  it('la même valeur passée au compilateur (option templateLang) est refusée de même', async () => {
    await assert.rejects(transpile('<p>{1}</p>\n', { moduleName: 'essai', templateLang: 'js' } as any), /templateLang : la valeur « js » n'est plus acceptée[\s\S]*Retirez ce réglage/)
  })
})
