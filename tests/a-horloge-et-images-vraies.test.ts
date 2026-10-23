// L'horloge et les images sont les vraies quand les tests commencent. Un fichier de la même exécution
// (tests/transition-tick-abort-resolves.test.ts) joue une file d'images et une horloge à lui : posées
// dès son chargement, elles figeraient `performance.now` pour tous les fichiers lancés avant lui —
// mocha charge TOUS les fichiers avant d'en lancer un. Elles ne doivent exister que pendant ses propres
// tests. Ce fichier-ci, par son nom, est parmi les premiers lancés : s'il voit une horloge figée ou une
// file d'images qui n'est pas celle du navigateur, quelqu'un les a posées au chargement.

import assert from 'node:assert/strict'

describe('l\'horloge et les images sont les vraies au début de l\'exécution', () => {
  it('performance.now avance', async () => {
    const t0 = performance.now()
    await new Promise((r) => setTimeout(r, 15))
    const t1 = performance.now()
    assert.ok(t1 > t0, `performance.now figé : ${t0} → ${t1}`)
  })

  it('requestAnimationFrame, absent de Node, n\'a pas été remplacé par une fausse file', () => {
    assert.equal(typeof (globalThis as any).requestAnimationFrame, 'undefined', 'requestAnimationFrame fantôme : ' + typeof (globalThis as any).requestAnimationFrame)
  })

  it('cancelAnimationFrame non plus', () => {
    assert.equal(typeof (globalThis as any).cancelAnimationFrame, 'undefined', 'cancelAnimationFrame fantôme')
  })
})
