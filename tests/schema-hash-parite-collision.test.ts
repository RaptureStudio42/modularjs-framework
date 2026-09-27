// Régression — src/schema/core.ts ET src/runtime/mjs_schema.ts (hashRegistre/mjschemaHashRegistre) :
// les noms de champs/schémas étaient concaténés SANS échappement pour produire le texte haché — un
// champ nommé « b=u8,c » (1 champ) et deux champs b:u8, c:u8 (2 champs) donnaient le MÊME hash
// malgré des trames de 2 et 3 octets (collision structurelle qui trompe la vérification de
// compatibilité client/serveur). La sérialisation hachée doit désormais être non ambiguë (encodage
// JSON), et rester CARACTÈRE POUR CARACTÈRE identique entre le serveur et le client — un désaccord
// d'algorithme entre les deux ferait pousser µ:schema à chaque hello, même pour des schémas
// identiques.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerRegistre, defSchema, encode, hashRegistre, list, bits } from '../src/schema/core.js'
import type { MjschemaRegistre } from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaSrc = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

function makeµ(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', schemaSrc)(µ)
  return µ
}

describe('schema/core — hashRegistre : plus de collision sur des noms de champs non échappés', () => {
  it("« b=u8,c » (1 champ) et b:u8/c:u8 (2 champs) ont des hash DIFFÉRENTS malgré des tailles de trame différentes", () => {
    const reg1 = creerRegistre()
    defSchema(reg1, 'x', { 'b=u8,c': 'u8' } as any)
    const h1 = hashRegistre(reg1)
    const taille1 = encode(reg1, 'x', { 'b=u8,c': 5 } as any).length

    const reg2 = creerRegistre()
    defSchema(reg2, 'x', { b: 'u8', c: 'u8' })
    const h2 = hashRegistre(reg2)
    const taille2 = encode(reg2, 'x', { b: 5, c: 9 }).length

    assert.notEqual(h1, h2, 'les deux schémas structurellement différents doivent avoir des hash DIFFÉRENTS')
    assert.notEqual(taille1, taille2, `sanity : tailles de trame réellement différentes (${taille1} vs ${taille2})`)
  })

  it('hashRegistre reste STABLE (déterministe) pour un même registre construit deux fois', () => {
    const build = (): MjschemaRegistre => {
      const r = creerRegistre()
      defSchema(r, 'pos', { x: 'i16', y: 'i16' })
      return r
    }
    assert.equal(hashRegistre(build()), hashRegistre(build()))
  })
})

describe('schema/core — hashRegistre : plus de collision sur les noms bits() non échappés', () => {
  it("bits(['a+b','c']), bits(['a','b','c']) et bits(['a','b+c']) — trois structures DIFFÉRENTES (découpage/nombre de sous-champs) — ont des hash tous DIFFÉRENTS", () => {
    const r1 = creerRegistre()
    defSchema(r1, 'x', { f: bits(['a+b', 'c']) })
    const h1 = hashRegistre(r1)

    const r2 = creerRegistre()
    defSchema(r2, 'x', { f: bits(['a', 'b', 'c']) })
    const h2 = hashRegistre(r2)

    const r3 = creerRegistre()
    defSchema(r3, 'x', { f: bits(['a', 'b+c']) })
    const h3 = hashRegistre(r3)

    assert.notEqual(h1, h2, "bits(['a+b','c']) (2 sous-champs) et bits(['a','b','c']) (3 sous-champs) doivent avoir des hash DIFFÉRENTS")
    assert.notEqual(h1, h3, "bits(['a+b','c']) et bits(['a','b+c']) — découpages différents — doivent avoir des hash DIFFÉRENTS")
    assert.notEqual(h2, h3, "bits(['a','b','c']) et bits(['a','b+c']) doivent avoir des hash DIFFÉRENTS")
  })

  it("un schéma SERVEUR bits(['a+b','c']) et un schéma CLIENT bits(['a','b','c']), déclarés indépendamment, ne sont JAMAIS jugés compatibles (hash différents)", () => {
    const rServeur = creerRegistre()
    defSchema(rServeur, 'etat', { flags: bits(['a+b', 'c']) })
    const hServeur = hashRegistre(rServeur)

    const µ = makeµ()
    µ.schema('etat', { flags: µ.bits(['a', 'b', 'c']) })
    const hClient = µ._mjs_mjschemaHelloHash()

    assert.notEqual(hServeur, hClient, 'deux structures bits() sémantiquement différentes ne doivent jamais partager le même hash')
  })
})

describe('schema/core ↔ mjs_schema.ts — parité du hash, CARACTÈRE POUR CARACTÈRE, plusieurs schémas', () => {
  it('un schéma simple (scalaires) donne EXACTEMENT le même hash des deux côtés', () => {
    const rServeur = creerRegistre()
    defSchema(rServeur, 'pos', { x: 'i16', y: 'i16' })
    const hServeur = hashRegistre(rServeur)

    const µ = makeµ()
    const defClient = µ.schema('pos', { x: 'i16', y: 'i16' })
    const hClient = µ._mjs_mjschemaHelloHash()

    assert.ok(defClient)
    assert.equal(hClient, hServeur, 'hash CLIENT et SERVEUR doivent coïncider pour une déclaration identique')
  })

  it('un schéma avec list()/bits() donne aussi EXACTEMENT le même hash des deux côtés', () => {
    const rServeur = creerRegistre()
    defSchema(rServeur, 'mix', { a: 'u16', tags: list('str8'), f: bits(['vivant', 'vip']) })
    const hServeur = hashRegistre(rServeur)

    const µ = makeµ()
    µ.schema('mix', { a: 'u16', tags: µ.list('str8'), f: µ.bits(['vivant', 'vip']) })
    const hClient = µ._mjs_mjschemaHelloHash()

    assert.equal(hClient, hServeur)
  })

  it('le cas de COLLISION (noms non échappés) donne aussi le MÊME hash des deux côtés — la parité tient même sur ce cas limite', () => {
    const rServeur1 = creerRegistre()
    defSchema(rServeur1, 'x', { 'b=u8,c': 'u8' } as any)
    const hServeur1 = hashRegistre(rServeur1)

    const rServeur2 = creerRegistre()
    defSchema(rServeur2, 'x', { b: 'u8', c: 'u8' })
    const hServeur2 = hashRegistre(rServeur2)

    const µ1 = makeµ()
    µ1.schema('x', { 'b=u8,c': 'u8' })
    const hClient1 = µ1._mjs_mjschemaHelloHash()

    const µ2 = makeµ()
    µ2.schema('x', { b: 'u8', c: 'u8' })
    const hClient2 = µ2._mjs_mjschemaHelloHash()

    assert.equal(hClient1, hServeur1, "hash CLIENT/SERVEUR identiques pour le schéma 'b=u8,c'")
    assert.equal(hClient2, hServeur2, "hash CLIENT/SERVEUR identiques pour le schéma b:u8,c:u8")
    assert.notEqual(hServeur1, hServeur2, 'sanity : les deux schémas restent bien distingués (pas de collision)')
  })

  it('plusieurs schémas déclarés dans le même registre — hash toujours identique des deux côtés', () => {
    const rServeur = creerRegistre()
    defSchema(rServeur, 'pos', { x: 'i16', y: 'i16' })
    defSchema(rServeur, 'chat', { texte: 'str16' })
    defSchema(rServeur, 'etat', { hp: 'u8', pseudo: 'str8' })
    const hServeur = hashRegistre(rServeur)

    const µ = makeµ()
    µ.schema('pos', { x: 'i16', y: 'i16' })
    µ.schema('chat', { texte: 'str16' })
    µ.schema('etat', { hp: 'u8', pseudo: 'str8' })
    const hClient = µ._mjs_mjschemaHelloHash()

    assert.equal(hClient, hServeur)
  })
})
