// types — un élément qui n'est plus dans la liste où il a été inscrit (retiré, ou partagé avec une autre liste
// puis retiré de celle-là) ne se nomme pas à une position qui n'existe plus : le message marque sa dernière
// position connue d'un point d'interrogation (`$choisies[0?].id`), et un élément remis dans sa liste, lui,
// se retrouve à sa vraie place

import assert from 'node:assert/strict'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

const MODES = ['warn', 'error'] as const

describe('types — un élément partagé entre deux listes, retiré de celle où il était inscrit', () => {
  for (const mode of MODES) {
    it(mode + ' : le message ne nomme plus la position qu’il avait dans cette liste', () => {
      const µ  = makeMu(mode)
      const el = composant({ tout: '{ id: int }[]', choisies: '{ id: int }[]' })
      const tout: any[]     = [{ id: 0 }, { id: 1 }, { id: 2 }]
      const choisies: any[] = []
      µ._mjs_tset(el, 'tout', tout)
      µ._mjs_tset(el, 'choisies', choisies)
      const reg = el._mjs_treg
      const x   = tout[2]
      appeler(µ, el, reg, choisies, 'push', x)
      assert.equal(refuser(µ, el, reg, x, 'id'), '$choisies[0].id', 'inscrit dans choisies : sa position est juste')
      appeler(µ, el, reg, tout, 'unshift', { id: 9 })
      assert.equal(refuser(µ, el, reg, x, 'id'), '$choisies[0].id', 'tout a bougé, pas choisies')
      appeler(µ, el, reg, choisies, 'splice', 0, 1)
      assert.equal(choisies.length, 0)
      assert.equal(refuser(µ, el, reg, x, 'id'), '$choisies[0?].id', 'retiré de choisies : la position n’est plus connue')
    })
  }
})

describe('types — un élément retiré de sa liste, gardé par l’appli', () => {
  const MESSAGES = '{ id: int, t: string }[]'

  function messages(mode: 'warn' | 'error', n = 5) {
    const µ  = makeMu(mode)
    const el = composant({ messages: MESSAGES })
    const l: any[] = Array.from({ length: n }, (_, i) => ({ id: i, t: 'm' }))
    µ._mjs_tset(el, 'messages', l)
    return { µ, el, reg: el._mjs_treg, l }
  }

  for (const mode of MODES) {
    it(mode + ' : sa dernière position, marquée', () => {
      const m = messages(mode)
      const retire = m.l[2]
      appeler(m.µ, m.el, m.reg, m.l, 'splice', 2, 1)
      assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[2?].id')
    })

    it(mode + ' : retiré après un déplacement de la liste, la position marquée est la dernière connue, pas la première', () => {
      const m = messages(mode)
      const retire = m.l[2]
      appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 90, t: 'n' })
      assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[3].id', 'déplacé, retrouvé')
      appeler(m.µ, m.el, m.reg, m.l, 'splice', 3, 1)
      assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[3?].id')
    })
  }

  it('un élément rangé de nouveau dans sa liste (sans passer par une méthode contrôlée) se retrouve à sa vraie place, sans marque', () => {
    const m = messages('warn')
    const retire = m.l[2]
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 2, 1)
    m.l.push(retire)
    assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[4].id')
    m.l.unshift({ id: 91, t: 'n' })
    assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[5].id')
  })

  it('un élément remis par une méthode contrôlée se nomme à sa nouvelle position, sans marque', () => {
    const m = messages('warn')
    const retire = m.l[2]
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 2, 1)
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', retire)
    assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[0].id')
  })
})

describe('types — un élément retiré d’une liste imbriquée : la marque tient la place de la position perdue, le reste du chemin est celui d’à présent', () => {
  const REGLE = '{ rows: { cells: { v: int }[] }[] }'

  function tableau(mode: 'warn' | 'error') {
    const µ  = makeMu(mode)
    const el = composant({ board: REGLE })
    const board: any = { rows: [0, 1, 2].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
    µ._mjs_tset(el, 'board', board)
    return { µ, el, reg: el._mjs_treg, board }
  }

  for (const mode of MODES) {
    it(mode + ' : une case retirée de sa ligne, la ligne ayant bougé', () => {
      const t    = tableau(mode)
      const ligne = t.board.rows[0]
      const case0 = ligne.cells[0]
      appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
      appeler(t.µ, t.el, t.reg, ligne.cells, 'splice', 0, 1)
      assert.equal(refuser(t.µ, t.el, t.reg, case0, 'v'), '$board.rows[2].cells[0?].v')
      assert.equal(refuser(t.µ, t.el, t.reg, ligne.cells[0], 'v'), '$board.rows[2].cells[0].v', 'la case qui reste se nomme à sa place')
    })

    it(mode + ' : une ligne retirée du tableau, ses cases restent dans la ligne', () => {
      const t    = tableau(mode)
      const ligne = t.board.rows[1]
      appeler(t.µ, t.el, t.reg, t.board.rows, 'splice', 1, 1)
      assert.equal(refuser(t.µ, t.el, t.reg, ligne.cells[1], 'v'), '$board.rows[1?].cells[1].v')
    })
  }
})
