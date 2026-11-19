// µschema en anglais, des deux côtés (serveur : src/schema/core.ts ; navigateur : src/runtime/mjs_schema.ts) : une définition porte
// `name`, `fields` et `order` ; bits() range ses drapeaux sous `names` ; le registre se lit par `byName` et `byId` ; les définitions
// qui voyagent (trame µ:schema, point d'accès de µ.ajax.binary) ne portent que `name` et `fields`. Le hash du registre ne dépend que
// des valeurs : il ne change pas. Une définition écrite avec les anciens noms français (`nom`, `champs`) n'est plus lue : le registre
// du navigateur reste tel quel, et l'erreur s'écrit
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bits, list, createRegistry, defineSchema, encode, hashRegistry, serializeDefinitions, loadDefinitions } from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE    = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

// hash FNV-1a de ce registre, relevé avant le passage aux noms anglais
const HASH = 'c5840dae'

function serverRegistry(): any {
  const r: any = createRegistry()
  defineSchema(r, 'pos', { x: 'i16', tags: list('str8'), f: bits(['alive', 'vip']) })
  defineSchema(r, 'chat', { text: 'str16' })
  return r
}

function client(): { µ: any; errors: unknown[][] } {
  const errors: unknown[][] = []
  const µ: any = { error: (...a: unknown[]) => errors.push(a), warn: () => {} }
  new Function('µ', SOURCE)(µ)
  return { µ, errors }
}

describe('µschema côté serveur — noms anglais', () => {
  it('bits() range ses drapeaux sous `names`', () => {
    assert.deepEqual(bits(['alive', 'vip']), { kind: 'bits', names: ['alive', 'vip'] })
  })

  it('une définition : id, name, fields, order ; le registre : byName, byId', () => {
    const r   = serverRegistry()
    const def = r.byName.get('pos')
    assert.deepEqual(Object.keys(r), ['byName', 'byId'])
    assert.deepEqual(Object.keys(def), ['id', 'name', 'fields', 'order'])
    assert.equal(def.name, 'pos')
    assert.deepEqual(def.order, ['x', 'tags', 'f'])
    assert.deepEqual(def.fields.f, { kind: 'bits', names: ['alive', 'vip'] })
    assert.equal(r.byId[1].name, 'chat')
  })

  it('les définitions qui voyagent : `name` et `fields` seulement ; rechargées telles quelles', () => {
    const json = serializeDefinitions(serverRegistry())
    assert.deepEqual(json.schemas[0], { name: 'pos', fields: [['x', 'i16'], ['tags', { kind: 'list', of: 'str8' }], ['f', { kind: 'bits', names: ['alive', 'vip'] }]] })
    assert.equal(/"(nom|champs|noms|ordre)"/.test(JSON.stringify(json)), false)
    const back: any = loadDefinitions(JSON.parse(JSON.stringify(json)))
    assert.deepEqual(back.byName.get('pos').order, ['x', 'tags', 'f'])
    assert.equal(hashRegistry(back), json.hash)
  })

  it('le hash du registre ne change pas', () => {
    assert.equal(hashRegistry(serverRegistry()), HASH)
  })
})

describe('µschema côté navigateur — noms anglais', () => {
  it('µ.bits, µ.schema et le registre : les mêmes noms que le serveur, le même hash', () => {
    const { µ } = client()
    assert.deepEqual(µ.bits(['alive', 'vip']), { kind: 'bits', names: ['alive', 'vip'] })
    const def = µ.schema('pos', { x: 'i16', tags: µ.list('str8'), f: µ.bits(['alive', 'vip']) })
    µ.schema('chat', { text: 'str16' })
    assert.deepEqual(Object.keys(def), ['id', 'name', 'fields', 'order'])
    assert.deepEqual(def.order, ['x', 'tags', 'f'])
    assert.deepEqual(def.fields.f.names, ['alive', 'vip'])
    assert.deepEqual(Object.keys(µ._mjs_mjschemaRegistry), ['byName', 'byId'])
    assert.equal(µ._mjs_mjschemaHelloHash(), HASH)
  })

  it('trame µ:schema du serveur : le registre se recharge, une trame binaire du serveur se lit', () => {
    const { µ, errors } = client()
    const dispatched: unknown[] = []
    const sock = { opts: {}, _mjs_dispatch: (t: string, msg: any) => dispatched.push([t, msg.p]) }
    const r    = serverRegistry()
    µ._mjs_mjschemaOnPush(sock, { p: { definitions: serializeDefinitions(r) } })
    assert.deepEqual(errors, [])
    assert.deepEqual(µ._mjs_mjschemaRegistry.byName.get('pos').order, ['x', 'tags', 'f'])
    µ._mjs_mjschemaOnBinary(sock, encode(r, 'pos', { x: -3, tags: ['a'], f: { vip: true } }))
    assert.deepEqual(dispatched, [['pos', { x: -3, tags: ['a'], f: { alive: false, vip: true } }]])
  })

  it('définitions écrites avec les anciens noms (`nom`, `champs`) : plus lues, le registre reste tel quel, l\'erreur s\'écrit', () => {
    const { µ, errors } = client()
    µ.schema('pos', { x: 'i16' })
    const avant = µ._mjs_mjschemaRegistry
    µ._mjs_mjschemaOnPush({ opts: {} }, { p: { definitions: { hash: 'x', schemas: [{ nom: 'chat', champs: [['text', 'str16']]}] } } })
    assert.equal(µ._mjs_mjschemaRegistry, avant)
    assert.equal(errors.length, 1)
  })
})
