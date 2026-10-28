// Passe du compilateur qui regroupe les rendus (generator/loop-batch.ts), appels de liste écrits hors de toute boucle : un
// `.forEach`, un `.map`, un `.reduce` (et les autres méthodes qui appellent leur rappel pendant l'appel) dont le rappel écrit
// l'état est enveloppé comme une boucle. Instruction (`l.forEach(…)`, `return l.map(…)`) : l'enveloppe des boucles ; ailleurs
// (affectation, argument, corps d'une fonction fléchée) : la même enveloppe dans une fonction fléchée appelée sur place, qui
// rend la valeur de l'appel. Le code produit est exécuté contre un runtime factice : les écritures se font boucle en cours,
// la file se vide une fois, à la sortie de l'appel, que l'appel finisse ou lève, et le compteur revient à zéro.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { batchLoopWrites } from '../src/generator/loop-batch.js'

const W = "µ._set(_mjsThis, 'n', x)"
const enveloppes = (out: string) => out.split('µ._mjs_lq++').length - 1
const passe = (corps: string, entete = 'function f(o, l, n)') => {
  const out = batchLoopWrites(`${entete} {\n${corps}\n}`)
  acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' })
  return out
}

// exécute `f` produite contre un runtime factice : chaque écriture note la profondeur des boucles en cours, chaque vidange de la file est comptée
function executer(corps: string, ...args: any[]) {
  const out = passe(corps)
  const µ: any = { _mjs_lq: 0, vidanges: 0, profondeurs: [] as number[] }
  µ._mjs_lqF = () => { µ.vidanges++ }
  µ._set = () => { µ.profondeurs.push(µ._mjs_lq) }
  const f = new Function('µ', '_mjsThis', `${out}\nreturn f`)(µ, {})
  let r: any, erreur: any = null
  try { r = f.call({ nom: 'moi' }, null, ...args) } catch (e) { erreur = e }
  return { out, µ, r, erreur }
}

describe('regroupement des rendus — appels de liste hors de toute boucle (la passe du compilateur)', () => {

  it('enveloppe chaque méthode de liste dont le rappel écrit l\'état', () => {
    for (const m of ['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex']) {
      assert.equal(enveloppes(passe(`l.${m}((x) => { ${W} })`)), 1, m)
      assert.equal(enveloppes(passe(`l.${m}(function (x) { ${W} })`)), 1, m + ' (function)')
    }
    for (const m of ['reduce', 'reduceRight']) assert.equal(enveloppes(passe(`l.${m}((s, x) => { ${W}; return s }, 0)`)), 1, m)
    // un appel optionnel, une `Map` ou un `Set` (`m.forEach`) : même forme
    assert.equal(enveloppes(passe(`l?.forEach((x) => { ${W} })`)), 1)
    assert.equal(enveloppes(passe(`o.m.forEach((v, k) => { ${W} })`)), 1)
  })

  it('instruction : l\'enveloppe des boucles ; `return` : l\'instruction entière', () => {
    assert.match(passe(`l.forEach((x) => { ${W} })`), /µ\._mjs_lq\+\+;try\{l\.forEach\(.*\)\}finally\{--µ\._mjs_lq\|\|µ\._mjs_lqF\(\)\}/s)
    assert.match(passe(`return l.map((x) => { ${W}; return x })`), /µ\._mjs_lq\+\+;try\{return l\.map\(/)
    // l'appel au milieu de l'instruction : l'instruction entière
    assert.match(passe(`n = l.reduce((s, x) => { ${W}; return s + x }, 0)`), /µ\._mjs_lq\+\+;try\{n = l\.reduce\(/)
    assert.match(passe(`g(l.filter((x) => { ${W}; return x }))`), /µ\._mjs_lq\+\+;try\{g\(l\.filter\(/)
    // hors d'une liste d'instructions, des accolades
    assert.match(passe(`if (n) l.forEach((x) => { ${W} })`), /if \(n\) \{µ\._mjs_lq\+\+;try\{l\.forEach/)
  })

  it('ailleurs : une fonction fléchée appelée sur place, qui rend la valeur de l\'appel', () => {
    for (const corps of [
      `const r = l.map((x) => { ${W}; return x })\nreturn r`,
      `if (l.some((x) => { ${W}; return x })) n = 1`,
      `const t = [l.reduce((s, x) => { ${W}; return s + x }, 0)]`,
      `const h = () => l.forEach((x) => { ${W} })\nh()`,
    ]) {
      const out = passe(corps)
      assert.equal(enveloppes(out), 1, corps)
      assert.match(out, /\(\(\) => \{µ\._mjs_lq\+\+;try\{return l\.\w+\(/, corps)
    }
  })

  it('pas enveloppé : rappel sans écriture, rappel nommé, appel dans une boucle déjà enveloppée, appel qui attend', () => {
    assert.equal(enveloppes(passe('l.forEach((x) => { n += x })')), 0)
    assert.equal(enveloppes(passe('l.forEach(ajouter)')), 0)
    // la boucle enveloppe déjà l'appel : une seule enveloppe
    assert.equal(enveloppes(passe(`for (const y of o) l.forEach((x) => { ${W} })`)), 1)
    // l'appel attend (son `await`, pas celui du rappel) : pendant l'attente, le reste de la page doit pouvoir se redessiner
    assert.equal(enveloppes(passe(`l.forEach((x) => { ${W} }, await n)`, 'async function f(o, l, n)')), 0)
    // un rappel `async` n'attend que dans sa propre fonction : l'appel, lui, n'attend pas
    assert.equal(enveloppes(passe(`l.forEach(async (x) => { await x; ${W} })`, 'async function f(o, l, n)')), 1)
    // une méthode qui n'appelle pas son rappel pendant l'appel (`then`, minuterie) n'est pas touchée
    assert.equal(enveloppes(passe(`o.then((x) => { ${W} })`)), 0)
  })

  it('le code produit : écritures faites appel en cours, une vidange à la sortie, valeur et `this` rendus, compteur rendu', () => {
    let e = executer(`l.forEach((x) => { ${W} })\nreturn 'fin'`, [1, 2, 3])
    assert.deepEqual([e.r, e.µ.profondeurs, e.µ.vidanges, e.µ._mjs_lq], ['fin', [1, 1, 1], 1, 0], e.out)
    e = executer(`const r = l.map((x) => { ${W}; return this.nom + x * 2 })\nreturn r`, [1, 2])
    assert.deepEqual([e.r, e.µ.profondeurs, e.µ.vidanges, e.µ._mjs_lq], [['moi2', 'moi4'], [1, 1], 1, 0], e.out)
    e = executer(`return l.reduce((s, x) => { ${W}; return s + x + this.nom }, '')`, [1, 2])
    assert.deepEqual([e.r, e.µ.vidanges, e.µ._mjs_lq], ['1moi2moi', 1, 0], e.out)
    e = executer(`l.forEach((x) => { ${W}\nif (x == 2) throw new Error('stop') })`, [1, 2, 3])
    assert.deepEqual([e.erreur?.message, e.µ.profondeurs.length, e.µ.vidanges, e.µ._mjs_lq], ['stop', 2, 1, 0], e.out)
    // deux appels de suite : une vidange chacun
    e = executer(`l.forEach((x) => { ${W} })\nl.forEach((x) => { ${W} })`, [1, 2])
    assert.deepEqual([e.µ.profondeurs, e.µ.vidanges, e.µ._mjs_lq], [[1, 1, 1, 1], 2, 0], e.out)
  })
})
