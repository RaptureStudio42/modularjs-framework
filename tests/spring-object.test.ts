// µ.spring — ressort physique scalaire ET composite (objet/tableau).
// Régression : le ressort doit interpoler chaque
// composante numérique d'un objet/tableau, et stiffness/damping sont réactifs.

import assert from 'node:assert/strict'

// `µ` global minimal requis par le runtime spring.
;(globalThis as any).µ = (globalThis as any).µ || { _mjs_interpolatorSet: new WeakSet(), Ticker: { add() {} } }
await import('../src/runtime/mjs_spring.js') // enregistre µ.spring
const µ = (globalThis as any).µ

function settle(s: any, max = 5000) { let i = 0; while (i++ < max && s._mjs_step()) {} return i }

describe('µ.spring — scalaire + composite', () => {
  it('scalaire converge vers la cible', () => {
    const s = µ.spring(0, 0.3, 0.5)
    s.value = 100
    settle(s)
    assert.ok(Math.abs(s.current - 100) < 0.5, `current=${s.current}`)
  })

  it('objet {x, y} : chaque axe converge indépendamment', () => {
    const s = µ.spring({ x: 0, y: 0 }, 0.3, 0.5)
    s.value = { x: 100, y: -50 }
    settle(s)
    assert.ok(Math.abs(s.current.x - 100) < 0.5, `x=${s.current.x}`)
    assert.ok(Math.abs(s.current.y + 50) < 0.5, `y=${s.current.y}`)
  })

  it('tableau [a, b] converge', () => {
    const s = µ.spring([0, 0], 0.3, 0.5)
    s.value = [10, 20]
    settle(s)
    assert.ok(Math.abs(s.current[0] - 10) < 0.5 && Math.abs(s.current[1] - 20) < 0.5, JSON.stringify(s.current))
  })

  it('stiffness/damping RÉACTIFS : le setter notifie l\'invalidator', () => {
    const s = µ.spring(0)
    // `_mjs_attachInvalidator(owner, fn)` (Map par
    // propriétaire — voir tests/interpolator-invalidator-multi-owner.test.ts).
    let n = 0; s._mjs_attachInvalidator({}, () => { n++ })
    s.stiffness = 0.2
    s.damping = 0.9
    assert.equal(n, 2, 'deux notifications')
    assert.equal(s.stiffness, 0.2)
    assert.equal(s.damping, 0.9)
  })

  it('garde NaN profond : une cible composite non-finie est ignorée', () => {
    const s = µ.spring({ x: 0, y: 0 })
    s.value = { x: NaN, y: 5 }
    assert.deepEqual(s.target, { x: 0, y: 0 }, 'cible inchangée')
  })

  it('le ressort est marqué interpolateur', () => {
    const s = µ.spring({ x: 1 })
    assert.ok(µ._mjs_interpolatorSet.has(s))
  })
})

describe('µ.spring — bornes de la raideur', () => {
  it('raideur minimale : zéro, négatif et très petit sont relevés à 0.001', () => {
    assert.equal(µ.spring(0, 0).stiffness, 0.001)
    assert.equal(µ.spring(0, -5).stiffness, 0.001)
    const s = µ.spring(0, 0.5)
    s.stiffness = 0.0001
    assert.equal(s.stiffness, 0.001)
  })

  it('raideur par défaut non finie : 0.15, au constructeur comme au réglage', () => {
    assert.equal(µ.spring(0, NaN).stiffness, 0.15)
    assert.equal(µ.spring(0, Infinity).stiffness, 0.15)
    assert.equal(µ.spring(0, 'dur').stiffness, 0.15)
    const s = µ.spring(0, 0.5)
    s.stiffness = NaN
    assert.equal(s.stiffness, 0.15)
  })

  it('raideur maximale : 4 − 2·amortissement − 0.01', () => {
    assert.ok(Math.abs(µ.spring(0, 100, 0.8).stiffness - 2.39) < 1e-12)
    assert.ok(Math.abs(µ.spring(0, 100, 0.5).stiffness - 2.99) < 1e-12)
  })

  it('amortissement qui change : la raideur déjà posée est re-bornée', () => {
    const s = µ.spring(0, 2.5, 0.5)
    assert.equal(s.stiffness, 2.5)
    s.damping = 1
    assert.ok(Math.abs(s.stiffness - 1.99) < 1e-12, `stiffness=${s.stiffness}`)
    s.damping = 0.5
    assert.ok(Math.abs(s.stiffness - 1.99) < 1e-12, 'elle ne remonte pas toute seule')
  })

  it('amortissement : non fini donne 0.8, borné entre 0.01 et 1', () => {
    assert.equal(µ.spring(0, 0.15, NaN).damping, 0.8)
    assert.equal(µ.spring(0, 0.15, 5).damping, 1)
    assert.equal(µ.spring(0, 0.15, 0).damping, 0.01)
  })
})
