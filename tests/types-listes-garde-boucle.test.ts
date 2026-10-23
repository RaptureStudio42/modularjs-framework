// types — la remontée des liens qui sert à nommer un conteneur dans un message s'arrête à la première
// revisite : un conteneur qui se pointe lui-même (`x.self = x`), ou une queue qui entre dans une boucle
// (`g → amis → enfant → enf → racine → enfant`), se nomme au chemin où il a été inscrit, après quelques
// lectures du registre et pas après des milliers. Et même si cette garde régressait, un plafond de profondeur
// borne la remontée : les tests comptent les lectures du registre, parce que le plafond rendrait le même
// texte que la garde, seulement plus tard

import assert from 'node:assert/strict'
import { makeMu, composant, appeler, refuser, lectures } from './helpers/types-runtime.js'

const MODES = ['warn', 'error', undefined] as const

// le plafond de la remontée, en conteneurs : au-delà, le message nomme le chemin d'inscription
const PLAFOND = 1000

// un conteneur qui pointe vers lui-même : `$x.self = $x`
function autoBoucle(mode?: 'warn' | 'error') {
  const µ      = makeMu(mode)
  const el     = composant({ x: '{ nom: string, self: { nom: string } }' })
  const x: any = { nom: 'a', self: { nom: 'b' } }
  µ._mjs_tset(el, 'x', x)
  const reg = el._mjs_treg
  assert.ok(µ._mjs_tdeep(el, reg, x, 'self', x) === x, 'un conteneur qui se pointe lui-même est permis')
  x.self = x
  return { µ, el, reg, x }
}

// un arbre dont l'enfant pointe vers sa racine, et dont une liste d'amis (hors de la boucle) porte un conteneur
function queueDansLaBoucle(mode?: 'warn' | 'error') {
  const µ           = makeMu(mode)
  const el          = composant({ arbre: '{ nom: string, enf: { nom: string, parent: { nom: string }, amis: { nom: string }[] }[] }' })
  const racine: any = { nom: 'r', enf: [] }
  µ._mjs_tset(el, 'arbre', racine)
  const reg         = el._mjs_treg
  const enfant: any = { nom: 'c', parent: racine, amis: [] }
  assert.equal(appeler(µ, el, reg, racine.enf, 'push', enfant), true)
  const g: any = { nom: 'g' }
  assert.equal(appeler(µ, el, reg, enfant.amis, 'push', g), true)
  return { µ, el, reg, racine, enfant, g }
}

describe('types — une auto-boucle (`x.self = x`) : écriture valide acceptée, refus nommé après peu de lectures', () => {
  for (const mode of MODES) {
    it((mode ?? 'production') + ' : une écriture valide dans le conteneur, sans exception ni message', () => {
      const a = autoBoucle(mode)
      assert.equal(a.µ._mjs_tdeep(a.el, a.reg, a.x, 'nom', 'ok'), 'ok')
      assert.equal(a.µ._mjs_tdeep(a.el, a.reg, a.x.self, 'nom', 'encore'), 'encore')
      assert.deepEqual(a.µ.warnings, [])
    })
  }

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : le refus nomme le chemin d’inscription, et la remontée s’arrête à la première revisite', () => {
      const a = autoBoucle(mode)
      let chemin = ''
      const n = lectures(() => { chemin = refuser(a.µ, a.el, a.reg, a.x, 'nom', null) })
      assert.equal(chemin, '$x.self.nom')
      assert.ok(n <= 12, 'lectures du registre : ' + n + ' (un plafond de ' + PLAFOND + ' conteneurs ne doit pas être atteint)')
    })
  }
})

describe('types — une queue qui entre dans une boucle : le conteneur hors de la boucle se nomme à son chemin d’inscription', () => {
  for (const mode of MODES) {
    it((mode ?? 'production') + ' : une écriture valide dans le conteneur de la queue passe', () => {
      const q = queueDansLaBoucle(mode)
      assert.equal(q.µ._mjs_tdeep(q.el, q.reg, q.g, 'nom', 'ok'), 'ok')
      assert.deepEqual(q.µ.warnings, [])
    })
  }

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : le refus nomme le chemin d’inscription, et la remontée s’arrête à la première revisite', () => {
      const q = queueDansLaBoucle(mode)
      let chemin = ''
      const n = lectures(() => { chemin = refuser(q.µ, q.el, q.reg, q.g, 'nom', null) })
      assert.equal(chemin, '$arbre.enf[0].amis[0].nom')
      assert.ok(n <= 12, 'lectures du registre : ' + n + ' (un plafond de ' + PLAFOND + ' conteneurs ne doit pas être atteint)')
    })
  }

  it('un conteneur de la boucle elle-même, et la racine : chacun garde son chemin d’inscription', () => {
    const q = queueDansLaBoucle('warn')
    assert.equal(refuser(q.µ, q.el, q.reg, q.enfant, 'nom', null), '$arbre.enf[0].nom')
    assert.equal(refuser(q.µ, q.el, q.reg, q.racine, 'nom', null), '$arbre.enf[0].parent.nom')
  })
})

describe('types — une chaîne de liens très profonde (sans boucle) : le plafond borne la remontée, en deçà le chemin est exact', () => {
  // une chaîne bâtie par enveloppes successives sous une règle peu profonde : chaque tour inscrit l'ancienne
  // racine comme `child` de la nouvelle, la chaîne des liens grandit d'un conteneur à chaque tour
  function chaine(n: number, mode: 'warn' | 'error' = 'warn') {
    const µ       = makeMu(mode)
    const el      = composant({ s: '{ nom: string, child: { nom: string } }' })
    let cur: any  = { nom: 'n0', child: { nom: 'feuille' } }
    const feuille = cur.child
    µ._mjs_tset(el, 's', cur)
    for (let i = 1; i < n; i++) {
      const w: any = { nom: 'n' + i, child: cur }
      assert.ok(µ._mjs_tset(el, 's', w) === w, 'un enrobage de plus est permis, tour ' + i)
      cur = w
    }
    return { µ, el, reg: el._mjs_treg, feuille }
  }

  it('en deçà du plafond : le chemin entier, exact', () => {
    const c = chaine(50)
    assert.equal(refuser(c.µ, c.el, c.reg, c.feuille, 'nom', null), '$s' + '.child'.repeat(50) + '.nom')
  })

  it('juste en deçà du plafond (' + (PLAFOND - 2) + ' enveloppes) : encore exact', () => {
    const c = chaine(PLAFOND - 2)
    assert.equal(refuser(c.µ, c.el, c.reg, c.feuille, 'nom', null), '$s' + '.child'.repeat(PLAFOND - 2) + '.nom')
  })

  for (const mode of ['warn', 'error'] as const) {
    it(mode + ' : au-delà du plafond, le message part sans exception et nomme le chemin d’inscription, après au plus ' + PLAFOND + ' lectures', () => {
      const c = chaine(PLAFOND + 500, mode)
      let chemin = ''
      const n = lectures(() => { chemin = refuser(c.µ, c.el, c.reg, c.feuille, 'nom', null) })
      assert.equal(chemin, '$s.child.nom')
      assert.ok(n <= PLAFOND + 10, 'lectures du registre : ' + n)
    })
  }

  it('une écriture valide tout au bout d’une chaîne plus profonde que le plafond ne remonte rien', () => {
    const c = chaine(PLAFOND + 500)
    const n = lectures(() => { assert.equal(c.µ._mjs_tdeep(c.el, c.reg, c.feuille, 'nom', 'ok'), 'ok') })
    assert.ok(n <= 4, 'lectures du registre : ' + n)
  })
})
