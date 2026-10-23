// types — les chemins que nomment les messages d'une liste typée, dans les cas que les autres tests laissaient
// sans garde : le mode erreur (l'erreur nomme le chemin d'à présent, comme l'avertissement), un champ d'objet ou
// un élément remplacé par une liste neuve, un choix entre plusieurs formes (liste d'un type nommé, champ qui
// en est un), une clé qui n'est pas un identifiant (`$x['a-b'].c`)

import assert from 'node:assert/strict'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

describe('types — le mode erreur nomme les mêmes chemins que l’avertissement', () => {
  const MESSAGES = '{ id: int, t: string }[]'

  function messages(n: number) {
    const µ  = makeMu('error')
    const el = composant({ messages: MESSAGES })
    const l: any[] = Array.from({ length: n }, (_, i) => ({ id: i, t: 'm' }))
    µ._mjs_tset(el, 'messages', l)
    return { µ, el, reg: el._mjs_treg, l }
  }

  const GESTES: Record<string, (m: any) => void> = {
    'unshift':                  (m) => { appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 90, t: 'n' }, { id: 91, t: 'n' }) },
    'shift':                    (m) => { appeler(m.µ, m.el, m.reg, m.l, 'shift') },
    'splice (retrait, ajout)':  (m) => { appeler(m.µ, m.el, m.reg, m.l, 'splice', 1, 2, { id: 92, t: 'n' }) },
    'sort':                     (m) => { appeler(m.µ, m.el, m.reg, m.l, 'sort', (a: any, b: any) => b.id - a.id) },
    'reverse':                  (m) => { appeler(m.µ, m.el, m.reg, m.l, 'reverse') },
  }

  for (const [nom, geste] of Object.entries(GESTES)) {
    it('après ' + nom + ', chaque élément écrit de travers se nomme à sa place', () => {
      const m = messages(6)
      geste(m)
      for (const o of m.l) assert.equal(refuser(m.µ, m.el, m.reg, o, 'id'), '$messages[' + m.l.indexOf(o) + '].id')
    })
  }

  it('une méthode refusée, une longueur refusée, un champ obligatoire supprimé : la liste, ou son élément, à la position d’à présent', () => {
    const µ  = makeMu('error')
    const el = composant({ board: '{ rows: { cells: { v: int }[] 0..3 }[] }' })
    const board: any = { rows: [0, 1, 2].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
    µ._mjs_tset(el, 'board', board)
    const reg = el._mjs_treg
    const ligne = board.rows[0]
    appeler(µ, el, reg, board.rows, 'reverse')
    assert.throws(() => appeler(µ, el, reg, ligne.cells, 'push', { v: 'x' }), { message: /^\[ModularJS\] \$board\.rows\[2\]\.cells\[2\]\.v refuse 'x'/ })
    assert.equal(ligne.cells.length, 2, 'la case refusée n’est pas gardée')
    assert.throws(() => appeler(µ, el, reg, ligne.cells, 'push', { v: 1 }, { v: 2 }), { message: /^\[ModularJS\] \$board\.rows\[2\]\.cells refuse/ })
    assert.equal(ligne.cells.length, 2, 'la liste revient à son état d’avant')
    assert.throws(() => µ._mjs_tdeep(el, reg, ligne.cells, 'length', 9), { message: /^\[ModularJS\] \$board\.rows\[2\]\.cells\.length refuse 9/ })
    assert.throws(() => µ._mjs_tdelete(el, reg, ligne.cells[1], 'v'), { message: /^\[ModularJS\] \$board\.rows\[2\]\.cells\[1\]\.v refuse undefined/ })
    assert.throws(() => µ._mjs_tdeep(el, reg, ligne.cells, 3, { v: 1 }), { message: /^\[ModularJS\] \$board\.rows\[2\]\.cells\[3\] refuse/ })
  })

  it('une valeur ramenée dans sa plage par une méthode, sur une liste qui a bougé : l’erreur la nomme, la liste revient à son état d’avant', () => {
    const µ  = makeMu('error')
    const el = composant({ board: '{ rows: { notes: int 0..100[] }[] }' })
    const board: any = { rows: [{ notes: [5] }, { notes: [6] }] }
    µ._mjs_tset(el, 'board', board)
    const reg = el._mjs_treg
    const ligne = board.rows[0]
    appeler(µ, el, reg, board.rows, 'reverse')
    assert.throws(() => appeler(µ, el, reg, ligne.notes, 'unshift', 150), { message: /^\[ModularJS\] \$board\.rows\[1\]\.notes\[0\] : 150 ramené à 100/ })
    assert.deepEqual(ligne.notes, [5])
    assert.throws(() => appeler(µ, el, reg, ligne.notes, 'fill', 150), { message: /^\[ModularJS\] \$board\.rows\[1\]\.notes\[0\] : 150 ramené à 100/ })
    assert.deepEqual(ligne.notes, [5])
  })
})

describe('types — un champ ou un élément remplacé par une liste neuve se nomme à sa place', () => {
  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : un champ d’objet remplacé par une liste, puis la liste qui bouge', () => {
      const µ  = makeMu(mode)
      const el = composant({ fiche: '{ nom: string, tags: { label: string }[] }' })
      const fiche: any = { nom: 'a', tags: [{ label: 'x' }] }
      µ._mjs_tset(el, 'fiche', fiche)
      const reg   = el._mjs_treg
      const neuve = [{ label: 'y' }, { label: 'z' }]
      assert.ok(µ._mjs_tdeep(el, reg, fiche, 'tags', neuve) === neuve, 'la liste neuve est acceptée')
      fiche.tags = neuve
      assert.equal(refuser(µ, el, reg, neuve[1], 'label', null), '$fiche.tags[1].label')
      appeler(µ, el, reg, neuve, 'unshift', { label: 'w' })
      assert.equal(refuser(µ, el, reg, neuve[2], 'label', null), '$fiche.tags[2].label')
      assert.equal(refuser(µ, el, reg, neuve, 'length', 99), '$fiche.tags.length')
    })

    it(mode + ' : un élément de liste remplacé par une liste, puis la liste qui bouge', () => {
      const µ  = makeMu(mode)
      const el = composant({ grille: '{ v: int }[][]' })
      const grille: any[] = [[{ v: 1 }], [{ v: 2 }]]
      µ._mjs_tset(el, 'grille', grille)
      const reg   = el._mjs_treg
      const neuve = [{ v: 3 }, { v: 4 }]
      assert.ok(µ._mjs_tdeep(el, reg, grille, 1, neuve) === neuve, 'la ligne neuve est acceptée')
      grille[1] = neuve
      assert.equal(refuser(µ, el, reg, neuve[1], 'v', null), '$grille[1][1].v')
      appeler(µ, el, reg, grille, 'unshift', [{ v: 5 }])
      assert.equal(refuser(µ, el, reg, neuve[1], 'v', null), '$grille[2][1].v')
    })
  }

  it('un objet remplacé dans un champ, ses propres champs ensuite : le champ de leur parent', () => {
    const µ  = makeMu('warn')
    const el = composant({ fiche: '{ nom: string, auteur: { prenom: string, tags: string[] } }' })
    const fiche: any = { nom: 'a', auteur: { prenom: 'p', tags: [] } }
    µ._mjs_tset(el, 'fiche', fiche)
    const reg   = el._mjs_treg
    const neuf  = { prenom: 'q', tags: ['t'] }
    assert.ok(µ._mjs_tdeep(el, reg, fiche, 'auteur', neuf) === neuf, 'l’auteur neuf est accepté')
    fiche.auteur = neuf
    assert.equal(refuser(µ, el, reg, neuf, 'prenom', null), '$fiche.auteur.prenom')
    assert.equal(refuser(µ, el, reg, neuf.tags, 0, null), '$fiche.auteur.tags[0]')
  })
})

describe('types — un choix entre plusieurs formes garde les liens de ce qu’il contrôle', () => {
  const DEFS = { Item: '{ id: int } | { name: string }' }

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : une liste d’un type nommé qui est un choix : un élément qui bouge se nomme à sa place', () => {
      const µ  = makeMu(mode)
      const el = composant({ l: 'Item[]' }, DEFS)
      const l: any[] = [{ id: 1 }, { name: 'a' }, { id: 3 }]
      µ._mjs_tset(el, 'l', l)
      const reg = el._mjs_treg
      appeler(µ, el, reg, l, 'unshift', { id: 0 })
      assert.equal(refuser(µ, el, reg, l[3], 'id'), '$l[3].id')
      assert.equal(refuser(µ, el, reg, l[2], 'name', null), '$l[2].name')
      appeler(µ, el, reg, l, 'reverse')
      assert.equal(refuser(µ, el, reg, l[0], 'id'), '$l[0].id')
      assert.equal(refuser(µ, el, reg, l[1], 'name', null), '$l[1].name')
    })

    it(mode + ' : un champ qui est un choix, dans une ligne qui bouge', () => {
      const µ  = makeMu(mode)
      const el = composant({ l: '{ choix: Item, note: string }[]' }, DEFS)
      const l: any[] = [{ choix: { id: 1 }, note: 'a' }, { choix: { name: 'b' }, note: 'b' }]
      µ._mjs_tset(el, 'l', l)
      const reg = el._mjs_treg
      appeler(µ, el, reg, l, 'unshift', { choix: { id: 0 }, note: 'z' })
      assert.equal(refuser(µ, el, reg, l[1].choix, 'id'), '$l[1].choix.id')
      assert.equal(refuser(µ, el, reg, l[2].choix, 'name', null), '$l[2].choix.name')
    })
  }

  it('un choix entre une liste et un objet : la liste d’un champ, quand sa ligne bouge', () => {
    const µ  = makeMu('warn')
    const el = composant({ l: '{ contenu: Contenu }[]' }, { Contenu: '{ id: int }[] | { name: string }' })
    const l: any[] = [{ contenu: [{ id: 1 }] }, { contenu: { name: 'b' } }]
    µ._mjs_tset(el, 'l', l)
    const reg = el._mjs_treg
    appeler(µ, el, reg, l, 'unshift', { contenu: { name: 'z' } })
    assert.equal(refuser(µ, el, reg, l[1].contenu[0], 'id', null), '$l[1].contenu[0].id')
    assert.equal(refuser(µ, el, reg, l[2].contenu, 'name', null), '$l[2].contenu.name')
  })
})

describe('types — une clé qui n’est pas un identifiant se nomme entre crochets', () => {
  const REGLE = "{ 'a-b': { c: int }, \"it's\": { c: int }, 'a b': { c: int }[] }"

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : à la racine, par une écriture profonde', () => {
      const µ  = makeMu(mode)
      const el = composant({ x: REGLE })
      const x: any = { 'a-b': { c: 1 }, "it's": { c: 2 }, 'a b': [{ c: 3 }] }
      µ._mjs_tset(el, 'x', x)
      const reg = el._mjs_treg
      assert.equal(refuser(µ, el, reg, x['a-b'], 'c'), "$x['a-b'].c")
      assert.equal(refuser(µ, el, reg, x["it's"], 'c'), "$x['it\\'s'].c")
      assert.equal(refuser(µ, el, reg, x['a b'][0], 'c'), "$x['a b'][0].c")
      assert.equal(refuser(µ, el, reg, x['a b'], 0, null), "$x['a b'][0]")
    })

    it(mode + ' : un objet remplacé à cette clé, ou écrit en entier, se nomme avec ses champs', () => {
      const µ  = makeMu(mode)
      const el = composant({ x: REGLE })
      const x: any = { 'a-b': { c: 1 }, "it's": { c: 2 }, 'a b': [{ c: 3 }] }
      µ._mjs_tset(el, 'x', x)
      const reg = el._mjs_treg
      assert.equal(refuser(µ, el, reg, x, 'a-b', { c: 'zz' }), "$x['a-b'].c")
      assert.equal(refuser(µ, el, reg, x, "it's", { c: 'zz' }), "$x['it\\'s'].c")
      assert.equal(refuser(µ, el, reg, x, 'a b', [{ c: 'zz' }]), "$x['a b'][0].c")
    })

    it(mode + ' : dans une ligne qui bouge', () => {
      const µ  = makeMu(mode)
      const el = composant({ x: "{ rows: { 'a-b': { c: int } }[] }" })
      const x: any = { rows: [{ 'a-b': { c: 1 } }, { 'a-b': { c: 2 } }] }
      µ._mjs_tset(el, 'x', x)
      const reg = el._mjs_treg
      appeler(µ, el, reg, x.rows, 'unshift', { 'a-b': { c: 0 } })
      assert.equal(refuser(µ, el, reg, x.rows[2]['a-b'], 'c'), "$x.rows[2]['a-b'].c")
      appeler(µ, el, reg, x.rows, 'reverse')
      assert.equal(refuser(µ, el, reg, x.rows[0]['a-b'], 'c'), "$x.rows[0]['a-b'].c")
    })
  }
})
