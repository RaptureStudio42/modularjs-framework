// *mesh est un effet lourd, comme l'était *aurora qu'il remplace : mesurées dans Chromium (six boîtes de 600 × 280 px), ses taches qui dérivent
// sous leur flou coûtent autant que l'ancienne aurore, ou plus. La mesure des effets économes part avec lui, et la page devenue économe arrête
// ses taches (elles restent à l'écran) ; la doc le dit.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FX_TOOLS } from '../src/bundler/fx-tools.js'

const CODE = readFileSync(new URL('../src/runtime/mjs_fx_mesh.ts', import.meta.url), 'utf8')

describe('*mesh est un effet lourd', () => {
  it('sa définition est marquée `heavy`', () => {
    assert.match(CODE, /µ\._mjs_fxDefs\.mesh = \{[\s\S]*?\n  heavy: true,/)
  })

  it('la mesure de la cadence (fx_toolgauge) part avec lui', () => {
    assert.ok(FX_TOOLS.fx_toolgauge.effects.includes('fx_mesh'))
  })

  it('en économe, ses taches s\'arrêtent : chaque animation suit `--mjs-fx-lite-play`', () => {
    const animes = CODE.match(/animation:var\(--mjs-fx-mesh-go/g) ?? []
    const arrets = CODE.match(/animation-play-state:var\(--mjs-fx-lite-play,running\)/g) ?? []
    assert.ok(animes.length >= 2)
    assert.equal(arrets.length, animes.length)
  })

  it('la doc des effets économes le nomme, et ne parle plus de l\'aurore', () => {
    const ligne = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('- **Les effets économes.**')) ?? ''
    assert.match(ligne, /`\*mesh`/)
    assert.doesNotMatch(ligne, /aurore/)
  })
})
