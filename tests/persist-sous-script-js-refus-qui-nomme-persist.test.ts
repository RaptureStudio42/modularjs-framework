// `@persist` écrit son code en Civet dans le script du composant : sous `<script lang="js">`, `lang="ts"` ou `lang="coffee"`,
// la construction le refuse en nommant `@persist` et le remède — le refus était une erreur de syntaxe sur du code que
// l'auteur n'a pas écrit, sans dire d'où il venait
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function refus(source: string): Promise<string> {
  const root   = mjsTmp('persist-js')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'cl.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => e.message).join('\n')
}

describe('@persist sous un script JavaScript, TypeScript ou CoffeeScript : le refus nomme @persist', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const lang of ['js', 'ts', 'coffee']) {
    it(`<script lang="${lang}"> avec @persist : le refus nomme @persist et le script en Civet`, async () => {
      const message = await refus(`@persist $n\n<script lang="${lang}">\n$n = 1\n</script>\n<p>{$n}</p>\n`)
      assert.match(message, /@persist demande un script en Civet/)
      assert.match(message, new RegExp(`lang="${lang}"`))
    })
  }

  it('sans lang, @persist se construit', async () => {
    assert.equal(await refus('@persist $n\n<script>\n$n = 1\n</script>\n<p>{$n}</p>\n'), '')
  })
})
