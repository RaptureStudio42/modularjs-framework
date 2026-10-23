// *spotlight : la lumière se tient aussi en un point, sans la souris (`origin` : un coin, `20% 80%` ; `pointer`, le défaut, la fait suivre la
// souris), la portée de son halo dans la boîte se règle seule (`glow`, en px ; sans lui, celle du liseré : 0,72 fois `size`), et elle peut
// s'allumer par instants (`every`). Deux préréglages livrés : *spotlight.corner_glow, une lueur permanente qui part du coin du bas à gauche et
// déborde dans la boîte, et *spotlight.corner_flash, la même qui s'allume par instants.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'

const DOC = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8').split('\n')

describe('*spotlight : la lumière de coin', () => {
  it('le catalogue porte `origin` (pointer par défaut), `glow` et `every`', () => {
    const s = EFFECTS.spotlight.settings
    assert.equal(s.origin?.rule, 'origin-pointer')
    assert.equal(s.origin?.dflt, 'pointer')
    assert.equal(s.glow?.rule, 'int 0..1000')
    assert.equal(s.glow?.dflt, undefined)
    assert.equal(s.every?.rule, 'time')
    assert.equal(s.every?.dflt, undefined)
  })

  it('les trois réglages se lisent, et un point inconnu est refusé', () => {
    const r = parseEffect('spotlight', 'origin: bottom-left, glow: 180, every: 2s')
    assert.equal(r.fixed.origin, 'bottom-left')
    assert.equal(r.fixed.glow, 180)
    assert.ok(r.fixed.every)
    assert.equal(parseEffect('spotlight', 'origin: 20% 80%').fixed.origin, '20% 80%')
    assert.throws(() => parseEffect('spotlight', 'origin: ailleurs'))
  })

  it('les deux préréglages : une lumière posée au coin du bas à gauche, allumée sans la souris ; l\'une s\'allume par instants', () => {
    const fournis = resolveProjectEffects([])
    const coin    = fournis['spotlight.corner_glow']?.fixed ?? {}
    const eclat   = fournis['spotlight.corner_flash']?.fixed ?? {}
    for (const f of [coin, eclat]) {
      assert.equal(f.origin, 'bottom-left')
      assert.equal(f.on, 'always')
      assert.ok(f.glow, 'la portée du halo est réglée')
    }
    assert.equal(coin.every, undefined)
    assert.ok(eclat.every, '*spotlight.corner_flash s\'allume par instants')
  })

  it('la doc donne les trois réglages et les deux préréglages', () => {
    const ligne = DOC.find((l) => l.startsWith('| `*spotlight` |')) ?? ''
    assert.match(ligne, /`origin` un point, ou pointer \(`pointer`\)/)
    assert.match(ligne, /`glow` int 0\.\.1000/)
    assert.match(ligne, /`every` durée/)
    assert.ok(DOC.some((l) => l.startsWith('| `*spotlight.corner_glow` |')))
    assert.ok(DOC.some((l) => l.startsWith('| `*spotlight.corner_flash` |')))
  })
})
