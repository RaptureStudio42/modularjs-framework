// `*gauge` suit sa valeur tant qu'elle est posée : elle n'a pas de réglage `on`. L'écrire est refusé à la compilation, avec la
// liste de ses réglages ; la doc des effets le dit — `on` est le réglage des effets qui ont un moment à choisir, pas de tous.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'

describe('*gauge : pas de réglage on, et la doc le dit', function () {
  it('*gauge(on: view) est refusé, la liste de ses réglages donnée', () => {
    assert.equal(EFFECTS.gauge.settings.on, undefined)
    assert.throws(() => parseEffect('gauge', 'on: view'), (e: any) => /\bon\b/.test(e.message) && /color/.test(e.message))
  })

  it('docs/38 : on pour un effet qui a un moment à choisir, *gauge nommé sans on', () => {
    const lignes = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf-8').split('\n')
    const on     = lignes.find((l) => l.startsWith('- **`on` — quand l\'effet agit')) ?? ''
    const jauge  = lignes.find((l) => l.startsWith('- `*gauge` : ')) ?? ''
    assert.match(on, /un effet qui a un moment à choisir/, on.slice(0, 300))
    assert.match(on, /Un effet sans `on` agit tant qu'il est posé : `\*gauge` suit sa valeur/, on.slice(0, 300))
    assert.match(jauge, /Elle n'a pas de réglage `on`/, jauge)
  })
})
