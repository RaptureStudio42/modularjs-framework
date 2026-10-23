// *loader : les styles `arc` (le dessin de `neon`) et `swirl` (le dessin de `galaxy`) ne sont plus livrés, ni leurs alias. Les écrire est une
// erreur de construction, comme toute valeur inconnue : le message liste les styles qui restent. Le runtime ne porte plus leur dessin.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EFFECTS, parseEffect, withProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'
import { transpile } from '../src/transpiler/index.js'

const RESTENT = ['dots', 'steps', 'plus', 'neon', 'trio', '3d', 'bloom', 'spiral', 'galaxy', 'cross', 'vortex']

describe('*loader : les styles arc et swirl sont retirés', () => {
  it('le catalogue permet les onze styles qui restent, et seulement eux', () => {
    const permis = [...EFFECTS.loader.settings.style.rule.matchAll(/'([^']+)'/g)].map((m) => m[1])
    assert.deepEqual(permis, RESTENT)
  })

  for (const ecrit of ['*loader(arc)', '*loader(style: swirl)']) {
    it(`${ecrit} : erreur de construction qui liste les styles qui restent`, async () => {
      await assert.rejects(transpile(`<span ${ecrit}></span>`, { moduleName: 'fx-essai' }), (e: Error) => {
        assert.match(e.message, /'neon'[\s\S]*'galaxy'/, e.message)
        assert.doesNotMatch(e.message, /'arc'|'swirl'/, e.message)
        return true
      })
    })
  }

  it('*loader.arc et *loader.swirl ne sont plus des alias livrés', () => {
    withProjectEffects(resolveProjectEffects([]), () => {
      for (const nom of ['loader.arc', 'loader.swirl']) assert.throws(() => parseEffect(nom, '', [], true), /aucun alias de ce nom pour \*loader/, nom)
    })
  })

  it('le runtime ne porte plus leur dessin', () => {
    const code = readFileSync(new URL('../src/runtime/mjs_fx_loader.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(code, /'arc'|'swirl'|draw\.arc|draw\.swirl|\barc: |\bswirl: /)
  })
})
