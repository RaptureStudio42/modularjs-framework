// types — en développement, un conteneur inscrit ne retient que faiblement celui qui le porte : une appli qui
// garde un élément hors de sa liste (une sélection, un historique) ne retient pas la liste entière, ni les
// autres éléments. La production ne garde aucun lien, et n'en crée aucune référence faible

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

// le ramasse-miettes à la demande, sans relancer node avec --expose-gc
v8.setFlagsFromString('--expose-gc')
const gc: () => void = vm.runInNewContext('gc')
v8.setFlagsFromString('--no-expose-gc')

// laisse finir le tour en cours (une référence faible garde sa cible jusqu'à la fin du tour), puis ramasse
async function ramasser() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 10))
    gc()
  }
}

const LIGNES = '{ id: int, t: string, tags: string[] }[]'

// une liste de n lignes inscrite sous `$rows` ; ne reste à l'appli qu'une ligne gardée, et des références faibles
// vers la liste et vers une autre ligne, pour voir si le contrôle les retient
function inscrire(mode: 'warn' | 'error' | undefined, n: number) {
  const µ         = makeMu(mode)
  const el        = composant({ rows: LIGNES })
  const pris: any = {}
  ;(() => {
    const l = Array.from({ length: n }, (_, i) => ({ id: i, t: 'm', tags: ['a'] }))
    µ._mjs_tset(el, 'rows', l)
    pris.garde = l[7]
    pris.liste = new WeakRef(l)
    pris.autre = new WeakRef(l[n - 1])
  })()
  return { µ, el, reg: el._mjs_treg, garde: pris.garde, liste: pris.liste as WeakRef<any>, autre: pris.autre as WeakRef<any> }
}

describe('types — un élément gardé hors de sa liste ne retient pas la liste', function () {
  this.timeout(30000)

  for (const mode of ['warn', 'error', undefined] as const) {
    it((mode ?? 'production') + ' : la liste et les autres éléments sont ramassés, l’élément gardé reste', async () => {
      const s = inscrire(mode, 2000)
      await ramasser()
      assert.ok(s.liste.deref() === undefined, 'la liste est ramassée')
      assert.ok(s.autre.deref() === undefined, 'les autres éléments aussi')
      assert.equal(s.garde.id, 7)
    })
  }

  it('l’élément gardé, écrit de travers après que sa liste a disparu : le message part, au chemin où il a été inscrit, marqué', async () => {
    const s = inscrire('warn', 2000)
    await ramasser()
    assert.ok(s.liste.deref() === undefined, 'la liste est ramassée')
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'id'), '$rows[7?].id')
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde.tags, 0, null), '$rows[7?].tags[0]')
  })

  it('tant que la liste vit, elle reste la source du chemin : un élément qui a bougé se nomme à sa place', async () => {
    const µ  = makeMu('warn')
    const el = composant({ rows: LIGNES })
    const l: any[] = Array.from({ length: 50 }, (_, i) => ({ id: i, t: 'm', tags: ['a'] }))
    µ._mjs_tset(el, 'rows', l)
    appeler(µ, el, el._mjs_treg, l, 'unshift', { id: 90, t: 'n', tags: [] })
    await ramasser()
    assert.equal(refuser(µ, el, el._mjs_treg, l[8], 'id'), '$rows[8].id')
    assert.equal(refuser(µ, el, el._mjs_treg, l[8].tags, 0, null), '$rows[8].tags[0]')
  })
})

describe('types — la liste ramassée, un élément gardé se nomme au chemin où il a été inscrit, marqué, de quelque façon qu’il l’ait été', function () {
  this.timeout(30000)

  // `monter` écrit dans le composant et rend la liste (ou l'objet) qui porte l'élément que l'appli garde ; une
  // fois ramassée, il ne reste que l'élément
  async function sansConteneur(regles: Record<string, string>, monter: (µ: any, el: any) => { racine: any, garde: any }) {
    const µ  = makeMu('warn')
    const el = composant(regles)
    const pris: any = {}
    ;(() => {
      const m = monter(µ, el)
      pris.garde  = m.garde
      pris.faible = new WeakRef(m.racine)
    })()
    await ramasser()
    assert.ok(pris.faible.deref() === undefined, 'le conteneur est ramassé')
    return { µ, el, reg: el._mjs_treg, garde: pris.garde }
  }

  const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, t: 'm', tags: ['a'] }))

  it('ajouté par une méthode (push)', async () => {
    const s = await sansConteneur({ rows: LIGNES }, (µ, el) => {
      const l = lignes(4)
      µ._mjs_tset(el, 'rows', l)
      const x = { id: 10, t: 'n', tags: [] }
      appeler(µ, el, el._mjs_treg, l, 'push', x)
      return { racine: l, garde: x }
    })
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'id'), '$rows[4?].id')
  })

  it('écrit à une position (`$rows[2] = …`)', async () => {
    const s = await sansConteneur({ rows: LIGNES }, (µ, el) => {
      const l: any[] = lignes(4)
      µ._mjs_tset(el, 'rows', l)
      const neuf = { id: 12, t: 'n', tags: [] }
      assert.ok(µ._mjs_tdeep(el, el._mjs_treg, l, 2, neuf) === neuf, 'écriture acceptée')
      l[2] = neuf
      return { racine: l, garde: neuf }
    })
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'id'), '$rows[2?].id')
  })

  it('écrit dans un champ d’objet (`$fiche.auteur = …`), ses propres champs avec lui', async () => {
    const s = await sansConteneur({ fiche: '{ nom: string, auteur: { prenom: string, tags: string[] } }' }, (µ, el) => {
      const fiche: any = { nom: 'a', auteur: { prenom: 'p', tags: [] } }
      µ._mjs_tset(el, 'fiche', fiche)
      const neuf = { prenom: 'q', tags: ['t'] }
      assert.ok(µ._mjs_tdeep(el, el._mjs_treg, fiche, 'auteur', neuf) === neuf, 'écriture acceptée')
      fiche.auteur = neuf
      return { racine: fiche, garde: neuf }
    })
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'prenom', null), '$fiche.auteur.prenom')
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde.tags, 0, null), '$fiche.auteur.tags[0]')
  })

  it('d’une liste revérifiée en entier (méthode hors des sept connues) : chaque élément à sa position d’alors', async () => {
    const s = await sansConteneur({ rows: LIGNES }, (µ, el) => {
      const l = lignes(4)
      µ._mjs_tset(el, 'rows', l)
      appeler(µ, el, el._mjs_treg, l, 'copyWithin', 0, 2)
      return { racine: l, garde: l[3] }
    })
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'id'), '$rows[3?].id')
  })

  it('ajouté dans une liste imbriquée : le chemin d’inscription de la liste, puis la position', async () => {
    const s = await sansConteneur({ board: '{ rows: { cells: { v: int }[] }[] }' }, (µ, el) => {
      const board: any = { rows: [0, 1].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
      µ._mjs_tset(el, 'board', board)
      const x = { v: 5 }
      appeler(µ, el, el._mjs_treg, board.rows[1].cells, 'push', x)
      return { racine: board, garde: x }
    })
    assert.equal(refuser(s.µ, s.el, s.reg, s.garde, 'v'), '$board.rows[1?].cells[2?].v')
  })
})

describe('types — la production n’écrit aucun lien, le développement les crée faibles', () => {
  const WeakRef0: any = (globalThis as any).WeakRef

  // `WeakRef` compte ses créations pendant `fn`
  function compter(fn: () => void): number {
    let n = 0
    ;(globalThis as any).WeakRef = class extends WeakRef0 {
      constructor(o: any) {
        n++
        super(o)
      }
    }
    try {
      fn()
    }
    finally {
      ;(globalThis as any).WeakRef = WeakRef0
    }
    return n
  }

  function monter(mode?: 'warn' | 'error') {
    const µ  = makeMu(mode)
    const el = composant({ rows: LIGNES })
    const l: any[] = Array.from({ length: 5 }, (_, i) => ({ id: i, t: 'm', tags: ['a'] }))
    µ._mjs_tset(el, 'rows', l)
    appeler(µ, el, el._mjs_treg, l, 'unshift', { id: 9, t: 'n', tags: [] })
    return { reg: el._mjs_treg, l }
  }

  it('production : une inscription ne porte que sa règle et son chemin, et aucune référence faible n’est créée', () => {
    let m: any
    const faibles = compter(() => { m = monter() })
    assert.equal(faibles, 0)
    assert.deepEqual(Object.keys(m.reg.get(m.l[0])), ['r', 'p'])
    assert.deepEqual(Object.keys(m.reg.get(m.l[0].tags)), ['r', 'p'])
    assert.deepEqual(Object.keys(m.reg.get(m.l)), ['r', 'p'])
  })

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : les liens sont des références faibles', () => {
      const faibles = compter(() => { monter(mode) })
      assert.ok(faibles > 0, 'références faibles créées : ' + faibles)
    })
  }

  it('un environnement sans WeakRef : les liens restent justes (forts, à défaut)', () => {
    ;(globalThis as any).WeakRef = undefined
    try {
      const µ  = makeMu('warn')
      const el = composant({ rows: LIGNES })
      const l: any[] = Array.from({ length: 5 }, (_, i) => ({ id: i, t: 'm', tags: ['a'] }))
      µ._mjs_tset(el, 'rows', l)
      appeler(µ, el, el._mjs_treg, l, 'unshift', { id: 9, t: 'n', tags: [] })
      assert.equal(refuser(µ, el, el._mjs_treg, l[3], 'id'), '$rows[3].id')
    }
    finally {
      ;(globalThis as any).WeakRef = WeakRef0
    }
  })
})
