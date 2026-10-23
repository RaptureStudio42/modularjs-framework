// types — des liens qui bouclent : un champ typé qui pointe vers son parent (`parent: { nom: string }`) ne
// gêne aucune écriture valide en développement (le chemin d'un message ne se calcule que quand un message
// part), et le message d'un conteneur pris dans la boucle nomme le chemin où il a été inscrit

import assert from 'node:assert/strict'
import { makeMu, composant, appeler, refuser } from './helpers/types-runtime.js'

const ARBRE = '{ nom: string, enf: { nom: string, parent: { nom: string } }[] }'

// un arbre dont l'enfant pointe vers sa racine : racine → enf → enfant → racine, les liens bouclent
function arbre(mode?: 'warn' | 'error', regle = ARBRE) {
  const µ           = makeMu(mode)
  const el          = composant({ arbre: regle })
  const racine: any = { nom: 'r', enf: [] }
  µ._mjs_tset(el, 'arbre', racine)
  const reg         = el._mjs_treg
  const enfant: any = { nom: 'c', parent: racine }
  assert.equal(appeler(µ, el, reg, racine.enf, 'push', enfant), true, 'un enfant qui pointe vers sa racine est permis')
  return { µ, el, reg, racine, enfant }
}

describe('types — des liens qui bouclent : les écritures valides passent', () => {
  for (const mode of ['warn', 'error', undefined] as const) {
    it((mode ?? 'production') + ' : une écriture dans la racine, dans l’enfant, et des méthodes de liste, sans exception ni message', () => {
      const a = arbre(mode)
      assert.equal(a.µ._mjs_tdeep(a.el, a.reg, a.racine, 'nom', 'x'), 'x')
      assert.equal(a.µ._mjs_tdeep(a.el, a.reg, a.enfant, 'nom', 'y'), 'y')
      assert.equal(a.µ._mjs_tdeep(a.el, a.reg, a.racine.enf, 'length', 1), 1)
      assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'push', { nom: 'd', parent: a.racine }), true)
      assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'unshift', { nom: 'e', parent: a.enfant }), true)
      assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'reverse'), true)
      assert.deepEqual(a.racine.enf.map((o: any) => o.nom), ['d', 'c', 'e'])
      assert.deepEqual(a.µ.warnings, [])
    })
  }

  it('une liste revérifiée en entier (méthode hors des sept connues) et un élément remplacé dans la boucle passent aussi', () => {
    const a = arbre('warn')
    assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'copyWithin', 0, 0), true)
    const neuf: any = { nom: 'n', parent: a.racine }
    assert.ok(a.µ._mjs_tdeep(a.el, a.reg, a.racine.enf, 0, neuf) === neuf, 'l’élément remplacé est accepté')
    assert.deepEqual(a.µ.warnings, [])
  })
})

describe('types — des liens qui bouclent : un refus se nomme, sans exception', () => {
  it('un champ refusé dans l’enfant et dans la racine : le chemin où chacun a été inscrit en dernier', () => {
    const a = arbre('warn')
    // l'enfant est inscrit sous `$arbre.enf[0]` ; la racine, inscrite en dernier, l'est sous le champ `parent` de l'enfant
    assert.equal(refuser(a.µ, a.el, a.reg, a.enfant, 'nom', null), '$arbre.enf[0].nom')
    assert.equal(refuser(a.µ, a.el, a.reg, a.racine, 'nom', null), '$arbre.enf[0].parent.nom')
  })

  it('mode erreur : l’erreur qui arrête l’écriture nomme le même chemin', () => {
    const a = arbre('error')
    assert.throws(() => a.µ._mjs_tdeep(a.el, a.reg, a.enfant, 'nom', null), { message: /^\[ModularJS\] \$arbre\.enf\[0\]\.nom refuse null/ })
    assert.throws(() => a.µ._mjs_tdeep(a.el, a.reg, a.racine, 'nom', null), { message: /^\[ModularJS\] \$arbre\.enf\[0\]\.parent\.nom refuse null/ })
  })

  it('une liste de la boucle qui dépasse son maximum : le message nomme la liste, qui revient à son état d’avant', () => {
    const a = arbre('warn', '{ nom: string, enf: { nom: string, parent: { nom: string } }[] 0..2 }')
    assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'push', { nom: 'd', parent: a.racine }), true)
    a.µ.warnings.length = 0
    assert.equal(appeler(a.µ, a.el, a.reg, a.racine.enf, 'push', { nom: 'e', parent: a.racine }), false)
    assert.equal(a.racine.enf.length, 2)
    assert.ok(a.µ.warnings[0].startsWith('[ModularJS] $arbre.enf refuse'), a.µ.warnings.join(' | '))
    a.µ.warnings.length = 0
    assert.ok(a.µ._mjs_tdeep(a.el, a.reg, a.racine.enf, 'length', 9) === a.µ._mjs_TNO, 'une longueur au-delà du maximum est refusée')
    assert.ok(a.µ.warnings[0].startsWith('[ModularJS] $arbre.enf.length refuse 9'), a.µ.warnings.join(' | '))
  })
})
