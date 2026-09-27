// Régression — src/schema/core.ts ET src/runtime/mjs_schema.ts : la définition d'un schéma
// (`champs`) était gardée PAR RÉFÉRENCE par defSchema/µ.schema — muter l'objet littéral APRÈS coup
// (réutilisé ailleurs par erreur, objet partagé) changeait le format encodé/le hash EN SILENCE, sans
// jamais repasser par la garde ajout-seul. La définition retenue doit désormais être une copie
// PROFONDE et GELÉE, prise au moment de la déclaration — une mutation externe ultérieure, ou une
// tentative de mutation DIRECTE de la définition stockée, ne doit plus jamais rien changer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerRegistre, defSchema, encode, bits } from '../src/schema/core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaSrc = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

function makeµ(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', schemaSrc)(µ)
  return µ
}

describe('schema/core — defSchema : la définition est copiée profondément et gelée', () => {
  it("muter l'objet littéral APRÈS defSchema(...) ne change plus le format encodé", () => {
    const r = creerRegistre()
    const champs: any = { x: 'u8' }
    const def = defSchema(r, 'evol', champs)
    const avant = encode(r, 'evol', { x: 5 })
    assert.equal(avant.length, 2, '1 octet id + 1 octet u8')

    champs.x = 'u16'   // mutation DIRECTE de l'objet appelant, APRÈS coup
    const apres = encode(r, 'evol', { x: 5 })
    assert.equal(apres.length, 2, "le format encodé ne doit PAS changer — def.champs est une copie, indépendante de l'objet appelant")
    assert.equal(def.champs.x, 'u8', 'la définition stockée doit rester u8')
  })

  it('une tentative de mutation DIRECTE de def.champs (gelé) reste sans effet', () => {
    const r = creerRegistre()
    const def = defSchema(r, 'gele', { x: 'i16', y: 'i16' })
    assert.ok(Object.isFrozen(def.champs), 'def.champs doit être gelé')
    try { (def.champs as any).x = 'u32' } catch { /* mode strict : throw attendu, ignoré ici */ }
    assert.equal(def.champs.x, 'i16', 'la tentative de mutation directe ne doit rien changer')
  })

  it("muter un objet list()/bits() interne APRÈS coup ne change pas non plus la définition stockée", () => {
    const r = creerRegistre()
    const drapeaux: any = bits(['vivant', 'vip'])
    const def = defSchema(r, 'flags', { f: drapeaux })
    drapeaux.noms.push('furtif')   // mutation DIRECTE du tableau interne de l'objet bits() original
    assert.deepEqual((def.champs.f as any).noms, ['vivant', 'vip'], "la liste de noms stockée ne doit pas suivre la mutation externe")
  })
})

describe('µ.schema (mjs_schema.ts, client) — même garde : définition copiée profondément et gelée', () => {
  it("muter l'objet littéral APRÈS µ.schema(...) ne change plus le registre interne", () => {
    const µ = makeµ()
    const champs: any = { x: 'i16', y: 'i16' }
    const def = µ.schema('pos', champs)
    const before = JSON.stringify(def.champs)
    champs.x = 'i32'   // mutation APRÈS coup du même objet littéral
    const after = JSON.stringify(def.champs)
    assert.equal(before, after, 'def.champs ne doit plus suivre la mutation externe (clone pris à la déclaration)')
  })

  it('une tentative de mutation DIRECTE de def.champs (gelé) côté client reste sans effet', () => {
    const µ = makeµ()
    const def = µ.schema('gele-client', { x: 'i16' })
    assert.ok(Object.isFrozen(def.champs), 'def.champs doit être gelé côté client aussi')
    // ce fichier de test EST un module ES (mode strict) : l'affectation ci-dessous lève une
    // TypeError sur un objet gelé (le mode dépend du code qui AFFECTE, pas de celui qui a CRÉÉ
    // l'objet, ici du JS non strict chargé via new Function) — capturée, seule la valeur compte.
    try { def.champs.x = 'u32' } catch { /* mode strict : throw attendu, ignoré ici */ }
    assert.equal(def.champs.x, 'i16', 'la tentative de mutation directe ne doit rien changer')
  })
})
