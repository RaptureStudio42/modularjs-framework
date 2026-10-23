// *pixelate — de gros carreaux à l'image nette, par paliers : l'animation (runtime/animations/pixelate.ts) joue
// ses paliers sur un filtre SVG propre à la balise, fait comme celui de *filter(pixelate) (mêmes primitives,
// vérifiées contre lui, dans Chromium comme dans WebKit), ne laisse rien derrière elle (ni filtre, ni <svg>,
// ni attribut style) et ne porte rien sur la balise qui attend son tour (ni <svg>, ni filtre, ni observateur)
// logique dans happy-dom ; ce qu'on voit, dans tests/effets-transitions-navigateur-browser.test.ts

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'

const HERE       = dirname(fileURLToPath(import.meta.url))
const RUNTIME    = join(HERE, '..', 'src', 'runtime')
const ENGINE     = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8')
const FILTER_SRC = readFileSync(join(RUNTIME, 'mjs_fx_filter.ts'), 'utf-8')
const TOOLS      = ['mjs_fx_toolsvg.ts', 'mjs_fx_toolsmooth.ts', 'mjs_fx_toolwebkit.ts', 'mjs_fx_toolcolor.ts'].map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')  //les outils du cœur que *filter appelle, embarqués avec lui par le build
const PIXELATE   = readFileSync(join(RUNTIME, 'animations', 'pixelate.ts'), 'utf-8')
const IRIS       = readFileSync(join(RUNTIME, 'animations', 'iris.ts'), 'utf-8')
const BRIDGE     = readFileSync(join(RUNTIME, 'mjs_fx_transition.ts'), 'utf-8')
const VENDOR     = { chromium: 'Google Inc.', webkit: 'Apple Computer, Inc.' }

// un navigateur de poche : une fenêtre happy-dom où le moteur des effets, *filter et les animations sont chargés,
// `vendor` dit le moteur (WebKit construit son filtre autrement)
function world(vendor: string = VENDOR.chromium) {
  const window: any = new Window({ url: 'http://localhost/' })
  Object.defineProperty(window.navigator, 'vendor', { value: vendor })
  // l'observateur de taille : ses rappels sont gardés, le test les appelle à la main
  window.__ro = []
  window.ResizeObserver = function (this: any, callback: any) {
    const o = { callback: callback, done: false }
    window.__ro.push(o)
    this.observe = () => {}
    this.disconnect = () => { o.done = true }
  }
  window.eval(`
    var µ = { warn: function(m) { (globalThis.__warnings = globalThis.__warnings || []).push(String(m)); }, _mjs_msg: function(k, v, fr) { return fr; }, easing: { resolve: function(e) { return typeof e === 'function' ? e : function(t) { return t; }; } } };
    µ._mjs_dom = new Proxy({}, { get: function(_, n) { return function(el) { return el[n].apply(el, Array.prototype.slice.call(arguments, 1)); }; } });
    µ._mjs_animate = function(el, frames, opts) { return el.animate(frames, opts); };
    ${ENGINE}
    ${TOOLS}
    ${FILTER_SRC}
    ${BRIDGE}
    µ.anim = {};
    µ.anim.pixelate = ${PIXELATE.trim().replace(/;\s*$/, '')};
    µ.anim.iris = ${IRIS.trim().replace(/;\s*$/, '')};
  `)
  const doc = window.document
  // la balise, avec sa boîte (happy-dom ne met rien en page)
  const makeNode = (w: number, h: number, tag = 'div') => {
    const el = doc.createElement(tag)
    Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
    Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
    el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h })
    doc.body.appendChild(el)
    return el
  }
  return {
    window, doc, makeNode,
    µ: window.µ,
    warnings: (): string[] => window.__warnings ?? [],
    holders: () => doc.querySelectorAll('svg'),
    primitives: () => doc.querySelector('filter')?.innerHTML ?? null,
    created: (): number => window.__ro.length,
    live: (): number => window.__ro.filter((o: any) => !o.done).length
  }
}

// le rayon de feMorphology et le côté du carreau, lus dans les primitives du filtre posé
const radius = (prims: string | null) => Number(/feMorphology operator="dilate" radius="(\d+)"/.exec(prims ?? '')?.[1])
const tile   = (prims: string | null) => Number(/<feComposite width="(\d+)" height="\d+"\/?>/.exec(prims ?? '')?.[1])

describe('*pixelate — l\'animation', function () {
  it('de la mosaïque à l\'image nette : un filtre propre à la balise à chaque palier, aucun filtre à t = 1', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    assert.equal(typeof cfg.tick, 'function')
    assert.equal(w.holders().length, 0, 'rien avant le premier palier')
    cfg.tick(0.001)
    assert.equal(w.holders().length, 1)
    assert.match(el.style.getPropertyValue('filter'), /^url\(["']?#mjs-px-\d+["']?\)$/)
    assert.equal(tile(w.primitives()), 48, 'le plus gros carreau d\'abord : size')
    cfg.tick(1)
    assert.equal(w.holders().length, 0, 'le <svg> est retiré')
    assert.equal(el.style.getPropertyValue('filter'), '')
    assert.equal(el.hasAttribute('style'), false, 'la balise qui n\'avait pas d\'attribut style n\'en garde pas un vide')
  })

  it('les paliers : steps carreaux de plus en plus fins (progression géométrique, 2 px au plus fin), puis l\'image nette', function () {
    const w    = world()
    const el   = w.makeNode(300, 200)
    const cfg  = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    const seen: number[] = []
    for (let k = 0; k < 8; k++) {
      cfg.tick((k + 0.5) / 8)
      seen.push(tile(w.primitives()))
      assert.equal(radius(w.primitives()), Math.floor(seen[k] / 2), `palier ${k} : le rayon de dilatation est la moitié du carreau`)
    }
    assert.deepEqual(seen, [48, 30, 18, 11, 7, 4, 3, 2])
    // un palier ne change rien tant que t reste dedans
    cfg.tick(0.5 / 8 + 0.01)
    assert.equal(tile(w.primitives()), 48)
    cfg.tick(0.99)
    assert.equal(tile(w.primitives()), 2, 'juste avant la fin : le plus fin')
    cfg.tick(1)
    assert.equal(w.holders().length, 0)
    // d'autres réglages
    const w2 = world()
    const c2 = w2.µ.anim.pixelate({ size: 64, steps: 6 }).intro(w2.makeNode(300, 200))
    const s2: number[] = []
    for (let k = 0; k < 6; k++) {
      c2.tick((k + 0.5) / 6)
      s2.push(tile(w2.primitives()))
    }
    assert.deepEqual(s2, [64, 32, 16, 8, 4, 2])
  })

  it('steps est un plafond : les paliers sont tous différents et se partagent le temps également (deux carreaux voisins de même taille n\'en font qu\'un)', function () {
    const N = 4000
    const run = (size: number, steps: number) => {
      const w   = world()
      const cfg = w.µ.anim.pixelate({ size, steps }).intro(w.makeNode(1000, 600))
      const levels: number[] = []
      const slots: number[]  = []
      for (let i = 1; i < N; i++) {
        cfg.tick(i / N)
        const px = tile(w.primitives())
        if (levels[levels.length - 1] !== px) {
          levels.push(px)
          slots.push(0)
        }
        slots[slots.length - 1]++
      }
      return { levels, slots }
    }
    for (const [size, steps] of [[48, 40], [8, 40], [2, 40], [48, 8]]) {
      const { levels, slots } = run(size, steps)
      const what = `size ${size}, steps ${steps}`
      assert.equal(levels[0], size, `${what} : le plus gros d'abord`)
      assert.equal(levels[levels.length - 1], 2, `${what} : 2 px au plus fin`)
      assert.ok(levels.length <= steps, `${what} : au plus ${steps} paliers (${levels.length})`)
      levels.forEach((v, i) => { if (i > 0) assert.ok(v < levels[i - 1], `${what} : des paliers tous différents (${levels.join(' ')})`) })
      slots.forEach((n, i) => assert.ok(Math.abs(n - N / levels.length) <= 2, `${what} : le palier ${i} (${levels[i]} px) dure ${n} échantillons sur ${N}, pas ${(N / levels.length).toFixed(1)}`))
    }
    assert.deepEqual(run(2, 40).levels, [2], 'size 2 : un seul palier')
  })

  it('un seul filtre pour tout le jeu : il garde son nœud et son id, seules ses primitives sont réécrites', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    cfg.tick(0.001)
    const filter = w.doc.querySelector('filter')
    const id     = filter.getAttribute('id')
    const before = filter.innerHTML
    cfg.tick(0.5)
    assert.ok(w.doc.querySelector('filter') === filter, 'le même nœud')
    assert.equal(filter.getAttribute('id'), id)
    assert.notEqual(filter.innerHTML, before, 'le carreau a changé')
    assert.equal(w.holders().length, 1)
    assert.equal(filter.getAttribute('x'), '0')
    assert.equal(filter.getAttribute('width'), '1')
    assert.equal(filter.getAttribute('primitiveUnits'), 'userSpaceOnUse')
    assert.equal(filter.getAttribute('color-interpolation-filters'), 'sRGB')
  })

  it('la balise qui attend son tour (t = 0) ne porte ni <svg>, ni filtre, ni observateur : elle est cachée et rien de plus', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    el.style.setProperty('color', 'red')
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    cfg.tick(0)
    assert.equal(w.holders().length, 0, 'aucun <svg>')
    assert.equal(w.created(), 0, 'aucun observateur créé')
    assert.equal(el.style.getPropertyValue('filter'), '', 'aucun filtre')
    assert.equal(el.style.getPropertyValue('visibility'), 'hidden', 'cachée : l\'image nette ne se voit pas avant le premier palier')
    // le jeu commence : la mosaïque naît, la balise se montre
    cfg.tick(0.01)
    assert.equal(w.holders().length, 1)
    assert.equal(w.live(), 1)
    assert.equal(el.style.getPropertyValue('visibility'), '')
    assert.equal(tile(w.primitives()), 48)
    // de nouveau au départ (le défilement remonte) : tout repart, la balise attend cachée
    cfg.tick(0)
    assert.equal(w.holders().length, 0)
    assert.equal(w.live(), 0, 'l\'observateur est rendu')
    assert.equal(el.style.getPropertyValue('filter'), '')
    assert.equal(el.style.getPropertyValue('visibility'), 'hidden')
    // passée (avancée 1) : l'image nette, rien d'autre
    cfg.tick(1)
    assert.equal(w.holders().length, 0)
    assert.equal(el.style.getPropertyValue('visibility'), '')
    assert.equal(el.style.getPropertyValue('color'), 'red')
  })

  it('l\'effet retiré pendant l\'attente : la balise est rendue telle qu\'elle était, sa visibilité d\'auteur comprise', function () {
    const w  = world()
    const el = w.makeNode(300, 200)
    const c1 = w.µ.anim.pixelate({}).intro(el)
    c1.tick(0)
    assert.equal(el.style.getPropertyValue('visibility'), 'hidden')
    c1.cleanup()
    assert.equal(el.hasAttribute('style'), false, 'ni visibilité, ni attribut style')
    const sure = w.makeNode(300, 200)
    sure.style.setProperty('visibility', 'visible')
    const c2 = w.µ.anim.pixelate({}).intro(sure)
    c2.tick(0)
    assert.equal(sure.style.getPropertyValue('visibility'), 'hidden')
    c2.tick(0.2)
    assert.equal(sure.style.getPropertyValue('visibility'), 'visible', 'la visibilité écrite par l\'auteur est rendue dès le premier palier')
    c2.tick(0)
    c2.cleanup()
    assert.equal(sure.style.getPropertyValue('visibility'), 'visible')
    assert.equal(w.holders().length, 0)
  })

  it('la sortie : de net au plus gros carreau, puis la balise attend cachée jusqu\'au retrait (le crochet de libération la rend)', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    cfg.tick(1)
    assert.equal(w.holders().length, 0)
    cfg.tick(0.6)
    cfg.tick(0.3)
    cfg.tick(0.01)
    assert.equal(tile(w.primitives()), 48, 'dernier palier de la sortie : la mosaïque la plus grosse')
    assert.equal(typeof el._mjs_pendingFillRelease, 'function', 'la balise est retirée par un bloc : il appelle ce crochet')
    cfg.tick(0)
    assert.equal(w.holders().length, 0, 'fin de sortie : le <svg> est rendu')
    assert.equal(el.style.getPropertyValue('filter'), '')
    assert.equal(el.style.getPropertyValue('visibility'), 'hidden', 'cachée jusqu\'au retrait')
    assert.equal(typeof el._mjs_pendingFillRelease, 'function')
    el._mjs_pendingFillRelease()
    assert.equal(el.style.getPropertyValue('visibility'), '', 'sortie ressuscitée : la balise se montre de nouveau')
    assert.equal(el.hasAttribute('style'), false)
    assert.equal(el._mjs_pendingFillRelease ?? null, null, 'le crochet est rendu')
    // une balise retirée du DOM pendant que la boucle tourne encore : plus rien n'est posé
    cfg.tick(0.5)
    assert.equal(w.holders().length, 1)
    el._mjs_pendingFillRelease()
    el.remove()
    cfg.tick(0.2)
    cfg.tick(0.1)
    assert.equal(w.holders().length, 0, 'jamais de filtre posé pour une balise hors de la page')
  })

  it('une balise pas encore dans la page ne montre rien, et le palier se pose dès qu\'elle y est (même instant, même palier)', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    el.remove()
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    cfg.tick(0.3)
    assert.equal(w.holders().length, 0, 'hors de la page : aucun filtre posé')
    w.doc.body.appendChild(el)
    cfg.tick(0.3)
    assert.equal(w.holders().length, 1, 'dans la page : le palier se pose')
    assert.equal(tile(w.primitives()), 18, 't = 0,3 sur huit paliers : le troisième')
    cfg.tick(Number.NaN)
    assert.equal(w.holders().length, 0, 'un instant illisible vaut le départ : la balise attend')
    assert.equal(el.style.getPropertyValue('visibility'), 'hidden')
  })

  it('l\'effet arrêté en plein jeu (cleanup) : la balise retrouve son style, le <svg> part', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    el.style.setProperty('filter', 'blur(2px)')
    el.style.setProperty('color', 'red')
    const cfg = w.µ.anim.pixelate({}).intro(el)
    cfg.tick(0.001)
    assert.match(el.style.getPropertyValue('filter'), /url\(/)
    cfg.cleanup()
    assert.equal(w.holders().length, 0)
    assert.equal(el.style.getPropertyValue('filter'), 'blur(2px)', 'le filtre d\'avant est rendu')
    assert.equal(el.style.getPropertyValue('color'), 'red')
    // rejouable ensuite
    cfg.tick(0.2)
    assert.equal(w.holders().length, 1)
    cfg.tick(1)
    assert.equal(el.style.getPropertyValue('filter'), 'blur(2px)')
    assert.equal(w.holders().length, 0)
  })

  it('une entrée coupée par la sortie (deux poses sur la même balise) : un seul filtre à la fois, jamais deux empilés', function () {
    const w     = world()
    const el    = w.makeNode(300, 200)
    const enter = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    const leave = w.µ.anim.pixelate({ size: 48, steps: 8 }).outro(el)
    enter.tick(0.5)
    const first = w.doc.querySelector('filter').getAttribute('id')
    assert.equal(w.holders().length, 1)
    // la sortie reprend là où l'entrée s'est arrêtée : le filtre de l'entrée est rendu avant que le sien ne soit posé
    leave.tick(0.5)
    assert.equal(w.holders().length, 1, 'un seul <svg> : celui de la sortie')
    assert.notEqual(w.doc.querySelector('filter').getAttribute('id'), first)
    assert.equal((el.style.getPropertyValue('filter').match(/url\(/g) ?? []).length, 1, 'jamais deux filtres empilés')
    assert.equal(w.live(), 1, 'un seul observateur de taille')
    leave.tick(0)
    assert.equal(w.holders().length, 0)
    el._mjs_pendingFillRelease()
    assert.equal(el.hasAttribute('style'), false, 'la balise est rendue telle qu\'elle était')
    // la sortie coupée à son tour par une entrée : même chose dans l'autre sens
    leave.tick(0.4)
    enter.tick(0.4)
    assert.equal(w.holders().length, 1)
    enter.tick(1)
    assert.equal(w.holders().length, 0)
    assert.equal(el.hasAttribute('style'), false)
  })

  it('une entrée coupée par une autre transition (qui a pris le crochet de libération), puis la balise retirée : l\'observateur de taille rend le <svg>', function () {
    const w   = world()
    const el  = w.makeNode(300, 200)
    const cfg = w.µ.anim.pixelate({ size: 48, steps: 8 }).intro(el)
    cfg.tick(0.5)
    assert.equal(w.holders().length, 1)
    el._mjs_pendingFillRelease = () => {}
    // la balise est encore dans la page : l'observateur ne touche à rien
    w.window.__ro[0].callback()
    assert.equal(w.holders().length, 1)
    el.remove()
    w.window.__ro[0].callback()
    assert.equal(w.holders().length, 0, 'le <svg> part avec la balise')
    assert.equal(w.live(), 0, 'l\'observateur aussi')
    assert.equal(el.style.getPropertyValue('filter'), '')
  })

  it('un carreau plus grand que deux fois le petit côté de la balise laisserait son échantillon hors d\'elle : il est ramené', function () {
    const w   = world()
    const cfg = w.µ.anim.pixelate({ size: 400, steps: 4 }).intro(w.makeNode(20, 20))
    cfg.tick(0.001)
    assert.equal(tile(w.primitives()), 39)
    assert.equal(radius(w.primitives()), 19)
    const w2   = world()
    const cfg2 = w2.µ.anim.pixelate({ size: 400, steps: 4 }).intro(w2.makeNode(600, 300))
    cfg2.tick(0.001)
    assert.equal(tile(w2.primitives()), 400, 'une grande balise garde le carreau demandé')
  })

  it('la taille de la balise change pendant le jeu : le filtre est refait à la nouvelle boîte (un observateur, rendu à la fin)', function () {
    const w   = world()
    const el  = w.makeNode(100, 60)
    const cfg = w.µ.anim.pixelate({ size: 8, steps: 2 }).intro(el)
    cfg.tick(0.001)
    assert.match(w.primitives() ?? '', /fx-ex/, '100 = 12 × 8 + 4 : une bande de bord en largeur')
    assert.equal(w.window.__ro.length, 1, 'un seul observateur de taille')
    // même taille : rien n'est refait
    const filter = w.primitives()
    w.window.__ro[0].callback()
    assert.equal(w.primitives(), filter)
    Object.defineProperty(el, 'offsetWidth', { value: 96, configurable: true })
    w.window.__ro[0].callback()
    assert.doesNotMatch(w.primitives() ?? '', /fx-ex/, '96 = 12 × 8 : plus de bande')
    assert.equal(w.window.__ro[0].done, false)
    cfg.tick(1)
    assert.equal(w.window.__ro[0].done, true, 'l\'observateur est rendu avec le filtre')
  })

  it('une balise qui porte déjà un effet à filtre : un avertissement, une fois, qui dit d\'en poser un sur une balise englobante', function () {
    for (const other of ['filter', 'chromatic', 'liquid']) {
      const w   = world()
      const el  = w.makeNode(300, 200)
      el.setAttribute('mjs-fx', other)
      const cfg = w.µ.anim.pixelate({ size: 48, steps: 4 }).intro(el)
      cfg.tick(0.001)
      cfg.tick(0.5)
      cfg.tick(0.8)
      assert.equal(w.warnings().length, 1, `*${other} : un seul avertissement`)
      assert.match(w.warnings()[0], /\*pixelate : la balise porte déjà un autre effet à filtre \(\*filter, \*chromatic ou \*liquid\)/)
      assert.match(w.warnings()[0], /se disputent la propriété CSS filter/)
      assert.match(w.warnings()[0], /balise englobante/)
    }
    const alone = world()
    const el    = alone.makeNode(300, 200)
    alone.µ.anim.pixelate({}).intro(el).tick(0.001)
    assert.equal(alone.warnings().length, 0, 'seule : rien à dire')
  })

  it('réglages d\'avant le jeu : durée 900, courbe ease-out, aucun retard ; l\'entrée et la sortie sont la même paire', function () {
    const w    = world()
    const pair = w.µ.anim.pixelate({})
    assert.equal(pair.intro, pair.outro)
    assert.equal(pair.intro._isCfgFactory, true)
    const cfg = pair.intro(w.makeNode(300, 200))
    assert.equal(cfg.duration, 900)
    assert.equal(cfg.delay, 0)
    assert.equal(typeof cfg.easing, 'function')
    const custom = w.µ.anim.pixelate({ duration: 2000, delay: 100 }).intro(w.makeNode(300, 200))
    assert.equal(custom.duration, 2000)
    assert.equal(custom.delay, 100)
  })

  it('du réglage écrit à l\'écran : les réglages de l\'effet passent par le pont du moteur jusqu\'à l\'animation', function () {
    const w    = world()
    const el   = w.makeNode(300, 200)
    const pair = w.µ._mjs_fxAnim(null, el, 'pixelate', { size: 32, steps: 4, duration: '2s' }, null, null)
    assert.equal(typeof pair.intro, 'function')
    const cfg = pair.intro(el)
    assert.equal(cfg.duration, 2000)
    const seen: number[] = []
    for (let k = 0; k < 4; k++) {
      cfg.tick((k + 0.5) / 4)
      seen.push(tile(w.primitives()))
    }
    assert.deepEqual(seen, [32, 13, 6, 2])
    cfg.tick(1)
    assert.equal(w.holders().length, 0)
    // posée directement, la transition est une définition d'effet comme les autres
    assert.equal(typeof w.µ._mjs_fxDefs.pixelate.setup, 'function')
  })

  it('« réduire les animations » : aucun palier, la balise apparaît — rien n\'est posé, et la paire du cycle de vie se règle tout de suite', async function () {
    const w = world()
    w.µ._mjs_fxCalm = () => true
    const el = w.makeNode(300, 200)
    assert.equal(w.µ._mjs_fxDefs.pixelate.setup(el, { on: 'load' }), null, 'posée directement : rien ne joue')
    assert.equal(w.holders().length, 0)
    assert.equal(el.hasAttribute('style'), false)
    const pair = w.µ._mjs_fxAnim(null, el, 'pixelate', {}, null, null)
    assert.equal(typeof pair.intro, 'function')
    await pair.intro(el)
    await pair.outro(el)
    assert.equal(w.holders().length, 0, 'aucun filtre, ni à l\'entrée ni à la sortie')
    assert.equal(el.hasAttribute('style'), false)
  })

  it('size et steps illisibles : les valeurs par défaut (48, 8) ; un seul palier si steps vaut 1', function () {
    const w   = world()
    const cfg = w.µ.anim.pixelate({ size: 'gros', steps: 'beaucoup' }).intro(w.makeNode(300, 200))
    cfg.tick(0.001)
    assert.equal(tile(w.primitives()), 48)
    cfg.tick(0.99)
    assert.equal(tile(w.primitives()), 2, 'huit paliers : le dernier est le plus fin')
    cfg.tick(1)
    const one = w.µ.anim.pixelate({ size: 30, steps: 1 }).intro(w.makeNode(300, 200))
    one.tick(0.001)
    assert.equal(tile(w.primitives()), 30)
    one.tick(0.99)
    assert.equal(tile(w.primitives()), 30)
    one.tick(1)
    assert.equal(w.holders().length, 0)
  })
})

describe('*pixelate — les mêmes primitives que *filter(pixelate), dans Chromium comme dans WebKit', function () {
  const BOXES: Array<[number, number, number]> = [[100, 60, 7], [100, 60, 8], [64, 64, 8], [50, 33, 5], [301, 199, 24], [97, 61, 12]]

  for (const engine of ['chromium', 'webkit'] as const) {
    it(`${engine} : le filtre de la transition et celui de *filter ont les mêmes primitives, pour chaque boîte et chaque carreau (bandes de bord comprises)`, function () {
      for (const [w, h, size] of BOXES) {
        const m = world(VENDOR[engine])
        // WebKit lit l'encre de la balise : sans moteur de mise en page, rien ne dépasse
        m.doc.createRange = undefined
        const el     = m.makeNode(w, h)
        const stop   = m.µ._mjs_fxDefs.filter.setup(el, { style: 'pixelate', size })
        const filter = m.primitives()
        stop()
        m.doc.querySelectorAll('svg').forEach((s: any) => s.remove())
        assert.ok(filter && filter.length > 100, `${engine} ${w}×${h} carreau ${size} : le filtre de *filter est posé`)
        const cfg = m.µ.anim.pixelate({ size, steps: 1 }).intro(m.makeNode(w, h))
        cfg.tick(0.001)
        assert.equal(m.primitives(), filter, `${engine} ${w}×${h} carreau ${size}`)
      }
    })
  }

  it('WebKit pose l\'échantillon à l\'origine du carreau puis le décale (x/y de sous-région lus en coordonnées de page) ; Chromium le pose au centre', function () {
    const c = world(VENDOR.chromium)
    c.µ.anim.pixelate({ size: 8, steps: 1 }).intro(c.makeNode(64, 64)).tick(0.001)
    assert.match(c.primitives() ?? '', /<feFlood x="4" y="4" width="1" height="1"\/?>/)
    assert.doesNotMatch(c.primitives() ?? '', /<feOffset dx="4"/)
    const k = world(VENDOR.webkit)
    k.doc.createRange = undefined
    k.µ.anim.pixelate({ size: 8, steps: 1 }).intro(k.makeNode(64, 64)).tick(0.001)
    assert.match(k.primitives() ?? '', /<feFlood width="1" height="1"\/?>/)
    assert.match(k.primitives() ?? '', /<feOffset dx="4" dy="4" width="8" height="8"\/?>/)
  })
})

describe('le pont des transitions posées au défilement — les images clés d\'une animation mesurée', function () {
  // une animation web factice : le pont ne lui demande que de se mettre en pause, de se couper et de lire son temps
  const withAnimate = (el: any) => {
    el.animate = () => ({ pause() {}, cancel() {}, currentTime: 0 })
    return el
  }

  it('l\'observateur de taille du pont n\'existe que pour une animation mesurée, et il est rendu au retrait de l\'effet', function () {
    const w = world()
    // un rond sans inclinaison ne dépend pas de la boîte : aucun observateur
    const plain = w.µ._mjs_fxDefs.iris.setup(withAnimate(w.makeNode(300, 200)), { on: 'scroll' })
    assert.equal(typeof plain, 'function')
    assert.equal(w.created(), 0, 'rien à mesurer : aucun observateur')
    plain()
    // un rectangle penché tourne ses points en pixels : ses images clés suivent la boîte
    const tilted = w.µ._mjs_fxDefs.iris.setup(withAnimate(w.makeNode(300, 200)), { on: 'scroll', shape: 'box', angle: -11 })
    assert.equal(typeof tilted, 'function')
    assert.equal(w.created(), 1, 'un observateur de taille')
    assert.equal(w.live(), 1)
    tilted()
    assert.equal(w.live(), 0, 'l\'observateur est rendu au retrait')
  })
})

describe('*pixelate — le catalogue', function () {
  it('une transition du catalogue : size (2 à 400, 48) et steps (2 à 40, 8), les réglages communs des transitions', function () {
    const s = EFFECTS.pixelate.settings
    assert.equal(EFFECTS.pixelate.family, 'transition')
    assert.equal(EFFECTS.pixelate.transition, true)
    assert.equal(EFFECTS.pixelate.main, 'size')
    assert.deepEqual([s.size.rule, s.size.dflt], ['int 2..400', 48])
    assert.deepEqual([s.steps.rule, s.steps.dflt], ['int 2..40', 8])
    assert.equal(s.duration.dflt, '900ms')
    assert.equal(s.easing.dflt, 'ease-out')
    for (const k of ['on', 'once', 'range', 'zone', 'delay']) assert.ok(k in s, k)
    assert.deepEqual(parseEffect('pixelate', '64, steps: 6, on: scroll').fixed, { size: 64, steps: 6, on: 'scroll' })
    assert.throws(() => parseEffect('pixelate', 'size: 1'), /size/)
    assert.throws(() => parseEffect('pixelate', 'size: 401'), /size/)
    assert.throws(() => parseEffect('pixelate', 'steps: 1'), /steps/)
    assert.throws(() => parseEffect('pixelate', 'steps: 41'), /steps/)
  })
})
