// Recherche en direct : un formulaire GET soumis par script à chaque frappe (`requestSubmit()`) envoie chaque
// soumission, la précédente est abandonnée et la dernière réponse gagne. Défaut garanti absent : la garde contre
// l'envoi en double, faite pour les formulaires qui modifient (POST, PUT, PATCH, DELETE), frappait aussi un GET —
// seule la première frappe partait (`?q=a`), la page montrait ses résultats pendant que le champ disait « abc ».
//
// Méthode : happy-dom, vrais µ._mjs_ujsOnSubmit et µ._mjs_navDispatch, vrai `_request` (mjs_ajax.ts) ;
// le fetch simulé relève chaque requête et ne répond jamais.

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
  const win: any = new Window({ url: 'http://localhost/posts' })
  const document: any = win.document
  document.body.innerHTML = corps
  const vus: any[] = []
  const fetchSimule = (u: string, o: any) => new Promise(() => {
    vus.push({ u, method: o.method, signal: o.signal })
  })
  const µ: any = { warn() {}, error() {}, log() {}, realTarget: (e: any) => e.target, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  const code = ['helpers-navigation', '_mjs_navController', '_mjs_abortStaleNav', '_mjs_navDispatch', '_mjs_ujsOnSubmit'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', 'FormData', code)(µ, document, win, win.DOMParser, win.FormData)
  return { µ, vus, form: document.querySelector('form') }
}

function soumission(form: any) {
  return { target: form, submitter: null, defaultPrevented: false, preventDefault(this: any) { this.defaultPrevented = true }, stopImmediatePropagation() {} }
}

describe('mjs_ujs — un formulaire GET envoie chaque soumission, la dernière gagne', function () {
  it('trois frappes pendant la première requête : trois requêtes, les deux premières abandonnées', async function () {
    const { µ, vus, form } = monter('<form action="/recherche" method="get"><input name="q" value="a"><button>Chercher</button></form>')
    const champ = form.querySelector('input')
    const envois: any[] = []
    for (const q of ['a', 'ab', 'abc']) {
      champ.value = q
      const s = soumission(form)
      envois.push(s)
      µ._mjs_ujsOnSubmit(s)
      await attendre(10)
    }
    assert.deepEqual(vus.map(v => v.method + ' ' + v.u.replace('http://localhost', '') + (v.signal && v.signal.aborted ? ' (abandonnée)' : '')), ['GET /recherche?q=a (abandonnée)', 'GET /recherche?q=ab (abandonnée)', 'GET /recherche?q=abc'])
    assert.equal(envois.every(s => s.defaultPrevented), true, 'aucun envoi natif')
  })

  it('un formulaire POST garde sa garde : la seconde soumission pendant la requête ne part pas', async function () {
    const { µ, vus, form } = monter('<form action="/posts" method="post"><input name="titre" value="bonjour"><button>Envoyer</button></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    assert.equal(vus.length, 1)
  })
})
