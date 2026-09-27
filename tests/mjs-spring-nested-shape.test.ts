// Régression — µ.spring (mjs_spring.ts) : un garde-fou de changement de forme (objet/tableau/
// nombre) existait déjà, mais SEULEMENT à la racine (`value` setter, comparant `this.current` à
// `newTarget`). Une valeur IMBRIQUÉE qui change de forme — `{a:{x:1}} -> {a:[1,2]}}`, racine
// inchangée (toujours un objet à une clé 'a') — passait sous ce radar : `_mjsSpringStep`
// choisissait sa branche selon la nature de `cur` SEUL (jamais celle de `tgt`), prenait la
// branche OBJET pour `cur.a` et fusionnait les index du tableau cible comme des clés
// (`for...in` sur un Array) → un hybride `{0:1,1:2,x:1}`, jamais un vrai tableau, figé dès la
// 1re étape, sans le moindre avertissement (cf. mjs-spring-shape-union pour le cas RACINE,
// déjà couvert par ailleurs).
//
// Même mécanique de chargement que anim-spring-shape-union.test.ts (cf. son en-tête).

import assert from 'node:assert/strict'

;(globalThis as any).µ = (globalThis as any).µ || { _mjs_interpolatorSet: new WeakSet(), Ticker: { add() {} } }
await import('../src/runtime/mjs_spring.js')
const µ = (globalThis as any).µ

function settle(s: any, max = 5000) { let i = 0; while (i++ < max && s._mjs_step()) {} return i }

describe('µ.spring — changement de forme IMBRIQUÉ (pas seulement à la racine)', () => {
  let __muBackup: any
  before(() => { __muBackup = (globalThis as any).µ; (globalThis as any).µ = µ })
  after(() => { (globalThis as any).µ = __muBackup })

  let warned: any[] = []
  beforeEach(() => { warned = []; µ.warn = (...a: any[]) => warned.push(a) })

  it("valeur imbriquée objet -> tableau (racine inchangée, toujours {a: …}) : current.a devient un VRAI Array, plus d'hybride, 1 warn", () => {
    const s = µ.spring({ a: { x: 1 } })
    s.value = { a: [1, 2] }
    assert.equal(warned.length, 0, 'la racine ne change pas de forme (objet à une clé "a" des deux côtés) : rien à signaler AU SET')
    settle(s)
    assert.ok(Array.isArray((s.current as any).a), `current.a doit être reformé en TABLEAU, pas un hybride : ${JSON.stringify(s.current)}`)
    assert.deepEqual(s.current, { a: [1, 2] })
    assert.equal(warned.length, 1, 'un avertissement doit être émis (à la 1re frame, la forme redevient cohérente ensuite)')
  })

  it('valeur imbriquée tableau -> objet (symétrique) : current.a redevient un objet PLAT, 1 warn', () => {
    const s = µ.spring({ a: [1, 2, 3] })
    s.value = { a: { x: 10, y: 20 } }
    settle(s)
    assert.equal(Array.isArray((s.current as any).a), false, `current.a doit être reformé en OBJET : ${JSON.stringify(s.current)}`)
    assert.deepEqual(s.current, { a: { x: 10, y: 20 } })
    assert.equal(warned.length, 1)
  })

  it('valeur imbriquée objet -> nombre : la branche saute directement au nombre cible, 1 warn', () => {
    const s = µ.spring({ a: { x: 1 } })
    s.value = { a: 10 }
    settle(s)
    assert.equal(typeof (s.current as any).a, 'number', `current.a doit devenir un NOMBRE : ${JSON.stringify(s.current)}`)
    assert.deepEqual(s.current, { a: 10 })
    assert.equal(warned.length, 1)
  })

  it("un SEUL warn même après un settle complet (plusieurs frames), pas un par frame", () => {
    const s = µ.spring({ a: { x: 1 } })
    s.value = { a: [1, 2] }
    const iterations = settle(s)
    assert.ok(iterations >= 1)
    assert.equal(warned.length, 1, `toujours 1 seul warn après ${iterations} frame(s)`)
  })

  it('un axe FRÈRE non concerné par le changement de forme continue d\'animer normalement, sans reset', () => {
    const s = µ.spring({ a: { x: 1 }, b: 0 })
    s.value = { a: [1, 2], b: 10 } // seul `a` change de NATURE ; `b` reste un nombre -> nombre
    const firstStep = s._mjs_step()
    assert.equal(firstStep, true, "'b' doit encore être en train d'animer après le 1er pas — la branche 'a' ne doit pas re-settle tout le ressort")
    assert.notEqual((s.current as any).b, 10, "'b' anime PROGRESSIVEMENT (pas de saut direct, lui n'a pas changé de forme)")
    settle(s)
    assert.deepEqual(s.current, { a: [1, 2], b: 10 })
  })

  it("MÊME nature imbriquée mais clés différentes ({a:{x:1}} -> {a:{y:2}}) : PAS un changement de forme, aucun avertissement de nature", () => {
    const s = µ.spring({ a: { x: 1 } })
    s.value = { a: { y: 2 } }
    settle(s)
    assert.equal(warned.length, 0, "objet -> objet n'est pas un changement de NATURE, même avec des clés différentes")
    assert.deepEqual(s.current, { a: { x: 1, y: 2 } }, "'x' figé (absent de la cible), 'y' apparaît direct (absent de current) — comportement union existant, inchangé")
  })
})
