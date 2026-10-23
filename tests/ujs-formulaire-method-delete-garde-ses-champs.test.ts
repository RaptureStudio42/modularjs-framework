// Formulaire dont le verbe vient d'un champ caché `_method=delete` (le `button_to … method: :delete,
// params: {…}` de Rails) : le formulaire natif envoie TOUS ses champs (paramètres, jeton
// `authenticity_token` du formulaire, motif saisi) ; la navigation doit les garder dans le corps
// de sa requête DELETE au lieu de partir à vide. Un lien @method="delete", lui, n'a que `_method` :
// il part toujours sans corps (l'identifiant voyage dans l'adresse).
//
// Méthode : happy-dom, vrai µ._mjs_navDispatch et vrai `_request` (mjs_ajax.ts), fetch simulé qui
// relève verbe et corps.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const AJAX_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ajax.ts'), 'utf-8')
const attendre = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function monter() {
  const win: any = new Window({ url: 'http://localhost/posts/1' })
  const document: any = win.document
  document.body.innerHTML = '<p>page</p>'
  const vus: any[] = []
  const fetchSimule = (u: string, o: any) => {
    vus.push({ u, method: o.method, body: o.body == null ? null : o.body })
    return Promise.resolve({ status: 204, url: 'http://localhost/posts', ok: true, headers: { get: () => null } })
  }
  const µ: any = { warn() {}, error() {}, log() {}, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts/1', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  const code = [extractMarked(UJS_SRC, 'helpers-navigation'), extractMarked(UJS_SRC, '_mjs_navController'), extractMarked(UJS_SRC, '_mjs_abortStaleNav'), extractMarked(UJS_SRC, '_mjs_navDispatch')].join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', code)(µ, document, win, win.DOMParser)
  return { µ, vus }
}

describe('mjs_ujs — un formulaire _method=delete garde ses champs', function () {
  it('champs du formulaire (paramètre, motif, jeton du formulaire) : envoyés dans le corps du DELETE', async function () {
    const { µ, vus } = monter()
    const fd = new FormData()
    fd.append('_method', 'delete')
    fd.append('raison', 'spam')
    fd.append('authenticity_token', 'jeton-du-formulaire')
    µ._mjs_navDispatch('/posts/1', 'DELETE', fd, {})
    await attendre(20)
    assert.equal(vus.length, 1)
    assert.equal(vus[0].method, 'DELETE', 'le verbe reste DELETE')
    assert.ok(vus[0].body, 'AVANT : la requête partait sans corps, tous les champs perdus')
    const corps = new URLSearchParams(String(vus[0].body))
    assert.equal(corps.get('raison'), 'spam')
    assert.equal(corps.get('authenticity_token'), 'jeton-du-formulaire')
    assert.ok(vus[0].body instanceof URLSearchParams, 'sans fichier joint : corps urlencoded, comme POST/PUT/PATCH')
  })

  it('lien @method="delete" (seulement `_method`) : DELETE toujours sans corps', async function () {
    const { µ, vus } = monter()
    const fd = new FormData()
    fd.append('_method', 'delete')
    µ._mjs_navDispatch('http://localhost/posts/1', 'DELETE', fd, { via: 'method' })
    await attendre(20)
    assert.equal(vus.length, 1)
    assert.equal(vus[0].method, 'DELETE')
    assert.equal(vus[0].body, null)
  })
})
