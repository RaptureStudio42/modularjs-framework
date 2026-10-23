// Formulaire GET (recherche, filtre) dont la requête échoue — panne réseau, erreur 500 sans page HTML, refus 422
// en JSON : la page affichée ne change pas, donc l'adresse poussée au geste (`?q=…`) revient sur elle, et la page
// photographiée pour le cache au départ ne reste pas marquée hibernée (nœuds affichés exemptés de destruction,
// entrée de cache qui pointe des nœuds vivants) — même traitement qu'une réponse « ne bouge pas » ou 204.
//
// Méthode : happy-dom, vrai µ._mjs_navDispatch et vrai `_request` (mjs_ajax.ts), fetch simulé.

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
  return { status, url: 'http://localhost/page', ok: status >= 200 && status < 300, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => JSON.parse(body), text: async () => body }
}

function monter(leFetch: () => Promise<any>) {
  const win: any = new Window({ url: 'http://localhost/page' })
  const document: any = win.document
  document.body.innerHTML = '<p>page</p>'
  const µ: any = { warn() {}, error() {}, log() {}, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/page', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, leFetch, document)
  const code = [extractMarked(UJS_SRC, 'helpers-navigation'), extractMarked(UJS_SRC, '_mjs_navController'), extractMarked(UJS_SRC, '_mjs_abortStaleNav'), extractMarked(UJS_SRC, '_mjs_navDispatch')].join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', code)(µ, document, win, win.DOMParser)
  return { µ, win, document }
}

const CAS: Array<[string, () => Promise<any>]> = [
  ['panne réseau', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['erreur 500 sans page HTML', () => Promise.resolve(reponse(500, { 'content-type': 'text/plain' }, 'boom'))],
  ['refus 422 en JSON', () => Promise.resolve(reponse(422, { 'content-type': 'application/json' }, JSON.stringify({ props: { errors: { q: ['trop court'] } } })))],
]

describe('mjs_ujs — formulaire GET dont la requête échoue', function () {
  for (const [nom, leFetch] of CAS) {
    it(`${nom} : adresse rendue, aucun nœud affiché laissé marqué hiberné, aucune entrée de cache sur la page affichée`, async function () {
      const { µ, win, document } = monter(leFetch)
      const fd = new FormData()
      fd.append('q', 'chat')
      µ._mjs_navDispatch('/page', 'GET', fd, {})
      await attendre(30)
      const p = document.body.firstChild
      assert.equal(document.body.textContent, 'page', 'la page affichée n’a pas changé')
      assert.equal(win.location.pathname + win.location.search, '/page', 'AVANT : l’adresse restait sur /page?q=chat, page inchangée')
      assert.equal(p._mjs_page_cached, false, 'AVANT : le nœud affiché restait marqué hiberné')
      assert.equal(µ._mjs_navHibernated, null)
      assert.equal(µ.pageCache.has('/page'), false, 'AVANT : l’entrée de cache pointait les nœuds encore affichés')
    })
  }
})
