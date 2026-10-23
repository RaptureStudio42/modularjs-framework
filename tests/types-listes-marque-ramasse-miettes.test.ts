// types — le texte d'un message ne dépend pas du ramasse-miettes : un élément gardé hors de sa liste se nomme
// pareil, marque comprise, que la liste d'avant soit encore là ou ait été ramassée (le lien qui la retient est
// faible). Quand le parent a disparu, le chemin rendu est celui où l'élément a été inscrit : il n'est plus
// vérifiable, donc marqué. Les gardes de ces tests lancent le ramasse-miettes à la demande, sans relancer node

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

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

const MODES = ['warn', 'error'] as const

describe('types — le texte d’un message ne change pas quand la liste d’avant est ramassée', function () {
  this.timeout(30000)

  for (const mode of MODES) {
    it(mode + ' : un élément retiré en place, puis la liste remplacée : `$todos[1?].id` avant et après le ramasse-miettes', async () => {
      const µ  = makeMu(mode)
      const el = composant({ todos: '{ id: int }[]' })
      const pris: any = {}
      ;(() => {
        const l = [{ id: 0 }, { id: 1 }, { id: 2 }]
        µ._mjs_tset(el, 'todos', l)
        pris.x      = l[1]
        pris.ancien = new WeakRef(l)
        appeler(µ, el, el._mjs_treg, l, 'splice', 1, 1)
      })()
      assert.equal(refuser(µ, el, el._mjs_treg, pris.x, 'id'), '$todos[1?].id', 'retiré en place, liste vivante')
      µ._mjs_tset(el, 'todos', [{ id: 5 }, { id: 6 }])
      assert.equal(refuser(µ, el, el._mjs_treg, pris.x, 'id'), '$todos[1?].id', 'liste remplacée, ancienne encore là')
      await ramasser()
      assert.ok(pris.ancien.deref() === undefined, 'l’ancienne liste est ramassée')
      assert.equal(refuser(µ, el, el._mjs_treg, pris.x, 'id'), '$todos[1?].id', 'ancienne liste ramassée')
    })

    it(mode + ' : un élément écarté par `$todos = $todos.filter(…)` : même texte avant et après le ramasse-miettes', async () => {
      const µ  = makeMu(mode)
      const el = composant({ todos: '{ id: int }[]' })
      const pris: any = {}
      ;(() => {
        const l  = [{ id: 0 }, { id: 1 }, { id: 2 }]
        µ._mjs_tset(el, 'todos', l)
        pris.x   = l[1]
        pris.ancien = new WeakRef(l)
        µ._mjs_tset(el, 'todos', l.filter((o) => o !== l[1]))
      })()
      const avant = refuser(µ, el, el._mjs_treg, pris.x, 'id')
      assert.equal(avant, '$todos[1?].id')
      await ramasser()
      assert.ok(pris.ancien.deref() === undefined, 'l’ancienne liste est ramassée')
      assert.equal(refuser(µ, el, el._mjs_treg, pris.x, 'id'), avant)
    })
  }

  it('un élément gardé alors que sa liste est ramassée sans avoir été remplacée : le chemin d’inscription, marqué', async () => {
    const µ  = makeMu('warn')
    const el = composant({ rows: '{ id: int, t: string }[]' })
    const pris: any = {}
    ;(() => {
      const l = Array.from({ length: 10 }, (_, i) => ({ id: i, t: 'm' }))
      µ._mjs_tset(el, 'rows', l)
      pris.garde  = l[7]
      pris.liste  = new WeakRef(l)
    })()
    await ramasser()
    assert.ok(pris.liste.deref() === undefined, 'la liste est ramassée')
    assert.equal(refuser(µ, el, el._mjs_treg, pris.garde, 'id'), '$rows[7?].id')
  })

  it('une liste imbriquée ramassée : chaque position du chemin d’inscription est marquée', async () => {
    const µ  = makeMu('warn')
    const el = composant({ board: '{ rows: { cells: { v: int }[] }[] }' })
    const pris: any = {}
    ;(() => {
      const board: any = { rows: [0, 1].map((r) => ({ cells: [{ v: r }, { v: r + 10 }] })) }
      µ._mjs_tset(el, 'board', board)
      pris.garde  = board.rows[1].cells[0]
      pris.racine = new WeakRef(board)
    })()
    await ramasser()
    assert.ok(pris.racine.deref() === undefined, 'le tableau est ramassé')
    assert.equal(refuser(µ, el, el._mjs_treg, pris.garde, 'v'), '$board.rows[1?].cells[0?].v')
  })

  it('un champ d’objet dont le parent est ramassé : aucune position à marquer, le chemin d’inscription tel quel', async () => {
    const µ  = makeMu('warn')
    const el = composant({ fiche: '{ nom: string, auteur: { prenom: string } }' })
    const pris: any = {}
    ;(() => {
      const fiche: any = { nom: 'a', auteur: { prenom: 'p' } }
      µ._mjs_tset(el, 'fiche', fiche)
      pris.garde  = fiche.auteur
      pris.racine = new WeakRef(fiche)
    })()
    await ramasser()
    assert.ok(pris.racine.deref() === undefined, 'la fiche est ramassée')
    assert.equal(refuser(µ, el, el._mjs_treg, pris.garde, 'prenom', null), '$fiche.auteur.prenom')
  })

  it('la liste est encore tenue par l’appli : la position se retrouve, sans marque, ramasse-miettes ou non', async () => {
    const µ  = makeMu('warn')
    const el = composant({ rows: '{ id: int }[]' })
    const l  = Array.from({ length: 6 }, (_, i) => ({ id: i }))
    µ._mjs_tset(el, 'rows', l)
    appeler(µ, el, el._mjs_treg, l, 'unshift', { id: 90 })
    const avant = refuser(µ, el, el._mjs_treg, l[3], 'id')
    assert.equal(avant, '$rows[3].id')
    await ramasser()
    assert.equal(refuser(µ, el, el._mjs_treg, l[3], 'id'), avant)
  })
})
