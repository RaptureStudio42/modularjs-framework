// Types et valeurs permises — le contrôle au runtime (mjs_types.ts), chargé seul avec un `µ` minimal.
// Une valeur passe telle quelle, est convertie (texte d'un nombre, nombre à virgule dans un int :
// arrondi au plus près), est ramenée dans sa plage, ou est refusée : la variable garde alors sa
// valeur. En développement, une valeur ramenée ou refusée prévient (avertissement, ou erreur selon
// `"types"` dans mjs.config.json) ; en production, rien ne s'affiche.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRule, resolveRule, emitRuntimeRule } from '../src/transpiler/var-types.js'
import { poserMessages } from './helpers/messages-stub.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

const ICI = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(ICI, '../src/runtime/mjs_types.ts'), 'utf-8')

function makeMu(mode?: 'warn' | 'error'): any {
  const µ: any = {
    warnings: [] as string[],
    warn(m: string) { this.warnings.push(m) },
    _mjs_toRaw: (x: any) => x,
    _mjs_interpolatorSet: new WeakSet(),
    _mjs_storeRaw: {},
    notified: [] as string[],
    _mjs_storeNotifyKey(k: string) { this.notified.push(k) },
    // une valeur convertie sur place prévient aussi les clés qui rangent le même objet (mjs_store_globals.ts)
    _mjs_storeNotifyDeep(k: string) { this.notified.push(k) },
    _runtimeLabelsLang: 'fr',
  }
  if (mode) µ._typesMode = mode
  poserMessages(µ)
  new Function('µ', SRC)(µ)
  return µ
}

// une règle écrite comme dans <vars>, compilée comme le fait le build (textes compris)
const DEFS = { Percent: parseRule('int 0..100', { bloc: '<types>', ligne: 1 }) }
function regle(texte: string): any {
  const ou  = { bloc: '<vars>', ligne: 1 }
  const ast = resolveRule(parseRule(texte, ou), DEFS, ou)
  return new Function(`return ${emitRuntimeRule(ast, true, texte)}`)()
}

// un composant réduit à ce que lit le contrôle : ses règles et son nom de balise
function composant(µ: any, regles: Record<string, string>): any {
  const T: any = {}
  for (const [k, v] of Object.entries(regles)) T[k] = regle(v)
  return { _mjs_types: T, localName: 'mjs-essai' }
}

describe('types — contrôle d’une valeur', () => {
  const µ = makeMu()
  const passe = (texte: string, v: any) => µ._mjs_tcheck(regle(texte), v)

  it('int : entier gardé, virgule arrondie au plus près, texte converti, plage ramenée', () => {
    assert.deepEqual(passe('int 0..100', 50), { s: 0, v: 50 })
    assert.deepEqual(passe('int 0..100', 50.7), { s: 1, v: 51 })
    assert.deepEqual(passe('int 0..100', 50.2), { s: 1, v: 50 })
    assert.deepEqual(passe('int 0..100', '42'), { s: 1, v: 42 })
    assert.deepEqual(passe('int 0..100', ' 7.5 '), { s: 1, v: 8 })
    assert.deepEqual(passe('int 0..100', 150), { s: 2, v: 100 })
    assert.deepEqual(passe('int 0..100', -3), { s: 2, v: 0 })
    assert.deepEqual(passe('int 0..100', 100.6), { s: 2, v: 100 })
  })

  it('int et float : ni texte vide, ni mot, ni NaN, ni infini, ni objet', () => {
    for (const v of ['', 'abc', '12px', NaN, Infinity, null, undefined, {}, [], true]) {
      assert.equal(passe('int 0..100', v).s, -1, String(v))
      assert.equal(passe('float', v).s, -1, String(v))
    }
    assert.deepEqual(passe('float 0..1', 0.25), { s: 0, v: 0.25 })
    assert.deepEqual(passe('float 0..1', 1.5), { s: 2, v: 1 })
  })

  it('string : nombre converti en texte, longueur en caractères (un émoji compte pour un), forme', () => {
    assert.deepEqual(passe('string', 42), { s: 1, v: '42' })
    assert.deepEqual(passe('string 3..5', 'abcd'), { s: 0, v: 'abcd' })
    assert.equal(passe('string 3..5', 'ab').s, -1, 'trop court : refusé, jamais complété')
    assert.equal(passe('string 3..5', 'abcdef').s, -1, 'trop long : refusé, jamais coupé')
    assert.deepEqual(passe('string 1..1', '😀'), { s: 0, v: '😀' })
    assert.deepEqual(passe('string /^[a-z]+$/', 'abc'), { s: 0, v: 'abc' })
    assert.equal(passe('string /^[a-z]+$/', 'ABC').s, -1)
    assert.equal(passe('string', null).s, -1)
  })

  it('bool : vrai booléen, ou texte true/false', () => {
    assert.deepEqual(passe('bool', false), { s: 0, v: false })
    assert.deepEqual(passe('bool', 'true'), { s: 1, v: true })
    assert.equal(passe('bool', 1).s, -1)
  })

  it('valeurs permises : exactes, ou converties vers une valeur de la liste', () => {
    assert.deepEqual(passe("'red' | 'green'", 'red'), { s: 0, v: 'red' })
    assert.equal(passe("'red' | 'green'", 'purple').s, -1)
    assert.deepEqual(passe('1 | 2 | 3', '2'), { s: 1, v: 2 })
    assert.deepEqual(passe("'1' | '2'", 2), { s: 1, v: '2' })
  })

  it('valeurs interdites : après conversion et plage, une valeur interdite est refusée', () => {
    assert.equal(passe("! 'admin' | 'root'", 'root').s, -1)
    assert.deepEqual(passe("! 'admin' | 'root'", 'ann'), { s: 0, v: 'ann' })
    assert.equal(passe('int 0..10 ! 10', 15).s, -1, '15 ramené à 10, et 10 est interdit')
    assert.equal(passe('int 0..100 ! 40..60', '50').s, -1)
    assert.deepEqual(passe('int 0..100 ! 40..60', 61), { s: 0, v: 61 })
  })

  it('listes et objets : chaque élément et chaque champ passent leur règle, conversions écrites sur place', () => {
    const tags = ['a', 7]
    assert.deepEqual(passe('string[] 0..3', tags), { s: 1, v: tags })
    assert.deepEqual(tags, ['a', '7'])
    assert.equal(passe('string[] 0..1', ['a', 'b']).s, -1, 'trop d’éléments : refusé')
    assert.equal(passe('int[]', [1, 'x']).s, -1, 'un élément refusé refuse toute la liste')
    const reglages = { volume: 150, bass: '-2', autre: 'libre' }
    assert.deepEqual(passe('{ volume: Percent, bass?: int -10..10 }', reglages), { s: 2, v: reglages })
    assert.deepEqual(reglages, { volume: 100, bass: -2, autre: 'libre' })
    assert.deepEqual(passe('{ volume: Percent, bass?: int -10..10 }', { volume: 5 }).s, 0, 'champ facultatif absent')
    assert.equal(passe('{ volume: Percent }', {}).s, -1, 'champ obligatoire absent')
    assert.equal(passe('{ volume: Percent }', [1]).s, -1, 'une liste n’est pas un objet')
  })

  it('une liste refusée n’est jamais modifiée à moitié', () => {
    const l = [150, 'x']
    assert.equal(passe('int 0..100[]', l).s, -1)
    assert.deepEqual(l, [150, 'x'])
  })

  it('choix : une valeur exacte d’abord, sinon la première conversion possible', () => {
    assert.deepEqual(passe("int 0..10 | 'auto'", 'auto'), { s: 0, v: 'auto' })
    assert.deepEqual(passe("int 0..10 | 'auto'", '5'), { s: 1, v: 5 })
    assert.deepEqual(passe("int 0..10 | 'auto'", 50), { s: 2, v: 10 })
    assert.equal(passe("int 0..10 | 'auto'", 'manuel').s, -1)
  })
})

describe('types — écriture d’une variable de composant', () => {
  it('rend la valeur à écrire, ou le refus ; en production, aucun message', () => {
    const µ  = makeMu()
    const el = composant(µ, { volume: 'Percent', color: "'red' | 'green' | 'blue'" })
    assert.equal(µ._mjs_tset(el, 'volume', 150), 100)
    assert.equal(µ._mjs_tset(el, 'volume', '7'), 7)
    assert.equal(µ._mjs_tset(el, 'color', 'purple'), µ._mjs_TNO)
    assert.deepEqual(µ.warnings, [])
  })

  it('en développement : un avertissement qui nomme la variable, la valeur, la règle et le composant', () => {
    const µ  = makeMu('warn')
    const el = composant(µ, { volume: 'Percent', color: "'red' | 'green' | 'blue'" })
    µ._mjs_tset(el, 'color', 'purple')
    µ._mjs_tset(el, 'volume', 150)
    µ._mjs_tset(el, 'volume', 50.7)
    assert.deepEqual(µ.warnings, [
      "[ModularJS] $color refuse 'purple' — permis : 'red' | 'green' | 'blue' (<mjs-essai>)",
      '[ModularJS] $volume : 150 ramené à 100 — permis : Percent (<mjs-essai>)',
    ], 'l’arrondi est une conversion : silencieux')
  })

  it('en développement, mode erreur : une erreur arrête l’écriture', () => {
    const µ  = makeMu('error')
    const el = composant(µ, { color: "'red' | 'green'" })
    assert.throws(() => µ._mjs_tset(el, 'color', 'purple'), /\$color refuse 'purple'/)
  })

  it('en anglais', () => {
    const µ  = makeMu('warn')
    µ._runtimeLabelsLang = 'en'
    µ._mjs_label = (groupe: string, cle: string) => (RUNTIME_LABELS.en as any)[groupe]?.[cle]
    const el = composant(µ, { volume: 'int 0..10' })
    µ._mjs_tset(el, 'volume', 50)
    µ._mjs_tset(el, 'volume', 'x')
    assert.deepEqual(µ.warnings, ['[ModularJS] $volume: 50 brought back to 10 — allowed: int 0..10 (<mjs-essai>)', "[ModularJS] $volume refuses 'x' — allowed: int 0..10 (<mjs-essai>)"])
  })

  it('une promesse passe : sa valeur arrive plus tard', () => {
    const µ  = makeMu('warn')
    const el = composant(µ, { volume: 'int 0..100' })
    const promesse = Promise.resolve(3)
    assert.equal(µ._mjs_tset(el, 'volume', promesse), promesse)
    assert.deepEqual(µ.warnings, [])
  })

  // un ressort (µspring, µinterpolate) a ses propres bornes : le compilateur refuse une variable du
  // <vars> qui en reçoit un ; s'il en arrive un quand même (par une fonction), il passe sans les
  // bornes de la règle — ce serait un doublon — et le développement le dit
  it('un ressort qui arrive quand même passe tel quel, sans les bornes de la règle, et le dit', () => {
    const µ  = makeMu('warn')
    const el = composant(µ, { volume: 'int 0..100' })
    const ressort: any = { value: 0, min: null, max: 5 }
    µ._mjs_interpolatorSet.add(ressort)
    assert.equal(µ._mjs_tset(el, 'volume', ressort), ressort)
    assert.equal(ressort.min, null, 'les bornes du ressort restent les siennes')
    assert.equal(ressort.max, 5)
    assert.equal(µ.warnings.length, 1)
    assert.match(µ.warnings[0], /\$volume reçoit une valeur animée[\s\S]*min, max[\s\S]*<vars>/)
  })
})

describe('types — écriture sous une valeur typée (champ, élément, clé calculée)', () => {
  it('un champ passe la règle de son objet ; un champ sans règle passe tel quel', () => {
    const µ  = makeMu('warn')
    const el = composant(µ, { settings: '{ volume: Percent, bass?: int -10..10 }' })
    const s  = { volume: 50 }
    assert.equal(µ._mjs_tset(el, 'settings', s), s)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, s, 'volume', 150), 100)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, s, 'volume', 'fort'), µ._mjs_TNO)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, s, 'bass', undefined), undefined, 'champ facultatif : peut repartir à vide')
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, s, 'libre', 'x'), 'x')
    assert.deepEqual(µ.warnings, [
      '[ModularJS] $settings.volume : 150 ramené à 100 — permis : Percent (<mjs-essai>)',
      "[ModularJS] $settings.volume refuse 'fort' — permis : Percent (<mjs-essai>)",
    ])
  })

  it('un élément de liste : sa règle, et le nombre d’éléments permis', () => {
    const µ  = makeMu()
    const el = composant(µ, { tags: 'string[] 0..2' })
    const l: any[] = ['a']
    µ._mjs_tset(el, 'tags', l)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, l, 1, 42), '42')
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, l, '2', 'c'), µ._mjs_TNO, 'un 3e élément dépasserait 2')
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, l, 'length', 0), 0)
  })

  it('après une méthode qui modifie une liste (push, splice…) : contrôle, et retour en arrière si refusé', () => {
    const µ  = makeMu()
    const el = composant(µ, { tags: 'string[] 0..2' })
    const l: any[] = ['a']
    µ._mjs_tset(el, 'tags', l)
    let avant = l.slice()
    l.push(7)
    assert.equal(µ._mjs_tafter(el, el._mjs_treg, l, avant), true)
    assert.deepEqual(l, ['a', '7'])
    avant = l.slice()
    l.push('b')
    assert.equal(µ._mjs_tafter(el, el._mjs_treg, l, avant), false)
    assert.deepEqual(l, ['a', '7'], 'la liste revient à son état d’avant')
  })

  it('supprimer un champ obligatoire est refusé', () => {
    const µ  = makeMu()
    const el = composant(µ, { settings: '{ volume: Percent, bass?: int }' })
    const s  = { volume: 50, bass: 2 }
    µ._mjs_tset(el, 'settings', s)
    assert.equal(µ._mjs_tdelete(el, el._mjs_treg, s, 'volume'), false)
    assert.equal(µ._mjs_tdelete(el, el._mjs_treg, s, 'bass'), true)
  })

  it('un objet remplacé à l’intérieur passe sa règle, puis ses propres champs sont suivis', () => {
    const µ  = makeMu()
    const el = composant(µ, { x: '{ son: { volume: Percent } }' })
    const x: any = { son: { volume: 1 } }
    µ._mjs_tset(el, 'x', x)
    const neuf = { volume: 500 }
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, x, 'son', neuf), neuf)
    assert.equal(neuf.volume, 100)
    assert.equal(µ._mjs_tdeep(el, el._mjs_treg, neuf, 'volume', -4), 0)
  })
})

describe('types — stores ($$x)', () => {
  it('la règle d’un store vaut pour toute l’appli ; la valeur déjà présente la passe tout de suite', () => {
    const µ = makeMu('warn')
    µ._mjs_storeRaw.cart = { quantity: 500 }
    µ._mjs_storeTypes({ cart: regle('{ quantity: int 1..99 }'), level: regle('int 1..3') })
    assert.equal(µ._mjs_storeRaw.cart.quantity, 99)
    assert.deepEqual(µ.notified, ['cart'])
    assert.equal(µ._mjs_tstore('level', 7), 3)
    assert.equal(µ._mjs_tstore('level', 'x'), µ._mjs_TNO)
    assert.equal(µ._mjs_tdeep(null, µ._mjs_storeTreg, µ._mjs_storeRaw.cart, 'quantity', 0), 1)
    assert.match(µ.warnings.join('\n'), /\$\$cart\.quantity : 500 ramené à 99/)
    assert.match(µ.warnings.join('\n'), /\$\$level refuse 'x'/)
  })

  it('une deuxième déclaration du même store ne remplace pas la première', () => {
    const µ = makeMu()
    µ._mjs_storeTypes({ level: regle('int 1..3') })
    µ._mjs_storeTypes({ level: regle('int 1..100') })
    assert.equal(µ._mjs_tstore('level', 50), 3)
  })
})
