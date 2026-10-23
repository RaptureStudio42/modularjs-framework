// une trace du routeur coupée par le niveau de console ne coûte rien
//
// le texte d'une trace vient de la table des messages (µ._mjs_txt). en production, ce tirage inscrit le
// texte court dans une table d'attente et pose deux écouteurs (error, unhandledrejection) : il ne sert
// que si la trace s'écrit. aux niveaux 'warn' (défaut de production), 'error' et 'silent', µ.log
// n'écrit rien : aucun appel à µ._mjs_txt, aucun écouteur, aucune entrée d'attente, aucune requête.
// au niveau 'log', ou sous µ.debug en développement, les traces sortent comme avant.
//
// méthode : le cœur (mjs_init.ts), le cache de pages et le routeur sont chargés dans une même fonction,
// dans une fenêtre happy-dom ; µ._mjs_txt et window.addEventListener sont espionnés

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { RUNTIME_LABELS, runtimeLabelsFor } from '../src/runtime-labels.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const read        = (name: string) => readFileSync(join(RUNTIME_DIR, name), 'utf-8')
const SOURCE      = `${read('mjs_init.ts').replace(/export\s*\{[^}]*\}/, '')}\n${read('mjs_page_cache.ts')}\n${read('mjs_router.ts')}\nreturn µ;`

interface Page {
  µ: any
  win: any
  Router: any
  written: string[]
  warned: string[]
  keys: string[]
  listeners: string[]
  requests: string[]
  walk(): void
  silentMiss(): void
}

// une page : le cœur et le routeur dans une fenêtre, console et réseau simulés, appels à µ._mjs_txt et écouteurs relevés
function page(opts: { prod?: boolean, level?: string, debug?: boolean } = {}): Page {
  const win: any = new Window({ url: 'http://localhost/#/a' })
  win.document.documentElement.setAttribute('lang', 'en')
  const written: string[]   = []
  const warned: string[]    = []
  const keys: string[]      = []
  const listeners: string[] = []
  const requests: string[]  = []
  const fakeConsole         = { log: (...a: any[]) => { written.push(a.map(String).join(' ')) }, warn: (...a: any[]) => { warned.push(a.map(String).join(' ')) }, error() {} }
  const fakeFetch           = (url: string) => {
    requests.push(url)
    return Promise.resolve({ ok: true, json: () => Promise.resolve((RUNTIME_LABELS as any)[url.includes('/en') ? 'en' : 'fr'].err) })
  }
  const addListener = win.addEventListener.bind(win)
  win.addEventListener = (type: string, ...rest: any[]) => {
    if (type === 'error' || type === 'unhandledrejection') listeners.push(type)
    return addListener(type, ...rest)
  }
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', 'fetch', 'console', 'CustomEvent', SOURCE)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet, fakeFetch, fakeConsole, win.CustomEvent,
  )
  µ._runtimeLabelsLang = 'fr'
  µ._runtimeLabels     = opts.prod ? runtimeLabelsFor(true) : RUNTIME_LABELS
  if (opts.prod) µ._msgUrls = { fr: '/fr.json', en: '/en.json' }
  if (opts.level) µ._logLevel = opts.level
  if (opts.debug) µ.debug = true
  µ.config = { routeNotFound: 'warn' }
  const txt = µ._mjs_txt
  µ._mjs_txt = function(key: string, ...rest: any[]) {
    keys.push(key)
    return txt.call(this, key, ...rest)
  }

  // un composant routé : deux pages sur la vue « main »
  const doc: any  = win.document
  const comp: any = doc.createElement('mjs-app')
  const view: any = doc.createElement('metamjs-view')
  view.id      = 'main'
  comp._shadow = comp
  comp.routes  = { main: { '/a': 'page-a', '/b': 'page-b' } }
  comp.appendChild(view)
  doc.body.appendChild(comp)

  // les traces des deux permutations sous transition : une API de transition simulée, et le vainqueur de la cascade imposé
  const Router: any = µ.Router
  const swap = (winner: any, curtain: boolean) => {
    Router._mjs_vtResolveNavigation = () => winner
    µ._mjs_vtCurtainRun = curtain ? () => true : undefined
  }
  doc.startViewTransition = (callback: () => void) => { callback(); return { finished: Promise.resolve(), ready: Promise.resolve() } }

  return {
    µ, win, Router, written, warned, keys, listeners, requests,
    walk() {
      Router.register(comp)
      Router.navigate('#/b', true)
      Router.navigate('#/a', true)
      Router.navigate('#/zzz', true)
      Router._mjs_injectViewsForComponent({ tagName: 'MJS-VIDE' }, '/a')
      swap({ value: 'cube', priority: 3 }, true)
      Router.navigate('#/b', true)
      swap({ value: 'zoom', priority: 3 }, false)
      Router.navigate('#/a', true)
      swap({ value: true, priority: 2 }, false)
      Router.navigate('#/b', true)
    },
    // la trace de « aucune route » du mode silent : le seul site que le parcours ci-dessus n'atteint pas
    silentMiss() {
      µ.config = { routeNotFound: 'silent' }
      Router._mjs_checkNoMatch('/zzz')
    },
  }
}

const wait = () => new Promise((r) => setTimeout(r, 30))

// une erreur non attrapée qui porte le texte court d'une trace du routeur (celui que la table d'attente retiendrait)
const uncaught = (p: Page) => {
  const ev: any = new p.win.Event('error')
  ev.message    = 'routerLogRegister {"tag":"mjs-app"}'
  p.win.dispatchEvent(ev)
}

for (const level of ['warn', 'error', 'silent']) {
  describe(`routeur — traces en production, niveau ${level}`, () => {
    it('le parcours complet ne tire aucun texte de la table : pas d\'appel à µ._mjs_txt, pas d\'écouteur, aucune requête, rien d\'écrit', async () => {
      const p = page({ prod: true, level })
      p.walk()
      await wait()
      assert.deepEqual(p.keys, [])
      assert.deepEqual(p.listeners, [])
      assert.deepEqual(p.requests, [])
      assert.deepEqual(p.written, [])
    })

    it('la trace « aucune route » du mode silent non plus', async () => {
      const p = page({ prod: true, level })
      p.walk()
      p.silentMiss()
      await wait()
      assert.deepEqual(p.keys, [])
      assert.deepEqual(p.listeners, [])
      assert.deepEqual(p.requests, [])
    })

    it('la table d\'attente est vide : une erreur qui porte le texte court d\'une trace ne demande aucun fichier', async () => {
      const p = page({ prod: true, level })
      p.walk()
      uncaught(p)
      await wait()
      assert.deepEqual(p.requests, [])
    })
  })
}

describe('routeur — traces en production, niveau log', () => {
  it('le texte vient de la table : µ._mjs_txt est appelé, les deux écouteurs sont posés, un seul fichier demandé', async () => {
    const p = page({ prod: true, level: 'log' })
    p.walk()
    p.silentMiss()
    await wait()
    assert.ok(p.keys.length > 0)
    assert.ok(p.keys.includes('routerNoRouteLog'))
    assert.deepEqual(p.listeners, ['error', 'unhandledrejection'])
    assert.deepEqual(p.requests, ['/en.json'])
  })
})

describe('routeur — traces en production, les autres messages ne sont pas coupés', () => {
  it('niveau warn : « aucune route » en mode warn s\'écrit et demande le fichier', async () => {
    const p = page({ prod: true, level: 'warn' })
    p.walk()
    p.Router._mjs_checkNoMatch('/zzz')
    await wait()
    assert.equal(p.warned.length > 0, true)
    assert.deepEqual(p.requests, ['/en.json'])
    assert.ok(p.keys.includes('routerNoRoute'))
  })
})

describe('routeur — traces en développement', () => {
  it('niveau log : les traces sortent, texte tiré de la table', () => {
    const p = page({ level: 'log' })
    p.walk()
    p.silentMiss()
    assert.ok(p.written.length >= 30)
    assert.equal(p.written[p.written.length - 1], '   ↳ 🚫 [Router] No route for \'/zzz\'.')
    assert.ok(p.keys.length > 0)
    assert.deepEqual(p.requests, [])
  })

  it('niveau warn : aucune trace écrite, aucun texte tiré de la table', () => {
    const p = page({ level: 'warn' })
    p.walk()
    p.silentMiss()
    assert.deepEqual(p.keys, [])
    assert.deepEqual(p.written, [])
  })

  it('niveau warn sous µ.debug : les traces sortent, identiques à celles du niveau log', () => {
    const reference = page({ level: 'log' })
    reference.walk()
    reference.silentMiss()
    const p = page({ level: 'warn', debug: true })
    p.walk()
    p.silentMiss()
    assert.ok(reference.written.length > 0)
    assert.deepEqual(p.written, reference.written)
  })

  it('une trace passe par le µ.log du moment : un µ.log remplacé après le chargement reçoit les traces', () => {
    const reference = page({ level: 'log' })
    reference.walk()
    const p = page({ level: 'log' })
    const received: string[] = []
    p.µ.log = (...a: any[]) => { received.push(a.map(String).join(' ')) }
    p.walk()
    assert.ok(reference.written.length > 0)
    assert.deepEqual(received, reference.written)
    assert.deepEqual(p.written, [])
  })
})
