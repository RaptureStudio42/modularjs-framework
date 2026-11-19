// `"lint": { "multilineString": false }` (ou `true`, ou `"error"`) dans mjs.config.json : la clé reste acceptée, sans effet — une chaîne
// écrite sur plusieurs lignes est lue correctement, la configuration qui l'écrit se lit et le projet se construit sans un mot, ni erreur ni
// avertissement ; une clé inconnue de `lint` reste refusée

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(lint: Record<string, unknown>): string {
  const root = mjsTmp('lint-multiligne')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', lint }))
  writeFileSync(join(root, 'src', 'fiche.mjs'), '<script>\n$s = "un\n# deux\ntrois"\n</script>\n<p>{$s}</p>\n')
  return root
}

describe('lint.multilineString : clé acceptée, sans effet', function () {
  this.timeout(60000)

  for (const valeur of [false, true, 'error']) {
    it(`"multilineString": ${JSON.stringify(valeur)} — la configuration se lit, le projet se construit sans erreur ni avertissement`, async () => {
      const root  = projet({ multilineString: valeur })
      const found = findConfig(root)
      assert.ok(found)
      const b     = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') } as any)
      const stats = await b.compile()
      await b.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [])
      assert.deepEqual(stats.warnings.map(String), [])
    })
  }

  it('témoin : une clé inconnue de `lint` reste refusée', () => {
    assert.throws(() => findConfig(projet({ chaineInconnue: false })))
  })
})
