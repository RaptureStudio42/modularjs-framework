// Régression — une réponse non-2xx de `_request` (mjs_ajax.ts) arrive toujours dans `error`, avec
// son statut, même sans corps ou avec un corps JSON illisible.
//
// Corps vide : le raccourci « 204 ou Content-Length: 0 → success(null) » passait AVANT le test de
// `response.ok`. Un 401, 403, 422 ou 500 sans corps (ce que rend un `head :forbidden` de Rails)
// appelait donc `success(null)` : côté UJS, un envoi de formulaire refusé jouait les effets
// `on: success`, sans avertissement ni message d'échec.
// JSON illisible : une erreur annoncée `application/json` dont le corps ne se lit pas (page HTML d'un
// proxy, corps vide) partait dans `error` sans `status` ni `body` — l'UJS affichait « statut ? ».

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AJAX_SRC  = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ajax.ts'), 'utf-8')
const UJS_SRC   = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

/** Fausse réponse fetch : statut, Content-Type, corps, Content-Length. */
function reponse(status: number, type: string | null, corps: string, longueur: string | null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: 'https://app.example/posts',
    headers: { get: (n: string) => n === 'content-type' ? type : n === 'content-length' ? longueur : null },
    json: async () => JSON.parse(corps),
    text: async () => corps
  }
}

/** Monte le runtime ajax sur un fetch qui rend `r`, envoie un POST, rend ce qu'ont reçu success et error. */
async function envoyer(r: any) {
  const µ: any = { log() {}, warn() {}, error() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, async () => r, { querySelector: () => null })
  const vu: any = { success: [], error: [] }
  await µ.ajax.post('/posts', { titre: 'x' }, (corps: any) => { vu.success.push(corps) }, (err: any) => { vu.error.push(err) })
  return vu
}

describe('mjs_ajax — une réponse en erreur arrive toujours dans error, avec son statut', function () {
  for (const statut of [401, 403, 422, 500]) {
    it(`${statut} à corps vide (Content-Length: 0) : error avec le statut, jamais success(null)`, async function () {
      const vu = await envoyer(reponse(statut, 'text/html; charset=utf-8', '', '0'))
      assert.deepEqual(vu.success, [], 'success(null) ne doit pas être appelé sur une erreur')
      assert.equal(vu.error.length, 1)
      assert.equal(vu.error[0].status, statut)
      assert.equal(vu.error[0].url, 'https://app.example/posts')
    })
  }

  it('erreur à corps vide sans Content-Type : même chemin, statut gardé', async function () {
    const vu = await envoyer(reponse(403, null, '', '0'))
    assert.deepEqual(vu.success, [])
    assert.equal(vu.error[0].status, 403)
  })

  it('erreur annoncée JSON à corps vide : statut gardé', async function () {
    const vu = await envoyer(reponse(403, 'application/json', '', '0'))
    assert.deepEqual(vu.success, [])
    assert.equal(vu.error.length, 1)
    assert.equal(vu.error[0].status, 403)
  })

  it('204 et 200 à corps vide restent des succès : success(null)', async function () {
    assert.deepEqual((await envoyer(reponse(204, null, '', null))).success, [null])
    assert.deepEqual((await envoyer(reponse(200, 'text/html', '', '0'))).success, [null])
  })

  it('500 annoncé JSON au corps illisible : error avec le statut et le corps reçu', async function () {
    const vu = await envoyer(reponse(500, 'application/json', '<html>proxy en panne</html>', '27'))
    assert.deepEqual(vu.success, [])
    assert.equal(vu.error.length, 1)
    assert.equal(vu.error[0].status, 500, 'le statut doit voyager avec l\'erreur')
    assert.equal(vu.error[0].body, '<html>proxy en panne</html>')
    assert.equal(vu.error[0].url, 'https://app.example/posts')
    assert.match(vu.error[0].message, /500/)
  })

  it('422 JSON lisible : corps décodé et message du serveur, comme avant', async function () {
    const vu = await envoyer(reponse(422, 'application/json', '{"error":"titre vide"}', null))
    assert.equal(vu.error[0].status, 422)
    assert.deepEqual(vu.error[0].body, { error: 'titre vide' })
    assert.equal(vu.error[0].message, 'titre vide')
  })

  it('envoi de formulaire UJS refusé par un 500 à corps vide : effet d\'échec, avertissement et message', async function () {
    const win: any = new Window({ url: 'http://localhost/page' })
    const document: any = win.document
    document.body.innerHTML = '<p>page</p>'
    const dits: boolean[] = [], avertissements: string[] = [], messages: string[] = []
    const µ: any = {
      warn(m: string) { avertissements.push(m) }, error() {}, log() {},
      pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(),
      _mjs_lastUjsPath: '/page', _mjs_navSeq: 0, _mjs_saveScroll() {},
      _mjs_fxTell: (_el: any, ok: boolean) => dits.push(ok),
      config: { flash: (type: string, texte: string) => messages.push(type + ' : ' + texte) }
    }
    poserMessages(µ)
    const fetch500 = async () => reponse(500, 'text/html', '', '0')
    new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetch500, document)
    const blocs = ['helpers-navigation', '_mjs_navController', '_mjs_abortStaleNav', '_mjs_navDispatch'].map(n => extractMarked(UJS_SRC, n))
    new Function('µ', 'document', 'window', 'DOMParser', blocs.join('\n'))(µ, document, win, win.DOMParser)
    const fd = new FormData()
    fd.append('titre', 'x')
    µ._mjs_navDispatch('/posts', 'POST', fd, { form: {} })
    await tick(20)
    assert.deepEqual(dits, [false], 'les effets `on: error` doivent jouer, jamais `on: success`')
    assert.equal(avertissements.length, 1)
    assert.match(avertissements[0], /500/)
    assert.equal(messages.length, 1)
    assert.match(messages[0], /^error : .*\(500\)/)
    await win.happyDOM.close()
  })
})
