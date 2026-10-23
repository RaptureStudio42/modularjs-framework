// La barre de navigation (mjs_nav_progress.ts) : un trait de lumière en haut de la page quand une
// navigation dure — un lien ou un formulaire (mjs_ujs.ts), une page du routeur dont le composant
// arrive (mjs_router.ts). Allumée par défaut : `µ.config.navProgress` absent ou `true` = seuil 500ms,
// un NOMBRE = ce seuil en ms, `{ delay, place }` (place : top, bottom), `false` = rien. Élément
// `<div class="mjs-nav-progress" role="progressbar" aria-hidden="true">` inséré dans `document.body`
// SEULEMENT si la navigation dépasse le seuil, retiré à la fin (succès/échec/abandon). Son allure est
// une feuille adoptée une fois, sélecteurs en `:where(…)` (une règle de l'appli l'emporte), réglée par
// les variables `--mjs-nav-progress-*`. Timer + élément GLOBAUX (comme `µ.nav.active`) : deux
// navigations enchaînées ne doivent jamais empiler ni l'un ni l'autre.
//
// Méthode : la SOURCE réelle du module, exécutée avec `setTimeout`/`clearTimeout` INJECTÉS (horloge
// FAKE pilotée à la main : un timer non déclenché ne produit JAMAIS d'élément) ; pour le routeur et
// l'autoloader, leurs sources réelles dans une fenêtre happy-dom.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { assertAbsent } from './helpers/dom-assert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const lire      = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')
const NAV_SRC   = lire('mjs_nav_progress.ts')

function installProgress(µ: any, document: any, setTimeoutFn: any, clearTimeoutFn: any, CSSStyleSheetFn: any = undefined) {
  new Function('µ', 'document', 'setTimeout', 'clearTimeout', 'CSSStyleSheet', NAV_SRC)(µ, document, setTimeoutFn, clearTimeoutFn, CSSStyleSheetFn)
}

// Horloge FAKE : `setTimeout`/`clearTimeout` n'attendent RIEN, chaque timer armé reste en attente
// dans `scheduled` jusqu'à `fire(id)` (déclenché à la main) ou `clearTimeoutFn(id)` (annulé).
function fakeTimers() {
  let nextId = 1
  const scheduled = new Map<number, { fn: Function, delay: number }>()
  const setTimeoutFn = (fn: Function, delay: number) => { const id = nextId++; scheduled.set(id, { fn, delay }); return id }
  const clearTimeoutFn = (id: number) => { scheduled.delete(id) }
  return {
    scheduled,
    setTimeoutFn,
    clearTimeoutFn,
    fire(id: number) {
      const t = scheduled.get(id)
      assert.ok(t, `timer ${id} introuvable (jamais armé, ou déjà annulé/déclenché)`)
      scheduled.delete(id)
      t!.fn()
    },
  }
}

// Élément/document FAKE : juste ce que µ._mjs_navProgressStart/Stop touchent réellement
function makeEl(tag: string): any {
  const el: any = {
    tag, className: '', parentNode: null as any, children: [] as any[], _attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) { el._attrs[k] = v },
    getAttribute(k: string) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null },
    appendChild(c: any) { el.children.push(c); c.parentNode = el; return c },
    removeChild(c: any) { el.children = el.children.filter((x: any) => x !== c); c.parentNode = null; return c },
  }
  return el
}
function makeDoc(): any {
  const body = makeEl('body')
  return { body, adoptedStyleSheets: [] as any[], createElement: (tag: string) => makeEl(tag) }
}
// une feuille FAKE : garde le CSS reçu
class FakeSheet {
  css = ''
  replaceSync(css: string) { this.css = css }
}

describe('barre de navigation — allumée par défaut', function () {
  it('µ.config absent : seuil de 500ms, rien encore à l\'écran', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = {}
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()

    assert.equal(timers.scheduled.size, 1)
    assert.equal(timers.scheduled.get(µ._mjs_navProgressTimer)!.delay, 500)
    assert.equal(doc.body.children.length, 0)
  })

  it('µ.config.navProgress = false : aucun timer, aucun élément', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: false } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()

    assert.equal(µ._mjs_navProgressTimer, null)
    assert.equal(timers.scheduled.size, 0)
    assert.equal(doc.body.children.length, 0)
  })
})

describe('barre de navigation — réglages', function () {
  it('µ.config.navProgress = true : seuil PAR DÉFAUT 500ms', function () {
    const timers = fakeTimers()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, makeDoc(), timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()

    assert.equal(timers.scheduled.get(µ._mjs_navProgressTimer)!.delay, 500)
  })

  it('µ.config.navProgress = 700 (nombre) : ce nombre EST le seuil, en ms', function () {
    const timers = fakeTimers()
    const µ: any = { config: { navProgress: 700 } }
    installProgress(µ, makeDoc(), timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()

    assert.equal(timers.scheduled.get(µ._mjs_navProgressTimer)!.delay, 700)
  })

  it('µ.config.navProgress = { delay: 300, place: \'bottom\' } : le seuil, et la barre en bas de la page', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: { delay: 300, place: 'bottom' } } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()
    assert.equal(timers.scheduled.get(µ._mjs_navProgressTimer)!.delay, 300)
    timers.fire(µ._mjs_navProgressTimer)

    assert.equal(doc.body.children[0].getAttribute('data-place'), 'bottom')
  })
})

describe('barre de navigation — navigation plus rapide que le seuil', function () {
  it('le timer est annulé avant d\'avoir sonné : AUCUN élément n\'apparaît jamais', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()
    assert.equal(timers.scheduled.size, 1)
    µ._mjs_navProgressStop() // navigation terminée AVANT que le seuil ne sonne

    assert.equal(timers.scheduled.size, 0, 'le timer est annulé, pas seulement ignoré')
    assert.equal(µ._mjs_navProgressTimer, null)
    assert.equal(µ._mjs_navProgressEl, null)
    assert.equal(doc.body.children.length, 0, 'aucun élément n\'a jamais été inséré')
  })
})

describe('barre de navigation — navigation plus lente que le seuil', function () {
  it('le seuil sonne : élément inséré (classe + attributs), retiré à la fin de la navigation', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()
    timers.fire(µ._mjs_navProgressTimer) // le seuil sonne : la navigation traîne encore

    assert.equal(doc.body.children.length, 1)
    const el = doc.body.children[0]
    assert.equal(el.tag, 'div')
    assert.equal(el.className, 'mjs-nav-progress', 'la classe SEULE — aucun style posé en JS')
    assert.equal(el.getAttribute('role'), 'progressbar')
    assert.equal(el.getAttribute('aria-hidden'), 'true')
    assert.equal(el.getAttribute('data-place'), null, 'en haut par défaut : pas d\'attribut')
    assert.equal(µ._mjs_navProgressEl, el)

    µ._mjs_navProgressStop() // fin de la navigation (succès, ici)

    assert.equal(doc.body.children.length, 0, 'retiré à la fin')
    assert.equal(µ._mjs_navProgressEl, null)
    assert.equal(µ._mjs_navProgressTimer, null)
  })

  it('le trait de lumière : une feuille adoptée UNE fois, à la première barre, sélecteurs sans poids, réglée par variables', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = {}
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn, FakeSheet)
    assert.equal(doc.adoptedStyleSheets.length, 0, 'rien tant qu\'aucune barre ne s\'affiche')

    µ._mjs_navProgressStart()
    timers.fire(µ._mjs_navProgressTimer)
    µ._mjs_navProgressStop()
    µ._mjs_navProgressStart()
    timers.fire(µ._mjs_navProgressTimer)

    assert.equal(doc.adoptedStyleSheets.length, 1, 'adoptée une seule fois')
    const css = doc.adoptedStyleSheets[0].css
    assert.match(css, /:where\(\.mjs-nav-progress\)\{/, 'une règle de l\'appli sur .mjs-nav-progress l\'emporte')
    for (const v of ['color', 'height', 'speed', 'zindex']) assert.match(css, new RegExp(`--mjs-nav-progress-${v}`), v)
    assert.match(css, /data-place="bottom"/)
    assert.match(css, /prefers-reduced-motion/)
    assert.equal(doc.adoptedStyleSheets[0]._mjs_keep, true)
  })

  it('échec réseau / abandon : même µ._mjs_navProgressStop, l\'élément est retiré tout autant', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()
    timers.fire(µ._mjs_navProgressTimer)
    assert.equal(doc.body.children.length, 1)

    µ._mjs_navProgressStop() // échec/abandon/repli natif : TOUJOURS le même helper

    assert.equal(doc.body.children.length, 0)
  })

  it('µ._mjs_navProgressStop appelé DEUX FOIS (defensif) : pas de crash, idempotent', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart()
    timers.fire(µ._mjs_navProgressTimer)

    assert.doesNotThrow(() => { µ._mjs_navProgressStop(); µ._mjs_navProgressStop() })
    assert.equal(doc.body.children.length, 0)
  })
})

describe('barre de navigation — deux navigations enchaînées', function () {
  it('un 2e µ._mjs_navProgressStart pendant que le 1er est encore en vol (timer OU élément) : jamais empilé', function () {
    const timers = fakeTimers()
    const doc = makeDoc()
    const µ: any = { config: { navProgress: true } }
    installProgress(µ, doc, timers.setTimeoutFn, timers.clearTimeoutFn)

    µ._mjs_navProgressStart() // nav 1
    const firstTimerId = µ._mjs_navProgressTimer
    µ._mjs_navProgressStart() // nav 2 démarre avant la fin de la 1re (ex. la 1re est abandonnée en vol)

    assert.equal(µ._mjs_navProgressTimer, firstTimerId, 'le 2e appel ne réarme PAS un second timer')
    assert.equal(timers.scheduled.size, 1, 'un seul timer en attente')

    timers.fire(firstTimerId)
    assert.equal(doc.body.children.length, 1, 'un seul élément inséré')
    const el = doc.body.children[0]

    µ._mjs_navProgressStart() // nav 3 démarre alors que l'élément est déjà affiché
    assert.equal(doc.body.children.length, 1, 'toujours un seul élément — pas empilé')
    assert.equal(µ._mjs_navProgressEl, el, 'même élément, pas un doublon')

    µ._mjs_navProgressStop() // fin de la DERNIÈRE navigation en vol
    assert.equal(doc.body.children.length, 0)
  })
})

describe('barre de navigation — le routeur', function () {
  // le routeur réel (et ce qu'il appelle) dans une fenêtre happy-dom
  function charger(win: any, avecAutoloader = false) {
    const init = lire('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')
    const src  = `${init}\n${lire('mjs_page_cache.ts')}\n${NAV_SRC}\n${lire('mjs_router.ts')}\n${avecAutoloader ? lire('mjs_autoloader.ts') : ''}\nreturn µ;`
    return new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'CustomEvent', src)(win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, win.CustomEvent)
  }
  // un composant routé : une vue, deux routes
  function routeur(µ: any, document: any) {
    const comp: any = document.createElement('div')
    const view: any = document.createElement('metamjs-view')
    view.id = 'main'
    comp._shadow = comp
    comp.appendChild(view)
    comp.routes = { main: { '/a': 'page-a', '/b': 'page-b' } }
    document.body.appendChild(comp)
    µ.Router._mjs_awareComponents = [comp]
    return comp
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const barre = (document: any) => document.body.querySelector('.mjs-nav-progress')

  it('une page dont le code n\'est pas arrivé : la barre paraît après le seuil, part quand le composant est défini', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win)
    µ.log = () => {}
    µ.config.navProgress = 20
    routeur(µ, win.document)

    µ.Router.navigate('#/a')
    await pause(60)
    assert.ok(barre(win.document), 'la barre pendant que <mjs-page-a> attend son code')

    win.customElements.define('mjs-page-a', class extends win.HTMLElement {})
    await pause(20)
    assertAbsent(barre(win.document), 'partie avec l\'arrivée du composant')
    win.close()
  })

  it('une page déjà chargée : rien à l\'écran', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win)
    µ.log = () => {}
    µ.config.navProgress = 20
    win.customElements.define('mjs-page-b', class extends win.HTMLElement {})
    routeur(µ, win.document)

    µ.Router.navigate('#/b')
    await pause(60)
    assertAbsent(barre(win.document))
    assert.equal(µ._mjs_navProgressTimer, null, 'le seuil annulé tout de suite')
    win.close()
  })

  it('µ.config.navProgress = false : le routeur ne pose rien', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win)
    µ.log = () => {}
    µ.config.navProgress = false
    routeur(µ, win.document)

    µ.Router.navigate('#/a')
    await pause(40)
    assertAbsent(barre(win.document))
    win.close()
  })

  it('un composant qui n\'arrive jamais (absent du manifeste) : l\'autoloader renonce, la barre part', async () => {
    const win: any = new Window({ url: 'http://localhost/#/' })
    const µ = charger(win, true)
    µ.log = () => {}
    µ.error = () => {}
    µ.config.navProgress = 20
    µ.paths = {}
    routeur(µ, win.document)

    µ.Router.navigate('#/a')
    await pause(60)
    assert.ok(barre(win.document))
    await µ.Autoloader.load('mjs-page-a')
    assertAbsent(barre(win.document))
    win.close()
  })
})
