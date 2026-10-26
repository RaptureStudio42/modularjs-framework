// *gallery — la logique de l'effet dans happy-dom (aucune mise en page : les tailles que l'effet lit sont posées à
// la main) : la place de chaque panneau pour chacun des sept styles (leurs nombres, en unités de
// panneau), le clavier, la souris, l'inclinaison de la scène, l'événement `change`, le suivi des réglages sans reposer
// l'effet, le retrait sans reste (les enfants retrouvent ce que l'auteur avait écrit), « réduire les animations » et
// rien qui tourne au repos. Ce qui se voit (glisser, molette, clic, défilement) est dans effets-gallery-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const MOTEUR  = ['mjs_fx.ts', 'mjs_fx_toolup.ts', 'mjs_fx_toolroots.ts', 'mjs_fx_toolscroll.ts'].map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')
const EFFET   = readFileSync(join(RUNTIME, 'mjs_fx_gallery.ts'), 'utf-8')

const attendre = (ms = 50) => new Promise((r) => setTimeout(r, ms))
// la boîte posée sur le prototype des éléments (partagé par toutes les fenêtres de happy-dom) est rendue après chaque test
const RENDUS: Array<() => void> = []
const rendre = () => { while (RENDUS.length) RENDUS.pop()!() }

type Options = { n?: number, w?: number, h?: number, calme?: boolean, avant?: (el: any, kids: any[], win: any) => void }

// une balise de huit images dans le shadow root d'un faux composant ; la balise mesure 1000 × 600, chaque panneau w × h
function monter(reglages: Record<string, any>, opts: Options = {}) {
  const { n = 8, w = 470, h = 310 } = opts
  const window: any = new Window({ url: 'http://localhost/' })
  // happy-dom a un IntersectionObserver qui ne dit rien : sans lui, `scroll` écoute tout de suite
  window.IntersectionObserver = undefined
  if (opts.calme) window.matchMedia = (q: string) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
  const pend = new Set<any>()
  const ra   = window.requestAnimationFrame.bind(window)
  const ca   = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = (f: any) => { const id = ra((t: number) => { pend.delete(id); f(t) }); pend.add(id); return id }
  window.cancelAnimationFrame  = (id: any) => { pend.delete(id); ca(id) }
  window.eval(`var µ = {};\n${MOTEUR}\n${EFFET}\nglobalThis.µ = µ;`)
  const doc  = window.document
  const host = doc.createElement('div')
  doc.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const el   = doc.createElement('div')
  const kids: any[] = []
  for (let i = 0; i < n; i++) {
    const c = doc.createElement('img')
    Object.defineProperty(c, 'offsetWidth', { value: w })
    Object.defineProperty(c, 'offsetHeight', { value: h })
    el.appendChild(c)
    kids.push(c)
  }
  Object.defineProperty(el, 'clientWidth', { value: 1000 })
  Object.defineProperty(el, 'clientHeight', { value: 600 })
  // l'effet lit les méthodes natives du prototype (un composant peut masquer celles de sa balise) : c'est lui qu'on remplace
  const proto = window.Element.prototype
  const avant = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
  const natif = proto.getBoundingClientRect
  proto.getBoundingClientRect = function () { return this === el ? { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 } : natif.call(this) }
  RENDUS.push(() => { if (avant) Object.defineProperty(proto, 'getBoundingClientRect', avant); else delete proto.getBoundingClientRect })
  root.appendChild(el)
  if (opts.avant) opts.avant(el, kids, window)
  const events: number[] = []
  // par le prototype : le banc ne passe pas pour l'effet quand les méthodes de la balise sont espionnées
  window.EventTarget.prototype.addEventListener.call(el, 'change', (e: any) => events.push(e.detail.index))
  const µ     = window.µ
  const comp  = { _shadow: root }
  const retrait = µ._mjs_fx(comp, el, 'gallery', reglages)
  return { window, µ, el, kids, events, pend, comp, retrait, off: () => el._mjs_fxOff && el._mjs_fxOff.gallery, fermer: () => window.close() }
}

// la transformation écrite sur un panneau, en nombres
function lire(c: any) {
  const t = c.style.transform as string
  const nb = (re: RegExp) => { const m = re.exec(t); return m ? parseFloat(m[1]) : 0 }
  const tr = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(t)
  return {
    x: tr ? parseFloat(tr[1]) : NaN, y: tr ? parseFloat(tr[2]) : NaN, z: tr ? parseFloat(tr[3]) : NaN,
    rx: nb(/rotateX\((-?[\d.]+)deg\)(?!.*translate3d)/), ry: nb(/rotateY\((-?[\d.]+)deg\)(?!.*translate3d)/), rz: nb(/rotateZ\((-?[\d.]+)deg\)(?!.*translate3d)/),
    s: /scale\((-?[\d.]+)\)/.test(t) ? nb(/scale\((-?[\d.]+)\)/) : 1,
    o: c.style.opacity === '' ? 1 : parseFloat(c.style.opacity),
    caché: c.hasAttribute('mjs-fx-gallery-hidden')
  }
}
const proche = (a: number, b: number, quoi: string, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${quoi} : ${a} au lieu de ${b}`)
const DEG = 180 / Math.PI

describe('*gallery — la place des panneaux (tailles posées à la main, u = 100 px par unité de panneau)', function () {
  afterEach(rendre)

  this.timeout(30000)

  it('coverflow : le panneau de tête à plat devant, ses voisins écartés, reculés, tournés et penchés ; les autres hors scène', () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 3, smooth: 1 })
    try {
      assert.equal(b.kids[3].style.transform, 'translate3d(0px,0px,0px)')
      // la superposition : le rang de profondeur, le panneau de tête au-dessus ; à égale distance, le dernier dans la page passe devant
      const z = (i: number) => parseInt(b.kids[i].style.zIndex)
      assert.ok(z(3) > z(4) && z(4) > z(2), 'le panneau de tête au-dessus, puis le suivant, puis le précédent (à égalité, le dernier devant)')
      assert.equal(b.kids[4].style.transform, 'translate3d(490px,0px,-130px) rotateY(-40.11deg) rotateZ(4.58deg)')
      assert.equal(b.kids[2].style.transform, 'translate3d(-490px,0px,-130px) rotateY(40.11deg) rotateZ(-4.58deg)')
      // au-delà de 1,6 panneau : retiré du rendu et de la tabulation
      assert.ok(b.kids[5].hasAttribute('mjs-fx-gallery-hidden') && b.kids[5].hasAttribute('inert'), 'panneau lointain caché et inerte')
      assert.equal(b.kids[5].style.transform, '')
      assert.ok(!b.kids[3].hasAttribute('mjs-fx-gallery-hidden') && !b.kids[3].hasAttribute('inert'), 'panneau de tête montré')
      assert.equal(b.el.getAttribute('mjs-fx-gallery-on'), 'drag')
      assert.equal(b.el.getAttribute('tabindex'), '0')
      assert.equal(b.el.getAttribute('aria-roledescription'), 'carousel')
      assert.equal(b.el.style.getPropertyValue('--mjs-gallery-perspective'), '', 'perspective non écrite : la valeur par défaut du CSS (1200px)')
    }
    finally { b.fermer() }
  })

  it('chaque style place ses panneaux selon ses nombres (lus sur le panneau d\'à côté, d = 1, et le suivant, d = 2)', () => {
    // les nombres de chaque style, ré-écrits ici en unités (y vers le haut, d'où les signes retournés en CSS)
    const attendus: Record<string, { taille: [number, number], voisin: (d: number) => any, cache: number }> = {
      depth:  { taille: [800, 500], cache: 5, voisin: (d) => ({ x: d * 90, y: -d * 40, z: -Math.abs(d) * 500, ry: d * .35 * DEG, s: 1 - Math.min(.55, Math.abs(d) * .3) }) },
      strip:  { taille: [320, 410], cache: 7, voisin: (d) => ({ x: d * 335, y: 10, z: 0, ry: Math.max(-.65, Math.min(.65, -d * .15)) * DEG }) },
      wheel:  { taille: [470, 310], cache: 6, voisin: (d) => ({ x: Math.sin(d * .65) * 70, y: d * 365, z: -Math.abs(d) * 70, rx: -d * .16 * DEG, rz: -Math.sin(d * .8) * .12 * DEG }) },
      arc:    { taille: [135, 200], cache: -1, voisin: (d) => { const a = d * .28; return { x: Math.sin(a) * 550, y: (.7 - Math.cos(a) * 1.3) * 100, z: (Math.cos(a) * 2 - 2) * 100, rx: .12 * DEG, ry: a * .85 * DEG, rz: a * .12 * DEG } } },
      tunnel: { taille: [470, 310], cache: 7, voisin: (d) => ({ x: 0, y: 0, z: -d * 1200 * .55, ry: 0 }) }
    }
    for (const [style, a] of Object.entries(attendus)) {
      const b = monter({ style, on: 'drag', index: 3, smooth: 1 }, { w: a.taille[0], h: a.taille[1] })
      try {
        for (const d of [1, 2]) {
          const l = lire(b.kids[3 + d])
          if (l.caché) { assert.ok(d === 2 && style === 'depth', `${style} : le panneau d = ${d} est caché`); continue }
          const e = a.voisin(d)
          for (const k of Object.keys(e)) proche((l as any)[k], e[k], `${style} d = ${d} : ${k}`)
        }
        if (a.cache >= 0) assert.ok(lire(b.kids[a.cache]).caché, `${style} : le panneau ${a.cache} est hors scène`)
        // le panneau de tête : à sa place de repos (l'arc est un peu relevé, la bande un peu descendue)
        const t = lire(b.kids[3])
        assert.ok(!t.caché, `${style} : le panneau de tête se voit`)
        proche(t.x, 0, `${style} : x du panneau de tête`)
      }
      finally { b.fermer() }
    }
  })

  it('z-index : le rang de profondeur (1 à n), écrit seulement quand l\'ordre change — un mouvement qui ne croise aucun panneau n\'en écrit aucun', async () => {
    const b = monter({ style: 'coverflow', on: 'pointer', smooth: 1 })
    try {
      const bouge = async (pos: number) => {
        b.el.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: pos / 7 * 1000, clientY: 300, bubbles: true }))
        await attendre(40)
      }
      const z = (i: number) => parseInt(b.kids[i].style.zIndex)
      // chaque écriture de z-index : `style.zIndex = v` passe par setProperty('z-index', v) — par le setter du prototype en happy-dom 20.11, par le Proxy du style en 20.14, qui n'a plus d'accesseur par propriété
      let ecrits = 0
      for (const c of b.kids) {
        const original = c.style.setProperty
        c.style.setProperty = (nom: string, ...reste: any[]) => {
          if (nom === 'z-index') ecrits++
          return original.call(c.style, nom, ...reste)
        }
      }
      await bouge(3)
      assert.ok(z(3) > z(4) && z(4) > z(2), 'au repos sur le panneau 3 : il est au-dessus, le 4 devant le 2 (à égale distance, le dernier dans la page)')
      const rangs = [2, 3, 4].map(z)
      ecrits = 0
      // 3 → 3,1 puis 3,4 : le panneau 3 reste le plus proche, le 4 le suit, le 2 est derrière : l'ordre ne change pas
      await bouge(3.1)
      await bouge(3.4)
      assert.equal(ecrits, 0, 'aucun z-index écrit tant que l\'ordre ne change pas')
      assert.deepEqual([2, 3, 4].map(z), rangs)
      // 3,4 → 3,6 : le panneau 4 devient le plus proche
      await bouge(3.6)
      assert.ok(ecrits > 0 && z(4) > z(3) && z(3) > z(2), 'le panneau 4 passe devant le 3, le 3 reste devant le 2')
      assert.ok([...Array(8).keys()].filter((i) => !b.kids[i].hasAttribute('mjs-fx-gallery-hidden')).every((i) => z(i) >= 1 && z(i) <= 8), 'les rangs vont de 1 à n')
    }
    finally { b.fermer() }
  })

  it('sphere : les panneaux répartis en spirale, ceux de derrière plus petits et plus pâles, superposés par profondeur', () => {
    const b = monter({ style: 'sphere', on: 'pointer', index: 0, smooth: 1 })
    try {
      // le premier : y = 1 − 0,5 / 8 × 2, rayon √(1 − y²), angle 0 → z = 0
      const l = lire(b.kids[0])
      proche(l.x, Math.sqrt(1 - .875 * .875) * .24 * 1000, 'x du premier panneau', .05)
      proche(l.y, .875 * .34 * 600, 'y du premier panneau', .05)
      proche(l.s, .8, 'taille du premier panneau', .001)
      proche(l.o, .77, 'opacité du premier panneau', .001)
      assert.ok(/^\d+$/.test(b.kids[0].style.zIndex), 'le z-index est un rang')
      const tous = b.kids.map(lire)
      assert.ok(tous.every((x) => !x.caché), 'la sphère montre tous ses panneaux')
      assert.ok(tous.every((x) => x.s >= .45 - 1e-6 && x.s <= 1.15 + 1e-6 && x.o >= .55 - 1e-6 && x.o <= .99 + 1e-6), 'taille bornée de 0,45 à 1,15, opacité de 0,55 à 0,99')
      // plus un panneau est loin (z petit), plus il est petit, pâle et bas dans la pile
      const ordre = b.kids.map((c: any, i: number) => ({ i, z: parseInt(c.style.zIndex), s: tous[i].s, o: tous[i].o })).sort((p, q) => p.z - q.z)
      for (let i = 1; i < ordre.length; i++) assert.ok(ordre[i].s >= ordre[i - 1].s - 1e-9 && ordre[i].o >= ordre[i - 1].o - 1e-9, 'taille et opacité croissent avec l\'ordre de superposition')
    }
    finally { b.fermer() }
  })

  it('gap : l\'écart entre deux panneaux, multiplié ; perspective : écrite en variable CSS ; style : change à chaud', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 3, smooth: 1, gap: 2, perspective: 800 })
    try {
      proche(lire(b.kids[4]).x, 980, 'x avec gap 2', .01)
      assert.equal(b.el.style.getPropertyValue('--mjs-gallery-perspective'), '800px')
      const off0 = b.off()
      b.µ._mjs_fxSet(b.el, 'gallery', { gap: 1, style: 'strip' }, undefined)
      assert.ok(b.off() === off0, 'gap et style se suivent sur place : l\'effet n\'est pas reposé')
      // la bande : 3,35 unités ; u vaut max(470 / 3,2, 310 / 4,1) = 146,9
      proche(lire(b.kids[4]).x, 3.35 * 470 / 3.2, 'x de la bande', .05)
      assert.equal(b.el.getAttribute('mjs-fx-gallery-axis'), null)
      b.µ._mjs_fxSet(b.el, 'gallery', { style: 'wheel' }, undefined)
      assert.equal(b.el.getAttribute('mjs-fx-gallery-axis'), 'y', 'la roue glisse en vertical')
      b.µ._mjs_fxSet(b.el, 'gallery', { on: 'pointer' }, undefined)
      assert.ok(b.off() !== off0, '`on` relance l\'effet (les écouteurs ne sont pas les mêmes)')
      assert.equal(b.el.getAttribute('mjs-fx-gallery-on'), 'pointer')
    }
    finally { b.fermer() }
  })
})

describe('*gallery — clavier, souris, inclinaison, événement `change`', function () {
  afterEach(rendre)

  this.timeout(30000)
  const touche = (b: any, key: string) => b.el.dispatchEvent(new b.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  it('flèches : panneau suivant et précédent, `change` à chaque nouveau panneau de tête, bornes tenues sans loop', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 6, smooth: 1 })
    try {
      assert.deepEqual(b.events, [], 'rien d\'émis à la pose')
      touche(b, 'ArrowRight')
      await attendre()
      assert.deepEqual(b.events, [7])
      touche(b, 'ArrowRight')
      await attendre()
      assert.deepEqual(b.events, [7], 'au dernier panneau, sans loop : on reste')
      touche(b, 'ArrowLeft')
      touche(b, 'ArrowLeft')
      await attendre()
      assert.deepEqual(b.events, [7, 5])
      assert.ok(b.kids[5].style.transform === 'translate3d(0px,0px,0px)', 'le panneau 5 est à plat devant')
    }
    finally { b.fermer() }
  })

  it('loop : après le dernier, le premier ; les voisins du premier sont les derniers', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 0, smooth: 1, loop: true })
    try {
      assert.ok(!lire(b.kids[7]).caché && lire(b.kids[7]).x < 0, 'le dernier panneau est à gauche du premier')
      touche(b, 'ArrowLeft')
      await attendre()
      assert.deepEqual(b.events, [7])
      touche(b, 'ArrowRight')
      touche(b, 'ArrowRight')
      await attendre()
      assert.deepEqual(b.events, [7, 1])
    }
    finally { b.fermer() }
  })

  it('pointer : la place de la souris, de gauche à droite', async () => {
    const b = monter({ style: 'strip', on: 'pointer', smooth: 1 })
    try {
      const bouge = (x: number, y = 300) => b.el.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
      bouge(900)
      await attendre()
      assert.deepEqual(b.events, [6], '90 % de la largeur : le panneau 6 (6,3 arrondi)')
      bouge(0)
      await attendre()
      assert.deepEqual(b.events, [6, 0])
      assert.ok(b.kids[0].style.transform.startsWith('translate3d(0px,'), 'le premier panneau est devant')
    }
    finally { b.fermer() }
  })

  it('tilt : la scène penche vers la souris (autour du centre), et se redresse à la sortie', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 3, smooth: 1, tilt: 10 })
    try {
      assert.equal(b.kids[3].style.transform, 'translate3d(0px,0px,0px)', 'sans souris : à plat')
      b.el.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: 1000, clientY: 0, bubbles: true }))
      await attendre()
      assert.ok(b.kids[3].style.transform.startsWith('rotateX(10deg) rotateY(10deg) translate3d(0px,0px,0px)'), b.kids[3].style.transform)
      b.el.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: 0, clientY: 600, bubbles: true }))
      await attendre()
      assert.ok(b.kids[3].style.transform.startsWith('rotateX(-10deg) rotateY(-10deg) translate3d('), b.kids[3].style.transform)
      b.el.dispatchEvent(new b.window.MouseEvent('pointerleave', { bubbles: false }))
      await attendre()
      assert.equal(b.kids[3].style.transform, 'translate3d(0px,0px,0px)')
      // tilt tenu par une variable : de 10 à 20 se suit sur place, de 10 à 0 relance (les écouteurs de la souris s'en vont)
      const off0 = b.off()
      b.µ._mjs_fxSet(b.el, 'gallery', { tilt: 20 }, undefined)
      assert.ok(b.off() === off0)
      b.µ._mjs_fxSet(b.el, 'gallery', { tilt: 0 }, undefined)
      assert.ok(b.off() !== off0)
    }
    finally { b.fermer() }
  })

  it('index suivi : le panneau de départ change à chaud', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 1, smooth: 1 })
    try {
      b.µ._mjs_fxSet(b.el, 'gallery', { index: 5 }, undefined)
      await attendre()
      assert.deepEqual(b.events, [5])
    }
    finally { b.fermer() }
  })

  it('des panneaux ajoutés ou retirés sont pris : le nouveau est placé, le retiré est rendu', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 3, smooth: 1 })
    try {
      const nouveau = b.window.document.createElement('img')
      Object.defineProperty(nouveau, 'offsetWidth', { value: 470 })
      Object.defineProperty(nouveau, 'offsetHeight', { value: 310 })
      b.el.appendChild(nouveau)
      await attendre()
      assert.ok(nouveau.hasAttribute('mjs-fx-gallery-hidden'), 'le neuvième panneau est hors scène, caché')
      const parti = b.kids[3]
      b.el.removeChild(parti)
      await attendre()
      assert.equal(parti.style.transform, '', 'le panneau retiré n\'a plus de transformation')
      assert.ok(!parti.hasAttribute('mjs-fx-gallery-hidden') && !parti.hasAttribute('inert'))
    }
    finally { b.fermer() }
  })
})

describe('*gallery — jamais une méthode de l\'auteur sur la balise ni sur les panneaux', function () {
  afterEach(rendre)

  this.timeout(30000)
  const METHODES = ['contains', 'focus', 'blur', 'click', 'getBoundingClientRect', 'getClientRects', 'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'closest', 'matches', 'querySelector', 'querySelectorAll', 'animate', 'getAnimations', 'remove', 'replaceWith', 'appendChild', 'insertBefore', 'after', 'scrollIntoView', 'setPointerCapture', 'releasePointerCapture', 'getRootNode']

  for (const mode of ['drag', 'pointer', 'always', 'scroll']) {
    it(`on: ${mode} : la balise et les panneaux sont des éléments dont chaque méthode est « écrite par l'auteur » ; l'effet passe par celles du prototype`, async () => {
      const appels: string[] = []
      const b = monter({ style: 'coverflow', on: mode, index: 2, smooth: 1, tilt: 5, speed: '100ms' }, {
        avant: (el, kids, win) => {
          for (const e of [el, ...kids]) {
            for (const nom of METHODES) {
              const natif = (win.Element.prototype as any)[nom] || (win.Node.prototype as any)[nom] || (win.EventTarget.prototype as any)[nom]
              if (typeof natif !== 'function') continue
              e[nom] = function (...args: any[]) {
                if (!/node_modules\/happy-dom/.test(String(new Error().stack).split('\n')[2])) appels.push(nom)
                return natif.apply(this, args)
              }
            }
          }
        }
      })
      try {
        for (const type of ['pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel', 'pointerleave', 'scroll']) {
          const ev = new b.window.Event(type, { bubbles: true, cancelable: true })
          Object.assign(ev, { clientX: 700, clientY: 100, pointerId: 1, pointerType: 'mouse', button: 0, key: 'ArrowRight', deltaX: 300, deltaY: 0, deltaMode: 0 })
          b.window.EventTarget.prototype.dispatchEvent.call(b.el, ev)
        }
        await attendre(150)
        b.retrait()
        assert.deepEqual([...new Set(appels)], [], 'l\'effet a appelé la méthode de l\'auteur')
      }
      finally { b.fermer() }
    })
  }
})

describe('*gallery — retrait, « réduire les animations », repos', function () {
  afterEach(rendre)

  this.timeout(30000)

  it('le retrait rend à la balise et aux panneaux ce que l\'auteur avait écrit', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 3, smooth: 1, perspective: 900 }, {
      avant: (el, kids) => {
        el.setAttribute('tabindex', '5')
        el.setAttribute('aria-roledescription', 'galerie')
        kids[4].setAttribute('style', 'opacity: 0.5; z-index: 99')
        kids[0].setAttribute('inert', '')
      }
    })
    try {
      assert.ok(b.kids[1].hasAttribute('mjs-fx-gallery-hidden'), 'le panneau 1 est caché pendant l\'effet')
      assert.equal(b.kids[4].style.opacity, '0.5', 'l\'opacité de l\'auteur reste tant que l\'effet n\'a rien à estomper')
      assert.ok(/^\d+$/.test(b.kids[4].style.zIndex) && b.kids[4].style.zIndex !== '99', 'le z-index est le rang de profondeur pendant l\'effet : celui de l\'auteur est écrasé')
      assert.equal(b.el.getAttribute('tabindex'), '5', 'le tabindex de l\'auteur reste')
      b.retrait()
      assert.deepEqual(b.el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'aucune marque sur la balise')
      assert.equal(b.el.getAttribute('tabindex'), '5')
      assert.equal(b.el.getAttribute('aria-roledescription'), 'galerie')
      assert.ok(!/--mjs-/.test(b.el.getAttribute('style') ?? ''), 'aucune variable CSS restée')
      assert.equal(b.el._mjs_fxOff ?? null, null, 'retrait inscrit')
      assert.equal(b.kids[4].style.opacity, '0.5')
      assert.equal(b.kids[4].style.zIndex, '99')
      assert.equal(b.kids[4].style.transform, '')
      assert.ok(b.kids[0].hasAttribute('inert'), 'l\'inert de l\'auteur reste')
      for (const c of b.kids.filter((_: any, i: number) => i !== 0 && i !== 4)) {
        assert.deepEqual(c.getAttributeNames(), [], 'un panneau sans style ni attribut au départ n\'en a plus')
      }
      await attendre()
      assert.equal(b.pend.size, 0, 'plus d\'image d\'animation en attente')
    }
    finally { b.fermer() }
  })

  it('sans tabindex ni aria-roledescription de l\'auteur : les siens partent au retrait', () => {
    const b = monter({ style: 'coverflow', on: 'drag', smooth: 1 })
    try {
      assert.equal(b.el.getAttribute('tabindex'), '0')
      b.retrait()
      assert.deepEqual(b.el.getAttributeNames(), [])
    }
    finally { b.fermer() }
  })

  it('« réduire les animations » : pas de lissage ni d\'élan, `always` ne tourne pas, la scène ne penche pas', async () => {
    const b = monter({ style: 'coverflow', on: 'always', index: 2, speed: '100ms', smooth: 0.02, tilt: 10 }, { calme: true })
    try {
      await attendre(300)
      assert.deepEqual(b.events, [], 'always ne tourne pas')
      assert.equal(b.pend.size, 0)
      b.el.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      await attendre()
      // un seul pas suffit : la place est prise sans lissage (smooth 0,02 aurait pris plus d'une seconde)
      assert.deepEqual(b.events, [3])
      assert.equal(b.kids[3].style.transform, 'translate3d(0px,0px,0px)')
      b.el.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: 1000, clientY: 0, bubbles: true }))
      await attendre()
      assert.equal(b.kids[3].style.transform, 'translate3d(0px,0px,0px)', 'pas d\'inclinaison')
    }
    finally { b.fermer() }
  })

  it('always : la galerie avance toute seule, un panneau par `speed`, et rien ne tourne une fois l\'effet retiré', async () => {
    const b = monter({ style: 'coverflow', on: 'always', index: 0, speed: '120ms', smooth: 1 })
    try {
      await attendre(420)
      assert.ok(b.events.length >= 2 && b.events[0] === 1, `elle a avancé : ${JSON.stringify(b.events)}`)
      assert.ok(b.pend.size > 0, 'pendant la marche, une boucle')
      b.retrait()
      assert.equal(b.pend.size, 0, 'retirée, plus aucune image d\'animation en attente')
    }
    finally { b.fermer() }
  })

  it('rien ne tourne au repos : le mouvement fini, plus d\'image d\'animation en attente ; will-change posé seulement pendant', async () => {
    const b = monter({ style: 'coverflow', on: 'drag', index: 0, smooth: 0.3 })
    try {
      b.el.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      assert.ok(b.pend.size > 0, 'le mouvement a sa boucle')
      assert.ok(b.el.hasAttribute('mjs-fx-gallery-moving'), 'will-change se pose avec le mouvement')
      await attendre(1500)
      assert.equal(b.pend.size, 0, 'la boucle s\'est arrêtée d\'elle-même')
      assert.ok(!b.el.hasAttribute('mjs-fx-gallery-moving'), 'will-change retiré au repos')
      assert.deepEqual(b.events, [1])
      assert.equal(b.kids[1].style.transform, 'translate3d(0px,0px,0px)', 'posée pile sur le panneau')
    }
    finally { b.fermer() }
  })
})
