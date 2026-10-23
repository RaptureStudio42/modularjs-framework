// Envoi abandonné par une navigation plus récente : un formulaire envoyé (boutons `disabled`,
// `aria-busy`) ou un lien @method (`aria-disabled`, garde anti double clic) dont la requête est
// abandonnée par un envoi, un clic ou un Précédent plus récent doit RENDRE sa main — sinon le lien
// avale tous ses clics suivants et les boutons restent grisés jusqu'au rechargement.
//
// Méthode : happy-dom, vrai µ._mjs_navDispatch (avec µ._mjs_navController/µ._mjs_abortStaleNav) et
// vrai `_request` (mjs_ajax.ts) ; le fetch simulé de la 1re requête ne répond jamais et rejette sur
// abandon du signal, comme le vrai fetch.

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

function reponse(status: number, headers: Record<string, string>, body: string) {
  return { status, url: 'http://localhost/fin', ok: status >= 200 && status < 300, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => JSON.parse(body), text: async () => body }
}

function monter(fetchSimule: any) {
  const win: any = new Window({ url: 'http://localhost/page' })
  const document: any = win.document
  document.body.innerHTML = '<p>page</p>'
  const µ: any = { warn() {}, error() {}, log() {}, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/page', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, fetchSimule, document)
  const code = [extractMarked(UJS_SRC, 'helpers-navigation'), extractMarked(UJS_SRC, '_mjs_navController'), extractMarked(UJS_SRC, '_mjs_abortStaleNav'), extractMarked(UJS_SRC, '_mjs_navDispatch')].join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', code)(µ, document, win, win.DOMParser)
  return µ
}

// 1re requête : pendue jusqu'à l'abandon ; les suivantes : réponse « ne bouge pas »
function fetchPenduPuisNone() {
  let n = 0
  return (_u: string, o: any) => {
    n++
    if (n === 1) {
      return new Promise((_r, rej) => o.signal.addEventListener('abort', () => { const e: any = new Error('aborted'); e.name = 'AbortError'; rej(e) }))
    }
    return Promise.resolve(reponse(200, { 'x-mjs-method': 'none', 'content-type': 'text/html' }, ''))
  }
}

function charge(champs: Array<[string, string]>) {
  const fd = new FormData()
  for (const [k, v] of champs) fd.append(k, v)
  return fd
}

describe('mjs_ujs — un envoi abandonné par une navigation plus récente rend sa main', function () {
  const cas: Array<[string, string, Array<[string, string]>]> = [
    ['lien @method="delete"', 'DELETE', [['_method', 'delete']]],
    ['formulaire POST', 'POST', [['titre', 'bonjour']]],
    ['formulaire GET (recherche)', 'GET', [['q', 'chat']]]
  ]
  for (const [nom, verbe, champs] of cas) {
    it(nom + ' abandonné par l\'envoi suivant : restoreBusy rappelé', async function () {
      const µ = monter(fetchPenduPuisNone())
      const rendu = { premier: 0, second: 0 }
      µ._mjs_navDispatch('http://localhost/items/1', verbe, charge(champs), { via: verbe === 'DELETE' ? 'method' : 'form', restoreBusy: () => { rendu.premier++ } })
      µ._mjs_navDispatch('http://localhost/autre', 'POST', charge([['q', 'x']]), { restoreBusy: () => { rendu.second++ } })
      await attendre(30)
      assert.ok(rendu.premier > 0, 'AVANT : la requête abandonnée ne rappelait jamais restoreBusy (lien aria-disabled, boutons grisés à vie)')
      assert.ok(rendu.second > 0, 'la navigation gagnante rend aussi sa main')
    })
  }

  it('l\'abandon ne déclenche ni succès ni échec visible (la page appartient à la navigation gagnante)', async function () {
    const µ = monter(fetchPenduPuisNone())
    const vus: string[] = []
    µ._mjs_fxTell = (_el: any, ok: boolean) => { vus.push(ok ? 'succès' : 'échec') }
    µ._mjs_navDispatch('http://localhost/items/1', 'DELETE', charge([['_method', 'delete']]), { via: 'method', el: {}, restoreBusy() {} })
    µ._mjs_navDispatch('http://localhost/autre', 'POST', charge([['q', 'x']]), { el: {}, restoreBusy() {} })
    await attendre(30)
    assert.deepEqual(vus, ['succès'], 'seule la navigation gagnante annonce son résultat')
  })
})
