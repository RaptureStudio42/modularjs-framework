// Préchargement au survol : le HTML d'une page préchargée n'est resservi au clic que s'il a été reçu
// il y a moins de 10 secondes (passé ce délai, la page a pu changer : le clic la redemande au serveur)
// et une seule fois (retiré à l'usage : un clic suivant sur le même lien voit la page à jour). Une
// entrée périmée libère aussi sa clé anti-doublon : un nouveau survol précharge de nouveau.
//
// Méthode : vrais µ._mjs_ajaxGet et µ._mjs_preloadLink (extraits par marqueurs) sur un µ minimal ;
// la requête réseau (µ._mjs_navRequest) est relevée, jamais lancée.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const attendre = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const URL_B = 'http://localhost/b'

function monter() {
  const reseau: string[] = []
  const µ: any = { warn() {}, _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(), _mjs_ajaxRequest() {}, _mjs_isPreloadableLink: () => true, _mjs_effectivePreload: () => 'hover', _mjs_navCachePolicyOf: () => 'cache-first' }
  µ._mjs_navRequest = (_m: string, url: string, _d: any, ok: Function) => { reseau.push(url); µ._reponse = ok }
  const code = ['_mjs_ajaxGet', '_mjs_preloadLink'].map(m => extractMarked(UJS_SRC, m)).join('\n')
  new Function('µ', 'window', code)(µ, { location: { pathname: '/', search: '' } })
  return { µ, reseau }
}

const lien = { href: URL_B, hash: '', pathname: '/b', search: '' }

describe('mjs_ujs — préchargement resservi 10 s au plus, une seule fois', function () {
  it('le survol mémorise l\'heure de réception avec le HTML', function () {
    const { µ, reseau } = monter()
    µ._mjs_preloadLink(lien, 'hover')
    assert.deepEqual(reseau, [URL_B])
    µ._reponse('<p>b</p>', URL_B, void 0, {})
    const entree = µ._mjs_preloadCache.get(URL_B)
    assert.equal(entree.html, '<p>b</p>')
    assert.ok(typeof entree.t === 'number' && Math.abs(Date.now() - entree.t) < 1000, 'AVANT : aucune heure gardée, entrée resservie sans limite')
  })

  it('HTML préchargé il y a 11 s : le clic redemande la page au serveur', async function () {
    const { µ, reseau } = monter()
    µ._mjs_preloadCache.set(URL_B, { html: '<p>vieux</p>', url: URL_B, nav: {}, t: Date.now() - 11000 })
    µ._mjs_preloaded.add('page:' + URL_B)
    const servis: string[] = []
    µ._mjs_ajaxGet(URL_B, (html: string) => servis.push(html), () => {})
    await attendre(5)
    assert.deepEqual(servis, [], 'AVANT : le HTML périmé était resservi')
    assert.deepEqual(reseau, [URL_B])
    assert.equal(µ._mjs_preloadCache.has(URL_B), false)
    assert.equal(µ._mjs_preloaded.has('page:' + URL_B), false)
  })

  it('HTML préchargé récent : servi au premier clic, redemandé au second', async function () {
    const { µ, reseau } = monter()
    µ._mjs_preloadCache.set(URL_B, { html: '<p>b</p>', url: URL_B, nav: {}, t: Date.now() })
    µ._mjs_preloaded.add('page:' + URL_B)
    const servis: string[] = []
    µ._mjs_ajaxGet(URL_B, (html: string) => servis.push(html), () => {})
    await attendre(5)
    assert.deepEqual(servis, ['<p>b</p>'])
    assert.deepEqual(reseau, [])
    µ._mjs_ajaxGet(URL_B, (html: string) => servis.push(html), () => {})
    await attendre(5)
    assert.deepEqual(servis, ['<p>b</p>'], 'AVANT : resservi une seconde fois')
    assert.deepEqual(reseau, [URL_B])
  })

  it('entrée périmée : un nouveau survol précharge de nouveau', function () {
    const { µ, reseau } = monter()
    µ._mjs_preloadCache.set(URL_B, { html: '<p>vieux</p>', url: URL_B, nav: {}, t: Date.now() - 11000 })
    µ._mjs_preloaded.add('page:' + URL_B)
    µ._mjs_preloadLink(lien, 'hover')
    assert.deepEqual(reseau, [URL_B], 'AVANT : la clé anti-doublon bloquait tout nouveau préchargement')
  })

  it('préchargement encore en vol (clé posée, aucune entrée) : un second survol ne relance rien', function () {
    const { µ, reseau } = monter()
    µ._mjs_preloadLink(lien, 'hover')
    µ._mjs_preloadLink(lien, 'hover')
    assert.deepEqual(reseau, [URL_B])
  })
})
