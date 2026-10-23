// La vue CSS qui repère les sections (<style>, <theme>…) relisait le texte jusqu'au bout pour chaque `url(` ou `/*` du
// HTML jamais refermé : 4 000 styles précédés d'un `url(` sans `)` coûtaient trois secondes (temps quadratique). La fin
// déjà cherchée est gardée : la lecture est linéaire, et trouve les mêmes sections

import assert from 'node:assert/strict'
import { findStyleMatches } from '../src/transpiler/sections.js'

const styles = (k: number, avant: string, fin = '') =>
  Array.from({ length: k }, (_, i) => `<p>${avant} x</p>\n<style name="s${i}">\n.a\n  color: red\n</style>\n`).join('') + fin

describe('sections : littéraux non refermés du HTML, coût linéaire', () => {
  for (const [nom, avant, fin] of [['url( sans fin', 'url(', ''], ['/* sans fin', '/*', ''], ['url( fermé tout au bout', 'url(', '<p>)</p>\n'], ['/* fermé tout au bout', '/*', '<p>*/</p>\n']]) {
    it(`${nom} : 4 000 styles trouvés, vite`, () => {
      const src = styles(4000, avant, fin)
      const t0  = performance.now()
      const r   = findStyleMatches(src, [])
      const ms  = performance.now() - t0
      assert.equal(r.matches.length, 4000)
      assert.ok(ms < 500, `${ms.toFixed(0)} ms`)
    })
  }

  it('mêmes littéraux qu\'avant : chaîne, commentaire, url( échappée, `//` restent masqués', () => {
    const src = "<p>a</p>\n<style>\n.a\n  background: url(a\\)b.png) /* c */ // d\n  content: 'e</style>'\n</style>\n<p>/* f</p>\n<style name=\"g\">\n.b\n  color: red\n</style>\n"
    const r = findStyleMatches(src, [])
    assert.equal(r.matches.length, 2)
    assert.match(src.slice(...r.matches[0].indices![0]), /content: 'e<\/style>'\n<\/style>$/)
    assert.match(r.maskedView, /background: {27}\n/)
  })
})
