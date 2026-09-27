// Régression : le préchargement au survol (µ._mjs_preloadLink) mémorisait TOUJOURS la réponse
// dans µ._mjs_preloadCache, sans jamais lire sa politique de cache (`nav.cache`) — contrairement
// à µ._mjs_navHibernate (l.801), qui refuse déjà d'archiver une page « no-cache ». Une page
// explicitement marquée no-cache (jeton one-shot, CSRF frais…) était donc quand même préchargée
// au survol PUIS resservie telle quelle au clic, SANS repasser par le réseau — exactement ce que
// la politique no-cache interdit (cf. docs/21-navigation.md, section « Préchargement au survol » :
// le HTML préchargé doit suivre les mêmes règles qu'une page qui vient d'être demandée au clic).
//
// Fix : même garde que µ._mjs_navHibernate — une réponse dont la politique de cache résout à
// 'no-cache' n'est jamais posée dans µ._mjs_preloadCache. `_mjs_ajaxGet` ne la trouvant donc
// jamais en cache, le clic repart en requête réseau normale (« ne pas resservir » découle
// naturellement de « ne pas stocker »).
//
// Méthode : même harnais que tests/ujs-preload-submitter.test.ts (installHelpers/installPreload,
// extraction par marqueurs, stubs plats).

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function extractHelpersBlock(): string {
  return extractMarked(UJS_SRC, 'helpers-navigation')
}
function installHelpers(µ: any, document: any, window: any) {
  new Function('µ', 'document', 'window', extractHelpersBlock())(µ, document, window)
}
function extractPreloadChain(): string {
  return [
    extractMarked(UJS_SRC, '_mjs_preloadCache-init'),
    extractMarked(UJS_SRC, '_mjs_normPreload'),
    extractMarked(UJS_SRC, '_mjs_ajaxGet'),
    extractMarked(UJS_SRC, '_mjs_isPreloadableLink'),
    extractMarked(UJS_SRC, '_mjs_effectivePreload'),
    extractMarked(UJS_SRC, '_mjs_preloadLink'),
  ].join('\n')
}
function installPreload(µ: any, window: any) {
  µ._mjs_preloaded = new Set() // hors marqueur dans la source (déclaration brute juste avant _mjs_preloadCache-init)
  new Function('µ', 'window', extractPreloadChain())(µ, window)
}

function makeLink(overrides: Record<string, any> = {}) {
  return Object.assign({
    tagName: 'A',
    hasAttribute: (_k: string) => false,
    getAttribute: (k: string) => (k === 'data-mjs-preload' ? 'eager' : null),
    origin: 'http://x',
    target: '',
    protocol: 'http:',
    hash: '',
    pathname: '/sensitive',
    search: '',
    href: 'http://x/sensitive',
    getRootNode: () => null,
  }, overrides)
}
function makeWindow() {
  return { location: { origin: 'http://x', pathname: '/page1', search: '' } }
}
function setupPreload() {
  const µ: any = { log() {}, warn() {}, error() {} }
  const win = makeWindow()
  installHelpers(µ, {}, win) // fournit µ._mjs_navRequest/µ._mjs_navCachePolicyOf (et µ._mjs_navNoUjs)
  installPreload(µ, win)
  return { µ, win }
}

describe('mjs_ujs — µ._mjs_preloadLink : une réponse no-cache ne doit jamais être mise en cache de préchargement', function () {
  it("nav.cache === 'no-cache' : aucune entrée posée dans µ._mjs_preloadCache", function () {
    const { µ } = setupPreload()
    µ._mjs_ajaxRequest = function (opts: any) {
      opts.success('<html><body id="app-root">SENSITIVE</body></html>', opts.url, undefined, { cache: 'no-cache' })
    }
    const link = makeLink()

    µ._mjs_preloadLink(link, 'eager')

    assert.equal(µ._mjs_preloadCache.has(link.href), false, 'une réponse no-cache ne doit jamais être archivée pour un clic futur')
  })

  it("nav.cache === 'no-cache' : le clic qui suit repart bien en requête réseau (rien à resservir)", async function () {
    const { µ } = setupPreload()
    const networkCalls: string[] = []
    µ._mjs_ajaxRequest = function (opts: any) {
      networkCalls.push(opts.url)
      opts.success('<html><body id="app-root">SENSITIVE</body></html>', opts.url, undefined, { cache: 'no-cache' })
    }
    const link = makeLink()

    µ._mjs_preloadLink(link, 'eager') // survol
    assert.equal(networkCalls.length, 1, 'le survol déclenche bien 1 requête')

    µ._mjs_ajaxGet(link.href, function () {})
    await new Promise((r) => setTimeout(r, 0))

    assert.equal(networkCalls.length, 2, 'le clic doit repartir en requête réseau, pas être servi depuis le cache de préchargement')
  })

  it("politique de cache par DÉFAUT (nav.cache absent) : mise en cache normale, comportement inchangé (non-régression)", function () {
    const { µ } = setupPreload()
    µ._mjs_ajaxRequest = function (opts: any) {
      opts.success('<html><body>ok</body></html>', opts.url, undefined, {})
    }
    const link = makeLink()

    µ._mjs_preloadLink(link, 'eager')

    assert.equal(µ._mjs_preloadCache.has(link.href), true, "sans politique explicite (repli 'cache-first'), la mise en cache doit rester inchangée")
  })

  it("fiche JSON du protocole avec cache: 'no-cache' (sans en-tête) : jamais archivée", function () {
    const { µ } = setupPreload()
    µ._mjs_ajaxRequest = function (opts: any) {
      opts.success({ module: 'page-sensible', props: {}, cache: 'no-cache' }, opts.url, undefined, {})
    }
    const link = makeLink()

    µ._mjs_preloadLink(link, 'eager')

    assert.equal(µ._mjs_preloadCache.has(link.href), false, 'la clé cache de la fiche JSON est un canal de politique à part entière')
  })

  it("page HTML qui déclare <meta name=\"mjs-cache\" content=\"no-cache\"> : jamais archivée", function () {
    const g: any = globalThis
    const prev = g.DOMParser
    g.DOMParser = new Window().DOMParser
    try {
      const { µ } = setupPreload()
      µ._mjs_ajaxRequest = function (opts: any) {
        opts.success('<html><head><meta name="mjs-cache" content="no-cache"></head><body>SENSITIVE</body></html>', opts.url, undefined, {})
      }
      const link = makeLink()

      µ._mjs_preloadLink(link, 'eager')

      assert.equal(µ._mjs_preloadCache.has(link.href), false, 'la balise meta est le troisième canal de la politique de cache')
    } finally {
      g.DOMParser = prev
    }
  })

  it("nav.cache === 'revalidate' : mise en cache normale (seul 'no-cache' est exclu, non-régression)", function () {
    const { µ } = setupPreload()
    µ._mjs_ajaxRequest = function (opts: any) {
      opts.success('<html><body>ok</body></html>', opts.url, undefined, { cache: 'revalidate' })
    }
    const link = makeLink()

    µ._mjs_preloadLink(link, 'eager')

    assert.equal(µ._mjs_preloadCache.has(link.href), true)
  })
})
