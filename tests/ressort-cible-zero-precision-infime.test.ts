// µ.spring (mjs_spring.ts) se pose quand sa vitesse et son écart à la cible passent sous la précision. Vers la cible 0,
// avec une précision plus fine que l'écart que les nombres savent représenter près de zéro (1e-322, Number.MIN_VALUE),
// le pas du ressort s'arrondissait à zéro avant d'atteindre ce seuil : la valeur restait figée tout près de la cible,
// sans jamais se poser — tâche du Ticker et rendu à chaque image, pour toujours.
// Le seuil de repos ne descend plus sous l'écart représentable près de la cible, zéro compris.

import assert from 'node:assert/strict'

;(globalThis as any).µ = (globalThis as any).µ || { _mjs_interpolatorSet: new WeakSet(), Ticker: { add() {} } }
await import('../src/runtime/mjs_spring.js')
const µ = (globalThis as any).µ

function poser(s: any, max = 100000): number {
  for (let i = 1; i <= max; i++) if (!s._mjs_step()) return i
  return -1
}

describe('µ.spring — cible 0 et précision infime : le ressort se pose', () => {
  // mesuré avant le correctif : à la précision Number.MIN_VALUE (et 1e-322 pour la raideur 0,01), ces réglages ne se
  // posaient pas en 3 000 000 de pas
  for (const [raideur, amorti] of [[0.15, 0.3], [0.15, 0.8], [0.15, 1], [1, 0.3], [0.01, 0.8]]) {
    for (const precision of [1e-322, Number.MIN_VALUE]) {
      it(`raideur ${raideur}, amortissement ${amorti}, précision ${precision}`, () => {
        const s = µ.spring(1, raideur, amorti)
        s.precision = precision
        s.value = 0
        const pas = poser(s)
        assert.notEqual(pas, -1, 'le ressort ne se posait jamais')
        assert.equal(s.current, 0)
      })
    }
  }

  it('une précision ordinaire reste la règle : autant de pas qu\'avant', () => {
    const pas = (depart: number, raideur: number, amorti: number, cible: number): number => {
      const s = µ.spring(depart, raideur, amorti)
      s.value = cible
      return poser(s)
    }
    assert.deepEqual([pas(100, 0.15, 0.8, 0), pas(1, 0.15, 0.8, 0), pas(100, 0.5, 0.3, 0), pas(0, 0.15, 0.8, 1e15), pas(5, 0.001, 0.01, 0)], [42, 22, 50, 131, 556])
  })
})
