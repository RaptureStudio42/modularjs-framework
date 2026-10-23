// types — la marque `?` d'un chemin ne couvre pas que le retrait en place d'un élément : une liste REMPLACÉE
// (`$choisies = []`, `$todos = $todos.filter(…)`, store remplacé) laisse l'élément gardé par l'appli nommé à une
// position de la liste d'avant. Le registre connaît la valeur courante de chaque racine (`$x`, `$$x`) : une
// chaîne dont le sommet n'est plus cette valeur marque ses positions d'un point d'interrogation. Un élément
// qui est encore dans la nouvelle liste s'y nomme à sa place d'à présent, sans marque

import assert from 'node:assert/strict'
import { makeMu, regle, composant, appeler, refuser } from './helpers/types-runtime.js'

const MODES = ['warn', 'error'] as const

const LIGNES = '{ id: int }[]'

function todos(mode: 'warn' | 'error', n = 3) {
  const µ  = makeMu(mode)
  const el = composant({ todos: LIGNES })
  const l: any[] = Array.from({ length: n }, (_, i) => ({ id: i }))
  µ._mjs_tset(el, 'todos', l)
  return { µ, el, reg: el._mjs_treg, l }
}

describe('types — une liste remplacée : l’élément gardé par l’appli se nomme avec la marque', () => {
  for (const mode of MODES) {
    it(mode + ' : `$todos = $todos.filter(…)` — l’élément écarté est marqué, ceux qui restent se nomment à leur place', () => {
      const t  = todos(mode)
      const x  = t.l[1]
      const nl = t.l.filter((o) => o !== x)
      assert.ok(t.µ._mjs_tset(t.el, 'todos', nl) === nl, 'la nouvelle liste est permise')
      assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[1?].id', 'l’ancienne liste le nommait en 1 ; $todos[1] est maintenant un autre élément')
      assert.equal(refuser(t.µ, t.el, t.reg, nl[0], 'id'), '$todos[0].id')
      assert.equal(refuser(t.µ, t.el, t.reg, nl[1], 'id'), '$todos[1].id', 'l’élément d’avant en 2 est maintenant en 1, sans marque')
    })

    it(mode + ' : `$choisies = []` — un élément partagé, retiré de `$choisies` par le remplacement de la liste', () => {
      const µ  = makeMu(mode)
      const el = composant({ tout: LIGNES, choisies: LIGNES })
      const tout: any[]     = [{ id: 0 }, { id: 1 }, { id: 2 }]
      const choisies: any[] = []
      µ._mjs_tset(el, 'tout', tout)
      µ._mjs_tset(el, 'choisies', choisies)
      const reg = el._mjs_treg
      const x   = tout[2]
      appeler(µ, el, reg, choisies, 'push', x)
      assert.equal(refuser(µ, el, reg, x, 'id'), '$choisies[0].id', 'inscrit dans choisies : sa position est juste')
      µ._mjs_tset(el, 'choisies', [])
      assert.equal(refuser(µ, el, reg, x, 'id'), '$choisies[0?].id', '$choisies n’a plus d’élément : la position n’est plus connue')
    })
  }

  it('une liste remplacée par une liste de mêmes éléments (`$todos = [...$todos]`) : chacun se nomme à sa place, sans marque', () => {
    const t  = todos('warn')
    const nl = [...t.l].reverse()
    t.µ._mjs_tset(t.el, 'todos', nl)
    for (const o of nl) assert.equal(refuser(t.µ, t.el, t.reg, o, 'id'), '$todos[' + nl.indexOf(o) + '].id')
  })

  it('la même liste écrite de nouveau (`$todos = $todos`) : aucun élément n’est marqué', () => {
    const t = todos('warn')
    t.µ._mjs_tset(t.el, 'todos', t.l)
    for (const o of t.l) assert.equal(refuser(t.µ, t.el, t.reg, o, 'id'), '$todos[' + t.l.indexOf(o) + '].id')
  })

  it('une liste remplacée puis remise (`$todos = ancienne`) : ses éléments se nomment de nouveau sans marque', () => {
    const t  = todos('warn')
    const x  = t.l[1]
    const nl = t.l.filter((o) => o !== x)
    t.µ._mjs_tset(t.el, 'todos', nl)
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[1?].id')
    t.µ._mjs_tset(t.el, 'todos', t.l)
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[1].id')
  })

  it('une écriture refusée n’est pas une écriture : la liste d’avant reste la courante, ses éléments sans marque', () => {
    const t = todos('warn')
    assert.ok(t.µ._mjs_tset(t.el, 'todos', [{ id: 'zz' }]) === t.µ._mjs_TNO, 'une liste refusée')
    for (const o of t.l) assert.equal(refuser(t.µ, t.el, t.reg, o, 'id'), '$todos[' + t.l.indexOf(o) + '].id')
  })

  it('un retrait en place, puis le remplacement de la liste : la marque reste une seule', () => {
    const t = todos('warn')
    const x = t.l[1]
    appeler(t.µ, t.el, t.reg, t.l, 'splice', 1, 1)
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[1?].id')
    t.µ._mjs_tset(t.el, 'todos', [{ id: 7 }])
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[1?].id')
  })

  it('un élément déplacé dans sa liste, la liste remplacée ensuite : la dernière position connue, marquée', () => {
    const t = todos('warn')
    const x = t.l[2]
    appeler(t.µ, t.el, t.reg, t.l, 'unshift', { id: 9 })
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[3].id', 'la liste vit encore : la position se retrouve')
    t.µ._mjs_tset(t.el, 'todos', [{ id: 7 }])
    assert.equal(refuser(t.µ, t.el, t.reg, x, 'id'), '$todos[3?].id')
  })
})

describe('types — des listes imbriquées : la racine remplacée marque chaque position du chemin', () => {
  const BOARD = '{ rows: { cells: { v: int }[] }[] }'

  function tableau(mode: 'warn' | 'error') {
    const µ  = makeMu(mode)
    const el = composant({ board: BOARD })
    const board: any = { rows: [0, 1, 2].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
    µ._mjs_tset(el, 'board', board)
    return { µ, el, reg: el._mjs_treg, board }
  }

  for (const mode of MODES) {
    it(mode + ' : `$board` remplacé — une case gardée par l’appli se nomme avec une marque sur chaque position', () => {
      const t    = tableau(mode)
      const case1 = t.board.rows[1].cells[0]
      assert.equal(refuser(t.µ, t.el, t.reg, case1, 'v'), '$board.rows[1].cells[0].v')
      t.µ._mjs_tset(t.el, 'board', { rows: [] })
      assert.equal(refuser(t.µ, t.el, t.reg, case1, 'v'), '$board.rows[1?].cells[0?].v')
    })

    it(mode + ' : `$board.rows` remplacé par une liste neuve (champ remplacé) — le nom des cases suit les lignes d’à présent', () => {
      const t     = tableau(mode)
      const ligne = t.board.rows[2]
      const neuf  = [t.board.rows[0], ligne]
      assert.ok(t.µ._mjs_tdeep(t.el, t.reg, t.board, 'rows', neuf) === neuf, 'écriture acceptée')
      t.board.rows = neuf
      assert.equal(refuser(t.µ, t.el, t.reg, ligne.cells[1], 'v'), '$board.rows[1].cells[1].v')
    })
  }
})

describe('types — un store remplacé : l’élément gardé par l’appli se nomme avec la marque', () => {
  function store(mode: 'warn' | 'error') {
    const µ = makeMu(mode)
    µ._mjs_storeRaw.items = [{ id: 0 }, { id: 1 }, { id: 2 }]
    µ._mjs_storeTypes({ items: regle(LIGNES) })
    return { µ, reg: µ._mjs_storeTreg, l: µ._mjs_storeRaw.items as any[] }
  }

  // ce que fait `µ._storeSet` autour de la règle : le contrôle, puis l'écriture dans le store brut
  function remplacer(s: { µ: any }, valeur: any[]) {
    const w = s.µ._mjs_tstore('items', valeur)
    assert.ok(w !== s.µ._mjs_TNO, 'la nouvelle liste est permise')
    s.µ._mjs_storeRaw.items = w
  }

  for (const mode of MODES) {
    it(mode + ' : `$$items = [{ id: 7 }]` — l’ancien élément en 2 se nomme `$$items[2?]`', () => {
      const s = store(mode)
      const x = s.l[2]
      assert.equal(refuser(s.µ, null, s.reg, x, 'id'), '$$items[2].id')
      remplacer(s, [{ id: 7 }])
      assert.equal(refuser(s.µ, null, s.reg, x, 'id'), '$$items[2?].id')
      assert.equal(refuser(s.µ, null, s.reg, s.µ._mjs_storeRaw.items[0], 'id'), '$$items[0].id', 'l’élément neuf se nomme à sa place')
    })
  }

  it('un élément gardé dans la nouvelle liste se nomme à sa nouvelle place, sans marque', () => {
    const s = store('warn')
    const x = s.l[2]
    remplacer(s, [{ id: 8 }, x])
    assert.equal(refuser(s.µ, null, s.reg, x, 'id'), '$$items[1].id')
  })
})

describe('types — la production ne tient aucune valeur courante de racine', () => {
  it('aucun registre de racines, aucun message à nommer', () => {
    const µ  = makeMu()
    const el = composant({ todos: LIGNES })
    µ._mjs_tset(el, 'todos', [{ id: 0 }])
    µ._mjs_tset(el, 'todos', [{ id: 1 }])
    assert.equal(el._mjs_treg._mjs_roots, undefined)
    µ._mjs_storeRaw.items = [{ id: 0 }]
    µ._mjs_storeTypes({ items: regle(LIGNES) })
    assert.equal(µ._mjs_storeTreg._mjs_roots, undefined)
  })

  it('en développement, une seule valeur courante par racine, tenue faiblement : une liste remplacée peut être ramassée', () => {
    const µ  = makeMu('warn')
    const el = composant({ todos: LIGNES, autres: LIGNES })
    µ._mjs_tset(el, 'todos', [{ id: 0 }])
    µ._mjs_tset(el, 'todos', [{ id: 1 }])
    µ._mjs_tset(el, 'autres', [{ id: 2 }])
    assert.deepEqual(Object.keys(el._mjs_treg._mjs_roots).sort(), ['$autres', '$todos'])
    for (const k of Object.keys(el._mjs_treg._mjs_roots)) assert.equal(typeof el._mjs_treg._mjs_roots[k].deref, 'function', k + ' : une référence faible')
  })
})
