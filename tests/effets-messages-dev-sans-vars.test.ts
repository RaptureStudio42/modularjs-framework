// Messages de réglage d'effet en développement — un réglage tenu par une variable (`*neon(size: $s)`)
// est passé par sa règle : une valeur ramenée ou refusée le dit dans la console, en développement,
// selon la clé `types` du projet (`µ._typesMode`, 'warn' par défaut). Un projet qui pose des effets
// sans écrire aucun <vars> y a droit aussi ; en production, rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const NEON = '<script>\n$s = 10\n</script>\n<p *neon(size: $s)>A</p>\n'

async function manifeste(etiquette: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('fx-messages-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...opts })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(root, 'bundle.js'), 'utf-8')
}

describe('messages de réglage d\'effet en développement, dans un projet sans <vars>', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un projet qui pose un effet sans aucun <vars> : le manifeste de développement porte le mode des messages', async () => {
    assert.match(await manifeste('warn', { 'c.mjs': NEON }), /µ\._typesMode = "warn";/)
  })

  it('la clé types du projet vaut aussi pour les effets', async () => {
    assert.match(await manifeste('error', { 'c.mjs': NEON }, { types: 'error' }), /µ\._typesMode = "error";/)
  })

  it('en production, rien', async () => {
    assert.doesNotMatch(await manifeste('prod', { 'c.mjs': NEON }, { env: 'prod' }), /_typesMode/)
  })

  it('un projet sans effet ni <vars> : rien', async () => {
    assert.doesNotMatch(await manifeste('rien', { 'c.mjs': '<script>\n$a = 1\n</script>\n<p>{$a}</p>\n' }), /_typesMode/)
  })
})
