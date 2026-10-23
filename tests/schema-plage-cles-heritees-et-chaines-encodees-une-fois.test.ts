// µschema, des deux côtés (serveur src/schema/core.ts, client src/runtime/mjs_schema.ts) :
//   - une valeur hors de la plage de son type arrivait repliée sans un mot (u8 300 → 44, u32 -1 → 4294967295) :
//     erreur claire à l'encodage (le client, qui attrape l'erreur, envoie alors en JSON et le signale)
//   - une propriété héritée d'Object.prototype était lue comme une valeur (`bits(['toString'])` vrai, un champ
//     `constructor` absent envoyait « function Object() … ») ; `bits(['__proto__'])` était accepté
//   - chaque chaîne était encodée en UTF-8 deux fois par message (mesure puis écriture)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerRegistre, defSchema, encode, decode, bits, list } from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaSrc = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

interface Codec {
  nom: string
  declarer(nom: string, champs: any): void
  encoder(nom: string, objet: any): Uint8Array
  decoder(octets: Uint8Array): any
}

function codecServeur(): Codec {
  const registre = creerRegistre()
  return {
    nom: 'serveur',
    declarer: (nom, champs) => { defSchema(registre, nom, champs) },
    encoder: (nom, objet) => encode(registre, nom, objet),
    decoder: (octets) => decode(registre, octets).objet,
  }
}

function muClient(): any {
  const µ: any = { erreurs: [] as string[], state: (i: any) => ({ ...i }), warn: () => {}, log: () => {} }
  µ.error = (...a: any[]) => { µ.erreurs.push(a.map(String).join(' ')) }
  µ._mjs_txt = (_k: string, vars: any, fr: string) => fr.replace(/\{(\w+)\}/g, (_m: string, n: string) => String(vars?.[n] ?? ''))
  µ.interne = new Function('µ', schemaSrc + '\nreturn { encoder: mjschemaEncode, decoder: mjschemaDecode };')(µ)
  return µ
}

function codecClient(): Codec {
  const µ = muClient()
  return {
    nom: 'client',
    declarer: (nom, champs) => { µ.schema(nom, champs) },
    encoder: (nom, objet) => µ.interne.encoder(µ._mjs_mjschemaRegistre, nom, objet),
    decoder: (octets) => µ.interne.decoder(µ._mjs_mjschemaRegistre, octets).objet,
  }
}

for (const fabrique of [codecServeur, codecClient]) {
  const cote = fabrique().nom

  describe(`µschema (${cote}) — valeur hors de la plage du type`, () => {
    const cas: Array<[string, number]> = [['u8', 300], ['u8', -1], ['i8', 200], ['u16', 70000], ['u16', 1e10], ['i16', 40000], ['u32', -1], ['i32', 2 ** 31]]
    for (const [type, valeur] of cas) {
      it(`${type} ${valeur} : erreur claire qui nomme le champ et la plage`, () => {
        const c = fabrique()
        c.declarer('m', { v: type })
        assert.throws(() => c.encoder('m', { v: valeur }), (e: any) => /'v'/.test(e.message) && new RegExp(String(valeur).replace('+', '\\+')).test(e.message) && /plage/.test(e.message))
      })
    }

    it('un élément de liste hors plage lève aussi', () => {
      const c = fabrique()
      c.declarer('l', { n: list('u8') })
      assert.throws(() => c.encoder('l', { n: [1, 300] }), /plage/)
    })

    it('témoins : les bornes passent, une fraction est tronquée, une valeur absente vaut 0', () => {
      const c = fabrique()
      c.declarer('t', { a: 'u8', b: 'i16', d: 'u32', e: 'u8', f: 'i8' })
      assert.deepEqual(c.decoder(c.encoder('t', { a: 255, b: -32768, d: 4294967295, e: 3.9 })), { a: 255, b: -32768, d: 4294967295, e: 3, f: 0 })
    })
  })

  describe(`µschema (${cote}) — clés héritées d'Object.prototype`, () => {
    it('bits() : toString et constructor absents de l\'objet arrivent faux', () => {
      const c = fabrique()
      c.declarer('d', { d: bits(['toString', 'a', 'constructor']) })
      assert.deepEqual(c.decoder(c.encoder('d', { d: { a: false } })), { d: { toString: false, a: false, constructor: false } })
    })

    it('un champ constructor absent de l\'objet arrive en chaîne vide', () => {
      const c = fabrique()
      c.declarer('k', { constructor: 'str8' } as any)
      assert.equal(c.decoder(c.encoder('k', {})).constructor, '')
    })

    it('bits([\'__proto__\', …]) est refusé à la déclaration', () => {
      const c = fabrique()
      assert.throws(() => c.declarer('p', { d: bits(['__proto__', 'b']) }), /__proto__/)
    })

    it('témoin : une valeur posée par un getter de classe reste lue', () => {
      class Pos { get x() { return 7 } }
      const c = fabrique()
      c.declarer('g', { x: 'u8' })
      assert.deepEqual(c.decoder(c.encoder('g', new Pos())), { x: 7 })
    })
  })

  describe(`µschema (${cote}) — chaque chaîne encodée une seule fois`, () => {
    it('trois chaînes et une liste de deux : cinq passages UTF-8, mêmes octets', () => {
      const c = fabrique()
      c.declarer('s', { a: 'str8', b: 'str16', n: 'u8', l: list('str8'), z: 'str8' })
      const objet = { a: 'héllo', b: 'monde ✓', n: 4, l: ['x', 'ÿ'], z: '' }
      const origine = TextEncoder.prototype.encode
      let appels = 0
      TextEncoder.prototype.encode = function (this: TextEncoder, s?: string) { appels++; return origine.call(this, s) }
      let octets: Uint8Array
      try { octets = c.encoder('s', objet) }
      finally { TextEncoder.prototype.encode = origine }
      assert.equal(appels, 5)
      assert.deepEqual(c.decoder(octets!), objet)
    })
  })
}

describe('µschema (client) — envoi d\'une valeur hors plage', () => {
  it('l\'envoi passe en JSON et l\'erreur est signalée, jamais repliée en silence', () => {
    const µ = muClient()
    µ.schema('pos', { hp: 'u8' })
    const binaire = µ._mjs_mjschemaEncode({ opts: {} }, { t: 'pos', p: { hp: 300 } })
    assert.equal(binaire, null)
    assert.equal(µ.erreurs.length, 1)
  })
})
