// µschema, des deux côtés (serveur src/schema/core.ts, client src/runtime/mjs_schema.ts) : `Infinity`, `-Infinity` et `NaN`
// dans un champ entier arrivaient à 0 sans un mot, alors qu'une valeur hors de la plage du type lève. Ils lèvent désormais la
// même erreur, qui nomme le schéma, le champ et la plage ; une valeur absente ou qui n'est pas un nombre vaut toujours 0.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerRegistre, defSchema, encode, decode, list } from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaSrc = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

function codecServeur() {
  const registre = creerRegistre()
  return {
    nom: 'serveur',
    declarer: (nom: string, champs: any) => { defSchema(registre, nom, champs) },
    encoder: (nom: string, objet: any) => encode(registre, nom, objet),
    decoder: (octets: Uint8Array) => decode(registre, octets).objet,
  }
}

function codecClient() {
  const µ: any = { state: (i: any) => ({ ...i }), warn: () => {}, log: () => {}, error: () => {} }
  µ._mjs_txt = (_k: string, vars: any, fr: string) => fr.replace(/\{(\w+)\}/g, (_m: string, n: string) => String(vars?.[n] ?? ''))
  const interne = new Function('µ', schemaSrc + '\nreturn { encoder: mjschemaEncode, decoder: mjschemaDecode };')(µ)
  return {
    nom: 'client',
    declarer: (nom: string, champs: any) => { µ.schema(nom, champs) },
    encoder: (nom: string, objet: any) => interne.encoder(µ._mjs_mjschemaRegistre, nom, objet),
    decoder: (octets: Uint8Array) => interne.decoder(µ._mjs_mjschemaRegistre, octets).objet,
  }
}

for (const fabrique of [codecServeur, codecClient]) {
  const cote = fabrique().nom

  describe(`µschema (${cote}) — Infinity et NaN dans un champ entier`, () => {
    const cas: Array<[string, number]> = [['u8', Infinity], ['i32', -Infinity], ['u32', Infinity], ['i8', NaN], ['u16', NaN]]
    for (const [type, valeur] of cas) {
      it(`${type} ${valeur} : la même erreur qu'une valeur hors plage`, () => {
        const c = fabrique()
        c.declarer('m', { v: type })
        assert.throws(() => c.encoder('m', { v: valeur }), (e: any) => /'v'/.test(e.message) && e.message.includes(String(valeur)) && /plage/.test(e.message))
      })
    }

    it('un élément de liste infini lève aussi', () => {
      const c = fabrique()
      c.declarer('l', { n: list('i16') })
      assert.throws(() => c.encoder('l', { n: [1, -Infinity] }), /plage/)
    })

    it('témoins : une valeur absente, nulle ou qui n\'est pas un nombre vaut toujours 0', () => {
      const c = fabrique()
      c.declarer('t', { a: 'u8', b: 'i16', d: 'u32' })
      assert.deepEqual(c.decoder(c.encoder('t', { b: null, d: 'abc' })), { a: 0, b: 0, d: 0 })
    })
  })
}
