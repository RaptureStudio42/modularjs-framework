// un gabarit dont beaucoup de balises ont une accolade d'attribut jamais refermée (fichier en cours de frappe,
// tout sur une ligne) : chaque balise relisait tout le reste du texte, la recompilation gelait plusieurs
// secondes. Une accolade reconnue sans fin ne se relit plus

import assert from 'node:assert/strict'
import { scanEffectImages } from '../src/transpiler/effect-images.js'
import { processGlobalMacros, findMacroTagEnd } from '../src/transpiler/macros.js'

function meilleur(fn: () => void): number {
  let best = Infinity
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now()
    fn()
    best = Math.min(best, performance.now() - t0)
  }
  return best
}

describe('accolade d\'attribut jamais refermée : coût linéaire', function () {
  this.timeout(120000)

  it('images des effets : 64 Ko de balises mal fermées coûtent du même ordre que bien fermées', () => {
    const mal  = '<a x={y '.repeat(8000)
    const bien = '<a x={y}>'.repeat(8000)
    const tMal  = meilleur(() => scanEffectImages(mal))
    const tBien = meilleur(() => scanEffectImages(bien))
    assert.ok(tMal < 4 * tBien + 50, `mal fermées : ${Math.round(tMal)} ms, bien fermées : ${Math.round(tBien)} ms`)
  })

  it('balises du langage : 4 000 <@window @x={ sur une ligne coûtent du même ordre que des balises inconnues', () => {
    const avant = console.error
    console.error = () => {}
    try {
      const mal    = '<@window @x={'.repeat(4000)
      const temoin = '<@windox @x={'.repeat(4000)
      const tMal    = meilleur(() => processGlobalMacros(mal))
      const tTemoin = meilleur(() => processGlobalMacros(temoin))
      assert.ok(tMal < 4 * tTemoin + 50, `<@window : ${Math.round(tMal)} ms, témoin : ${Math.round(tTemoin)} ms`)
      assert.ok(processGlobalMacros(mal).errors.length > 0)
    }
    finally {
      console.error = avant
    }
  })

  it('le `>` réel est toujours trouvé, sur le même texte, après une accolade sans fin', () => {
    const html = '<a x={y <b c={d}>'
    assert.equal(findMacroTagEnd(html, 2), -1)
    assert.equal(findMacroTagEnd(html, 10), html.length - 1)
    assert.equal(findMacroTagEnd('<a x={y\n<b c={d}>', 2), -1)
    assert.equal(findMacroTagEnd('<a x={"}"}>', 2), 10)
  })
})
