// µschema : un champ `f32` ou `f64` recevait 0 pour `Infinity`, `-Infinity` et `NaN` (la tolérance des champs entiers, `numOr0`), alors que
// le format IEEE les écrit : ils passent tels quels, côté serveur (src/schema/core.ts) comme côté navigateur (src/runtime/mjs_schema.ts).
// Une valeur absente ou qui n'est pas un nombre vaut toujours 0 ; un champ entier refuse toujours un nombre infini

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerRegistre, defSchema, encode, decode } from '../src/schema/core.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const CLIENT = new Function('µ', readFileSync(join(ICI, '../src/runtime/mjs_schema.ts'), 'utf-8') + '\nreturn { ecrire: _mjschemaEcrireScalaire }')({})

function allerRetour(objet: Record<string, unknown>): Record<string, unknown> {
  const r = creerRegistre()
  defSchema(r, 'p', { a: 'f32', b: 'f64', c: 'f32', d: 'f64' })
  return decode(r, encode(r, 'p', objet)).objet
}

function client(type: 'f32' | 'f64', valeur: unknown): number {
  const vue = new DataView(new ArrayBuffer(8))
  CLIENT.ecrire(vue, 0, type, valeur, { octets: [], i: 0 })
  return type === 'f32' ? vue.getFloat32(0, true) : vue.getFloat64(0, true)
}

describe('µschema — Infinity, -Infinity et NaN dans un champ flottant', () => {
  it('serveur : ils passent tels quels', () => {
    const o = allerRetour({ a: Infinity, b: -Infinity, c: NaN, d: Infinity })
    assert.equal(o.a, Infinity)
    assert.equal(o.b, -Infinity)
    assert.ok(Number.isNaN(o.c), String(o.c))
    assert.equal(o.d, Infinity)
  })

  it('serveur : une valeur absente ou qui n\'est pas un nombre vaut toujours 0', () => {
    assert.deepEqual(allerRetour({ a: undefined, b: 'abc', c: null, d: '1.5' }), { a: 0, b: 0, c: 0, d: 1.5 })
  })

  it('serveur : un champ entier refuse toujours un nombre infini', () => {
    const r = creerRegistre()
    defSchema(r, 'n', { a: 'i32' })
    assert.throws(() => encode(r, 'n', { a: Infinity }))
  })

  it('navigateur : la même écriture', () => {
    for (const type of ['f32', 'f64'] as const) {
      assert.equal(client(type, Infinity), Infinity)
      assert.equal(client(type, -Infinity), -Infinity)
      assert.ok(Number.isNaN(client(type, NaN)))
      assert.equal(client(type, undefined), 0)
      assert.equal(client(type, 'abc'), 0)
      assert.equal(client(type, 2.5), 2.5)
    }
  })
})
