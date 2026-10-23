// Les alias des préréglages de l'éditeur d'effets du site (/effets) : chaque préréglage d'une carte porte le nom d'un alias que
// ModularJS livre (`*tilt.floating_layers`), jamais la liste de ses réglages. La liste ci-dessous est celle des alias ajoutés pour
// les cartes qu'aucun alias livré ne couvrait ; chacun pose l'effet avec les réglages que la carte montrait, ceux que le fichier
// des alias écrit, et son nom suit la règle des alias.

import assert from 'node:assert/strict'
import { parseEffect, ALIAS_NAME } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'

// [effet, nom de l'alias, réglages de la carte]
const ATTENDUS: Array<[string, string, string]> = [
  ['stagger', 'flip', 'style: flip'],
  ['stagger', 'blur_words', 'unit: word, style: blur'],
  ['stagger', 'scroll_words', 'unit: word, style: fade, on: scroll, opacity: .2, zone: 80% 30%'],
  ['longshadow', 'lamp', 'light: true'],
  ['pixels', 'explode', 'mode: explode, size: 10, spread: 30, color: #03a9f4'],
  ['pixels', 'strip', 'mode: strip, color: #e50914'],
  ['pixels', 'card_burst', 'mode: explode, spread: 100, cover: true, color: #ff5722'],
  ['pixels', 'mosaic', 'mode: mosaic, on: always'],
  ['pixels', 'swap', 'mode: swap'],
  ['particles', 'aura', 'mode: aura, color: #e50914, on: hover'],
  ['particles', 'stars', 'mode: stars'],
  ['particles', 'network', 'mode: network'],
  ['particles', 'meteors', 'mode: meteors, direction: down-left'],
  ['spotlight', 'green_torch', 'where: border, color: #0f0, size: 150'],
  ['border', 'wave', 'style: wave'],
  ['border', 'run', 'style: run'],
  ['ink', 'brush', 'style: brush'],
  ['ink', 'wash', 'style: wash'],
  ['ink', 'smoke', 'style: smoke'],
  ['ink', 'drip', 'style: drip'],
  ['ink', 'dots', 'style: dots'],
  ['ink', 'shards', 'style: shards'],
  ['ink', 'swirl', 'style: swirl'],
  ['ink', 'tear', 'style: tear'],
  ['ink', 'burn', 'style: burn'],
  ['ink', 'frost', 'style: frost'],
  ['ink', 'rain', 'style: rain'],
  ['ink', 'cells', 'style: cells'],
  ['ink', 'cracks', 'style: cracks'],
  ['ink', 'ripple', 'style: ripple'],
  ['ink', 'scribble', 'style: scribble'],
  ['ink', 'petals', 'style: petals'],
  ['ink', 'glitch', 'style: glitch'],
  ['ink', 'topo', 'style: topo'],
  ['ink', 'maze', 'style: maze'],
  ['grid', 'halo', 'style: halo'],
  ['grid', 'trail', 'style: trail'],
  ['grid', 'needle', 'style: needle'],
  ['grid', 'outline', 'light: outline'],
  ['grid', 'glow', 'light: glow'],
  ['grid', 'rows', 'light: rows'],
  ['grid', 'lines', 'style: lines, fade: down'],
  ['magnet', 'ring', 'strength: 50, ring: true'],
  ['zoom', 'from_pointer', 'origin: pointer'],
  ['goo', 'merge', 'mode: merge, drag: true'],
  ['attention', 'heartbeat', 'style: heartbeat, on: always'],
  ['attention', 'jello', 'style: jello, on: always'],
  ['attention', 'rubber', 'style: rubber, on: always'],
  ['attention', 'swing', 'style: swing, on: always'],
  ['annotate', 'circle', 'style: circle'],
  ['annotate', 'box', 'style: box, color: #22d3ee'],
  ['annotate', 'strike', 'style: strike, color: #f85149'],
  ['annotate', 'bracket', 'style: bracket, color: #facc15'],
  ['cycle', 'flip', 'style: flip'],
  ['cycle', 'blur', 'style: blur'],
  ['cycle', 'typewriter', 'style: type, speed: 3s'],
  ['cycle', 'frame', 'style: frame, speed: 3s'],
  ['filter', 'vintage', 'style: vintage'],
  ['filter', 'lomo', 'style: lomo'],
  ['filter', 'cyberpunk', 'style: cyberpunk'],
  ['filter', 'thermal', 'style: thermal'],
  ['filter', 'posterize', 'style: posterize'],
  ['filter', 'halftone', 'style: halftone'],
  ['filter', 'vignette', 'style: vignette'],
  ['filter', 'tiltshift', 'style: tiltshift'],
  ['filter', 'duotone', 'style: duotone, colors: [#1b1464, #ff4fa3]'],
  ['filter', 'gray_at_rest', 'style: grayscale, on: rest'],
  ['filter', 'pixelate', 'style: pixelate'],
  ['filter', 'bright_hue_shift', 'brightness: 1.2, hue: 40'],
  ['iris', 'box', 'shape: box'],
  ['iris', 'diamond', 'shape: diamond'],
  ['iris', 'cross', 'shape: cross'],
  ['wheel', 'four_spokes', 'spokes: 4'],
  ['fly', 'light_speed', 'direction: left, distance: 120, skew: 30, blur: 6'],
  ['scale', 'stretch_x', 'axis: x'],
  ['rotate', 'quarter_turn', 'angle: -90, start: 0'],
  ['flipcard', 'click_flip', 'axis: x, on: click'],
  ['scratch', 'gold', 'colors: [#fde68a, #b45309], ink: #78350f, brush: 36'],
  ['spoiler', 'blur', 'style: blur'],
  ['spoiler', 'bar', 'style: bar'],
  ['spoiler', 'pixels', 'style: pixels'],
  ['spoiler', 'on_hover', 'on: hover'],
  ['weight', 'stretch', 'fallback: stretch'],
  ['mesh', 'sunset', 'style: sunset'],
  ['mesh', 'ocean', 'style: ocean'],
  ['mesh', 'neon', 'style: neon'],
  ['mesh', 'candy', 'style: candy'],
  ['mesh', 'forest', 'style: forest'],
  ['chromatic', 'cmy_title', 'mode: cmy, gap: 6'],
  ['reflect', 'water', 'water: true'],
  ['crt', 'amber', 'tint: #ffb000'],
  ['scrollprogress', 'glow_gradient', 'colors: [#f97316, #ec4899, #8b5cf6], thickness: 6, glow: 12'],
  ['scrollprogress', 'side_rail', 'place: right, thickness: 6, track: #30363d'],
  ['path', 'loop', 'd: loop'],
  ['path', 'circle', 'd: circle'],
  ['path', 'infinity', 'd: infinity'],
  ['path', 'zigzag', 'd: zigzag'],
  ['path', 'spiral', 'd: spiral'],
  ['path', 'heart', 'd: heart'],
  ['blend', 'difference', 'mode: difference'],
  ['blend', 'overlay', 'mode: overlay'],
  ['blend', 'screen_gradient', 'mode: screen, colors: [#7c3aed, #22d3ee], angle: 135'],
  ['loader', 'steps', 'style: steps'],
  ['loader', 'plus', 'style: plus'],
  ['loader', 'neon', 'style: neon'],
  ['loader', 'trio', 'style: trio'],
  ['loader', 'slab_ring', 'style: 3d'],
  ['loader', 'bloom', 'style: bloom'],
  ['loader', 'spiral', 'style: spiral'],
  ['loader', 'galaxy', 'style: galaxy'],
  ['loader', 'cross', 'style: cross']
]

describe('les alias des préréglages de l\'éditeur d\'effets', () => {
  const fournis = resolveProjectEffects([])

  it('la liste compte 111 alias sur 32 effets, aucun nom deux fois pour un même effet', () => {
    assert.equal(ATTENDUS.length, 111)
    assert.equal(new Set(ATTENDUS.map(([effet]) => effet)).size, 32)
    assert.equal(new Set(ATTENDUS.map(([effet, nom]) => `${effet}.${nom}`)).size, 111)
  })

  it('chaque nom suit la règle des alias (minuscules, chiffres, _)', () => {
    for (const [effet, nom] of ATTENDUS) assert.ok(ALIAS_NAME.test(nom), `*${effet}.${nom} : hors de la règle`)
  })

  for (const [effet, nom, reglages] of ATTENDUS) {
    it(`*${effet}.${nom} est livré, avec les réglages de la carte`, () => {
      const alias = fournis[`${effet}.${nom}`]
      assert.ok(alias, `*${effet}.${nom} n'est pas livré`)
      assert.equal(alias.base, effet)
      assert.deepEqual(alias.fixed, parseEffect(effet, reglages, [], true).fixed)
      assert.ok(MJS_ALIASES.split('\n').some((l) => l.startsWith(`*${effet}.${nom} = `)), 'la ligne du fichier')
    })
  }
})
