// Types — listes typées en développement (`µ._typesMode`, posé par `mjs dev`) : une méthode qui déplace
// des éléments (unshift, shift, splice, sort, reverse) ne coûte pas plus qu'en production, même sur des
// milliers d'éléments. Les chemins des messages (`$messages[4].id`) suivent pourtant l'élément déplacé :
// ils se calculent au moment où un message part, et plus à chaque opération sur la liste (quand chaque
// opération renumérotait la liste entière, 4 000 unshift prenaient plusieurs secondes).

import assert from 'node:assert/strict'
import { makeMu, regle, composant, appeler, refuser } from './helpers/types-runtime.js'

const MESSAGES = '{ id: int, t: string }[]'

// une liste de n messages (id = position de départ), inscrite sous `$messages`
function messages(n: number, mode?: 'warn' | 'error') {
  const µ  = makeMu(mode)
  const el = composant({ messages: MESSAGES })
  const l: any[] = Array.from({ length: n }, (_, i) => ({ id: i, t: 'm' }))
  µ._mjs_tset(el, 'messages', l)
  return { µ, el, reg: el._mjs_treg, l }
}

describe('types — listes en développement : les chemins des messages suivent l’élément déplacé', () => {
  // chaque élément, écrit de travers, se nomme à sa position d'à présent
  function verifier(m: any, apres: string) {
    for (const o of m.l) assert.equal(refuser(m.µ, m.el, m.reg, o, 'id'), '$messages[' + m.l.indexOf(o) + '].id', apres + ', élément ' + o.id)
  }
  const nouveau = (id: number) => ({ id, t: 'n' })

  it('unshift : les éléments décalés, comme les nouveaux', () => {
    const m = messages(4, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', nouveau(90), nouveau(91))
    verifier(m, 'après un unshift de deux')
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', nouveau(92))
    verifier(m, 'après un second unshift')
  })

  it('shift : tous les éléments restants remontent d’une place', () => {
    const m = messages(5, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'shift')
    verifier(m, 'après un shift')
    appeler(m.µ, m.el, m.reg, m.l, 'shift')
    verifier(m, 'après un second shift')
  })

  it('splice : un ajout au milieu, un retrait, un remplacement', () => {
    const m = messages(6, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 2, 0, nouveau(90), nouveau(91))
    verifier(m, 'après un ajout de deux')
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 1, 3)
    verifier(m, 'après un retrait de trois')
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 1, 1, nouveau(92))
    verifier(m, 'après un remplacement')
  })

  it('sort : chaque élément se nomme à sa nouvelle place', () => {
    const m = messages(6, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'sort', (a: any, b: any) => b.id - a.id)
    assert.deepEqual(m.l.map((o: any) => o.id), [5, 4, 3, 2, 1, 0])
    verifier(m, 'après un tri décroissant')
  })

  it('reverse : chaque élément se nomme à sa nouvelle place', () => {
    const m = messages(5, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'reverse')
    assert.deepEqual(m.l.map((o: any) => o.id), [4, 3, 2, 1, 0])
    verifier(m, 'après un reverse')
  })

  it('plusieurs déplacements de suite, sans qu’un message ait parlé entre deux', () => {
    const m = messages(6, 'warn')
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', nouveau(90))
    appeler(m.µ, m.el, m.reg, m.l, 'sort', (a: any, b: any) => b.id - a.id)
    appeler(m.µ, m.el, m.reg, m.l, 'shift')
    appeler(m.µ, m.el, m.reg, m.l, 'reverse')
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 1, 2)
    verifier(m, 'après cinq déplacements')
  })

  it('un élément remplacé par une écriture `$messages[1] = …` se nomme à sa place, puis quand la liste bouge', () => {
    const m = messages(4, 'warn')
    const neuf = nouveau(50)
    assert.equal(m.µ._mjs_tdeep(m.el, m.reg, m.l, 1, neuf), neuf)
    m.l[1] = neuf
    verifier(m, 'après le remplacement')
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', nouveau(51), nouveau(52))
    verifier(m, 'après un unshift')
  })

  it('un élément retiré de la liste, écrit ensuite par une référence gardée : le message part, avec sa dernière position connue, marquée', () => {
    const m = messages(4, 'warn')
    const retire = m.l[2]
    appeler(m.µ, m.el, m.reg, m.l, 'splice', 2, 1)
    assert.equal(refuser(m.µ, m.el, m.reg, retire, 'id'), '$messages[2?].id')
  })

  it('un store : le chemin garde son `$$`, sans nom de composant', () => {
    const µ = makeMu('warn')
    µ._mjs_storeRaw.messages = Array.from({ length: 4 }, (_, i) => ({ id: i, t: 'm' }))
    µ._mjs_storeTypes({ messages: regle(MESSAGES) })
    const l   = µ._mjs_storeRaw.messages
    const reg = µ._mjs_storeTreg
    appeler(µ, null, reg, l, 'unshift', nouveau(90))
    appeler(µ, null, reg, l, 'reverse')
    for (const o of l) assert.equal(refuser(µ, null, reg, o, 'id'), '$$messages[' + l.indexOf(o) + '].id')
    assert.ok(!µ.warnings[0].includes('mjs-essai'))
  })

  it('en production, un conteneur inscrit ne garde aucun lien vers celui qui le porte : rien ne retient une liste qu’un élément gardé survit à', () => {
    const m = messages(3)
    appeler(m.µ, m.el, m.reg, m.l, 'unshift', nouveau(90))
    for (const o of m.l) assert.equal(m.reg.get(o).up, undefined)
    const d = messages(3, 'warn')
    assert.ok(d.reg.get(d.l[1]).up.deref() === d.l, 'en développement, le lien existe, par une référence faible')
  })
})

describe('types — listes en développement : sous un élément déplacé, tout suit', () => {
  const REGLE = '{ rows: { cells: { v: int }[] 0..3 }[] }'

  function tableau() {
    const µ  = makeMu('warn')
    const el = composant({ board: REGLE })
    const board: any = { rows: [0, 1, 2].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
    µ._mjs_tset(el, 'board', board)
    return { µ, el, reg: el._mjs_treg, board }
  }
  const cible = (b: any, row: any, cell: any) => '$board.rows[' + b.rows.indexOf(row) + '].cells[' + row.cells.indexOf(cell) + '].v'

  // chaque case, écrite de travers, se nomme par la position actuelle de sa ligne et d'elle-même
  function verifier(t: any, apres: string) {
    for (const row of t.board.rows) for (const cell of row.cells) assert.equal(refuser(t.µ, t.el, t.reg, cell, 'v'), cible(t.board, row, cell), apres)
  }

  it('les lignes bougent : leurs cases se nomment par la nouvelle position de la ligne', () => {
    const t = tableau()
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    verifier(t, 'après reverse des lignes')
    appeler(t.µ, t.el, t.reg, t.board.rows, 'unshift', { cells: [{ v: 7 }] })
    verifier(t, 'après unshift d’une ligne')
    appeler(t.µ, t.el, t.reg, t.board.rows, 'shift')
    verifier(t, 'après shift d’une ligne')
  })

  it('les cases d’une ligne bougent : une autre ligne et la ligne elle-même gardent un chemin juste', () => {
    const t = tableau()
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    appeler(t.µ, t.el, t.reg, t.board.rows[1].cells, 'unshift', { v: 8 })
    verifier(t, 'après unshift de cases')
    appeler(t.µ, t.el, t.reg, t.board.rows[1].cells, 'reverse')
    verifier(t, 'après reverse de cases')
  })

  it('une case refusée à l’ajout dans une liste qui a bougé : le message nomme la ligne d’à présent', () => {
    const t   = tableau()
    const row = t.board.rows[0]
    appeler(t.µ, t.el, t.reg, t.board.rows, 'unshift', { cells: [] })
    t.µ.warnings.length = 0
    assert.equal(appeler(t.µ, t.el, t.reg, row.cells, 'push', { v: 'x' }), false)
    assert.equal(row.cells.length, 2, 'la case refusée n’est pas gardée')
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[1].cells[2].v refuse \'x\''), t.µ.warnings.join(' | '))
  })

  it('la longueur d’une liste de cases, et la suppression d’un champ obligatoire, se nomment à la position d’à présent', () => {
    const t   = tableau()
    const row = t.board.rows[2]
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    t.µ.warnings.length = 0
    assert.equal(t.µ._mjs_tdeep(t.el, t.reg, row.cells, 'length', 9), t.µ._mjs_TNO)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[0].cells.length refuse 9'), t.µ.warnings.join(' | '))
    t.µ.warnings.length = 0
    assert.equal(t.µ._mjs_tdelete(t.el, t.reg, row.cells[1], 'v'), false)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[0].cells[1].v refuse undefined'), t.µ.warnings.join(' | '))
  })

  it('une liste de cases revérifiée en entier (méthode hors des sept connues) garde son chemin, même quand sa ligne bouge ensuite', () => {
    const t   = tableau()
    const row = t.board.rows[0]
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    appeler(t.µ, t.el, t.reg, row.cells, 'copyWithin', 0, 1)
    appeler(t.µ, t.el, t.reg, t.board.rows, 'unshift', { cells: [] })
    t.µ.warnings.length = 0
    assert.equal(appeler(t.µ, t.el, t.reg, row.cells, 'push', { v: 'x' }), false)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[3].cells[2].v refuse \'x\''), t.µ.warnings.join(' | '))
  })

  it('une liste de cases refusée en entier (fill) revient à son état d’avant, et le message nomme la ligne d’à présent', () => {
    const t     = tableau()
    const row   = t.board.rows[0]
    const avant = row.cells.slice()
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    t.µ.warnings.length = 0
    assert.equal(appeler(t.µ, t.el, t.reg, row.cells, 'fill', { v: 'x' }), false)
    assert.ok(row.cells.length === 2 && row.cells[0] === avant[0] && row.cells[1] === avant[1], 'les cases d’avant, chacune à sa place')
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[2].cells[0].v refuse \'x\''), t.µ.warnings.join(' | '))
  })

  it('un maximum dépassé par push, une case remplacée par une valeur refusée, un indice au-delà du maximum : la ligne d’à présent', () => {
    const t   = tableau()
    const row = t.board.rows[2]
    appeler(t.µ, t.el, t.reg, t.board.rows, 'reverse')
    t.µ.warnings.length = 0
    assert.equal(appeler(t.µ, t.el, t.reg, row.cells, 'push', { v: 1 }, { v: 2 }), false)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[0].cells refuse'), t.µ.warnings.join(' | '))
    t.µ.warnings.length = 0
    assert.equal(t.µ._mjs_tdeep(t.el, t.reg, row.cells, 0, { v: 'x' }), t.µ._mjs_TNO)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[0].cells[0].v refuse \'x\''), t.µ.warnings.join(' | '))
    t.µ.warnings.length = 0
    assert.equal(t.µ._mjs_tdeep(t.el, t.reg, row.cells, 3, { v: 1 }), t.µ._mjs_TNO)
    assert.ok(t.µ.warnings[0].startsWith('[ModularJS] $board.rows[0].cells[3] refuse'), t.µ.warnings.join(' | '))
  })
})

// des notes plus riches que les messages (un objet, un objet dedans, une liste dedans) : une liste de
// 4 000 notes porte 12 000 conteneurs au registre
const NOTE = '{ id: int, t: string, par: { nom: string, rang: int }, tags: string[] }'
const note = (id: number) => ({ id, t: 'm', par: { nom: 'n', rang: 1 }, tags: ['a', 'b'] })

function notes(n: number, mode?: 'warn' | 'error') {
  const µ  = makeMu(mode)
  const el = composant({ notes: NOTE + '[]' })
  const l: any[] = Array.from({ length: n }, (_, i) => note(i))
  µ._mjs_tset(el, 'notes', l)
  return { µ, el, reg: el._mjs_treg, l }
}

// nombre de lectures du registre pendant `fn` : une opération qui reparcourt la liste en fait une par élément
function lectures(fn: () => void): number {
  const get0 = WeakMap.prototype.get
  let n = 0
  WeakMap.prototype.get = function (this: any, cle: any) { n++; return get0.call(this, cle) }
  try {
    fn()
  }
  finally {
    WeakMap.prototype.get = get0
  }
  return n
}

describe('types — listes en développement : une opération ne reparcourt pas la liste', () => {
  const OPERATIONS: Record<string, (m: any) => void> = {
    'unshift':                                      (m) => { appeler(m.µ, m.el, m.reg, m.l, 'unshift', note(9999)) },
    'shift':                                        (m) => { appeler(m.µ, m.el, m.reg, m.l, 'shift') },
    'splice (un ajout, puis un retrait au milieu)': (m) => { appeler(m.µ, m.el, m.reg, m.l, 'splice', 2000, 0, note(9999)); appeler(m.µ, m.el, m.reg, m.l, 'splice', 2000, 1) },
    'sort':                                         (m) => { appeler(m.µ, m.el, m.reg, m.l, 'sort', (a: any, b: any) => a.id - b.id) },
    'reverse':                                      (m) => { appeler(m.µ, m.el, m.reg, m.l, 'reverse') },
  }

  for (const [nom, operation] of Object.entries(OPERATIONS)) {
    it(nom + ' sur 4 000 notes : le registre est lu quelques fois, pas une fois par note', () => {
      const m = notes(4000, 'warn')
      const n = lectures(() => operation(m))
      assert.ok(n <= 10, 'lectures du registre : ' + n)
      assert.deepEqual(m.µ.warnings, [], 'aucun message : toutes les valeurs sont permises')
    })
  }
})

// le temps d'une série d'opérations : la même série, en production puis en développement, se mesure dans
// le même test ; le développement peut coûter un peu plus (les messages se préparent), jamais un nombre de
// fois la production
describe('types — listes en développement : une série d’opérations ne coûte pas plus qu’en production', function () {
  this.timeout(240000)

  const FACTEUR = 20
  const MARGE   = 500

  const SERIES = [
    {
      nom: '4 000 unshift', depart: 0, attendu: 4000,
      jouer: (m: any) => { for (let i = 0; i < 4000; i++) appeler(m.µ, m.el, m.reg, m.l, 'unshift', note(i)) },
    },
    {
      nom: '2 000 shift sur une liste de 4 000', depart: 4000, attendu: 2000,
      jouer: (m: any) => { for (let i = 0; i < 2000; i++) appeler(m.µ, m.el, m.reg, m.l, 'shift') },
    },
  ]

  // durée de la série, en ms ; la liste de départ se monte avant la mesure
  function duree(mode: 'warn' | undefined, s: (typeof SERIES)[number]): number {
    const m  = notes(s.depart, mode)
    const t0 = performance.now()
    s.jouer(m)
    const ms = performance.now() - t0
    assert.equal(m.l.length, s.attendu, 'la liste a la longueur attendue')
    assert.deepEqual(m.µ.warnings, [], 'aucun message : toutes les valeurs sont permises')
    return ms
  }

  for (const s of SERIES) {
    it(s.nom + ' : au plus ' + FACTEUR + ' fois la production', () => {
      let prod = 0
      let dev  = 0
      // un délai qui échoue se rejoue une fois seul : la machine de test est partagée
      for (let tour = 0; tour < 2; tour++) {
        prod = duree(undefined, s)
        dev  = duree('warn', s)
        if (dev <= prod * FACTEUR + MARGE) break
      }
      assert.ok(dev <= prod * FACTEUR + MARGE, 'développement ' + Math.round(dev) + ' ms, production ' + Math.round(prod) + ' ms')
    })
  }
})
