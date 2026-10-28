// Option « Précédent » des ancres : `"anchorHistory": true` dans mjs.config.json fait de chaque ancre suivie une entrée
// d'historique (la navigation lit `µ._anchorHistory` à chaque clic d'ancre). La construction n'écrit la ligne qu'avec la clé
// à true ; sans elle, la page reste une vraie page. Une valeur qui n'est pas un booléen est refusée, comme `csp`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

function projet(config: Record<string, unknown>): string {
  const racine = mjsTmp('anchor-history')
  mkdirSync(join(racine, 'src'), { recursive: true })
  writeFileSync(join(racine, 'src', 'page-app.mjs'), '<p><a href="#a">a</a></p>')
  writeFileSync(join(racine, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', runtime: ['router', 'ujs'], ...config }))
  return racine
}

async function manifeste(config: Record<string, unknown>): Promise<string> {
  const racine = projet(config)
  const trouve = findConfig(racine)!
  const b      = new Bundler(resolveBundlerOpts(trouve.config, trouve.configDir))
  const stats  = await b.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(racine, 'out', 'bundle.js'), 'utf-8')
}

describe('config — `anchorHistory` (chaque ancre, une entrée d\'historique)', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('`"anchorHistory": true` : le manifeste pose `µ._anchorHistory = true;`', async () => {
    assert.match(await manifeste({ anchorHistory: true }), /µ\._anchorHistory = true;/)
  })

  it('sans la clé, ou à false : rien n\'est posé (une vraie page)', async () => {
    assert.doesNotMatch(await manifeste({}), /_anchorHistory/)
    assert.doesNotMatch(await manifeste({ anchorHistory: false }), /_anchorHistory/)
  })

  it('une valeur qui n\'est pas un booléen est refusée et nommée', () => {
    for (const valeur of ['oui', 1, null, {}]) {
      const racine = projet({ anchorHistory: valeur })
      assert.throws(() => findConfig(racine), /anchorHistory doit être un booléen/)
    }
  })
})
