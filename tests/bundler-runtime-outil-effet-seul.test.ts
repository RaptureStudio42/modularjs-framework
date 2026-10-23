// Une liste `runtime` qui ne cite que des effets ou des outils d'effets (`fx_toolup`…) les ajoute au cœur sans rien
// retirer : routeur, liens, requêtes et modale restent, comme pour une liste d'effets seuls.

import assert from 'node:assert/strict'
import { Bundler } from '../src/bundler/index.js'
import { FX_TOOL_KEYS } from '../src/bundler/fx-tools.js'
import { mjsTmp } from './helpers/tmp.js'

function fichiers(runtime: any): string[] {
  const b: any = new Bundler({ sourceDir: mjsTmp('rt-outil-src'), outputDir: mjsTmp('rt-outil-out'), runtime, env: 'prod' })
  return b.resolveRuntimeFiles(new Set(['for', 'if'])).files
}

describe('runtime : outils d\'effets seuls', function () {
  it('["fx_toolup"] garde routeur, UJS, ajax et modale, et embarque l\'outil', () => {
    assert.ok(FX_TOOL_KEYS.includes('fx_toolup'))
    const f = fichiers(['fx_toolup'])
    for (const m of ['mjs_router.ts', 'mjs_ujs.ts', 'mjs_ajax.ts', 'mjs_modal.ts', 'mjs_fx_toolup.ts']) assert.ok(f.includes(m), `${m} absent : ${f.join(', ')}`)
  })

  it('["fx_neon", "fx_toolup"] garde aussi la sélection par défaut', () => {
    const f = fichiers(['fx_neon', 'fx_toolup'])
    for (const m of ['mjs_router.ts', 'mjs_ujs.ts', 'mjs_ajax.ts', 'mjs_modal.ts']) assert.ok(f.includes(m), `${m} absent : ${f.join(', ')}`)
  })

  it('une liste qui cite un module ordinaire reste explicite', () => {
    const f = fichiers(['fx_toolup', 'ujs'])
    assert.ok(!f.includes('mjs_modal.ts'), f.join(', '))
  })
})
