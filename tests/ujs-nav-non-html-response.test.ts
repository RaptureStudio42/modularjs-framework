// Régression : un clic ou un retour arrière vers une réponse de MÊME origine qui n'est PAS une
// page HTML complète (204 sans corps, corps vide, texte brut, JSON en texte…) était passée telle
// quelle à DOMParser — qui fabrique TOUJOURS un <body> exploitable, même depuis `null` ou du
// texte brut (`String(null)` → `"null"`) — et ce contenu brut était installé dans la zone de
// navigation, en silence, URL déjà changée. Le chemin des formulaires (µ._mjs_navDispatch) porte
// déjà cette garde (teste la présence de « <html » avant tout parse) ; le clic et le retour
// arrière ne l'avaient pas.
//
// Fix (mjs_ujs.ts, chemins réseau du clic et du popstate) : tri AVANT tout DOMParser
// (µ._mjs_navBodyKind) — le Content-Type annoncé par le serveur tranche ; sans en-tête, un corps
// qui commence par une balise passe pour du HTML (page complète ou fragment). Un 204 (`html` null) ou un corps
// vide est un cas « rien à afficher » (comme un navigateur qui reçoit un 204 : aucune erreur,
// aucun contenu) — l'hibernation de la page quittée est annulée, rien n'est installé, exactement
// le traitement déjà réservé à `X-MJS-Method: none` ; au clic, l'adresse poussée revient alors sur la
// page affichée (les deux cas). Une réponse non vide mais non-HTML (texte,
// CSV, PDF servi tel quel…) part en navigation native : au clic via µ._mjs_hardNav (repli déjà
// utilisé quand la réponse HTML n'a aucune zone exploitable), au retour arrière via un
// rechargement complet (même repli déjà utilisé au popstate dans ce même cas) — c'est le
// NAVIGATEUR qui traite alors la réponse (téléchargement, affichage direct d'un PDF), jamais MJS.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked, extractMarkedBody } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function extractHelpersBlock(src: string): string {
  return extractMarked(src, 'helpers-navigation')
}
function installHelpers(µ: any, doc: any, win: any) {
  new Function('µ', 'document', 'window', extractHelpersBlock(UJS_SRC))(µ, doc, win)
}
function makeClickHandler() {
  const body = extractMarkedBody(UJS_SRC, '_mjs_ujsOnClick')
  return new Function('e', 'µ', 'window', 'document', 'DOMParser', body)
}
function makePopstateHandler() {
  const body = extractMarkedBody(UJS_SRC, 'popstate-listener')
  return new Function('e', 'µ', 'window', 'document', 'DOMParser', body)
}
function makeCrossLink(pathname: string, href: string, hash = '') {
  return { hasAttribute: () => false, origin: 'http://x', target: '', protocol: 'http:', pathname, search: '', hash, href, closest: function (this: any) { return this } }
}
function makeClickEvent(link: any) {
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    composedPath: () => [link],
    target: link,
  }
}
// DOMParser NATIF (happy-dom, mesuré côté sonde) : parseFromString coerce l'argument en chaîne
// (même `null`) et pose TOUJOURS un <body> — c'est ce comportement qui rend le bug possible tant
// que rien, en amont, ne trie les réponses avant de les lui passer.
class NativeLikeDOMParser {
  parseFromString(arg: any) {
    const text = String(arg)
    return { body: { children: [] as any[], childNodes: [{ nodeType: 3, textContent: text }], textContent: text } }
  }
}

describe('mjs_ujs — clic cross-page : réponse non-HTML (204, vide, texte, JSON en texte) jamais installée telle quelle', function () {
  function setupClick() {
    const replaceChildrenCalls: any[] = []
    const liveRoot: any = { replaceChildren(...nodes: any[]) { replaceChildrenCalls.push(nodes) }, childNodes: [] as any[] }
    const replaceStateCalls: any[] = []
    const win: any = { location: { pathname: '/', search: '', origin: 'http://x', href: 'http://x/', hash: '' }, history: { pushState() {}, replaceState(_s: any, _t: any, url: string) { replaceStateCalls.push(url) } }, scrollTo() {} }
    const doc: any = { body: liveRoot }
    const hardNavCalls: any[] = []
    let capturedCb: any
    const µ: any = {
      realTarget: (e: any) => e.target, _mjs_navSeq: 0, _mjs_lastUjsPath: '/',
      pageCache: { has: () => false, get: () => null, set() {}, delete() {} }, _mjs_saveScroll() {},
      _mjs_ajaxGet: (_u: string, cb: any) => { capturedCb = cb },
      _mjs_hardNav: (d: string) => hardNavCalls.push(d),
      _mjs_finalPathFor: (_finalUrl: any, fallback: string) => fallback,
      Router: { navigate() {} },
      warn() {}, error() {}, log() {},
    }
    installHelpers(µ, doc, win)
    const e = makeClickEvent(makeCrossLink('/tuto', 'http://x/tuto#/lecon', '#/lecon'))
    makeClickHandler()(e, µ, win, doc, NativeLikeDOMParser)
    return { replaceChildrenCalls, hardNavCalls, replaceStateCalls, getCb: () => capturedCb }
  }

  it('204 sans corps (html=null) : aucun contenu installé, aucune navigation native déclenchée', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    assert.equal(typeof getCb(), 'function', '_mjs_ajaxGet doit avoir été appelé')
    getCb()(null, 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 0, 'un 204 ne doit installer aucun contenu, comme un navigateur')
    assert.equal(hardNavCalls.length, 0, "un 204 n'est pas un échec, il ne doit pas déclencher de navigation native")
  })

  it('corps vide ("") : aucun contenu installé', function () {
    const { replaceChildrenCalls, getCb } = setupClick()
    getCb()('', 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 0)
  })

  it('texte brut non-HTML : aucun contenu installé, navigation native via µ._mjs_hardNav', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('Erreur interne du serveur', 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 0, 'le texte brut ne doit jamais être injecté dans la page')
    assert.deepEqual(hardNavCalls, ['http://x/tuto#/lecon'], 'le navigateur doit traiter lui-même une réponse non-HTML (PDF, CSV…)')
  })

  it('JSON en texte (content-type mal négocié) : aucun contenu installé, navigation native', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('{"error":"oops"}', 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 0)
    assert.equal(hardNavCalls.length, 1)
  })

  it('page HTML complète (cas nominal) : toujours installée normalement', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('<html><body>contenu</body></html>', 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 1, "une vraie page HTML continue de s'installer")
    assert.equal(hardNavCalls.length, 0)
  })

  it('fragment HTML annoncé text/html (sans balise <html>) : installé comme une page', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('<main><h1>Produits</h1></main>', 'http://x/tuto', undefined, { type: 'text/html; charset=utf-8' })
    assert.equal(replaceChildrenCalls.length, 1, 'le mode HTML accepte un fragment, pas seulement une page complète')
    assert.equal(hardNavCalls.length, 0)
  })

  it('fragment HTML sans Content-Type : un corps qui commence par une balise est installé', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('  <section>liste</section>', 'http://x/tuto')
    assert.equal(replaceChildrenCalls.length, 1)
    assert.equal(hardNavCalls.length, 0)
  })

  it('PDF annoncé application/pdf : jamais installé, navigation native', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('%PDF-1.7 <</Type /Catalog>>', 'http://x/tuto', undefined, { type: 'application/pdf' })
    assert.equal(replaceChildrenCalls.length, 0)
    assert.deepEqual(hardNavCalls, ['http://x/tuto#/lecon'])
  })

  it('CSV annoncé text/csv même s\'il commence par un chevron : navigation native', function () {
    const { replaceChildrenCalls, hardNavCalls, getCb } = setupClick()
    getCb()('<id>;nom\n1;Ada', 'http://x/tuto', undefined, { type: 'text/csv' })
    assert.equal(replaceChildrenCalls.length, 0, 'le type annoncé par le serveur prime sur le premier caractère')
    assert.equal(hardNavCalls.length, 1)
  })

  it('204 : l\'adresse poussée au clic revient sur la page affichée', function () {
    const { replaceStateCalls, getCb } = setupClick()
    getCb()(null, 'http://x/tuto')
    assert.deepEqual(replaceStateCalls, ['/'], 'un navigateur ne change pas d\'adresse sur un 204')
  })

  it('X-MJS-Method: none : rien d\'installé et l\'adresse revient sur la page affichée', function () {
    const { replaceChildrenCalls, replaceStateCalls, getCb } = setupClick()
    getCb()('', 'http://x/tuto', undefined, { method: 'none' })
    assert.equal(replaceChildrenCalls.length, 0)
    assert.deepEqual(replaceStateCalls, ['/'], 'docs/21-navigation.md : « pas de changement d\'adresse »')
  })

  it('page installée : l\'adresse poussée au clic est gardée', function () {
    const { replaceStateCalls, getCb } = setupClick()
    getCb()('<html><body>contenu</body></html>', 'http://x/tuto')
    assert.deepEqual(replaceStateCalls, [])
  })
})

describe('mjs_ujs — popstate : réponse non-HTML (204, vide, texte) jamais installée telle quelle', function () {
  function setupPopstate() {
    const filled: any[] = []
    const zone: any = { tag: 'body', childNodes: [] as any[], replaceChildren(...nodes: any[]) { filled.push(nodes) } }
    const reloadCalls: any[] = []
    const win: any = { location: { pathname: '/b', search: '', hash: '', href: 'http://x/b', origin: 'http://x', reload: () => reloadCalls.push(true) } }
    const doc: any = { body: zone }
    let capturedSuccess: any
    const µ: any = {
      _mjs_lastUjsPath: '/a', _mjs_navSeq: 0,
      pageCache: { has: () => false, get: () => null, set() {}, delete() {} },
      _mjs_saveScroll() {}, _mjs_restoreScroll() {},
      warn() {}, error() {}, log() {},
      _mjs_finalPathFor: (_finalUrl: any, fallback: string) => fallback,
      _mjs_ajaxRequest: (opts: any) => { capturedSuccess = opts.success; return Promise.resolve() },
      Router: { navigate() {} },
    }
    installHelpers(µ, doc, win)
    const handler = makePopstateHandler()
    handler({}, µ, win, doc, NativeLikeDOMParser)
    return { filled, reloadCalls, getCb: () => capturedSuccess }
  }

  it('204 sans corps (html=null) : aucun contenu installé, aucun rechargement forcé', function () {
    const { filled, reloadCalls, getCb } = setupPopstate()
    assert.equal(typeof getCb(), 'function', 'µ._mjs_ajaxRequest doit avoir été appelé (cache miss)')
    getCb()(null, 'http://x/b')
    assert.equal(filled.length, 0, 'un 204 ne doit installer aucun contenu, comme un navigateur')
    assert.equal(reloadCalls.length, 0)
  })

  it('corps vide ("") : aucun contenu installé', function () {
    const { filled, getCb } = setupPopstate()
    getCb()('', 'http://x/b')
    assert.equal(filled.length, 0)
  })

  it('texte brut non-HTML : aucun contenu installé, rechargement complet (le navigateur traite la réponse)', function () {
    const { filled, reloadCalls, getCb } = setupPopstate()
    getCb()('Erreur interne du serveur', 'http://x/b')
    assert.equal(filled.length, 0, 'le texte brut ne doit jamais être injecté dans la page')
    assert.equal(reloadCalls.length, 1, 'même repli que celui déjà utilisé quand la réponse HTML est sans zone exploitable')
  })

  it('page HTML complète (cas nominal) : toujours installée normalement', function () {
    const { filled, reloadCalls, getCb } = setupPopstate()
    getCb()('<html><body>contenu</body></html>', 'http://x/b')
    assert.equal(filled.length, 1)
    assert.equal(reloadCalls.length, 0)
  })

  it('fragment HTML annoncé text/html : installé', function () {
    const { filled, reloadCalls, getCb } = setupPopstate()
    getCb()('<main>fragment</main>', 'http://x/b', undefined, { type: 'text/html' })
    assert.equal(filled.length, 1)
    assert.equal(reloadCalls.length, 0)
  })

  it('PDF annoncé application/pdf : rechargement complet, jamais installé', function () {
    const { filled, reloadCalls, getCb } = setupPopstate()
    getCb()('%PDF-1.7', 'http://x/b', undefined, { type: 'application/pdf' })
    assert.equal(filled.length, 0)
    assert.equal(reloadCalls.length, 1)
  })
})
