// @flip (mjs_flip.ts) : chaque ligne d'une liste réordonnée glisse par animate(). Le navigateur refuse (TypeError) une courbe
// qui n'est pas une valeur CSS (`@flip={easing: 'elasticOut'}`, le nom d'une courbe de µ.easing) et une durée négative (liaison
// calculée) ; l'erreur, levée dans la micro-tâche du glissement, arrêtait toute la liste et partait en rejet non rattrapé.
// Désormais la ligne fautive glisse avec la courbe par défaut (la durée par défaut pour une durée négative) et les suivantes
// glissent aussi. Le refus réel de Chromium est vérifié par modale-rideaux-fantome-et-flip-browser.test.ts ; ici animate()
// le reproduit, sous happy-dom (même assemblage que flip-newrect-before-cancel.test.ts).

import assert from 'node:assert/strict'
;(globalThis as any).µ = (globalThis as any).µ || {}
const µ: any = (globalThis as any).µ
µ.debug = µ.debug ?? false
µ.warn = µ.warn || (() => {})
µ.log = µ.log || (() => {})
µ.error = µ.error || (() => {})
µ.Ticker = µ.Ticker || { add() {} }
µ._mjs_interpolatorSet = µ._mjs_interpolatorSet || new WeakSet()
const { Window } = await import('happy-dom')
const win: any = new Window({ url: 'http://localhost/' })
const g: any = globalThis
g.window ??= win
g.document ??= win.document
g.HTMLElement ??= win.HTMLElement
g.CSSStyleSheet ??= win.CSSStyleSheet
g.customElements ??= win.customElements
g.Node ??= win.Node
g.Event ??= win.Event
g.CustomEvent ??= win.CustomEvent
await import('../src/runtime/mjs_easing.js')
await import('../src/runtime/mjs_init.js')
await import('../src/runtime/mjs_element.js')
await import('../src/runtime/mjs_for.js')
await import('../src/runtime/mjs_flip.js')

// sous-classe dédiée : `_mjs_hasFlip` n'est jamais posé sur µ.Element, partagé par tout le processus
class ListeAvecFlip extends µ.Element {}
;(ListeAvecFlip as any)._mjs_hasFlip = true

const COURBE_CSS = /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|(cubic-bezier|steps|linear)\(.*\))$/

// ligne factice qui se déplace de 100 px vers la droite au réordonnancement ; son animate() refuse ce que refuse le navigateur
function ligne(attrs: Record<string, string>): { node: any; appels: any[]; bouger: () => void } {
  const appels: any[] = []
  const parent = {}
  let left = 0
  const node: any = {
    nodeType: 1,
    parentNode: parent,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k: string) => k in attrs,
    setAttribute: (k: string, v: string) => { attrs[k] = v },
    querySelectorAll: () => [],
    getAnimations: () => [],
    getBoundingClientRect: () => ({ left, top: 0 }),
    animate: (keyframes: any, opts: any) => {
      if (!(opts.duration >= 0)) { throw new TypeError('duration must be non-negative or auto') }
      if (!COURBE_CSS.test(opts.easing)) { throw new TypeError(`'${opts.easing}' is not a valid value for easing`) }
      appels.push(opts)
      return { id: opts.id }
    },
  }
  return { node, appels, bouger: () => { left += 100 } }
}

async function reordonner(lignes: Array<{ node: any; bouger: () => void }>): Promise<string[]> {
  const rejets: string[] = []
  const surRejet = (e: any) => { rejets.push(String(e && e.message)) }
  process.on('unhandledRejection', surRejet)
  try {
    const cache = () => new Map(lignes.map((l, i) => [`k${i}`, { nodes: [l.node] }]))
    const liste: any = Object.assign(Object.create(ListeAvecFlip.prototype), { _mjs_list_cache: { c: cache() } })
    liste._mjs_reconcileList('c', null, null, null, null, () => {}, () => 'k', () => {}, null)
    liste._mjs_list_cache.c = cache()
    lignes.forEach((l) => l.bouger())
    for (let i = 0; i < 4; i++) { await Promise.resolve() }
    await new Promise((r) => setTimeout(r, 10))
  }
  finally {
    process.off('unhandledRejection', surRejet)
  }
  return rejets
}

describe('mjs_flip — une courbe ou une durée refusée par le navigateur n\'arrête pas la liste', function () {
  it('courbe qui n\'est pas CSS : la ligne glisse avec la courbe par défaut, la suivante glisse aussi', async function () {
    const a = ligne({ 'mjs-flip': '300', 'mjs-flip-easing': 'elasticOut' })
    const b = ligne({ 'mjs-flip': '200' })
    const rejets = await reordonner([a, b])
    assert.deepEqual(rejets, [], 'aucun rejet non rattrapé')
    assert.equal(a.appels.length, 1, 'la ligne fautive glisse')
    assert.equal(a.appels[0].easing, 'cubic-bezier(0.25, 1, 0.5, 1)')
    assert.equal(a.appels[0].duration, 300, 'sa durée est gardée')
    assert.equal(b.appels.length, 1, 'la ligne suivante glisse')
  })

  it('durée négative : la ligne glisse avec la durée par défaut, la suivante glisse aussi', async function () {
    const a = ligne({ 'mjs-flip': '-100', 'mjs-flip-easing': 'ease-out' })
    const b = ligne({ 'mjs-flip': '200' })
    const rejets = await reordonner([a, b])
    assert.deepEqual(rejets, [])
    assert.equal(a.appels.length, 1)
    assert.equal(a.appels[0].duration, 200)
    assert.equal(a.appels[0].easing, 'ease-out', 'sa courbe est gardée')
    assert.equal(b.appels.length, 1)
  })
})
