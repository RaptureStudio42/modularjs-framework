// transitions — les variantes d'*iris (start, angle, shape: ellipse, origin: pointer), de *blocks (order,
// seed), de *scale (start jusqu'à 40) et de *fly (rotate) : chaque réglage neuf change ce qu'on voit comme
// annoncé, et sans lui rien ne bouge — les animations d'avant et celles-ci rendent les mêmes chaînes, à
// l'identique, sur une grille de réglages et d'instants (l'empreinte est relevée sur les animations
// d'avant) ; chargement des animations : lecture de la source + `new Function('µ', 'return (...)')`, comme
// anim-iris-swipe.test.ts — le fichier est une expression, pas un module ; l'écouteur de survol de l'iris qui part du
// pointeur n'existe que tant qu'une balise en a besoin

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { chargerAnimation } from './helpers/charger-animation.js'

const HERE     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(HERE, '..', 'src', 'runtime')

function makeµ() {
  return {
    warn: function (_m: any) {},
    easing: {
      resolve: function (e: any) { return typeof e === 'function' ? e : function (t: number) { return t } },
      linear: function (t: number) { return t },
      cubicIn: function (t: number) { return t * t * t },
      cubicOut: function (t: number) { return 1 - Math.pow(1 - t, 3) }
    }
  } as any
}

// `document` n'existe que le temps du chargement : l'iris y pose son écouteur de clic
function load(name: string, µ: any = makeµ(), document?: any) {
  const g = globalThis as any
  const prior = g.document
  if (document) g.document = document
  try {
    // fly et scale sont posées sur l'enveloppe commune (shared/from.ts), fly sur shared/len.ts : l'aide charge ce qu'une animation appelle avec elle
    return chargerAnimation(name, µ)
  }
  finally {
    if (document) {
      if (prior === undefined) delete g.document
      else g.document = prior
    }
  }
}

// la balise : sa boîte, sans moteur de mise en page
const makeBox = (w: number, h: number, left = 0, top = 0) => ({ offsetWidth: w, offsetHeight: h, getBoundingClientRect: () => ({ width: w, height: h, left: left, top: top }) })

const instants = Array.from({ length: 21 }, (_, i) => i / 20)
const fingerprint = (lines: string[]) => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)

// une grille de réglages × les instants : ce que rend l'animation, ligne à ligne
function render(name: string, grid: Array<[any, any]>): string[] {
  const g = globalThis as any
  const prior = g.window
  g.window = { getComputedStyle: () => ({ opacity: '1', transform: 'none', filter: 'none' }) }
  try {
    const output: string[] = []
    for (const [opts, node] of grid) {
      const cfg = load(name)(opts).intro(node)
      output.push(JSON.stringify([cfg.duration, cfg.delay, cfg.steps]))
      for (const t of instants) output.push(JSON.stringify(cfg.css(t, 1 - t)))
    }
    return output
  }
  finally {
    if (prior === undefined) delete g.window
    else g.window = prior
  }
}

const nodes = [{}, { getBoundingClientRect: () => ({ width: 600, height: 400, left: 10, top: 20 }) }, { getBoundingClientRect: () => ({ width: 300, height: 900, left: 0, top: 0 }) }]

describe('transitions — sans le réglage neuf, rien ne change (à l\'identique)', function () {
  it('*iris : formes, origines et boîtes d\'avant — même empreinte que l\'ancienne animation', function () {
    const grid: Array<[any, any]> = []
    for (const shape of [undefined, 'circle', 'box', 'diamond', 'cross']) {
      for (const origin of [undefined, [0.2, 0.7], [0, 0], [1.3, -0.4]]) {
        for (const n of nodes) grid.push([{ shape, origin }, n])
      }
    }
    const lines = render('iris', grid)
    assert.equal(lines.length, 1320)
    assert.equal(fingerprint(lines), '1adb841fe47f9108')
  })

  it('*blocks : damiers et boîtes d\'avant — même empreinte que l\'ancienne animation', function () {
    const grid: Array<[any, any]> = []
    for (const [cols, rows] of [[undefined, undefined], [2, 1], [1, 1], [16, 9], [5, 18]]) {
      for (const n of nodes) grid.push([{ cols, rows }, n])
    }
    const lines = render('blocks', grid)
    assert.equal(lines.length, 330)
    assert.equal(fingerprint(lines), '10e4a79eb5c4e237')
  })

  it('*fly : déplacements, flou, inclinaison d\'avant — même empreinte que l\'ancienne animation', function () {
    const lines = render('fly', [[{}, {}], [{ x: 40, y: -20 }, {}], [{ x: '10%', y: '5em', skew: 12, blur: 4, opacity: 0.3 }, {}], [{ x: 0, y: 30, skew: -20 }, {}]])
    assert.equal(fingerprint(lines), '5bfa16c7c607ac7b')
  })

  it('*scale : départs, axes et origines d\'avant — même empreinte que l\'ancienne animation', function () {
    const lines = render('scale', [[{}, {}], [{ start: 0.5 }, {}], [{ start: 2.5, axis: 'x', origin: '0% 0%', opacity: 0.2 }, {}], [{ start: 1, axis: 'y' }, {}]])
    assert.equal(fingerprint(lines), 'bb2a6c60ec14370e')
  })

  it('réglages neutres écrits (start 0, angle 0, order diagonal, rotate 0) : les mêmes chaînes que sans eux', function () {
    const a = render('iris', [[{ shape: 'box', origin: [0.3, 0.6] }, nodes[1]]])
    const b = render('iris', [[{ shape: 'box', origin: [0.3, 0.6], start: 0, angle: 0 }, nodes[1]]])
    assert.deepEqual(b, a)
    const c = render('blocks', [[{ cols: 5, rows: 3 }, nodes[1]]])
    const d = render('blocks', [[{ cols: 5, rows: 3, order: 'diagonal', seed: 99 }, nodes[1]]])
    assert.deepEqual(d, c)
    const e = render('fly', [[{ x: 10, y: 20, skew: 5 }, {}]])
    const f = render('fly', [[{ x: 10, y: 20, skew: 5, rotate: 0 }, {}]])
    assert.deepEqual(f, e)
  })
})

describe('*iris — start, angle, ellipse, pointer', function () {
  const W = 800
  const H = 450
  const node = makeBox(W, H)

  it('start : la fenêtre est déjà ouverte au départ (en part de l\'ouverture finale), et finit toute ouverte', function () {
    const circle = load('iris')({ start: 0.2 }).intro(node)
    assert.equal(circle.css(0, 1).clipPath, 'circle(14.4% at 50% 50%)')
    assert.equal(circle.css(1, 0).clipPath, 'circle(72% at 50% 50%)')
    const rect = load('iris')({ shape: 'box', start: 0.2 }).intro(node)
    assert.equal(rect.css(0, 1).clipPath, 'inset(40% 40% 40% 40%)')
    assert.equal(rect.css(1, 0).clipPath, 'inset(0% 0% 0% 0%)')
    const diamond = load('iris')({ shape: 'diamond', start: 0.5 }).intro(node)
    assert.equal(diamond.css(0, 1).clipPath, load('iris')({ shape: 'diamond' }).intro(node).css(0.5, 0.5).clipPath)
  })

  it('angle + box + start : un rectangle penché de -11° qui part du cinquième de la boîte et se redresse en s\'ouvrant, au pixel près', function () {
    const cfg = load('iris')({ shape: 'box', start: 0.2, angle: -11 }).intro(node)
    // le calcul attendu : un rectangle centré de e × (largeur, hauteur), tourné de (1 - e) × -11° autour du centre
    const fmt = (v: number) => String(Math.round(v * 1000) / 1000)
    const expected = (t: number) => {
      const e  = 0.2 + 0.8 * t
      const th = (1 - e) * -11 * Math.PI / 180
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const dx = sx * W * e / 2
        const dy = sy * H * e / 2
        return fmt(50 + (dx * Math.cos(th) - dy * Math.sin(th)) / W * 100) + '% ' + fmt(50 + (dx * Math.sin(th) + dy * Math.cos(th)) / H * 100) + '%'
      })
      return 'polygon(' + pts.join(', ') + ')'
    }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) assert.equal(cfg.css(t, 1 - t).clipPath, expected(t), `t = ${t}`)
    assert.equal(cfg.css(1, 0).clipPath, 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', 'toute ouverte : droite, la boîte entière')
  })

  it('angle : positif = penché dans le sens des aiguilles d\'une montre (+8°, sans start : la fenêtre part de zéro)', function () {
    const cfg = load('iris')({ shape: 'box', angle: 8 }).intro(node)
    const p0  = cfg.css(0, 1).clipPath
    // à t = 0 : un point (aire nulle), tous les sommets au centre
    assert.equal(p0, 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)')
    // à mi-course : le coin haut gauche tourné de 4° vers le haut (en tournant dans le sens des aiguilles, le coin haut gauche monte à droite)
    const pts = cfg.css(0.5, 0.5).clipPath.slice('polygon('.length, -1).split(', ')
    assert.equal(pts.length, 4)
    const [x0, y0] = pts[0].split('% ').map(parseFloat)
    const [x1, y1] = pts[1].split('% ').map(parseFloat)
    assert.ok(y1 > y0, 'le bord du haut descend vers la droite : une rotation dans le sens des aiguilles d\'une montre')
    assert.ok(x1 > x0)
  })

  it('circle ignore angle ; le nombre de sommets d\'un polygone ne change jamais d\'une image à l\'autre', function () {
    const plain = load('iris')({ shape: 'circle' }).intro(node)
    const rotated = load('iris')({ shape: 'circle', angle: 30, start: 0.3 }).intro(node)
    for (const t of [0, 0.4, 1]) assert.equal(rotated.css(t, 1 - t).clipPath.replace(/^circle\([\d.]+%/, ''), plain.css(t, 1 - t).clipPath.replace(/^circle\([\d.]+%/, ''))
    for (const [shape, n] of [['box', 4], ['diamond', 4], ['cross', 12], ['ellipse', 96]] as Array<[string, number]>) {
      const cfg = load('iris')({ shape, angle: 20, start: 0.1 }).intro(node)
      for (const t of instants) assert.equal(cfg.css(t, 1 - t).clipPath.slice('polygon('.length, -1).split(', ').length, n, `${shape} à t = ${t}`)
    }
    // toute ouverte, la fenêtre est droite : les mêmes sommets qu'une fenêtre qui ne penche pas
    for (const shape of ['box', 'diamond', 'cross']) {
      const straight = load('iris')({ shape }).intro(node).css(1, 0).clipPath
      const tilted = load('iris')({ shape, angle: 40 }).intro(node).css(1, 0).clipPath
      assert.equal(tilted, shape === 'box' ? 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' : straight, shape)
    }
  })

  it('ellipse : un ovale aux proportions de la balise, du centre (ou de l\'origine) à tout recouvrir', function () {
    const cfg = load('iris')({ shape: 'ellipse' }).intro(node)
    assert.equal(cfg.css(0, 1).clipPath, 'ellipse(0% 0% at 50% 50%)')
    assert.equal(cfg.css(0.5, 0.5).clipPath, 'ellipse(36% 36% at 50% 50%)')
    assert.equal(cfg.css(1, 0).clipPath, 'ellipse(72% 72% at 50% 50%)', 'même rayon en % de la largeur et de la hauteur : les proportions de la balise')
    // depuis un coin : le rayon atteint le coin opposé
    const corner = load('iris')({ shape: 'ellipse', origin: [0, 0] }).intro(node)
    assert.equal(corner.css(1, 0).clipPath, 'ellipse(143% 143% at 0% 0%)')
    // penché : un polygone qui, tout ouvert, recouvre les quatre coins de la boîte
    const tilted = load('iris')({ shape: 'ellipse', angle: 8 }).intro(node).css(1, 0).clipPath
    const poly   = tilted.slice('polygon('.length, -1).split(', ').map((p) => p.split('% ').map(parseFloat))
    const inside = (x: number, y: number) => {
      let r = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if ((poly[i][1] > y) !== (poly[j][1] > y) && x < (poly[j][0] - poly[i][0]) * (y - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) r = !r
      }
      return r
    }
    for (const [x, y] of [[0, 0], [100, 0], [100, 100], [0, 100]]) assert.ok(inside(x, y), `coin ${x} ${y} dans l'ovale tout ouvert`)
  })

  it('origin: pointer — le dernier clic (ou survol) de la souris ; sans geste connu, le centre ; les écouteurs ne se posent qu\'au besoin', function () {
    const listeners: Array<[string, any, any]> = []
    // le `document` de la page, le temps du test : l'iris le lit à son chargement, puis à la pose d'un iris qui part du pointeur
    const g     = globalThis as any
    const prior = g.document
    g.document  = { addEventListener: (type: string, f: any, o: any) => { listeners.push([type, f, o]) } }
    try {
      const factory = load('iris')
      // au chargement : le clic seulement, un écouteur passif de capture
      assert.deepEqual(listeners.map((e) => e[0]), ['pointerdown'])
      assert.deepEqual(listeners[0][2], { capture: true, passive: true })
      factory({ shape: 'box' })
      assert.deepEqual(listeners.map((e) => e[0]), ['pointerdown'], 'un iris qui ne part pas du pointeur n\'écoute pas le survol')
      const box2 = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }) }
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(72% at 50% 50%)', 'sans geste connu : le centre')
      assert.deepEqual(listeners.map((e) => e[0]), ['pointerdown', 'pointermove'])
      factory({ origin: 'pointer' })
      assert.equal(listeners.length, 2, 'le survol n\'est écouté qu\'une fois')
      // un clic en (100, 50) : le quart de la boîte de 400 × 200
      listeners[0][1]({ clientX: 100, clientY: 50, detail: 1 })
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(108% at 25% 25%)')
      // le dernier point l'emporte : un survol en (300, 150)
      listeners[1][1]({ clientX: 300, clientY: 150, pointerType: 'mouse' })
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(108% at 75% 75%)')
      // un clic venu du clavier (rien de touché : 0, 0, détail 0) ne compte pas
      listeners[0][1]({ clientX: 0, clientY: 0, detail: 0, pointerType: '' })
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(108% at 75% 75%)')
      // une balise qui n'a pas de boîte (pas encore mise en page) : le centre
      assert.equal(factory({ origin: 'pointer' }).intro({}).css(1, 0).clipPath, 'circle(72% at 50% 50%)')
      // un point hors de la balise : l'ouverture part du point de son bord le plus proche (jamais de l'extérieur, où rien ne se voit)
      listeners[0][1]({ clientX: -100, clientY: 100, detail: 1 })
      assert.equal(factory({ origin: 'pointer', shape: 'box' }).intro(box2).css(0.5, 0.5).clipPath, 'inset(25% 50% 25% 0%)')
      // au-delà d'un coin : le coin
      listeners[0][1]({ clientX: -100, clientY: -50, detail: 1 })
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(143% at 0% 0%)')
      // loin à droite, à hauteur de la balise : le milieu de son bord droit
      listeners[0][1]({ clientX: 700, clientY: 100, detail: 1 })
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(1, 0).clipPath, 'circle(132% at 100% 50%)')
      // et la fenêtre est visible dès les premiers instants : le rond part du bord, il couvre déjà quelque chose
      assert.equal(factory({ origin: 'pointer' }).intro(box2).css(0.1, 0.9).clipPath, 'circle(13.2% at 100% 50%)')
    }
    finally {
      if (prior === undefined) delete g.document
      else g.document = prior
    }
  })

  it('origin: pointer — le survol n\'est écouté que tant qu\'une balise qui part du pointeur est dans la page : il part avec la dernière', function () {
    const log: Array<[string, string, any, any]> = []
    const g     = globalThis as any
    const doc   = {
      addEventListener: (type: string, f: any, o: any) => { log.push(['pose', type, f, o]) },
      removeEventListener: (type: string, f: any, o: any) => { log.push(['retrait', type, f, o]) }
    }
    // l'observateur de taille : il dit qu'une balise a quitté la page ; le test l'appelle à la main
    const seen: any[] = []
    let notify: any = null
    let released = 0
    const priorDoc = g.document
    const priorObs = g.ResizeObserver
    g.document = doc
    g.ResizeObserver = class {
      constructor(callback: any) { notify = callback }
      observe(n: any) { seen.push(n) }
      disconnect() { released++ }
    }
    try {
      const factory = load('iris')
      const hover   = () => log.filter((e) => e[1] === 'pointermove').reduce((n, e) => n + (e[0] === 'pose' ? 1 : -1), 0)
      const element   = (): any => ({ nodeType: 1, isConnected: true, offsetWidth: 400, offsetHeight: 200, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }) })
      assert.equal(hover(), 0, 'au chargement : le clic seulement')
      // un iris qui ne part pas du pointeur n'a pas besoin du survol
      const plain = element()
      factory({ shape: 'box' }).intro(plain)
      assert.equal(hover(), 0)
      assert.deepEqual(seen, [])
      // deux balises qui partent du pointeur : un seul écouteur de survol, passif, en capture
      const a = element()
      const b = element()
      factory({ origin: 'pointer' }).intro(a)
      factory({ origin: 'pointer', shape: 'box' }).outro(b)
      factory({ origin: 'pointer' }).intro(a)
      assert.equal(hover(), 1)
      assert.deepEqual(seen, [a, b], 'chaque balise est suivie, une fois')
      const added = log.find((e) => e[0] === 'pose' && e[1] === 'pointermove')!
      assert.deepEqual(added[3], { capture: true, passive: true })
      // l'une quitte la page : l'autre a encore besoin du survol
      a.isConnected = false
      notify()
      assert.equal(hover(), 1)
      assert.equal(released, 0)
      // la dernière part : l'écouteur part avec elle (le même, en capture), et l'observateur aussi
      b.isConnected = false
      notify()
      assert.equal(hover(), 0)
      const removed = log.find((e) => e[0] === 'retrait' && e[1] === 'pointermove')!
      assert.equal(removed[2], added[2], 'la même fonction que celle posée')
      assert.equal(removed[3].capture, true)
      assert.equal(released, 1)
      // le clic, lui, reste écouté : annoncé, passif, posé une fois pour la page
      assert.deepEqual(log.filter((e) => e[1] === 'pointerdown').map((e) => e[0]), ['pose'])
      // une balise de plus : le survol revient, une seule fois
      const c = element()
      factory({ origin: 'pointer' }).intro(c)
      factory({ origin: 'pointer' }).outro(c)
      assert.equal(hover(), 1)
      assert.deepEqual(seen.slice(2), [c])
      // un observateur qui parle alors que toutes les balises sont encore là : rien ne bouge
      notify()
      assert.equal(hover(), 1)
    }
    finally {
      if (priorDoc === undefined) delete g.document
      else g.document = priorDoc
      if (priorObs === undefined) delete g.ResizeObserver
      else g.ResizeObserver = priorObs
    }
  })

  it('l\'écouteur de clic n\'est posé qu\'une fois, même quand l\'iris est chargé deux fois dans la même page', function () {
    const listeners: string[] = []
    const doc = { addEventListener: (type: string) => { listeners.push(type) }, removeEventListener: () => {} }
    const µ   = makeµ()
    const first   = load('iris', µ, doc)
    const second = load('iris', µ, doc)
    assert.deepEqual(listeners, ['pointerdown'], 'un seul écouteur pour deux chargements')
    // le point noté par l'un est lu par l'autre : l'état est celui de la page
    assert.equal(typeof first, 'function')
    assert.equal(typeof second, 'function')
    assert.equal(µ._mjs_lastPointer.down, true)
  })
})

describe('*blocks — order, seed', function () {
  const node = { getBoundingClientRect: () => ({ width: 600, height: 400 }) }
  const points = (css: string) => css.slice('polygon('.length, -1).split(', ')
  const rendered  = (opts: any, t: number) => load('blocks')(opts).intro(node).css(t, 1 - t).clipPath
  const ORDERS = ['diagonal', 'random', 'rows', 'columns', 'center', 'edges']
  // les cinq premiers sommets d'une tuile (x, y) de la grille : tous confondus tant qu'elle n'a pas commencé
  const tileOf = (css: string, cols: number, x: number, y: number) => points(css).slice((y * cols + x) * 5, (y * cols + x) * 5 + 5)
  const collapsed = (pts: string[]) => pts.every((p) => p === pts[0])

  it('chaque ordre : le même nombre de sommets à chaque image, les tuiles toutes confondues à t = 0 et toutes posées à t = 1, comme en diagonale', function () {
    for (const order of ORDERS) {
      const opts = { cols: 6, rows: 4, order }
      for (const t of instants) assert.equal(points(rendered(opts, t)).length, 5 * 24 + 22, `${order} à t = ${t}`)
      assert.equal(rendered(opts, 0), rendered({ cols: 6, rows: 4 }, 0), `${order} : départ`)
      assert.equal(rendered(opts, 1), rendered({ cols: 6, rows: 4 }, 1), `${order} : arrivée`)
    }
  })

  it('chaque ordre arrive autrement à mi-course', function () {
    const seen = new Set(ORDERS.map((order) => rendered({ cols: 6, rows: 4, order }, 0.4)))
    assert.equal(seen.size, ORDERS.length)
  })

  it('un ordre inconnu : la diagonale, comme sans réglage', function () {
    assert.equal(rendered({ cols: 6, rows: 4, order: 'spirale' }, 0.4), rendered({ cols: 6, rows: 4 }, 0.4))
  })

  it('center : les tuiles du milieu arrivent avant celles des coins ; edges : l\'inverse', function () {
    const t = 0.15
    const c = rendered({ cols: 6, rows: 4, order: 'center' }, t)
    assert.ok(!collapsed(tileOf(c, 6, 2, 1)), 'le milieu a commencé')
    assert.ok(collapsed(tileOf(c, 6, 0, 0)), 'le coin attend')
    assert.ok(collapsed(tileOf(c, 6, 5, 3)), 'l\'autre coin attend')
    const e = rendered({ cols: 6, rows: 4, order: 'edges' }, t)
    assert.ok(collapsed(tileOf(e, 6, 2, 1)), 'le milieu attend')
    assert.ok(!collapsed(tileOf(e, 6, 0, 0)) || !collapsed(tileOf(e, 6, 5, 3)), 'un coin a commencé')
  })

  it('rows : la rangée du haut arrive avant celle du bas (avec un léger désordre) ; columns : la colonne de gauche avant celle de droite', function () {
    const r = rendered({ cols: 5, rows: 18, order: 'rows' }, 0.1)
    assert.ok(!collapsed(tileOf(r, 5, 0, 0)), 'la première tuile de la première rangée a commencé')
    for (let x = 0; x < 5; x++) assert.ok(collapsed(tileOf(r, 5, x, 17)), `la dernière rangée attend (colonne ${x})`)
    const c = rendered({ cols: 18, rows: 5, order: 'columns' }, 0.1)
    assert.ok(!collapsed(tileOf(c, 18, 0, 0)), 'la première tuile de la première colonne a commencé')
    for (let y = 0; y < 5; y++) assert.ok(collapsed(tileOf(c, 18, 17, y)), `la dernière colonne attend (rangée ${y})`)
    // le désordre : des tuiles d'une même rangée ne partent pas toutes ensemble
    const done = rendered({ cols: 5, rows: 18, order: 'rows' }, 0.05)
    const rowFlags = [0, 1, 2, 3, 4].map((x) => collapsed(tileOf(done, 5, x, 0)))
    assert.ok(rowFlags.includes(true) && rowFlags.includes(false), 'léger désordre dans la rangée')
  })

  it('random : un tirage à graine — le même à chaque fois, autre avec une autre graine ; entrée et sortie se répondent', function () {
    const a = rendered({ cols: 16, rows: 9, order: 'random', seed: 7 }, 0.3)
    assert.equal(rendered({ cols: 16, rows: 9, order: 'random', seed: 7 }, 0.3), a)
    assert.notEqual(rendered({ cols: 16, rows: 9, order: 'random', seed: 8 }, 0.3), a)
    assert.equal(rendered({ cols: 16, rows: 9, order: 'random' }, 0.3), rendered({ cols: 16, rows: 9, order: 'random', seed: 3 }, 0.3), 'la graine par défaut est 3')
    const pair = load('blocks')({ order: 'random' })
    assert.equal(pair.intro, pair.outro)
    // aucune tuile n'est oubliée ni servie deux fois : chacune a son rang, son instant de départ (un tirage sans doublon)
    const grid  = Array.from({ length: 501 }, (_, k) => k / 500)
    const renders  = grid.map((t) => points(rendered({ cols: 6, rows: 6, order: 'random', seed: 5 }, t)))
    const startTimes = new Set<number>()
    for (let i = 0; i < 36; i++) startTimes.add(grid[renders.findIndex((pts) => !collapsed(pts.slice(i * 5, i * 5 + 5)))])
    assert.equal(startTimes.size, 36, 'trente-six tuiles, trente-six instants de départ')
    for (let seed = 1; seed <= 20; seed++) {
      assert.equal(rendered({ cols: 6, rows: 6, order: 'random', seed }, 1), rendered({ cols: 6, rows: 6 }, 1), `graine ${seed} : tout posé à la fin`)
    }
  })

  it('seed illisible : la graine par défaut', function () {
    assert.equal(rendered({ cols: 6, rows: 4, order: 'random', seed: 'abc' }, 0.4), rendered({ cols: 6, rows: 4, order: 'random', seed: 3 }, 0.4))
  })
})

describe('*scale et *fly', function () {
  const withWindow = (body: () => void) => {
    const g = globalThis as any
    const prior = g.window
    g.window = { getComputedStyle: () => ({ opacity: '1', transform: 'none', filter: 'none' }) }
    try { body() }
    finally {
      if (prior === undefined) delete g.window
      else g.window = prior
    }
  }

  it('*scale : start va jusqu\'à 40 (le zoom traversant : un titre vingt fois plus grand qui rétrécit à sa taille)', function () {
    assert.equal(EFFECTS.scale.settings.start.rule, 'float 0..40')
    assert.equal(parseEffect('scale', 'start: 20').fixed.start, 20)
    assert.equal(parseEffect('scale', 'start: 40').fixed.start, 40)
    assert.throws(() => parseEffect('scale', 'start: 41'), /start/)
    withWindow(() => {
      const cfg = load('scale')({ start: 20 }).intro({})
      assert.equal(cfg.css(0, 1).transform, 'scale(20)')
      assert.equal(cfg.css(1, 0).transform, 'scale(1)')
      assert.equal(cfg.css(0.5, 0.5).transform, 'scale(10.5)')
    })
  })

  it('*fly : rotate — la balise arrive tournée de cet angle et se redresse ; entre le déplacement et l\'inclinaison', function () {
    withWindow(() => {
      const cfg = load('fly')({ x: 0, y: 40, rotate: 90 }).intro({})
      assert.equal(cfg.css(0, 1).transform, 'translate(0px, 40px) rotate(90deg)')
      assert.equal(cfg.css(0.5, 0.5).transform, 'translate(0px, 20px) rotate(45deg)')
      assert.equal(cfg.css(1, 0).transform, 'translate(0px, 0px) rotate(0deg)')
      assert.equal(load('fly')({ x: 0, y: 40, rotate: -180 }).intro({}).css(0.5, 0.5).transform, 'translate(0px, 20px) rotate(-90deg)')
      assert.equal(load('fly')({ y: 40, rotate: 90, skew: 10 }).intro({}).css(0, 1).transform, 'translate(0px, 40px) rotate(90deg) skewX(10deg)')
    })
  })
})

describe('catalogue et pont des réglages', function () {
  const ENGINE     = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8')
  const TRANSITION = readFileSync(join(RUNTIME, 'mjs_fx_transition.ts'), 'utf-8')
  const options    = (name: string, s: any) => {
    const µ: any = {}
    new Function('µ', ENGINE + '\n' + TRANSITION)(µ)
    // le pont de fly lit sa distance avec la lecture de longueur de fly (shared/len.ts), qui part avec elle
    chargerAnimation('fly', µ)
    return µ._mjs_fxAnimOpts(name, s)
  }

  it('*iris : origin accepte pointer, shape accepte ellipse, start de 0 à 1, angle de -180 à 180 — les défauts sont le comportement d\'avant', function () {
    const s = EFFECTS.iris.settings
    assert.equal(s.origin.rule, 'origin-pointer')
    assert.equal(s.origin.dflt, 'center')
    assert.equal(s.shape.rule, "'circle' | 'box' | 'diamond' | 'cross' | 'ellipse'")
    assert.equal(s.shape.dflt, 'circle')
    assert.deepEqual([s.start.rule, s.start.dflt], ['float 0..1', 0])
    assert.deepEqual([s.angle.rule, s.angle.dflt], ['int -180..180', 0])
    assert.equal(EFFECTS.iris.main, 'origin', 'le réglage principal reste l\'origine : *iris(top-left) marche toujours')
    const p = parseEffect('iris', 'shape: box, start: .2, angle: -11, on: scroll')
    assert.deepEqual(p.fixed, { shape: 'box', start: 0.2, angle: -11, on: 'scroll' })
    assert.equal(parseEffect('iris', 'pointer').fixed.origin, 'pointer')
    assert.equal(parseEffect('iris', 'shape: ellipse').fixed.shape, 'ellipse')
    assert.throws(() => parseEffect('iris', 'start: 1.5'), /start/)
    assert.throws(() => parseEffect('iris', 'angle: 181'), /angle/)
    assert.throws(() => parseEffect('iris', 'shape: oval'), /shape/)
    assert.throws(() => parseEffect('iris', 'box'), /origin/, 'box n\'est pas une origine : le réglage principal est origin')
  })

  it('*blocks : order (six ordres) et seed de 1 à 999 ; *fly : rotate de -1080 à 1080', function () {
    const b = EFFECTS.blocks.settings
    assert.equal(b.order.rule, "'diagonal' | 'random' | 'rows' | 'columns' | 'center' | 'edges'")
    assert.equal(b.order.dflt, 'diagonal')
    assert.deepEqual([b.seed.rule, b.seed.dflt], ['int 1..999', 3])
    assert.deepEqual(parseEffect('blocks', 'cols: 16, rows: 9, order: random, seed: 7').fixed, { cols: 16, rows: 9, order: 'random', seed: 7 })
    assert.throws(() => parseEffect('blocks', 'order: spirale'), /order/)
    assert.throws(() => parseEffect('blocks', 'seed: 0'), /seed/)
    assert.throws(() => parseEffect('blocks', 'seed: 1000'), /seed/)
    const f = EFFECTS.fly.settings
    assert.deepEqual([f.rotate.rule, f.rotate.dflt], ['int -1080..1080', 0])
    assert.equal(parseEffect('fly', 'up, rotate: -720').fixed.rotate, -720)
    assert.throws(() => parseEffect('fly', 'rotate: 1081'), /rotate/)
  })

  it('le pont traduit les réglages neufs dans les options de l\'animation, et ne touche pas à *wheel', function () {
    assert.deepEqual(options('iris', { origin: 'pointer', shape: 'ellipse', start: 0.2, angle: -11 }), { origin: 'pointer', shape: 'ellipse', start: 0.2, angle: -11 })
    assert.deepEqual(options('iris', { origin: 'top-left' }), { origin: [0, 0] })
    assert.deepEqual(options('iris', { origin: '20% 80%', shape: 'box' }), { origin: [0.2, 0.8], shape: 'box' })
    assert.deepEqual(options('blocks', { cols: 16, rows: 9, order: 'random', seed: 7 }), { cols: 16, rows: 9, order: 'random', seed: 7 })
    assert.deepEqual(options('blocks', {}), {})
    assert.equal(options('fly', { direction: 'up', distance: 40, rotate: 90 }).rotate, 90)
    assert.equal('rotate' in options('fly', { direction: 'up', distance: 40 }), false)
    assert.deepEqual(options('wheel', { origin: 'top-left', spokes: 4, reverse: true }), { origin: [0, 0], spokes: 4, reverse: true })
    assert.deepEqual(options('pixelate', { size: 64, steps: 6, duration: '2s' }), { duration: 2000, size: 64, steps: 6 })
  })
})
