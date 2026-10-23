// Ancre ordinaire (`#installation`, sans le `/` des routes) dans l'adresse d'une page qui porte un
// composant routé : arriver sur `/docs#installation` (lien d'ancre, rechargement, lien venu d'une
// autre page) ne doit pas remplacer la vue par le panneau « Page introuvable » ni écrire
// `/installation` dans `µ.url.path`. Seul un fragment qui commence par `/` est une route — la règle
// que suivent déjà le clic, le Précédent et hashchange.
//
// Méthode : happy-dom, vrai mjs_router.ts évalué tel quel, composant routé simulé.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTER_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_router.ts'), 'utf-8')
const attendre = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function monter(adresse: string, ensuite?: (µ: any) => void) {
  const win: any = new Window({ url: adresse })
  const document: any = win.document
  const hote = document.createElement('div')
  hote.innerHTML = '<metamjs-view id="main"></metamjs-view>'
  document.body.appendChild(hote)
  const comp: any = { tagName: 'X-ROUTEUR', routes: { main: { '/': 'intro', '/api': 'api' } }, _shadow: hote, querySelector: (s: string) => hote.querySelector(s) }
  const erreurs: string[] = []
  const µ: any = { _mjs_logger: () => null, _mjs_txt: (_k: string, p: any, f: string) => f.replace(/\{(\w+)\}/g, (_m: string, k: string) => String((p || {})[k])), warn() {}, error(m: string) { erreurs.push(m) }, state: (o: any) => o, config: {} }
  new Function('µ', 'window', 'document', 'customElements', 'requestAnimationFrame', 'CustomEvent', ROUTER_SRC)(µ, win, document, win.customElements, (f: any) => setTimeout(f, 0), win.CustomEvent)
  µ.Router.register(comp)
  if (ensuite) ensuite(µ)
  await attendre(20)
  return { vue: hote.querySelector('#main').innerHTML, path: µ.url && µ.url.path, erreurs }
}

describe('mjs_router — une ancre ordinaire n\'est pas une route', function () {
  it('témoin : /docs sans fragment → vue de la route `/`', async function () {
    const r = await monter('http://localhost/docs')
    assert.match(r.vue, /mjs-intro/)
    assert.equal(r.path, '/')
  })

  it('arrivée sur /docs#installation : vue de la route `/`, µ.url.path = `/`, aucune erreur', async function () {
    const r = await monter('http://localhost/docs#installation')
    assert.match(r.vue, /mjs-intro/, 'AVANT : panneau « Page introuvable » à la place de la vue')
    assert.doesNotMatch(r.vue, /data-mjs-route-error/)
    assert.equal(r.path, '/', 'AVANT : µ.url.path = /installation')
    assert.deepEqual(r.erreurs, [])
  })

  it('navigate(\'/docs#installation\') (lien venu d\'une autre page) : vue de la route `/`', async function () {
    const r = await monter('http://localhost/docs', (µ) => µ.Router.navigate('/docs#installation', false))
    assert.match(r.vue, /mjs-intro/)
    assert.equal(r.path, '/')
  })

  it('une vraie route hash (`#/api`) reste une route', async function () {
    const r = await monter('http://localhost/docs#/api')
    assert.match(r.vue, /mjs-api/)
    assert.equal(r.path, '/api')
  })

  it('_mjs_getMatchPath : `#section` → `/`, `#/a` → `/a`, `#/a/?x=1` → `/a`', async function () {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = { _mjs_logger: () => null, _mjs_txt: (_k: string, _p: any, f: string) => f, warn() {}, error() {}, state: (o: any) => o, config: {} }
    new Function('µ', 'window', 'document', ROUTER_SRC)(µ, win, win.document)
    assert.equal(µ.Router._mjs_getMatchPath('/docs#section'), '/')
    assert.equal(µ.Router._mjs_getMatchPath('/docs#/a'), '/a')
    assert.equal(µ.Router._mjs_getMatchPath('/docs#/a/?x=1'), '/a')
    assert.equal(µ.Router._mjs_getMatchPath('/docs'), '/')
    assert.equal(µ.Router._mjs_getMatchPath('/docs#?tri=nom'), '/')
  })
})
