// Formulaire dont le verbe vient de son attribut `method="delete"` (sans champ caché `_method`) : comme
// pour le champ `_method`, ses autres champs (motif saisi, jeton `authenticity_token` du formulaire)
// partent dans le corps de la requête DELETE au lieu d'être perdus. Sans aucun champ, le DELETE part
// toujours sans corps.
//
// Méthode : happy-dom, vrais µ._mjs_ujsOnSubmit et µ._mjs_navDispatch, vrai `_request` (mjs_ajax.ts),
// fetch simulé qui relève verbe et corps.

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

function monter(corps: string) {
  const win: any = new Window({ url: 'http://localhost/posts/1' })
  const document: any = win.document
  document.body.innerHTML = corps
  const vus: any[] = []
  const fetchSimule = (u: string, o: any) => {
    vus.push({ u, method: o.method, body: o.body == null ? null : o.body })
    return Promise.resolve({ status: 204, url: 'http://localhost/posts', ok: true, headers: { get: () => null } })
  }
  const µ: any = { warn() {}, error() {}, log() {}, realTarget: (e: any) => e.target, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts/1', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  const code = ['helpers-navigation', '_mjs_navController', '_mjs_abortStaleNav', '_mjs_navDispatch', '_mjs_ujsOnSubmit'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', 'FormData', code)(µ, document, win, win.DOMParser, win.FormData)
  return { µ, vus, form: document.querySelector('form') }
}

function soumission(form: any) {
  return { target: form, submitter: null, defaultPrevented: false, preventDefault(this: any) { this.defaultPrevented = true }, stopImmediatePropagation() {} }
}

describe('mjs_ujs — un formulaire method="delete" garde ses champs', function () {
  it('motif et jeton du formulaire : envoyés dans le corps du DELETE', async function () {
    const { µ, vus, form } = monter('<form action="/posts/1" method="delete"><input name="raison" value="spam"><input type="hidden" name="authenticity_token" value="jeton-du-formulaire"></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(20)
    assert.equal(vus.length, 1)
    assert.equal(vus[0].method, 'DELETE', 'le verbe reste DELETE')
    assert.ok(vus[0].body, 'AVANT : la requête partait sans corps, les champs perdus')
    const corps = new URLSearchParams(String(vus[0].body))
    assert.equal(corps.get('raison'), 'spam')
    assert.equal(corps.get('authenticity_token'), 'jeton-du-formulaire')
  })

  it('formulaire method="delete" sans aucun champ : DELETE sans corps', async function () {
    const { µ, vus, form } = monter('<form action="/posts/1" method="delete"><button>Supprimer</button></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(20)
    assert.equal(vus.length, 1)
    assert.equal(vus[0].method, 'DELETE')
    assert.equal(vus[0].body, null)
  })
})
