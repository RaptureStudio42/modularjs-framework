// les modules d'exécution des effets fondus dans un autre avant la 3.0 (`fx_aurora`, `fx_shimmer`, `fx_wiggle`…) n'existent plus : la liste des
// modules du cœur ne les porte plus, et `runtime: ['fx_aurora']` dans mjs.config.json est refusé comme un module inconnu, avec le module qui
// porte maintenant l'effet. Chaque module d'effet de la liste a son fichier.

import assert from 'node:assert/strict'
import { writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig, DETECTED_CORE_MODULES } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

const ICI = dirname(fileURLToPath(import.meta.url))

const config = (cfg: unknown) => {
  const root = mjsTmp('rt-fondus')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(cfg))
  return root
}

const ANCIENS: Array<[string, string]> = [['fx_aurora', 'fx_mesh'], ['fx_shimmer', 'fx_shine'], ['fx_wiggle', 'fx_attention'], ['fx_lens', 'fx_filter'], ['fx_knockout', 'fx_gradient'], ['fx_texture', 'fx_gradient'], ['fx_typing', 'fx_cycle']]

describe('mjs.config.json : les modules des effets fondus', () => {
  afterEach(() => setMessagesLang('fr'))

  it('chaque module d\'effet de la liste du cœur a son fichier d\'exécution', () => {
    const sans = DETECTED_CORE_MODULES.filter(m => m.startsWith('fx_') && !existsSync(join(ICI, '../src/runtime/mjs_' + m + '.ts')))
    assert.deepEqual(sans, [])
  })

  for (const [ancien, nouveau] of ANCIENS) {
    it(`runtime: ['${ancien}'] refusé, le message donne '${nouveau}'`, () => {
      assert.ok(!(DETECTED_CORE_MODULES as readonly string[]).includes(ancien), ancien + ' encore dans la liste du cœur')
      assert.throws(() => findConfig(config({ runtime: [ancien] })), (e: Error) => e.message.includes(`module inconnu '${ancien}'`) && e.message.includes(`'${nouveau}'`))
    })
  }

  it('en anglais', () => {
    setMessagesLang('en')
    assert.throws(() => findConfig(config({ lang: 'en', runtime: ['fx_aurora'] })), /unknown module 'fx_aurora'[\s\S]*'fx_aurora' no longer exists: its effect is now part of 'fx_mesh'/)
  })
})
