// Anti double envoi d'un formulaire : tant que sa requête est en vol, une nouvelle soumission du même
// formulaire est ignorée. Désactiver les boutons ne suffit pas : un formulaire sans bouton (touche
// Entrée dans son unique champ) ou un `requestSubmit()` lancé par un script le soumettent quand même,
// et la requête partait deux fois au serveur (la première n'était abandonnée que dans le navigateur).
// L'opt-out `mjs-no-disable` lève aussi cette garde.
//
// Méthode : happy-dom, vrais µ._mjs_ujsOnSubmit et µ._mjs_navDispatch, vrai `_request` (mjs_ajax.ts) ;
// le fetch simulé relève chaque requête et ne répond qu'à la demande du test.

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
  const win: any = new Window({ url: 'http://localhost/posts/new' })
  const document: any = win.document
  document.body.innerHTML = corps
  const vus: any[] = []
  const fetchSimule = (u: string, o: any) => new Promise((ok) => {
    vus.push({ u, method: o.method, repondre: () => ok({ status: 204, url: 'http://localhost/posts', ok: true, headers: { get: () => null } }) })
  })
  const µ: any = { warn() {}, error() {}, log() {}, realTarget: (e: any) => e.target, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/posts/new', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  const code = ['helpers-navigation', '_mjs_navController', '_mjs_abortStaleNav', '_mjs_navDispatch', '_mjs_ujsOnSubmit'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', 'FormData', code)(µ, document, win, win.DOMParser, win.FormData)
  return { µ, vus, form: document.querySelector('form') }
}

function soumission(form: any) {
  return { target: form, submitter: null, defaultPrevented: false, preventDefault(this: any) { this.defaultPrevented = true }, stopImmediatePropagation() {} }
}

describe('mjs_ujs — un formulaire en cours d\'envoi ne repart pas', function () {
  it('formulaire sans bouton soumis deux fois (Entrée) pendant sa requête : une seule requête', async function () {
    const { µ, vus, form } = monter('<form action="/posts" method="post"><input name="titre" value="bonjour"></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    const seconde = soumission(form)
    µ._mjs_ujsOnSubmit(seconde)
    await attendre(10)
    assert.equal(vus.length, 1, 'AVANT : la seconde soumission partait aussi au serveur')
    assert.equal(seconde.defaultPrevented, true, 'la seconde soumission ne part pas non plus en envoi natif')
  })

  it('requestSubmit() sur un formulaire à bouton : idem ; la réponse reçue, le formulaire repart', async function () {
    const { µ, vus, form } = monter('<form action="/posts" method="post"><input name="titre" value="bonjour"><button>Envoyer</button></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    assert.equal(vus.length, 1, 'AVANT : 2 requêtes')
    vus[0].repondre()
    await attendre(20)
    assert.equal(form.querySelector('button').disabled, false, 'bouton rendu')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    assert.equal(vus.length, 2, 'la garde tombe avec la fin de la requête')
  })

  it('opt-out mjs-no-disable : chaque soumission part, comme avant', async function () {
    const { µ, vus, form } = monter('<form action="/posts" method="post" mjs-no-disable><input name="titre" value="bonjour"></form>')
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    µ._mjs_ujsOnSubmit(soumission(form))
    await attendre(10)
    assert.equal(vus.length, 2)
  })
})
