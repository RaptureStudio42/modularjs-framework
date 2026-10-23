// *zoom grossit de moitié quand rien n'est écrit (`scale` 1.5) : le catalogue, la feuille de l'effet (chaque repli de `--mjs-zoom-scale`, que
// le moteur n'écrit que si la page donne `scale`) et la doc disent la même valeur.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'

describe('*zoom : le grossissement par défaut est 1.5', () => {
  it('le catalogue donne 1.5 à `scale`', () => {
    assert.equal(EFFECTS.zoom.settings.scale.dflt, 1.5)
  })

  it('`*zoom` sans réglage n\'écrit pas `scale` : la feuille de l\'effet le replie sur 1.5, partout', () => {
    assert.deepEqual(parseEffect('zoom', '').fixed, {})
    const code   = readFileSync(new URL('../src/runtime/mjs_fx_zoom.ts', import.meta.url), 'utf8')
    const replis = [...code.matchAll(/var\(--mjs-zoom-scale,([^)]+)\)/g)].map((m) => m[1])
    assert.ok(replis.length >= 4, replis.join(' '))
    assert.deepEqual([...new Set(replis)], ['1.5'])
    assert.match(code, /Réglages : scale \(1\.5\)/)
  })

  it('la doc dit 1.5', () => {
    const ligne = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('| `*zoom` |')) ?? ''
    assert.match(ligne, /\*\*`scale`\*\* float 1\.\.3 \(1\.5\)/)
  })
})
