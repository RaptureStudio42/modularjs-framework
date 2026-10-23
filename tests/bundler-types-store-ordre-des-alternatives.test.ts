// Un store vaut pour toute l'appli, sa règle aussi : deux composants qui le déclarent avec deux règles différentes
// font échouer le build. L'ordre des alternatives d'un choix COMPTE : à l'exécution la première règle qui sait
// convertir la valeur l'emporte (3.5 devient 4 avec `int | string`, reste "3.5" avec `string | int` ; "3.5" devient 4
// avec `int | float`, 3.5 avec `float | int`), et le store garde la première règle enregistrée. `int | string` et
// `string | int` sont donc deux règles : un conflit. Seules échappent à l'ordre une liste de valeurs littérales
// (`'a' | 'b'` et `'b' | 'a'`) et les champs d'un objet, qui n'en ont pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const component = (rule: string) => `<vars>\n  $$x  ${rule}\n</vars>\n<p>{$$x}</p>\n`

async function errorsOf(prefix: string, a: string, b: string): Promise<string[]> {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'a.mjs'), component(a))
  writeFileSync(join(srcDir, 'b.mjs'), component(b))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => e.message)
}

const conflicts = (messages: string[]) => messages.filter(m => /a deux règles différentes/.test(m))

describe('stores typés — l\'ordre des alternatives d\'un choix compte, celui d\'une liste de valeurs non', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [a, b] of [['int | string', 'string | int'], ['int | float', 'float | int'], ['int 0..10 | int 5..20', 'int 5..20 | int 0..10'], ['int | string | bool', 'bool | int | string']]) {
    it(`\`${a}\` et \`${b}\` : deux règles, un conflit qui cite les deux règles et les deux fichiers`, async () => {
      const said = conflicts(await errorsOf('store-ordre', a, b))
      assert.equal(said.length, 1, `un conflit attendu : ${JSON.stringify(said)}`)
      assert.ok(said[0].includes(a) && said[0].includes(b), `les deux règles sont citées : ${said[0]}`)
      assert.match(said[0], /a\.mjs/)
      assert.match(said[0], /b\.mjs/)
    })
  }

  it('un choix dans un objet : le même ordre ne compte pas moins', async () => {
    assert.equal(conflicts(await errorsOf('store-ordre-objet', '{ a: int | string, b: bool }', '{ a: string | int, b: bool }')).length, 1)
  })

  it('une liste de valeurs littérales dans un autre ordre, et les champs d\'un objet dans un autre ordre : la même règle', async () => {
    assert.deepEqual(await errorsOf('store-valeurs', '\'a\' | \'b\' | \'c\'', '\'c\' | \'a\' | \'b\''), [])
    assert.deepEqual(await errorsOf('store-champs', '{ a: int, b: bool }', '{ b: bool, a: int }'), [])
    assert.deepEqual(await errorsOf('store-identique', 'int | string', 'int | string'), [])
  })

  it('une vraie différence reste un conflit, une seule fois', async () => {
    assert.equal(conflicts(await errorsOf('store-different', 'int | string', 'int | bool')).length, 1)
    assert.equal(conflicts(await errorsOf('store-simple-different', 'int', 'string')).length, 1)
  })
})
