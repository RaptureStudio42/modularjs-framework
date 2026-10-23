// *peel.bottom_left n'est plus livré : il ne disait rien de plus que `corner`, qui reste (`*peel(corner: bottom-left)`). Son nom est un alias
// inconnu comme un autre : la construction s'arrête et le message le dit. Ni le fichier des alias ni la doc ne le citent.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEffect, withProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'

describe('*peel.bottom_left est retiré', () => {
  it('ni dans le fichier des alias, ni parmi les alias fournis', () => {
    assert.ok(!MJS_ALIASES.split('\n').some((l) => l.startsWith('*peel.')), 'le fichier livre encore un alias de *peel')
    assert.ok(!('peel.bottom_left' in resolveProjectEffects([])), '*peel.bottom_left est encore fourni')
  })

  it('son nom arrête la construction : aucun alias de ce nom pour *peel', () => {
    withProjectEffects(resolveProjectEffects([]), () => {
      assert.throws(() => parseEffect('peel.bottom_left', '', [], true), /\*peel\.bottom_left : aucun alias de ce nom pour \*peel/)
    })
  })

  it('le coin se choisit toujours par `corner`', () => {
    assert.equal(parseEffect('peel', 'corner: bottom-left').fixed.corner, 'bottom-left')
  })

  it('la doc ne le liste plus', () => {
    // parmi les alias livrés ; la section des anciens noms le cite avec son remplaçant
    assert.doesNotMatch(readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8'), /^\| `\*peel\.bottom_left`/m)
  })
})
