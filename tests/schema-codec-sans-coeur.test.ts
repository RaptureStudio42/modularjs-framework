// Le codec µschema du navigateur (src/runtime/mjs_schema.ts) s'évalue SEUL, sans le cœur : une application le charge ainsi pour
// éprouver son fil binaire dans un test Node (`new Function('µ', source)(µ)`, sans navigateur). Ses messages venaient de la table des
// messages du cœur (µ._mjs_txt, mjs_init.ts) : sans elle, la moindre erreur du codec levait « µ._mjs_txt is not a function » à la
// place de la sienne, et un échec d'encodage ou de décodage, qui devait seulement s'écrire, cassait l'envoi ou la réception.
// Ce que le test garde : sans la table, les erreurs du codec gardent leur texte français et leurs variables ; sans journal (`µ.error`,
// `µ.warn`), elles s'écrivent dans la console ; avec le cœur, rien ne change (la table du cœur reste celle qui parle).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE    = readFileSync(join(__dirname, '../src/runtime/mjs_schema.ts'), 'utf8')

// le codec chargé seul, sur l'objet `µ` donné ; ses fonctions internes d'encodage et de décodage en plus
function charger(µ: any): any {
  return new Function('µ', SOURCE + '\nreturn { encoder: mjschemaEncode, decoder: mjschemaDecode };')(µ)
}

// la console d'erreur et d'avertissement, relevée le temps de `f`
function relever(f: () => void): string[][] {
  const vu: string[][] = []
  const err  = console.error
  const warn = console.warn
  console.error = (...a: any[]) => { vu.push(['error', ...a.map(String)]) }
  console.warn  = (...a: any[]) => { vu.push(['warn', ...a.map(String)]) }
  try { f() }
  finally {
    console.error = err
    console.warn  = warn
  }
  return vu
}

describe('µschema — le codec du navigateur chargé sans le cœur', () => {
  it('sans table des messages : un type inconnu lève SA propre erreur, en français, avec ses variables', () => {
    const µ: any = { error: () => {}, warn: () => {} }
    charger(µ)
    assert.throws(() => µ.schema('pos', { x: 'zz' }), (e: any) => /schéma 'pos', champ 'x' : type inconnu 'zz'/.test(e.message) && !/_mjs_txt/.test(e.message))
  })

  it('sans table des messages : encodage puis décodage d\'une trame, comme avec le cœur', () => {
    const µ: any = { error: () => {}, warn: () => {} }
    const interne = charger(µ)
    µ.schema('pos', { x: 'i16', y: 'i16', nom: 'str8' })
    const octets = interne.encoder(µ._mjs_mjschemaRegistre, 'pos', { x: -3, y: 7, nom: 'é' })
    assert.deepEqual(interne.decoder(µ._mjs_mjschemaRegistre, octets).objet, { x: -3, y: 7, nom: 'é' })
  })

  it('sans table des messages : une valeur hors plage à l\'envoi s\'écrit dans le journal, l\'envoi repasse en JSON', () => {
    const erreurs: any[][] = []
    const µ: any = { error: (...a: any[]) => erreurs.push(a), warn: () => {} }
    charger(µ)
    µ.schema('pos', { x: 'u8' })
    assert.equal(µ._mjs_mjschemaEncode({ opts: {} }, { t: 'pos', p: { x: 300 } }), null, 'envoi en JSON')
    assert.equal(erreurs.length, 1)
    assert.equal(erreurs[0][0], '[µ.schema] encodage en échec, envoi en JSON')
    assert.match(String(erreurs[0][1]?.message), /schéma 'pos', champ 'x' : 300 est hors de la plage de u8 \(0 à 255\)/)
  })

  it('sans table des messages : une trame tronquée à la réception s\'écrit dans le journal, sans lever', () => {
    const erreurs: any[][] = []
    const µ: any = { error: (...a: any[]) => erreurs.push(a), warn: () => {} }
    charger(µ)
    µ.schema('pos', { x: 'i16', y: 'i16' })
    let recu: any = null
    µ._mjs_mjschemaOnBinary({ _mjs_dispatch: (t: string, m: any) => { recu = [t, m] } }, new Uint8Array([0, 1]))
    assert.equal(recu, null, 'trame jetée')
    assert.equal(erreurs.length, 1)
    assert.equal(erreurs[0][0], '[µ.schema] décodage en échec (trame corrompue ?)')
    assert.match(String(erreurs[0][1]?.message), /decode\(\) : lecture hors de la trame \(offset 1, 2 octets, trame de 2\)/)
  })

  it('sans journal ni table (`µ` vide) : les erreurs et avertissements du codec s\'écrivent dans la console', () => {
    const µ: any = {}
    charger(µ)
    µ.schema('pos', { x: 'u8' })
    const vu = relever(() => {
      µ._mjs_mjschemaEncode({ opts: {} }, { t: 'pos', p: { x: -1 } })
      µ._mjs_mjschemaOnBinary({ _mjs_dispatch: () => {} }, new Uint8Array([9]))
    })
    assert.deepEqual(vu.map((l) => l.slice(0, 2)), [['error', '[µ.schema] encodage en échec, envoi en JSON'], ['warn', '[µ.schema] id de schéma inconnu (9) reçu — registre local désynchronisé (en attente d\'un µ:schema ?)']])
  })

  it('avec le cœur : la table des messages du cœur reste celle qui parle', () => {
    const µ: any = { error: () => {}, warn: () => {} }
    poserMessages(µ)
    const txt = µ._mjs_txt
    charger(µ)
    assert.equal(µ._mjs_txt, txt, 'le codec ne remplace pas le texte du cœur')
    assert.throws(() => µ.schema('pos', { x: 'zz' }), /type inconnu 'zz'/)
  })
})
