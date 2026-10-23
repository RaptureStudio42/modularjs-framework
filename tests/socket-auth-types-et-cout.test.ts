// µ.socket(url, opts) sur une adresse déjà tenue : deux `auth` de types natifs différents ne sont jamais jugés
// identiques (expressions régulières, erreurs, primitives encapsulées, URL, tampons et vues binaires, tableaux
// typés) ; deux WeakMap ou deux WeakSet ne se comparent que par référence ; la comparaison reste linéaire en
// nombre de clés et en taille des tampons.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')

describe('µ.socket — comparaison de `auth` : types natifs et coût', () => {
  let avertissements: string[]
  let µ: any
  let n: number

  beforeEach(() => {
    avertissements = []
    n = 0
    µ = { state: (o: any) => ({ ...o }), error: () => {}, warn: (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }, log: () => {} }
    poserMessages(µ)
    new Function('µ', socketSrc)(µ)
  })

  afterEach(() => {
    Object.values(µ._mjs_sockets).forEach((s: any) => { try { s.destroy() } catch { /* connexion posée à la main */ } })
  })

  const comparer = (a: any, b: any) => {
    const url = 'wss://types/' + (++n)
    avertissements.length = 0
    assert.doesNotThrow(() => { µ.socket(url, { auth: a }); µ.socket(url, { auth: b }) }, 'jamais d\'exception')
    return avertissements.length
  }
  const buf = (...o: number[]) => new Uint8Array(o).buffer

  const cas: Array<[string, () => any, () => any, () => any]> = [
    ['RegExp',            () => /a/,                     () => /b/,                      () => /a/],
    ['RegExp (drapeaux)', () => /a/g,                    () => /a/i,                     () => /a/g],
    ['Error (message)',   () => new Error('un'),         () => new Error('deux'),        () => new Error('un')],
    ['Error (nom)',       () => new Error('x'),          () => new TypeError('x'),       () => new Error('x')],
    ['Number encapsulé',  () => new Number(1),           () => new Number(2),            () => new Number(1)],
    ['Boolean encapsulé', () => new Boolean(true),       () => new Boolean(false),       () => new Boolean(true)],
    ['String encapsulée', () => new String('a'),         () => new String('b'),          () => new String('a')],
    ['URL',               () => new URL('https://a.fr/'), () => new URL('https://b.fr/'), () => new URL('https://a.fr/')],
    ['ArrayBuffer',       () => buf(1, 2, 3),            () => buf(1, 2, 4),             () => buf(1, 2, 3)],
    ['ArrayBuffer (taille)', () => buf(1, 2),            () => buf(1, 2, 3),             () => buf(1, 2)],
    ['DataView',          () => new DataView(buf(1, 2)), () => new DataView(buf(1, 3)),  () => new DataView(buf(1, 2))],
    ['Uint8Array',        () => new Uint8Array([1, 2]),  () => new Uint8Array([1, 3]),   () => new Uint8Array([1, 2])],
    ['Float64Array',      () => new Float64Array([1, 2]), () => new Float64Array([1, 3]), () => new Float64Array([1, 2])],
    ['Uint8Array (taille)', () => new Uint8Array([1]),   () => new Uint8Array([1, 0]),   () => new Uint8Array([1])]
  ]
  cas.forEach(([nom, a, b, a2]) => {
    it(nom + ' : deux valeurs différentes avertissent, deux valeurs égales se taisent', () => {
      assert.equal(comparer(a(), b()), 1, 'différents : un avertissement')
      assert.equal(comparer(a(), a2()), 0, 'égaux : aucun avertissement')
      assert.equal(comparer({ k: a() }, { k: b() }), 1, 'imbriqués, différents : un avertissement')
      assert.equal(comparer({ k: a() }, { k: a2() }), 0, 'imbriqués, égaux : aucun avertissement')
    })
  })

  it('WeakMap et WeakSet : la référence seule', () => {
    const wm = new WeakMap(); const ws = new WeakSet()
    assert.equal(comparer(new WeakMap(), new WeakMap()), 1, 'deux WeakMap distinctes')
    assert.equal(comparer(new WeakSet(), new WeakSet()), 1, 'deux WeakSet distincts')
    assert.equal(comparer(wm, wm), 0, 'la même WeakMap')
    assert.equal(comparer(ws, ws), 0, 'le même WeakSet')
  })

  it('50 000 clés : comparées en moins de 100 ms', () => {
    const a: any = {}; const b: any = {}
    for (let i = 0; i < 50000; i++) { a['k' + i] = i; b['k' + (49999 - i)] = 49999 - i }
    // le meilleur de trois essais : une machine chargée ne fait pas échouer une comparaison linéaire
    let d = Infinity
    for (let i = 0; i < 3; i++) {
      const t = Date.now()
      assert.equal(comparer(a, b), 0, 'mêmes clés, autre ordre : égaux')
      d = Math.min(d, Date.now() - t)
    }
    assert.ok(d < 100, 'comparaison linéaire : ' + d + ' ms')
  })

  it('un tampon d\'un million d\'octets : comparé en moins de 500 ms', () => {
    const a = new Uint8Array(1e6); const b = new Uint8Array(1e6)
    const t = Date.now()
    assert.equal(comparer(a, b), 0, 'mêmes octets : égaux')
    b[999999] = 1
    assert.equal(comparer(a, b), 1, 'un octet change : différents')
    const d = Date.now() - t
    assert.ok(d < 500, 'comparaison linéaire : ' + d + ' ms')
  })
})
