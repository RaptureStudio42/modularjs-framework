// Passe du compilateur qui regroupe les rendus d'une boucle (generator/loop-batch.ts) : quelles boucles elle enveloppe,
// où elle pose l'enveloppe, et ce que fait le code produit du compteur des boucles en cours — la file des rendus se vide
// une seule fois, à la sortie de la boucle la plus extérieure, que la boucle finisse, lève, rende (`return`) ou
// s'interrompe (`break`, `continue` étiqueté), et le compteur revient toujours à zéro.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { batchLoopWrites } from '../src/generator/loop-batch.js'

const W = "µ._set(_mjsThis, 'n', i)"
const enveloppes = (out: string) => out.split('µ._mjs_lq++').length - 1
const analyser = (out: string) => acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' })
const passe = (corps: string) => {
  const out = batchLoopWrites(`function f(o, l, n) {\n${corps}\n}`)
  analyser(out)
  return out
}

// exécute `f` produite (`args` : sa liste `l`) contre un runtime factice : chaque écriture note la profondeur des boucles en cours, chaque
// vidange de la file est comptée
function executer(corps: string, ...args: any[]) {
  const out = passe(corps)
  const µ: any = { _mjs_lq: 0, vidanges: 0, profondeurs: [] as number[] }
  µ._mjs_lqF = () => { µ.vidanges++ }
  µ._set = () => { µ.profondeurs.push(µ._mjs_lq) }
  const f = new Function('µ', '_mjsThis', `${out}\nreturn f`)(µ, {})
  let r: any, erreur: any = null
  try { r = f(null, ...args) } catch (e) { erreur = e }
  return { out, µ, r, erreur }
}

describe('regroupement des rendus d\'une boucle — la passe du compilateur', () => {

  it('enveloppe chaque forme de boucle qui écrit l\'état', () => {
    for (const boucle of [
      `for (let i = 0; i < 3; i++) ${W}`,
      `for (const i in o) ${W}`,
      `for (const i of l) ${W}`,
      `let i = 0\nwhile (i < 3) { i++\n${W} }`,
      `let i = 0\ndo { i++\n${W} }\nwhile (i < 3)`,
    ]) assert.equal(enveloppes(passe(boucle)), 1, boucle)
  })

  it('chaque appel d\'écriture posé par les passes compte : local, profond, méthode, suppression, magasin', () => {
    for (const ecriture of [
      'µ._mjs_deepSet(_mjsThis, ["o", "a"], i)', 'µ._mjs_deepCall(_mjsThis, ["l"], \'push\', [i])', 'µ._mjs_deepDelete(_mjsThis, ["o", i])',
      'µ._storeSet("t", i)', 'µ._mjs_storeDelete("t")', 'µ._mjs_storeDeepSet("t", ["a"], i)', 'µ._mjs_storeDeepCall("t", ["l"], \'push\', [i])',
      'µ._mjs_storeDeepDelete("t", ["a"])', 'µ._mjs_storeSetOn("t", o, "a", i)', 'µ._mjs_storeCallOn("t", l, \'push\', [i])', 'µ._mjs_storeDeleteOn("t", o, "a")',
      // la forme fléchée d'une écriture dont la valeur est lue
      `x = ((_v) => (${W.replace(', i)', ', _v)')}, _v))(i)`,
      // une écriture faite par un rappel appelé dans la boucle
      `l.forEach((x) => ${W})`,
    ]) assert.equal(enveloppes(passe(`let x\nfor (const i of l) { ${ecriture} }`)), 1, ecriture)
  })

  it('une écriture laissée à l\'enveloppe réactive compte aussi : chemin composé, clé calculée, `++`, `delete`, méthode', () => {
    for (const ecriture of [
      '$.o.a.b.c += 1', "$.l[i].n += '!'", '$.o[i.k][i] = 1', '$.o.a.n++', '--$.o.a.n', 'delete $.o[i][i]', '$.l[i].tags.push(1)', '$.m.set(i, 1)',
      'µ.store.o.a += 1', 'µ.store.l[i].push(1)',
    ]) assert.equal(enveloppes(passe(`for (const i of l) { ${ecriture} }`)), 1, ecriture)
    // une lecture de l'état n'en est pas une, une écriture hors de l'état non plus
    for (const lecture of ["t.push($.s.split(','))", 'x.a += $.o.a', 'µ.warn($.l.length)', 'n++']) assert.equal(enveloppes(passe(`let t = [], x = {}\nfor (const i of l) { ${lecture} }`)), 0, lecture)
  })

  it('une boucle sans écriture de l\'état ne paie rien : le texte sort tel quel', () => {
    const src = 'function f(l) {\n  let t = 0\n  for (const x of l) t += x\n  µ.warn(t)\n  return t\n}'
    assert.equal(batchLoopWrites(src), src)
    // un `.forEach` écrit hors de toute boucle n'est pas regroupé
    assert.equal(enveloppes(passe(`l.forEach((i) => ${W})`)), 0)
  })

  it('une boucle qui attend n\'est pas enveloppée ; sa boucle intérieure sans attente l\'est', () => {
    const asynchrone = (corps: string) => {
      const out = batchLoopWrites(`async function f(l) {\n${corps}\n}`)
      analyser(out)
      return out
    }
    assert.equal(enveloppes(asynchrone(`for (const i of l) { ${W}\nawait null }`)), 0)
    assert.equal(enveloppes(asynchrone(`for await (const i of l) { ${W} }`)), 0)
    assert.equal(enveloppes(asynchrone(`let i = 0\nwhile (await l.next()) { ${W} }`)), 0)
    const gen = batchLoopWrites(`function* f(l) {\nfor (const i of l) { ${W}\nyield i }\n}`)
    assert.equal(enveloppes(gen), 0)
    const dedans = asynchrone(`for (const x of l) {\nawait null\nfor (const i of x) ${W}\n}`)
    assert.equal(enveloppes(dedans), 1)
    assert.match(dedans, /await null\nµ\._mjs_lq\+\+;try\{for \(const i of x\)/)
    // l'attente d'une fonction écrite dans la boucle ne suspend pas la boucle
    assert.equal(enveloppes(passe(`for (const i of l) { ${W}\nl.map(async (x) => await x) }`)), 1)
  })

  it('seule la plus extérieure de sa fonction est enveloppée ; une fonction écrite dans la boucle a la sienne', () => {
    assert.equal(enveloppes(passe(`for (const x of l) { for (const i of x) { while (n--) ${W} } }`)), 1)
    const out = passe(`for (const x of l) { l.forEach(function (y) { for (const i of y) ${W} }) }`)
    assert.equal(enveloppes(out), 2)
  })

  it('l\'étiquette entre avec la boucle ; hors d\'une liste d\'instructions, des accolades', () => {
    const lab = passe(`externe: interne: for (const x of l) { for (const i of x) { ${W}\ncontinue externe } }`)
    assert.match(lab, /µ\._mjs_lq\+\+;try\{externe: interne: for/)
    const si = passe(`if (n) for (const i of l) ${W}\nelse while (n--) ${W}`)
    assert.match(si, /if \(n\) \{µ\._mjs_lq\+\+;try\{for .*\}finally\{--µ\._mjs_lq\|\|µ\._mjs_lqF\(\)\}\}\nelse \{µ\._mjs_lq\+\+;try\{while/)
  })

  it('deux boucles collées : la fermeture de la première précède l\'ouverture de la seconde', () => {
    const out = passe(`for(const i of l)${W};for(const i of o)${W}`)
    assert.equal(enveloppes(out), 2)
    assert.match(out, /\}finally\{--µ\._mjs_lq\|\|µ\._mjs_lqF\(\)\}µ\._mjs_lq\+\+;try\{for\(const i of o\)/)
  })

  it('le code produit : écritures faites boucle en cours, une vidange à la sortie de la plus extérieure, compteur rendu', () => {
    let e = executer(`for (const x of l) { for (const i of x) ${W} }\nreturn 'fin'`, [[1, 2], [3]])
    assert.deepEqual([e.r, e.µ.profondeurs, e.µ.vidanges, e.µ._mjs_lq], ['fin', [1, 1, 1], 1, 0], e.out)
    e = executer(`for (const i of l) { ${W}\nif (i == 2) throw new Error('stop') }`, [1, 2, 3])
    assert.deepEqual([e.erreur?.message, e.µ.profondeurs.length, e.µ.vidanges, e.µ._mjs_lq], ['stop', 2, 1, 0], e.out)
    e = executer(`for (const i of l) { ${W}\nif (i == 2) return i }\nreturn 0`, [1, 2, 3])
    assert.deepEqual([e.r, e.µ.vidanges, e.µ._mjs_lq], [2, 1, 0], e.out)
    e = executer(`let t = 0\nexterne: for (const x of l) { for (const i of x) { ${W}\nt++\nif (i == 1) continue externe\nif (i == 3) break externe } }\nreturn t`, [[1, 9], [2, 3, 9], [4]])
    assert.deepEqual([e.r, e.µ.vidanges, e.µ._mjs_lq], [3, 1, 0], e.out)
    // une écriture hors boucle : aucune boucle en cours, aucune vidange
    e = executer(`const i = 1\n${W}`)
    assert.deepEqual([e.µ.profondeurs, e.µ.vidanges], [[0], 0], e.out)
  })
})
