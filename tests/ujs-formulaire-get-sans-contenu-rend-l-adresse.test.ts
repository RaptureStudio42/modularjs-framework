// Formulaire GET (recherche, filtre) dont la réponse n'installe rien — « ne bouge pas »
// (`X-MJS-Method: none`) ou rien à afficher (204) : la page affichée ne change pas, donc l'adresse
// poussée au geste (`?q=…`) doit revenir sur elle, et la page photographiée pour le cache au départ
// ne doit pas rester marquée hibernée (nœuds affichés exemptés de destruction, entrée de cache qui
// pointe des nœuds vivants) — même traitement que le clic sur un lien.
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

function monter(adresse: string, rep: any) {
  const win: any = new Window({ url: adresse })
  const document: any = win.document
  document.body.innerHTML = '<p>page</p>'
  const µ: any = { warn() {}, error() {}, log() {}, pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_lastUjsPath: '/page', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  poserMessages(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, () => Promise.resolve(rep), document)
  const code = [extractMarked(UJS_SRC, 'helpers-navigation'), extractMarked(UJS_SRC, '_mjs_navController'), extractMarked(UJS_SRC, '_mjs_abortStaleNav'), extractMarked(UJS_SRC, '_mjs_navDispatch')].join('\n')
  new Function('µ', 'document', 'window', 'DOMParser', code)(µ, document, win, win.DOMParser)
  return { µ, win, document }
}

function recherche(µ: any) {
  const fd = new FormData()
  fd.append('q', 'chat')
  µ._mjs_navDispatch('/page', 'GET', fd, {})
}

describe('mjs_ujs — formulaire GET dont la réponse n\'installe rien', function () {
  it('réponse X-MJS-Method: none : l\'adresse revient sur la page affichée', async function () {
    const { µ, win } = monter('http://localhost/page', reponse(200, { 'x-mjs-method': 'none', 'content-type': 'text/html' }, ''))
    recherche(µ)
    await attendre(20)
    assert.equal(win.location.pathname + win.location.search, '/page', 'AVANT : l\'adresse restait sur /page?q=chat, page inchangée')
    assert.equal(µ._mjs_navHibernated, null)
  })

  it('réponse 204 : adresse rendue, aucun nœud affiché laissé marqué hiberné, aucune entrée de cache sur la page affichée', async function () {
    const { µ, win, document } = monter('http://localhost/page', reponse(204, {}, ''))
    recherche(µ)
    await attendre(20)
    const p = document.body.firstChild
    assert.equal(win.location.pathname + win.location.search, '/page')
    assert.equal(p._mjs_page_cached, false, 'AVANT : le nœud affiché restait marqué hiberné')
    assert.equal(µ._mjs_navHibernated, null)
    assert.equal(µ.pageCache.has('/page'), false, 'AVANT : l\'entrée de cache pointait les nœuds encore affichés')
  })

  it('page à route hash (`/page#/liste`) : l\'adresse rendue garde son fragment', async function () {
    const { µ, win } = monter('http://localhost/page#/liste', reponse(204, {}, ''))
    recherche(µ)
    await attendre(20)
    assert.equal(win.location.pathname + win.location.search + win.location.hash, '/page#/liste')
  })

  it('témoin : une réponse HTML installée garde l\'adresse de la recherche', async function () {
    const { µ, win, document } = monter('http://localhost/page', reponse(200, { 'content-type': 'text/html' }, '<html><head><title>R</title></head><body><p>résultats</p></body></html>'))
    recherche(µ)
    await attendre(20)
    assert.equal(win.location.pathname + win.location.search, '/page?q=chat')
    assert.equal(document.body.textContent, 'résultats')
  })
})
