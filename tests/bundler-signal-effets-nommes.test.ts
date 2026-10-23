// Un effet choisi par une variable (`*delta(fx: $effet)`) fait livrer le fichier de chaque effet qu'elle
// peut nommer. Le signal vient de la POSE compilée de l'effet (sa règle de réglage `["e", …]`, dernier
// argument de `µ._mjs_fx(…)` / `µ._mjs_fxSet(…)`), jamais d'un texte qui lui ressemble ailleurs dans le
// code : un JSON ordinaire (`$data = {"fr":["e","x"]}`) ne fait pas livrer une trentaine de fichiers.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, FX_NAMED } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const JSON_DONNEES = '<script>\n$data = {"fr":["e","x"]}\n</script>\n<p>{$data.fr}</p>\n'
const EFFET_NOMME  = '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>\n'

async function signaux(source: string): Promise<Set<string>> {
  return scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)
}

async function fichiersEffets(prefixe: string, source: string): Promise<string[]> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'carte.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return readdirSync(outDir).filter(f => /^mjs_fx_/.test(f))
}

describe('signal des effets nommés par une variable', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un JSON de script qui ressemble à la règle d\'un réglage ne donne pas le signal', async () => {
    assert.equal((await signaux(JSON_DONNEES)).has(FX_NAMED), false)
    assert.equal((await signaux(JSON_DONNEES + '<b *neon(#0ff)>y</b>\n')).has(FX_NAMED), false, 'même avec un autre effet posé')
  })

  it('une pose dont un réglage est tenu par une variable d\'effet donne le signal', async () => {
    assert.equal((await signaux(EFFET_NOMME)).has(FX_NAMED), true)
    assert.equal((await signaux('<script>\n$fx = \'none\'\n$data = {"fr":["e","x"]}\n</script>\n<span *delta(fx: $fx)>{$data.fr}</span>\n')).has(FX_NAMED), true, 'avec le JSON dans le même composant')
  })

  it('en construction : le JSON seul ne fait livrer aucun fichier d\'effet, l\'effet nommé fait livrer ceux qu\'il peut nommer', async () => {
    assert.deepEqual(await fichiersEffets('signal-json', JSON_DONNEES), [])
    const nommes = await fichiersEffets('signal-nomme', EFFET_NOMME)
    assert.ok(nommes.length > 5, `les fichiers des effets nommables : ${nommes.length}`)
  })
})
