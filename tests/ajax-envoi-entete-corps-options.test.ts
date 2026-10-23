// Régression — ce que `_request` (mjs_ajax.ts) envoie : en-têtes, corps, options de µ.ajax.binary.
//
// X-Requested-With : posé sur toute requête, même vers une autre origine. Cet en-tête non standard y
// force une requête préalable OPTIONS : une API publique qui autorise les GET simples (CORS `*`) sans
// l'approuver faisait échouer `µ.ajax.get` (« Failed to fetch ») là où un fetch nu passait. Il ne part
// plus que vers l'origine de la page, comme le fait jQuery.
// Corps binaire : seuls FormData et URLSearchParams partaient tels quels ; un Blob, un File, un
// ArrayBuffer ou un Uint8Array partaient en `{}` ou `{"0":7,"1":8,"2":9}` sous un Content-Type JSON.
// µ.ajax.binary : écrivait dans l'objet d'options reçu (url, méthode devinée, rappels par défaut) ;
// réutilisé, il gardait la méthode GET du premier appel et partait en GET avec un corps.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AJAX_SRC  = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ajax.ts'), 'utf-8')

const fakeLocation = { origin: 'https://app.example', href: 'https://app.example/panier' }
const fakeDocument = { querySelector: () => null }

/** Monte le runtime ajax sur un faux fetch qui note chaque envoi ; `extra` = fonctions du module schema. */
function monter(extra: Record<string, any> = {}) {
  const envois: any[] = []
  const µ: any = { log() {}, warn() {}, error() {} }
  poserMessages(µ)
  const fakeFetch = async (url: string, opts: any) => {
    envois.push({ url, method: opts.method, headers: opts.headers, body: opts.body })
    return { status: 204, ok: true, url, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
  }
  const noms = ['µ', 'fetch', 'document', 'location', ...Object.keys(extra)]
  new Function(...noms, AJAX_SRC)(µ, fakeFetch, fakeDocument, fakeLocation, ...Object.values(extra))
  return { µ, envois }
}

describe('mjs_ajax — X-Requested-With ne part que vers l\'origine de la page', function () {
  it('GET vers une autre origine : pas de X-Requested-With (aucune requête préalable forcée)', async function () {
    const { µ, envois } = monter()
    await µ.ajax.get('https://api.tierce.example/data', () => {}, () => {})
    assert.equal(envois[0].headers['X-Requested-With'], undefined)
    assert.match(envois[0].headers['Accept'], /application\/json/, 'Accept reste posé : en-tête simple')
  })

  it('POST vers une autre origine : pas de X-Requested-With non plus', async function () {
    const { µ, envois } = monter()
    await µ.ajax.post('https://api.tierce.example/collecte', { a: 1 }, () => {}, () => {})
    assert.equal(envois[0].headers['X-Requested-With'], undefined)
  })

  it('même origine (adresse relative ou absolue) : X-Requested-With posé, comme avant', async function () {
    const { µ, envois } = monter()
    await µ.ajax.get('/api/produits', () => {}, () => {})
    await µ.ajax.post('https://app.example/api/produits', { a: 1 }, () => {}, () => {})
    assert.equal(envois[0].headers['X-Requested-With'], 'XMLHttpRequest')
    assert.equal(envois[1].headers['X-Requested-With'], 'XMLHttpRequest')
  })
})

describe('mjs_ajax — un fichier ou des octets partent tels quels', function () {
  const octets = new Uint8Array([7, 8, 9])
  const cas: Array<[string, any]> = [
    ['Blob', new Blob(['contenu du fichier'], { type: 'text/plain' })],
    ['File', new File(['image'], 'photo.png', { type: 'image/png' })],
    ['Uint8Array', octets],
    ['ArrayBuffer', octets.buffer],
    ['DataView', new DataView(octets.buffer)]
  ]
  for (const [nom, corps] of cas) {
    it(`${nom} : le corps envoyé est l'objet d'origine, sans Content-Type JSON`, async function () {
      const { µ, envois } = monter()
      await µ.ajax.post('/televerser', corps, () => {}, () => {})
      assert.equal(envois[0].body, corps, 'JSON.stringify ne doit pas toucher un corps binaire')
      assert.equal(envois[0].headers['Content-Type'], undefined, 'fetch pose seul le type d\'un Blob')
    })
  }

  it('FormData et URLSearchParams restent passés tels quels', async function () {
    const { µ, envois } = monter()
    const fd = new FormData()
    const qs = new URLSearchParams('a=1')
    await µ.ajax.post('/f', fd, () => {}, () => {})
    await µ.ajax.put('/f', qs, () => {}, () => {})
    assert.equal(envois[0].body, fd)
    assert.equal(envois[1].body, qs)
    assert.equal(envois[0].headers['Content-Type'], undefined)
  })

  it('un objet ordinaire part toujours en JSON', async function () {
    const { µ, envois } = monter()
    await µ.ajax.patch('/f', { nom: 'Stylo' }, () => {}, () => {})
    assert.equal(envois[0].body, '{"nom":"Stylo"}')
    assert.equal(envois[0].headers['Content-Type'], 'application/json')
  })
})

describe('µ.ajax.binary — l\'objet d\'options de l\'appelant reste intact', function () {
  it('options réutilisées : le 2e appel avec data part en POST, et l\'objet n\'a pas bougé', async function () {
    const registre = { parNom: new Map([['profil', {}]]) }
    const { µ, envois } = monter({
      mjschemaEncode: () => new Uint8Array([1]),
      mjschemaDecode: () => ({ nom: 'profil', objet: {} }),
      mjschemaHashRegistre: () => 'abcdefgh',
      mjschemaChargerDefinitions: () => registre
    })
    const opts: any = { schema: 'profil', codec: registre }
    await µ.ajax.binary('/api/profil', opts)
    assert.deepEqual(Object.keys(opts).sort(), ['codec', 'schema'], 'ni url, ni méthode, ni rappels écrits chez l\'appelant')
    opts.data = { nom: 'Ada' }
    await µ.ajax.binary('/api/profil', opts)
    assert.equal(envois[0].method, 'GET')
    assert.equal(envois[1].method, 'POST', 'la méthode se devine à chaque appel')
    assert.ok(envois[1].body instanceof Uint8Array)
    assert.deepEqual(Object.keys(opts).sort(), ['codec', 'data', 'schema'])
  })
})
