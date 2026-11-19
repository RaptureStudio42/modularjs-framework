// le choix des étiquettes de l'axe sans largeur connue (rendu serveur) tient au-delà de 100 000 étiquettes : le plus long libellé se
// cherche sans passer toute la liste en arguments d'un appel (la pile du moteur ne les tient pas, « RangeError »), et le choix reste
// celui d'une petite liste
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FICHIER = fileURLToPath(new URL('../src/runtime/mjs_chart.ts', import.meta.url))
const µ: any = {}
new Function('µ', readFileSync(FICHIER, 'utf-8'))(µ)
const C = µ._mjs_chart

function liste(n: number): { fractions: number[], texts: string[] } {
  const fractions = Array.from({ length: n }, (_, i) => n === 1 ? 0 : i / (n - 1))
  const texts     = Array.from({ length: n }, (_, i) => `2026-11-${String(i % 28 + 1).padStart(2, '0')}`)
  return { fractions, texts }
}

describe('graphiques — étiquettes sans largeur, plus de 100 000', () => {
  it('300 000 étiquettes : un choix rendu, sans RangeError, la première et la dernière gardées', () => {
    const { fractions, texts } = liste(300000)
    const shown = C.labelPicks(fractions, texts, {})
    assert.ok(Array.isArray(shown) && shown.length > 1)
    assert.equal(shown[0], 0)
    assert.equal(shown[shown.length - 1], 299999)
  })

  it('40 étiquettes : le même choix qu\'avant (relevé sur la version d\'avant)', () => {
    const { fractions, texts } = liste(40)
    assert.deepEqual(C.labelPicks(fractions, texts, {}), [0, 7, 14, 21, 28, 39])
  })
})
