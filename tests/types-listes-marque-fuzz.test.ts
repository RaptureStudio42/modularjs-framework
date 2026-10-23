// types — un chemin de message n'est jamais faux sans marque : des parties aléatoires (méthodes de liste,
// éléments partagés entre deux listes, listes REMPLACÉES, ramasse-miettes) puis, pour un échantillon d'éléments,
// le chemin que nomme un refus contre la vraie place de l'élément. Un chemin sans marque est exact ; un chemin
// marqué `?` nomme un élément qui n'est plus dans la liste qu'il nomme. Les parties sont rejouables (graine fixe)

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { makeMu, regle, composant, appeler, refuser } from './helpers/types-runtime.js'

v8.setFlagsFromString('--expose-gc')
const gc: () => void = vm.runInNewContext('gc')
v8.setFlagsFromString('--no-expose-gc')

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// générateur pseudo-aléatoire à graine (mulberry32)
function prng(graine: number) {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Reglages = { remplacer: boolean, ramasser: boolean, garderAnciennes: boolean, cible: 'composant' | 'store' }
type Compte   = Record<string, number>

const NOMS = ['a', 'b']

// une partie de `ops` opérations ; chaque opération est suivie du contrôle d'un échantillon d'éléments
async function partie(mode: 'warn' | 'error', graine: number, ops: number, r: Reglages, compte: Compte, exemples: Record<string, string>) {
  const rnd = prng(graine)
  const µ   = makeMu(mode)
  const el  = r.cible === 'store' ? null : composant({ a: '{ id: int }[]', b: '{ id: int }[]' })
  const reg = () => (r.cible === 'store' ? µ._mjs_storeTreg : el._mjs_treg)
  let nid = 0
  const pool: any[] = []
  const neuf        = () => { const o = { id: nid++ }; pool.push(o); return o }
  const cur: Record<string, any[]> = { a: [neuf(), neuf(), neuf()], b: [neuf(), neuf()] }
  if (r.cible === 'store') {
    µ._mjs_storeRaw.a = cur.a
    µ._mjs_storeRaw.b = cur.b
    µ._mjs_storeTypes({ a: regle('{ id: int }[]'), b: regle('{ id: int }[]') })
  }
  else {
    µ._mjs_tset(el, 'a', cur.a)
    µ._mjs_tset(el, 'b', cur.b)
  }
  // la valeur d'une variable ou d'un store remplacée : ce que fait l'écriture compilée
  const poser = (n: string, liste: any[]): boolean => {
    if (r.cible === 'store') {
      const w = µ._mjs_tstore(n, liste)
      if (w === µ._mjs_TNO) return false
      µ._mjs_storeRaw[n] = w
      return true
    }
    return µ._mjs_tset(el, n, liste) !== µ._mjs_TNO
  }
  const anciennes: any[] = []
  const pick    = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const existant = () => (pool.length ? pick(pool) : neuf())
  const choix   = () => (rnd() < 0.5 ? neuf() : existant())
  const racine  = r.cible === 'store' ? '\\$\\$' : '\\$'
  const forme   = new RegExp('^' + racine + '(a|b)\\[(\\d+)(\\?)?\\]\\.id$')

  for (let k = 0; k < ops; k++) {
    const n  = pick(NOMS)
    const L  = cur[n]
    const op = Math.floor(rnd() * 12)
    try {
      if (op === 0) appeler(µ, el, reg(), L, 'push', choix())
      else if (op === 1) appeler(µ, el, reg(), L, 'unshift', choix())
      else if (op === 2) appeler(µ, el, reg(), L, 'splice', Math.floor(rnd() * (L.length + 1)), Math.floor(rnd() * 3), ...(rnd() < 0.5 ? [choix()] : []))
      else if (op === 3) appeler(µ, el, reg(), L, 'shift')
      else if (op === 4) appeler(µ, el, reg(), L, 'pop')
      else if (op === 5) {
        const cle = new Map<any, number>()
        for (const o of L) cle.set(o, rnd())
        appeler(µ, el, reg(), L, 'sort', (x: any, y: any) => (cle.get(x) ?? 0) - (cle.get(y) ?? 0))
      }
      else if (op === 6) appeler(µ, el, reg(), L, 'reverse')
      else if (op === 7 && L.length) {
        const i = Math.floor(rnd() * L.length)
        const x = choix()
        if (µ._mjs_tdeep(el, reg(), L, i, x) !== µ._mjs_TNO) L[i] = x
      }
      else if (op === 8 && r.remplacer) {
        const nl: any[] = []
        for (let i = Math.floor(rnd() * 5); i > 0; i--) nl.push(choix())
        if (r.garderAnciennes) anciennes.push(L)
        if (poser(n, nl)) cur[n] = nl
      }
      else if (op === 10) appeler(µ, el, reg(), L, 'fill', neuf())
      else if (op === 11) appeler(µ, el, reg(), cur[n === 'a' ? 'b' : 'a'], 'push', existant())
    }
    catch (e: any) {
      const cle = 'EXCEPTION ' + String(e.message).slice(0, 60)
      compte[cle] = (compte[cle] || 0) + 1
    }
    if (r.ramasser && k % 9 === 8) {
      await attendre(0)
      gc()
    }
    const echantillon = pool.length <= 14 ? pool : Array.from({ length: 14 }, () => pick(pool))
    for (const x of echantillon) {
      if (!reg().get(x)) continue
      const P = refuser(µ, el, reg(), x, 'id')
      const m = forme.exec(P)
      if (!m) {
        compte['forme inconnue'] = (compte['forme inconnue'] || 0) + 1
        exemples['forme inconnue'] = P
        continue
      }
      const [, nom, idx, marque] = m
      const places: [string, number][] = []
      for (const nn of NOMS) cur[nn].forEach((y, i) => { if (y === x) places.push([nn, i]) })
      let classe: string
      if (!marque) {
        if (places.some(([nn, i]) => nn === nom && i === +idx)) classe = 'exact'
        else if (places.some(([nn]) => nn === nom)) classe = 'NON MARQUÉ FAUX : bonne liste, mauvais indice'
        else if (places.length) classe = 'NON MARQUÉ FAUX : élément dans l’autre liste seulement'
        else classe = 'NON MARQUÉ FAUX : élément nulle part'
      }
      else {
        classe = places.some(([nn]) => nn === nom) ? 'MARQUÉ À TORT : l’élément est dans la liste nommée' : 'marqué, honnête'
      }
      compte[classe] = (compte[classe] || 0) + 1
      if (classe.startsWith('NON MARQUÉ') || classe.startsWith('MARQUÉ')) exemples[classe] ||= 'graine ' + graine + ', opération ' + k + ' : annoncé ' + P + ', vraies places ' + JSON.stringify(places) + ', a = ' + cur.a.map((o) => o.id) + ', b = ' + cur.b.map((o) => o.id) + ', x.id = ' + x.id
    }
  }
}

const GRAINES = 12
const OPS     = 150

const CONFIGS: [string, Reglages][] = [
  ['composant : déplacements et partage, sans remplacement', { remplacer: false, ramasser: false, garderAnciennes: false, cible: 'composant' }],
  ['composant : listes remplacées, anciennes lâchées', { remplacer: true, ramasser: false, garderAnciennes: false, cible: 'composant' }],
  ['composant : listes remplacées, ramasse-miettes fréquent', { remplacer: true, ramasser: true, garderAnciennes: false, cible: 'composant' }],
  ['composant : listes remplacées, anciennes gardées par l’appli, ramasse-miettes fréquent', { remplacer: true, ramasser: true, garderAnciennes: true, cible: 'composant' }],
  ['store : déplacements et partage, sans remplacement', { remplacer: false, ramasser: false, garderAnciennes: false, cible: 'store' }],
  ['store : listes remplacées, ramasse-miettes fréquent', { remplacer: true, ramasser: true, garderAnciennes: false, cible: 'store' }],
  ['store : listes remplacées, anciennes gardées par l’appli', { remplacer: true, ramasser: true, garderAnciennes: true, cible: 'store' }],
]

describe('types — un chemin sans marque est exact : des parties aléatoires', function () {
  this.timeout(240000)

  for (const [nom, reglages] of CONFIGS) {
    it(nom + ' : aucun chemin faux sans marque, aucune forme inconnue, aucune exception', async () => {
      const compte: Compte = {}
      const exemples: Record<string, string> = {}
      for (let g = 1; g <= GRAINES; g++) await partie(g % 2 ? 'warn' : 'error', g, OPS, reglages, compte, exemples)
      const total = Object.values(compte).reduce((a, b) => a + b, 0)
      assert.ok((compte.exact ?? 0) > 500, 'des contrôles exacts : ' + JSON.stringify(compte))
      const fautes = Object.entries(compte).filter(([k]) => k.startsWith('NON MARQUÉ') || k.startsWith('MARQUÉ') || k === 'forme inconnue' || k.startsWith('EXCEPTION'))
      assert.deepEqual(fautes, [], total + ' contrôles ; exemples : ' + JSON.stringify(exemples, null, 1))
    })
  }
})
