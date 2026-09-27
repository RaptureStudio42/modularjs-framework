// Régression — src/schema/core.ts ET src/runtime/mjs_schema.ts : un champ nommé '__proto__' était
// accepté à la déclaration mais PERDU au rechargement (chargerDefinitions reconstruit `champs` en
// affectant `champs[c] = t` sur un objet — '__proto__' y déclenche le setter hérité
// d'Object.prototype au lieu de créer une propriété, silencieusement avalé) : décalage d'offset au
// décodage, jamais signalé. Tout nom de champ qui ne survit pas à un objet ordinaire doit désormais
// être refusé À LA DÉCLARATION, avec une erreur claire, des deux côtés.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  creerRegistre, defSchema, encode, hashRegistre, serialiserDefinitions, chargerDefinitions,
} from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaSrc = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

function makeµ(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', schemaSrc)(µ)
  return µ
}

describe("schema/core — defSchema refuse un champ nommé '__proto__' (et similaires) à la déclaration", () => {
  it("un champ '__proto__' construit via Object.create(null) est refusé avec une erreur claire", () => {
    const reg = creerRegistre()
    const champs = Object.create(null) as any
    champs['__proto__'] = 'u8'
    champs['x'] = 'u8'
    assert.throws(() => defSchema(reg, 'evilproto', champs), /__proto__|nom de champ invalide/i)
  })

  it("un champ '__proto__' reçu via chargerDefinitions (voyage réseau JSON) est refusé, jamais perdu en silence", () => {
    const json: any = {
      hash: 'peu-importe',
      schemas: [{ nom: 'x', champs: [['__proto__', 'u8'], ['y', 'u8']] }],
    }
    assert.throws(() => chargerDefinitions(json), /__proto__|nom de champ invalide/i)
  })

  it('un champ normal (aucun nom piégeux) continue de fonctionner : round-trip complet inchangé', () => {
    const origine = creerRegistre()
    defSchema(origine, 'normal', { x: 'u8', y: 'u8' })
    const json = serialiserDefinitions(origine)
    const recharge = chargerDefinitions(json)
    assert.equal(hashRegistre(recharge), hashRegistre(origine))
    const bytes = encode(origine, 'normal', { x: 1, y: 2 })
    assert.equal(bytes.length, 3)
  })
})

describe("µ.schema (mjs_schema.ts, client) — même garde côté navigateur", () => {
  it("µ.schema('x', {'__proto__':'u8'}) — construit via Object.create(null), déclaration DIRECTE — est refusé avec une erreur claire", () => {
    const µ = makeµ()
    const champs = Object.create(null)
    champs['__proto__'] = 'u8'
    champs['x'] = 'u8'
    assert.throws(() => µ.schema('evilproto-client', champs), /__proto__|nom de champ invalide/i)
  })

  it('un champ normal côté client continue de fonctionner sans erreur', () => {
    const µ = makeµ()
    const def = µ.schema('normal-client', { x: 'u8', y: 'u8' })
    assert.deepEqual(def.ordre, ['x', 'y'])
  })

  it("un champ '__proto__' reçu par le RÉSEAU (µ:schema, cf. _mjs_mjschemaOnPush) est refusé — jamais installé amputé, le registre local reste celui d'AVANT", () => {
    const µ = makeµ()
    µ.schema('avant', { x: 'u8' })
    const registreAvant = µ._mjs_mjschemaRegistre
    const erreurs: unknown[] = []
    µ.error = (...a: unknown[]) => erreurs.push(a)
    const payload = { hash: 'peu-importe', schemas: [{ nom: 'x', champs: [['a', 'u8'], ['__proto__', 'u8'], ['b', 'u8']] }] }
    µ._mjs_mjschemaOnPush(null, { p: { definitions: payload } })
    assert.ok(erreurs.length > 0, 'une erreur doit être journalisée — jamais un silence')
    assert.equal(µ._mjs_mjschemaRegistre, registreAvant, "le registre local doit rester celui d'AVANT — jamais remplacé par une définition amputée du champ fautif")
  })
})
