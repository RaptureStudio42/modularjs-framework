// *spoiler lit son libellé (la balise comme un bouton, le temps où le texte est caché) par l'aide commune des effets
// µ._mjs_fxLabel (runtime/mjs_fx_toollabel.ts), comme *guard, *offline et *loader : un seul code pour la clé du projet, la table
// du framework et la langue de la page, et le build embarque l'aide avec lui (bundler/fx-tools.ts, outil fx_toollabel)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FX_TOOLS } from '../src/bundler/fx-tools.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

describe('effets — le libellé dans la langue de la page passe par l\'aide commune', () => {
  it('*spoiler ne relit pas lui-même le groupe fx des libellés : il passe par µ._mjs_fxLabel', () => {
    const src = readFileSync(join(RUNTIME, 'mjs_fx_spoiler.ts'), 'utf8')
    assert.doesNotMatch(src, /_mjs_label\(\s*'fx'/)
    assert.match(src, /µ\._mjs_fxLabel\('spoiler'\)/)
  })

  it('*spoiler embarque l\'aide commune du libellé', () => {
    assert.ok(FX_TOOLS.fx_toollabel.effects.includes('fx_spoiler'), 'fx_spoiler absent de fx_toollabel')
  })
})
