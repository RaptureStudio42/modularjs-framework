// Après un envoi qui modifie le serveur (POST, PUT, PATCH, DELETE), les pages gardées pour le Précédent
// (µ.pageCache) et le HTML préchargé (µ._mjs_preloadCache, µ._mjs_preloaded) datent d'avant la modification :
// ils sont vidés, quelle que soit la réponse — fiche JSON, page HTML installée, réponse qui n'installe rien,
// refus 422, échec. Un envoi GET ne modifie rien : les trois gardent leurs entrées. Une seule aide fait ce
// ménage pour toutes ces sorties ; ce test les parcourt toutes, pour qu'aucune ne le perde.
//
// Méthode : happy-dom, vrais µ._mjs_navDispatch et bloc des aides de navigation ; le réseau
// (µ._mjs_navRequest) remplacé par un relevé des rappels de réussite et d'échec, appelés à la main.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function monter() {
  const win: any = new Window({ url: 'http://localhost/posts' })
  const document: any = win.document
  document.body.innerHTML = '<p>page affichée</p>'
  const µ: any = { warn() {}, error() {}, log() {}, realTarget: (e: any) => e.target, _mjs_lastUjsPath: '/posts', _mjs_navSeq: 0, _mjs_saveScroll() {} }
  µ.pageCache = new Map([['/autre', [document.createElement('div')]]])
  µ._mjs_preloadCache = new Map([['http://localhost/autre', '<html><body>autre</body></html>']])
  µ._mjs_preloaded = new Set(['http://localhost/autre'])
  poserMessages(µ)
  new Function('µ', 'document', 'window', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, document, win)
  new Function('µ', 'window', 'document', 'FormData', 'URL', 'DOMParser', extractMarked(UJS_SRC, '_mjs_navDispatch'))(µ, win, document, win.FormData, URL, win.DOMParser)
  const rappels: any = {}
  µ._mjs_navRequest = (_verbe: string, _url: string, _corps: any, ok: any, ko: any) => { rappels.ok = ok; rappels.ko = ko }
  // fiche JSON : son installation n'est pas l'objet de ce test
  µ._mjs_navApplyJson = () => {}
  return { µ, rappels }
}

function intacts(µ: any) {
  return µ.pageCache.has('/autre') && µ._mjs_preloadCache.has('http://localhost/autre') && µ._mjs_preloaded.has('http://localhost/autre')
}

function vides(µ: any) {
  return µ.pageCache.size === 0 && µ._mjs_preloadCache.size === 0 && µ._mjs_preloaded.size === 0
}

const sorties: Array<[string, (r: any) => void]> = [
  ['fiche JSON', r => r.ok({ module: 'liste', props: {} }, 'http://localhost/posts')],
  ['page HTML installée', r => r.ok('<html><head><title>Posts</title></head><body><p>page reçue</p></body></html>', 'http://localhost/posts')],
  ['réponse qui n\'installe rien (204)', r => r.ok(null, 'http://localhost/posts')],
  ['refus 422 en JSON', r => r.ko({ status: 422, body: { props: { errors: { titre: 'requis' } } } })],
  ['échec (500 sans page)', r => r.ko({ status: 500 })]
]

describe('mjs_ujs — envoi : caches vidés après une modification, à chaque sortie', function () {
  for (const [nom, sortie] of sorties) {
    it('POST, ' + nom + ' : pages gardées et préchargement vidés', function () {
      const { µ, rappels } = monter()
      const corps = new URLSearchParams([['titre', 'x']])
      µ._mjs_navDispatch('http://localhost/posts', 'POST', corps, { via: 'form' })
      assert.equal(typeof rappels.ok, 'function', 'requête partie')
      assert.ok(intacts(µ), 'rien de vidé avant la réponse')
      sortie(rappels)
      assert.ok(vides(µ), 'caches vidés')
    })

    it('GET, ' + nom + ' : entrées gardées', function () {
      const { µ, rappels } = monter()
      µ._mjs_navDispatch('http://localhost/posts', 'GET', new URLSearchParams([['q', 'x']]), { via: 'form' })
      assert.equal(typeof rappels.ok, 'function', 'requête partie')
      sortie(rappels)
      assert.ok(intacts(µ), 'un GET ne vide rien')
    })
  }

  it('DELETE d\'un lien @method (sans corps), réponse 204 : caches vidés', function () {
    const { µ, rappels } = monter()
    const corps = new URLSearchParams([['_method', 'delete']])
    µ._mjs_navDispatch('http://localhost/posts/1', 'DELETE', corps, { via: 'method' })
    rappels.ok(null, 'http://localhost/posts/1')
    assert.ok(vides(µ))
  })
})
