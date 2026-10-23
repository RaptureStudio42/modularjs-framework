// Le message vers le pool ne porte en entier que les effets qui diffèrent des alias livrés. La comparaison se faisait sur les octets
// de `v8.serialize`, dont la forme suit la représentation interne de V8 : un même tableau s'écrit dense ou clairsemé selon la façon
// dont il a été créé et l'histoire du processus. Dans un processus qui avait déjà beaucoup compilé (une session `mjs dev`, plusieurs
// projets construits de suite), des alias livrés identiques partaient en entier avec chaque fichier. La comparaison porte sur les
// valeurs : deux alias de même valeur sont pareils, quelle que soit la forme de leurs tableaux en mémoire.

import assert from 'node:assert/strict'
import { serialize } from 'node:v8'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { effectDefsToWire } from '../src/bundler/transpile-msg.js'

// la même valeur, chaque tableau recréé par sa longueur puis rempli : V8 le range « troué », et l'écrit en forme clairsemée
function troue(v: any): any {
  if (Array.isArray(v)) {
    const a = new Array(v.length)
    for (let i = 0; i < v.length; i++) a[i] = troue(v[i])
    return a
  }
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, troue(x)]))
  return v
}

// la même valeur, chaque tableau rempli par ajouts successifs : V8 le range « plein », et l'écrit en forme dense
function plein(v: any): any {
  if (Array.isArray(v)) {
    const a: any[] = []
    for (const x of v) a.push(plein(x))
    return a
  }
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plein(x)]))
  return v
}

describe('bundler — alias livrés comparés par leur valeur, pas par leurs octets', () => {
  // la forme des tableaux des alias livrés suit elle aussi l'histoire du processus (dans une longue suite de tests, ils naissent troués) :
  // deux copies de forme imposée, l'une pleine, l'autre trouée, et aucune des deux ne part en entier
  it('des alias livrés de même valeur, aux tableaux rangés autrement en mémoire : aucun ne part en entier', () => {
    const livres = collectEffectDefs([], () => '')
    const pleins = Object.fromEntries(Object.entries(livres).map(([n, d]) => [n, plein(d)]))
    const troues = Object.fromEntries(Object.entries(livres).map(([n, d]) => [n, troue(d)]))
    const avecTableau = Object.keys(livres).filter(n => !serialize(pleins[n]).equals(serialize(troues[n])))
    assert.ok(avecTableau.length > 5, 'les deux copies diffèrent bien en octets pour plusieurs alias : ' + avecTableau.length)
    assert.deepEqual(Object.keys(effectDefsToWire(pleins).diff), [])
    assert.deepEqual(Object.keys(effectDefsToWire(troues).diff), [])
  })

  it('un alias livré dont une valeur change part en entier, seul', () => {
    const livres = collectEffectDefs([], () => '') as Record<string, any>
    const copies = Object.fromEntries(Object.entries(livres).map(([n, d]) => [n, troue(d)]))
    copies['gradient.knockout'] = { ...copies['gradient.knockout'], fixed: { ...copies['gradient.knockout'].fixed, angle: 45 } }
    assert.deepEqual(Object.keys(effectDefsToWire(copies).diff), ['gradient.knockout'])
  })
})
