// Les requêtes que le cœur envoie de lui-même (le journal d'erreurs vers `/__mjs/errors`, le rafraîchissement du
// schéma de `µ.ajax.binary`) passent à `fetch(url, réglages)` un objet que le navigateur lit membre par membre, membres
// hérités compris (`credentials`, `mode`, `method`, `referrerPolicy`…) : avec un prototype pollué, la requête partait
// avec les cookies vers une autre origine, ou changeait de méthode. Les réglages de ces requêtes n'ont pas de
// prototype. Le code tourne dans la fenêtre happy-dom (son propre `Object.prototype`) ; le faux `fetch` lit les
// réglages comme le navigateur, propriété par propriété
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { creerRegistre, defSchema, encode as coreEncode, hashRegistre, serialiserDefinitions } from '../src/schema/core.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const POLLUTION: Record<string, string> = { credentials: 'include', mode: 'no-cors', method: 'PUT', referrerPolicy: 'unsafe-url' }
const MEMBRES = ['credentials', 'mode', 'method', 'referrerPolicy']

// ce que le navigateur lirait des réglages : chaque membre, hérité compris
const lu = (o: any) => Object.fromEntries(MEMBRES.map((k) => [k, o ? o[k] : undefined]))

describe('prototype pollué : les requêtes internes du cœur n\'héritent d\'aucun réglage', function () {
  let window: any
  beforeEach(() => { window = new Window({ url: 'http://localhost/' }) })
  afterEach(async () => {
    window.eval(MEMBRES.map((k) => `delete Object.prototype[${JSON.stringify(k)}];`).join('\n'))
    await window.happyDOM.close()
  })
  const polluer = () => window.eval(Object.keys(POLLUTION).map((k) => `Object.prototype[${JSON.stringify(k)}] = ${JSON.stringify(POLLUTION[k])};`).join('\n'))

  it('journal d\'erreurs : POST vers /__mjs/errors avec ses seuls réglages', () => {
    const envois: any[] = []
    const µ: any = { config: { journal: true }, error() {}, version: 'v1' }
    const fauxFetch = (url: string, o: any) => { envois.push({ url, ...lu(o) }); return Promise.resolve({ ok: true }) }
    window.eval(`(function(µ, navigator, fetch) {\n${lire('mjs_journal.ts')}\n})`)(µ, {}, fauxFetch)
    polluer()
    µ._mjs_journalSend({ message: 'panne', pile: 'pile', url: '/' })
    assert.equal(envois.length, 1, 'le journal est parti par fetch')
    assert.deepEqual(envois[0], { url: '/__mjs/errors', credentials: undefined, mode: undefined, method: 'POST', referrerPolicy: undefined })
  })

  it('µ.ajax.binary : le rafraîchissement du schéma part en GET, sans réglage hérité', async () => {
    const registreV2 = creerRegistre()
    defSchema(registreV2, 'pos', { x: 'i16', y: 'i16' })
    defSchema(registreV2, 'etat', { hp: 'u8' })
    const hashV2 = hashRegistre(registreV2)
    const charge = coreEncode(registreV2, 'pos', { x: 3, y: 9 })
    const trame = new Uint8Array(8 + charge.byteLength)
    for (let i = 0; i < 8; i++) trame[i] = hashV2.charCodeAt(i)
    trame.set(charge, 8)
    const envois: any[] = []
    const fauxFetch = (url: string, o: any) => {
      envois.push({ url, ...lu(o) })
      if (url.indexOf('schema=1') !== -1) return Promise.resolve({ status: 200, ok: true, url, headers: { get: () => 'application/json' }, json: async () => serialiserDefinitions(registreV2) })
      return Promise.resolve({ status: 200, ok: true, url, headers: { get: () => null }, arrayBuffer: async () => trame.slice().buffer })
    }
    const µ: any = { log() {}, warn() {}, error() {} }
    poserMessages(µ)
    window.eval(`(function(µ, fetch, document) {\n${lire('mjs_ajax.ts')}\n${lire('mjs_schema.ts')}\n})`)(µ, fauxFetch, { querySelector: () => null })
    µ.schema('pos', { x: 'i16', y: 'i16' })
    polluer()
    const resultat: any = await new Promise((resolve, reject) => {
      µ.ajax.binary('https://x/pos', { schema: 'pos', success: (body: any) => resolve(body), error: (e: any) => reject(e) })
    })
    assert.deepEqual({ x: resultat.x, y: resultat.y }, { x: 3, y: 9 })
    const rafraichi = envois.find((e) => e.url.indexOf('schema=1') !== -1)
    assert.ok(rafraichi, 'le schéma a été redemandé')
    assert.deepEqual(rafraichi, { url: rafraichi.url, credentials: undefined, mode: undefined, method: undefined, referrerPolicy: undefined })
  })
})
