// Régression : une transition de PAGE (mjs_ujs.ts, µ._mjs_vtWrapSwap) enchaîne, dans le MÊME
// clic/popstate/submit, un appel à Router.navigate() — les 6 sites d'échange de page finissent
// tous par lui (cf. le bandeau de µ._mjs_vtWrapSwap). Router.navigate(), lui, ouvre sa PROPRE
// transition (résolution INDÉPENDANTE, niveau <@view>) dès qu'une vue routée en demande une.
// document.startViewTransition() se retrouvait alors rappelé DEPUIS L'INTÉRIEUR du updateCallback
// du 1ᵉʳ appel, avant même que celui-ci n'ait rendu son objet ViewTransition à SON appelant —
// réentrance sans erreur JS (les deux côtés absorbent leurs rejets), mais deux transitions
// imbriquées sur une seule navigation.
//
// Fix : drapeau PARTAGÉ µ._mjs_vtPageSwapping, levé par µ._mjs_vtWrapSwap le temps exact de
// l'exécution de l'échange — que le navigateur rappelle de façon ASYNCHRONE (spécification CSS View
// Transitions, vérifié dans Chromium), jamais pendant l'appel à startViewTransition lui-même ;
// Router.navigate() n'ouvre sa propre transition que si ce drapeau n'est pas levé — sinon il
// exécute l'échange de vues DIRECTEMENT, la transition de PAGE déjà en cours reste la SEULE.
//
// Méthode : même harnais que tests/view-transition.test.ts (loadRouter/makeRoutedComponent,
// happy-dom, globals posés/restaurés PAR TEST) + extraction par marqueurs (µ._mjs_vtWrapSwap/
// µ._mjs_vtResolvePage, mjs_ujs.ts) — code réel des deux fichiers, comme la sonde d'origine.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const ROUTER_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_router.ts'), 'utf-8')

// Globals posés/restaurés PAR TEST (même précaution que view-transition.test.ts : Node fournit un
// CustomEvent natif incompatible avec les instances happy-dom, et un autre fichier de test du même
// process Mocha peut avoir déjà posé sa propre Window avant celui-ci).
let __prevWindow: any, __prevDocument: any, __prevCustomEvent: any, __prevCustomElements: any
beforeEach(() => {
  __prevWindow = (globalThis as any).window
  __prevDocument = (globalThis as any).document
  __prevCustomEvent = (globalThis as any).CustomEvent
  __prevCustomElements = (globalThis as any).customElements
})
afterEach(() => {
  ;(globalThis as any).window = __prevWindow
  ;(globalThis as any).document = __prevDocument
  ;(globalThis as any).CustomEvent = __prevCustomEvent
  ;(globalThis as any).customElements = __prevCustomElements
})

function loadRouter(win: any) {
  const µ: any = { log() {}, warn() {}, error() {} }
  const g: any = globalThis
  g.window = win
  g.document = win.document
  g.CustomEvent = win.CustomEvent
  g.customElements = win.customElements
  new Function('µ', ROUTER_SRC)(µ)
  return µ
}

// vue routée qui résout TOUJOURS une transition active (data-mjs-vt="on") — équivalent d'un
// <@view data-mjs-vt="on"> ou @viewTransition sur le composant routeur.
function makeRoutedComponent(win: any) {
  const document = win.document
  const comp: any = document.createElement('div')
  const view: any = document.createElement('metamjs-view')
  view.id = 'main'
  view.setAttribute('data-mjs-vt', 'on')
  comp._shadow = comp // simplifie : querySelector direct sur comp
  comp.appendChild(view)
  comp.routes = { main: { '/x': 'page-x' } }
  return comp
}

function installVtWrapSwap(µ: any, document: any) {
  const src = extractMarked(UJS_SRC, '_mjs_vtResolvePage') + '\n' + extractMarked(UJS_SRC, '_mjs_vtWrapSwap')
  new Function('µ', 'document', src)(µ, document)
}

// document.startViewTransition FAKE, forme SYNCHRONE (le updateCallback s'exécute à l'intérieur de
// l'appel, comme dans vt-presets-ujs.test.ts) : compte la profondeur de réentrance.
function makeNestingTracker() {
  const state = { active: 0, maxNesting: 0 }
  const startViewTransition = function (cb: any) {
    state.active++
    state.maxNesting = Math.max(state.maxNesting, state.active)
    try {
      cb()
      const inert = { then() {} }
      return { ready: inert, finished: inert }
    } finally {
      state.active--
    }
  }
  return { state, startViewTransition }
}

// même compteur, forme FIDÈLE au navigateur : le updateCallback est rappelé plus tard (tâche
// suivante), APRÈS le retour de startViewTransition — c'est dans ce délai qu'une garde posée
// seulement AUTOUR de l'appel retombait avant que l'échange ne s'exécute
function makeAsyncNestingTracker() {
  let resolveDone: () => void = () => {}
  const state = { active: 0, maxNesting: 0, done: new Promise<void>(r => { resolveDone = r }) }
  const startViewTransition = function (cb: any) {
    state.active++
    state.maxNesting = Math.max(state.maxNesting, state.active)
    setTimeout(() => { try { cb() } finally { state.active--; resolveDone() } }, 0)
    const inert = { then() {} }
    return { ready: inert, finished: inert }
  }
  return { state, startViewTransition }
}

describe("mjs_ujs/mjs_router — transition de PAGE et transition de VUE ROUTÉE ne s'imbriquent plus", function () {
  it("updateCallback rappelé de façon ASYNCHRONE (comme un vrai navigateur) : navigate() depuis l'échange n'ouvre pas de seconde transition", async function () {
    const win: any = new Window({ url: 'http://localhost/#/x' })
    const { state, startViewTransition } = makeAsyncNestingTracker()
    win.document.startViewTransition = startViewTransition

    const µ = loadRouter(win)
    µ.Router._mjs_awareComponents.add(makeRoutedComponent(win))
    installVtWrapSwap(µ, win.document)

    const link = { getAttribute: (k: string) => (k === 'mjs-vt' ? 'on' : null) }
    const swap = function () { µ.Router.navigate('#/x', false) }

    µ._mjs_vtWrapSwap(link, swap)
    assert.ok(!µ._mjs_vtPageSwapping, 'la garde ne doit pas être levée hors de l\'échange')
    await state.done

    assert.equal(state.maxNesting, 1, 'navigate() rappelé pendant l\'échange asynchrone ne doit pas ouvrir une seconde transition')
  })

  it("navigate() appelé DEPUIS le updateCallback de µ._mjs_vtWrapSwap : une seule transition ouverte (pas de réentrance)", function () {
    const win: any = new Window({ url: 'http://localhost/#/x' })
    const { state, startViewTransition } = makeNestingTracker()
    win.document.startViewTransition = startViewTransition

    const µ = loadRouter(win)
    µ.Router._mjs_awareComponents.add(makeRoutedComponent(win))
    installVtWrapSwap(µ, win.document)

    const link = { getAttribute: (k: string) => (k === 'mjs-vt' ? 'on' : null) } // page-level VT active
    const swap = function () { µ.Router.navigate('#/x', false) } // ligne réelle des 6 sites d'échange de page

    µ._mjs_vtWrapSwap(link, swap)

    assert.equal(state.maxNesting, 1, 'une seule transition doit être active à la fois — navigate() ne doit plus en ouvrir une seconde depuis l\'intérieur de la 1ʳᵉ')
  })

  it('navigate() appelé SEUL (aucune transition de page en cours) : la vue routée ouvre bien SA transition — non-régression', function () {
    const win: any = new Window({ url: 'http://localhost/#/x' })
    const { state, startViewTransition } = makeNestingTracker()
    win.document.startViewTransition = startViewTransition

    const µ = loadRouter(win)
    µ.Router._mjs_awareComponents.add(makeRoutedComponent(win))

    µ.Router.navigate('#/x', false)

    assert.equal(state.maxNesting, 1, 'un navigate() standalone (hors transition de page) doit toujours ouvrir sa propre transition')
  })
})
