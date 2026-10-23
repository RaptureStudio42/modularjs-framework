// une entry `.civet` BRUTE (compileRawCivetFile, src/cli/server-entry.ts) refuse les directives MJS, mais une propriété suivie d'un
// mot-opérateur (`@lang or "fr"`, `@display if @display?`) est du Civet ordinaire (`this.lang || "fr"`) : elle était refusée comme
// une directive, quand la même ligne passait dans un `.server.mjs`. Même règle pour les deux

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { compileRawCivetFile } from '../src/cli/server-entry.js'
import { mjsTmp } from './helpers/tmp.js'

const dossiers: string[] = []
function racine(prefixe: string): string {
  const root = mjsTmp(prefixe)
  dossiers.push(root)
  mkdirSync(join(root, 'node_modules'))
  return root
}
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }) })

async function compiler(prefixe: string, source: string): Promise<any> {
  const root  = racine(prefixe)
  const entry = join(root, 'brut.civet')
  writeFileSync(entry, source)
  return import(await compileRawCivetFile(entry, root))
}

describe("cli/server-entry — entry '.civet' brute : une propriété suivie d'un mot-opérateur n'est pas une directive", function () {
  this.timeout(20000)

  it('`@lang or "fr"` en tête de ligne compile', async () => {
    const mod = await compiler('civet-brut-op1', 'export default ->\n  @lang or "fr"\n')
    assert.equal(mod.default.call({ lang: 'en' }), 'en')
    assert.equal(mod.default.call({}), 'fr')
  })

  it('`@display if @display?` compile', async () => {
    const mod = await compiler('civet-brut-op2', 'export default ->\n  @display if @display?\n')
    assert.equal(mod.default.call({ display: 'bloc' }), 'bloc')
  })

  it('`@lang fr` reste refusé', async () => {
    await assert.rejects(compiler('civet-brut-op3', '@lang fr\n\nexport default 1\n'), /@lang/)
  })
})
