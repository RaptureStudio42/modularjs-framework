// Une page reprise du cache de navigation est restaurée de la même façon au retour arrière / avant (popstate) et au
// clic : tête, éléments permanents, contenu, fin d'hibernation, contenant suivi, politique de cache et empreinte de la
// page, dernière adresse, défilement, focus, revalidation en fond, puis seulement routeur et mjs:load — dans cet ordre,
// sans transition de vue comme différée par elle. Les deux chemins partagent une seule restauration : ce test garde
// leur équivalence pas à pas.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked, extractMarkedBody } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

const attendre = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function conteneur(): any {
  const c: any = { children: [] as any[] }
  Object.defineProperty(c, 'childNodes', { get: () => c.children.slice() })
  c.replaceChildren = (...n: any[]) => { c.children = n.slice() }
  return c
}

function documentFactice(body: any): any {
  const ecoutes: Array<{ type: string, fn: (e: any) => void }> = []
  return {
    body,
    querySelector: () => null,
    createElement: (tag: string) => ({ tag, nodeType: 1, children: [] }),
    addEventListener(type: string, fn: (e: any) => void) { ecoutes.push({ type, fn }) },
    dispatchEvent(e: any) { ecoutes.filter(l => l.type === e.type).forEach(l => l.fn(e)); return !e.defaultPrevented },
  }
}

// entrée du cache : un élément et un texte, avec la tête, la politique et l'empreinte gardées avec la page
function entree(): any {
  const nodes: any = [{ nodeType: 1, tag: 'section', _mjs_page_cached: true }, { nodeType: 3, _mjs_page_cached: true }]
  nodes._mjs_mjsHead = { titre: 'gardée' }
  nodes._mjs_mjsCachePolicy = 'revalidate'
  nodes._mjs_mjsRecu = 'empreinte'
  return nodes
}

// banc commun : `page` = page reprise du cache, `lieu` = adresse affichée au moment de l'événement ; chaque étape de la
// restauration est notée dans l'ordre où elle arrive
function banc(page: string, lieu: string, differe: boolean) {
  const etapes: any[] = []
  const body  = conteneur()
  const doc   = documentFactice(body)
  const nodes = entree()
  const win: any = { location: { pathname: lieu, search: '', hash: '', origin: 'http://x' }, history: { pushState() {} } }
  const µ: any = {
    realTarget: (e: any) => e.target,
    warn() {}, error() {}, log() {},
    _mjs_navSeq: 0, _mjs_lastUjsPath: '/depart',
    Router: { navigate: (dest: string) => etapes.push(['routeur', dest]), _mjs_vtEnabled: () => true },
    _mjs_saveScroll() {},
    _mjs_scrollPos: { get: () => null, has: () => false },
    pageCache: { has: (p: string) => p === page, get: () => nodes, set() {} },
  }
  new Function('µ', 'document', 'window', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, doc, win)
  if (differe) {
    µ.viewTransition = true
    doc.startViewTransition = (cb: any) => { setTimeout(cb, 0); return {} }
    new Function('µ', 'document', extractMarked(UJS_SRC, '_mjs_vtResolvePage') + '\n' + extractMarked(UJS_SRC, '_mjs_vtWrapSwap'))(µ, doc)
  }
  // étapes notées, posées APRÈS les aides qui les définissent
  µ._mjs_navRestoreHead = (head: any) => etapes.push(['tête', head.titre])
  µ._mjs_navTransplantPermanents = (zone: any, n: any) => etapes.push(['permanents', zone === body, n === nodes])
  µ._mjs_zoneFill = (zone: any, n: any) => etapes.push(['contenu', zone === body, n === nodes])
  µ._mjs_navTrackZone = (a: any, b: any) => etapes.push(['suivi', a, b])
  µ._mjs_restoreScroll = (p: string) => etapes.push(['défilement', p, µ._mjs_lastUjsPath])
  µ._mjs_focusAfterSwap = (el: any) => etapes.push(['focus', el === nodes[0]])
  µ._mjs_navRevalidate = (zone: any, p: string) => etapes.push(['revalidation', zone === body, p, µ._mjs_navCachePolicy, µ._mjs_navRecu])
  doc.addEventListener('mjs:load', (e: any) => etapes.push(['load', e.detail.via, e.detail.path, e.detail.zone === body]))
  return { µ, doc, win, nodes, etapes }
}

function retourArriere(differe: boolean) {
  const b = banc('/dest', '/dest', differe)
  const gestionnaire = new Function('e', 'µ', 'window', 'document', 'DOMParser', extractMarkedBody(UJS_SRC, 'popstate-listener'))
  gestionnaire({}, b.µ, b.win, b.doc, class {})
  return b
}

function clic(differe: boolean) {
  const b = banc('/autre', '/depart', differe)
  const lien: any = {
    tagName: 'A', hasAttribute: () => false, getAttribute: () => null, closest() { return this },
    origin: 'http://x', target: '', protocol: 'http:', pathname: '/autre', search: '', hash: '', href: 'http://x/autre',
  }
  const e: any = {
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true },
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    composedPath: () => [lien], target: lien,
  }
  const gestionnaire = new Function('e', 'µ', 'window', 'document', 'DOMParser', 'FormData', extractMarkedBody(UJS_SRC, '_mjs_ujsOnClick'))
  gestionnaire(e, b.µ, b.win, b.doc, class {}, class {})
  return b
}

// la suite attendue, la même pour les deux chemins à la page et au déclencheur près
function attendu(page: string, via: string): any[] {
  return [
    ['tête', 'gardée'],
    ['permanents', true, true],
    ['contenu', true, true],
    ['suivi', null, null],
    ['défilement', page, page],
    ['focus', true],
    ['revalidation', true, page, 'revalidate', 'empreinte'],
    ['routeur', page],
    ['load', via, page, true],
  ]
}

const neutre = (etapes: any[], page: string, via: string): string => JSON.stringify(etapes).split(page).join('<page>').split('"' + via + '"').join('"<via>"')

function verifierEtat(b: any, page: string): void {
  assert.equal(b.µ._mjs_lastUjsPath, page, 'la dernière adresse est la page restaurée')
  assert.equal(b.nodes[0]._mjs_page_cached, false, 'l\'élément sort d\'hibernation')
  assert.equal(b.nodes[1]._mjs_page_cached, true, 'un nœud texte n\'est pas touché')
}

describe('cache de navigation — même restauration au retour arrière / avant et au clic', () => {
  it('sans transition de vue : mêmes étapes, dans le même ordre, routeur et mjs:load en dernier', () => {
    const pop = retourArriere(false)
    assert.deepEqual(pop.etapes, attendu('/dest', 'popstate'))
    verifierEtat(pop, '/dest')
    const lien = clic(false)
    assert.deepEqual(lien.etapes, attendu('/autre', 'link'))
    verifierEtat(lien, '/autre')
    assert.equal(neutre(pop.etapes, '/dest', 'popstate'), neutre(lien.etapes, '/autre', 'link'), 'les deux chemins sont équivalents pas à pas')
  })

  it('différée par une transition de vue : rien avant le rappel, puis les mêmes étapes', async () => {
    const pop = retourArriere(true)
    const lien = clic(true)
    assert.deepEqual(pop.etapes, [], 'retour arrière : rien d\'installé avant le rappel de la transition')
    assert.deepEqual(lien.etapes, [], 'clic : rien d\'installé avant le rappel de la transition')
    await attendre(10)
    assert.deepEqual(pop.etapes, attendu('/dest', 'popstate'))
    assert.deepEqual(lien.etapes, attendu('/autre', 'link'))
    verifierEtat(pop, '/dest')
    verifierEtat(lien, '/autre')
  })
})
