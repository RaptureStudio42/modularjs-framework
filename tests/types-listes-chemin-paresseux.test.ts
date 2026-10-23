// types — le chemin que nomme un message ne se calcule que quand un message part : une écriture valide, ou une
// méthode de liste valide, ne remonte aucun lien et ne cherche aucune position, même sur une liste qui a
// bougé (unshift, shift, splice, sort, reverse). Un message ne cherche la position d'un élément que s'il a
// bougé, et une seule fois

import assert from 'node:assert/strict'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

// lectures du registre, et recherches de position dans `liste`, pendant `fn`
function compter(liste: any[], fn: () => void) {
  const get0 = WeakMap.prototype.get
  const idx0 = Array.prototype.indexOf
  let lectures   = 0
  let recherches = 0
  WeakMap.prototype.get = function (this: any, cle: any) {
    lectures++
    return get0.call(this, cle)
  }
  Array.prototype.indexOf = function (this: any, ...a: any[]) {
    if (this === liste) recherches++
    return (idx0 as any).apply(this, a)
  }
  try {
    fn()
  }
  finally {
    WeakMap.prototype.get = get0
    Array.prototype.indexOf = idx0
  }
  return { lectures, recherches }
}

const LIGNES = '{ id: int, t: string }[]'

function lignes(n: number, mode?: 'warn' | 'error') {
  const µ  = makeMu(mode)
  const el = composant({ rows: LIGNES })
  const l: any[] = Array.from({ length: n }, (_, i) => ({ id: i, t: 'm' }))
  µ._mjs_tset(el, 'rows', l)
  return { µ, el, reg: el._mjs_treg, l }
}

describe('types — une écriture valide ne calcule aucun chemin', () => {
  const N = 2000

  const DEPLACEMENTS: Record<string, (m: any) => void> = {
    'unshift':                     (m) => { appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: -1, t: 'n' }) },
    'shift':                       (m) => { appeler(m.µ, m.el, m.reg, m.l, 'shift') },
    'splice (un retrait en tête)': (m) => { appeler(m.µ, m.el, m.reg, m.l, 'splice', 0, 1) },
    'sort':                        (m) => { appeler(m.µ, m.el, m.reg, m.l, 'sort', (a: any, b: any) => b.id - a.id) },
    'reverse':                     (m) => { appeler(m.µ, m.el, m.reg, m.l, 'reverse') },
  }

  for (const mode of ['warn', 'error'] as const) {
    for (const [nom, deplacer] of Object.entries(DEPLACEMENTS)) {
      it(mode + ' : après ' + nom + ', un balayage d’écritures valides lit le registre une fois par écriture et ne cherche aucune position', () => {
        const m = lignes(N, mode)
        deplacer(m)
        const n = m.l.length
        const c = compter(m.l, () => {
          for (let i = 0; i < n; i++) assert.ok(m.µ._mjs_tdeep(m.el, m.reg, m.l[i], 'id', 5) === 5, 'écriture valide acceptée')
        })
        assert.ok(c.lectures <= n, 'lectures du registre : ' + c.lectures + ' pour ' + n + ' écritures')
        assert.equal(c.recherches, 0, 'recherches de position')
        assert.deepEqual(m.µ.warnings, [])
      })
    }
  }

  it('une méthode valide sur une liste imbriquée dont la ligne a bougé ne cherche aucune position', () => {
    const µ  = makeMu('warn')
    const el = composant({ board: '{ rows: { cells: { v: int }[] }[] }' })
    const board: any = { rows: Array.from({ length: 500 }, (_, r) => ({ cells: [{ v: r }, { v: r + 1 }] })) }
    µ._mjs_tset(el, 'board', board)
    const reg = el._mjs_treg
    appeler(µ, el, reg, board.rows, 'reverse')
    const c = compter(board.rows, () => {
      for (const row of board.rows) {
        assert.equal(appeler(µ, el, reg, row.cells, 'push', { v: 1 }), true)
        assert.equal(appeler(µ, el, reg, row.cells, 'shift'), true)
        assert.ok(µ._mjs_tdeep(el, reg, row.cells[0], 'v', 2) === 2, 'écriture valide acceptée')
      }
    })
    assert.equal(c.recherches, 0, 'recherches de position')
    assert.deepEqual(µ.warnings, [])
  })

  it('une liste revérifiée en entier (méthode hors des sept connues) ne cherche aucune position non plus', () => {
    const µ  = makeMu('warn')
    const el = composant({ board: '{ rows: { cells: { v: int }[] }[] }' })
    const board: any = { rows: Array.from({ length: 300 }, (_, r) => ({ cells: [{ v: r }, { v: r + 1 }] })) }
    µ._mjs_tset(el, 'board', board)
    const reg = el._mjs_treg
    appeler(µ, el, reg, board.rows, 'reverse')
    const c = compter(board.rows, () => {
      for (const row of board.rows) assert.equal(appeler(µ, el, reg, row.cells, 'copyWithin', 0, 1), true)
    })
    assert.equal(c.recherches, 0, 'recherches de position')
  })
})

describe('types — un message cherche la position d’un élément seulement s’il a bougé, et une seule fois', () => {
  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : à sa place aucune recherche ; déplacé, une seule, dont la position est retenue', () => {
      const m = lignes(1000, mode)
      const x = m.l[600]
      let nom = ''
      let c   = compter(m.l, () => { nom = refuser(m.µ, m.el, m.reg, x, 'id') })
      assert.equal(nom, '$rows[600].id')
      assert.equal(c.recherches, 0, 'à sa place : aucune recherche')
      appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: -1, t: 'n' })
      c = compter(m.l, () => { nom = refuser(m.µ, m.el, m.reg, x, 'id') })
      assert.equal(nom, '$rows[601].id')
      assert.equal(c.recherches, 1, 'déplacé : une recherche')
      c = compter(m.l, () => { nom = refuser(m.µ, m.el, m.reg, x, 'id') })
      assert.equal(nom, '$rows[601].id')
      assert.equal(c.recherches, 0, 'la position trouvée est retenue')
    })
  }

  const AJOUTS: Record<string, [(m: any) => void, string]> = {
    'push':    [(m) => { appeler(m.µ, m.el, m.reg, m.l, 'push', { id: 100, t: 'n' }) }, '$rows[50].id'],
    'unshift': [(m) => { appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 100, t: 'n' }) }, '$rows[0].id'],
    'splice':  [(m) => { appeler(m.µ, m.el, m.reg, m.l, 'splice', 10, 0, { id: 100, t: 'n' }) }, '$rows[10].id'],
  }

  for (const [nom, [ajouter, attendu]] of Object.entries(AJOUTS)) {
    it('un élément ajouté par ' + nom + ' se nomme sans recherche : la position inscrite est la bonne', () => {
      const m = lignes(50, 'warn')
      ajouter(m)
      const x = m.l.find((o: any) => o.id === 100)
      let chemin = ''
      const c = compter(m.l, () => { chemin = refuser(m.µ, m.el, m.reg, x, 'id') })
      assert.equal(chemin, attendu)
      assert.equal(c.recherches, 0, 'recherches de position')
    })
  }

  it('production : un refus ne calcule aucun chemin, il ne lit le registre qu’une fois', () => {
    const m = lignes(10)
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: -1, t: 'n' })
    const c = compter(m.l, () => {
      assert.ok(m.µ._mjs_tdeep(m.el, m.reg, m.l[3], 'id', 'zz') === m.µ._mjs_TNO, 'écriture refusée')
    })
    assert.equal(c.lectures, 1, 'lectures du registre')
    assert.equal(c.recherches, 0, 'recherches de position')
    assert.deepEqual(m.µ.warnings, [], 'aucun message en production')
  })

  it('un refus de méthode (ajout refusé, maximum dépassé) cherche la position de la liste elle-même seulement si elle a bougé', () => {
    const µ  = makeMu('warn')
    const el = composant({ board: '{ rows: { cells: { v: int }[] 0..3 }[] }' })
    const board: any = { rows: Array.from({ length: 200 }, (_, r) => ({ cells: [{ v: r }, { v: r + 1 }] })) }
    µ._mjs_tset(el, 'board', board)
    const reg = el._mjs_treg
    const ligne = board.rows[50]
    let c = compter(board.rows, () => {
      assert.equal(appeler(µ, el, reg, ligne.cells, 'push', { v: 'x' }), false)
    })
    assert.ok(µ.warnings[0].startsWith('[ModularJS] $board.rows[50].cells[2].v refuse \'x\''), µ.warnings.join(' | '))
    assert.equal(c.recherches, 0, 'à sa place : aucune recherche')
    appeler(µ, el, reg, board.rows, 'unshift', { cells: [] })
    µ.warnings.length = 0
    c = compter(board.rows, () => {
      assert.equal(appeler(µ, el, reg, ligne.cells, 'push', { v: 'x' }), false)
    })
    assert.ok(µ.warnings[0].startsWith('[ModularJS] $board.rows[51].cells[2].v refuse \'x\''), µ.warnings.join(' | '))
    assert.equal(c.recherches, 1, 'déplacée : une recherche')
  })
})
