// *scrub — une vidéo, ou une suite d'images, qui avance avec le défilement : la compilation de ses
// réglages (dont une liste d'adresses data:), les refus, la suite d'images (adresses, six chargements
// au plus, image la plus proche déjà prête, toile à la taille de la balise × la densité), la vidéo
// (en pause, muette, une recherche à la fois), la boucle (aucune au repos, elle s'arrête d'elle-même),
// le suivi sur place des réglages tenus par une variable, et le retrait qui ne laisse rien.
// happy-dom ne mesure ni ne décode rien : le défilement, les images, les observateurs et les images
// d'animation sont des bouchons que le banc pilote à la main.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect } from '../src/effects/catalog.js'

const ICI  = dirname(fileURLToPath(import.meta.url))
const CODE = ['mjs_fx.ts', 'mjs_fx_scrub.ts'].map((f) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')).join('\n')

// n adresses de suite, `i0.webp`, `i1.webp`…
const adresses = (n: number) => Array.from({ length: n }, (_, i) => `i${i}.webp`)
const tour     = () => new Promise((r) => setTimeout(r, 0))

// la fenêtre du banc : le moteur et l'effet chargés, tout ce qui mesure ou décode remplacé par un bouchon
function banc(options: { calm?: boolean, dpr?: number } = {}) {
  const window: any = new Window({ url: 'http://localhost/' })
  const b: any = { window, warns: [] as string[], images: [] as any[], ios: [] as any[], ros: [] as any[], scrolls: [] as any[], now: 0 }
  Object.defineProperty(window, 'devicePixelRatio', { value: options.dpr ?? 1, configurable: true })
  window.matchMedia = () => ({ matches: !!options.calm })
  // les images : chaque `new Image()` est notée, son décodage attend qu'on le libère (ok) ou le refuse (ko)
  window.Image = class {
    decoding = ''
    naturalWidth = 480
    naturalHeight = 270
    history: string[] = []
    ok!: () => void
    ko!: () => void
    constructor() { b.images.push(this) }
    set src(v: string) { this.history.push(v) }
    get src() { return this.history[this.history.length - 1] ?? '' }
    decode() { return new Promise<void>((ok, ko) => { this.ok = ok; this.ko = () => ko(new Error('decode')) }) }
  }
  // les images d'animation : une file que `frame()` vide
  let id = 0
  const file = new Map<number, (t: number) => void>()
  window.requestAnimationFrame = (f: (t: number) => void) => { file.set(++id, f); return id }
  window.cancelAnimationFrame = (h: number) => { file.delete(h) }
  b.pending = () => file.size
  b.frame = (ms = 16) => {
    b.now += ms
    const run = [...file.values()]
    file.clear()
    for (const f of run) f(b.now)
  }
  window.IntersectionObserver = class {
    gone = false
    constructor(public cb: (e: any[]) => void, public opts: any) { b.ios.push(this) }
    observe() {}
    disconnect() { this.gone = true }
  }
  window.ResizeObserver = class {
    gone = false
    el: any = null
    constructor(public cb: (e: any[]) => void) { b.ros.push(this) }
    observe(el: any) { this.el = el }
    disconnect() { this.gone = true }
  }
  // la boîte d'une balise : celle que le banc lui donne (`__rect`), vide sinon ; le prototype de happy-dom est celui de toutes les fenêtres, il est rendu à la fermeture
  const proto = window.Element.prototype
  const avant = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
  proto.getBoundingClientRect = function () { return this.__rect ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  b.close = () => {
    if (avant) Object.defineProperty(proto, 'getBoundingClientRect', avant)
    else delete proto.getBoundingClientRect
    window.close()
  }
  window.eval('globalThis.µ = {}')
  window.eval(CODE)
  const µ = window.µ
  µ.warn = (m: string) => { b.warns.push(m) }
  µ._mjs_msg = (_k: string, v: any, fr: string) => '[ModularJS] ' + fr.replace(/\{(\w+)\}/g, (_m: string, n: string) => v && n in v ? v[n] : _m)
  // le défilement : `f(p)` est appelé à la main par le banc ; le moteur, lui, l'appelle une première fois dès la pose (b.start : la position de départ)
  µ._mjs_fxScroll = (el: any, f: (p: number) => void, zone: string) => {
    const t = { el, f, zone, gone: false }
    b.scrolls.push(t)
    f(b.start ?? 0)
    return () => { t.gone = true }
  }
  b.setup   = (el: any, s: any) => µ._mjs_fxDefs.scrub.setup(el, s)
  b.el      = (html: string) => {
    const d = window.document.createElement('div')
    d.innerHTML = html
    window.document.body.appendChild(d)
    return d.firstElementChild
  }
  // l'observateur de présence dit « près de la vue » (ou plus)
  b.near    = (yes = true) => b.ios[b.ios.length - 1].cb([{ isIntersecting: yes }])
  // la toile : un contexte 2d qui note ses appels
  b.canvas  = (attrs = '') => {
    const c: any = b.el(`<canvas ${attrs}></canvas>`)
    const ctx: any = { calls: [] as any[], clears: 0, clearRect() { ctx.clears++ }, drawImage(...a: any[]) { ctx.calls.push(a) } }
    c.getContext = () => ctx
    return { c, ctx }
  }
  // la vidéo : son temps, sa durée, son état de recherche et ses pauses sont ceux que le banc donne
  b.video   = (attrs = '', dur = 0) => {
    const v: any = b.el(`<video ${attrs}></video>`)
    const st = { t: 0, writes: [] as number[], seeking: false, dur, pauses: 0, muted: /\bmuted\b/.test(attrs) }
    Object.defineProperty(v, 'currentTime', { get: () => st.t, set: (x) => { st.writes.push(x); st.t = x }, configurable: true })
    Object.defineProperty(v, 'duration', { get: () => st.dur || NaN, configurable: true })
    Object.defineProperty(v, 'readyState', { get: () => st.dur ? 4 : 0, configurable: true })
    Object.defineProperty(v, 'seeking', { get: () => st.seeking, configurable: true })
    Object.defineProperty(v, 'muted', { get: () => st.muted, set: (x) => { st.muted = !!x }, configurable: true })
    v.pause = () => { st.pauses++ }
    v.st = st
    return v
  }
  // la balise change de taille : sa boîte est celle que le RO annonce
  b.resize  = (i: number, w: number, h: number) => {
    const r = b.ros[i]
    r.el.__rect = { left: 0, top: 0, right: w, bottom: h, width: w, height: h }
    r.cb([{ contentRect: { width: w, height: h } }])
  }
  // tout ce qui est en route est décodé, jusqu'à la fin de la suite
  b.tout    = async () => {
    for (let n = 0; n < 12; n++) {
      for (const i of b.images) i.ok()
      await tour()
    }
  }
  // libère le décodage de l'image i, et laisse les promesses se dénouer
  b.libere  = async (...is: number[]) => {
    for (const i of is) b.images[i].ok()
    await tour()
  }
  return b
}

const marques = (el: any) => el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx'))

describe('*scrub — compilation de ses réglages', () => {
  it('frames au réglage principal, count, first, from, to, smooth, fit, reverse, on, zone', () => {
    const r = parseEffect('scrub', "'img/seq-###.webp', count: 120, first: 0, from: 0.1, to: 0.9, smooth: 0.3, fit: contain, reverse: true, on: hover, zone: 80% 20%")
    assert.deepEqual(r.fixed, { frames: 'img/seq-###.webp', count: 120, first: 0, from: 0.1, to: 0.9, smooth: 0.3, fit: 'contain', reverse: true, on: 'hover', zone: '80% 20%' })
  })

  it('les valeurs hors règle sont refusées au build : une seule image, lissage > 1, mot inconnu, portion hors 0..1', () => {
    for (const mauvais of ['count: 1', 'count: 2001', 'smooth: 1.5', 'on: click', 'fit: stretch', 'from: -0.1', 'to: 1.2', 'first: -1', 'zone: 50% 50%', 'reverse: 1']) {
      assert.throws(() => parseEffect('scrub', `frames: 'a-###.webp', ${mauvais}`), /scrub/, mauvais)
    }
  })

  it('images : une liste d\'adresses, dont des adresses data: (virgules comprises) quand chacune est entre guillemets simples', () => {
    const a = 'data:image/svg+xml,%3Csvg%20width%3D%27480%27%3E%3C%2Fsvg%3E'
    const b = 'data:image/svg+xml,%3Csvg%20width%3D%27270%27%3E%3C%2Fsvg%3E'
    const r = parseEffect('scrub', `images: ['${a}', '${b}'], on: hover`)
    assert.deepEqual(r.fixed.images, [a, b])
    assert.deepEqual(parseEffect('scrub', 'images: [a.webp, b.webp, c.webp]').fixed.images, ['a.webp', 'b.webp', 'c.webp'])
  })

  it('une adresse data: écrite sans guillemets est coupée à sa virgule (la règle words), d\'où les guillemets simples', () => {
    const r = parseEffect('scrub', 'images: [data:image/svg+xml,%3Csvg%3E, b.webp]')
    assert.deepEqual(r.fixed.images, ['data:image/svg+xml', '%3Csvg%3E', 'b.webp'])
  })

  it('un réglage tenu par une variable arrive avec sa règle', () => {
    const r = parseEffect('scrub', 'images: $images, smooth: $lissage, from: $debut, fit: $cadre')
    assert.deepEqual(Object.keys(r.dynamic).sort(), ['fit', 'from', 'images', 'smooth'])
    assert.equal(r.spec.images[0], 'w')
    assert.deepEqual(r.spec.smooth.slice(0, 3), ['f', 0, 1])
    assert.equal(r.spec.fit[0], 'l')
  })

  it('un effet de défilement : famille scroll, frames en réglage principal, valeurs par défaut du catalogue', async () => {
    const { EFFECTS } = await import('../src/effects/catalog.js')
    assert.equal(EFFECTS.scrub.family, 'scroll')
    assert.equal(EFFECTS.scrub.main, 'frames')
    const d = (k: string) => EFFECTS.scrub.settings[k].dflt
    assert.deepEqual([d('first'), d('on'), d('from'), d('to'), d('smooth'), d('fit'), d('reverse')], [1, 'scroll', 0, 1, 0.15, 'cover', false])
    assert.deepEqual([d('frames'), d('count'), d('images'), d('zone')], [undefined, undefined, undefined, undefined])
  })
})

describe('*scrub — refus', () => {
  let b: any
  afterEach(() => { b.close() })

  it('ni <video> ni frames : refusé, une seule fois, et rien n\'est posé', () => {
    b = banc()
    const el = b.el('<div>x</div>')
    const off = b.setup(el, {})
    assert.equal(b.warns.length, 1)
    assert.match(b.warns[0], /\*scrub/)
    assert.match(b.warns[0], /<video>/)
    assert.match(b.warns[0], /<div>/)
    assert.equal(typeof off, 'function')
    off()
    assert.equal(b.scrolls.length + b.ios.length + b.ros.length + b.pending(), 0)
    assert.deepEqual(marques(el), [])
  })

  it('frames sans count : refusé, le message écrit ce qu\'il faut écrire', () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { frames: 'a-###.webp' })
    assert.equal(b.warns.length, 1)
    assert.match(b.warns[0], /count/)
    assert.equal(b.images.length, 0)
  })

  it('frames sans # : refusé (rien ne donnerait le numéro de l\'image)', () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { frames: 'a.webp', count: 10 })
    assert.equal(b.warns.length, 1)
    assert.match(b.warns[0], /###/)
  })

  it('une suite d\'images sur une <video> ou une <div> : refusée', () => {
    b = banc()
    b.setup(b.video(), { frames: 'a-###.webp', count: 10 })
    b.setup(b.el('<div></div>'), { images: adresses(3) })
    assert.equal(b.warns.length, 2)
    assert.match(b.warns[0], /<canvas>/)
    assert.match(b.warns[1], /<div>/)
  })

  it('un <canvas> qui porte déjà un autre contexte que 2d : refusé', () => {
    b = banc()
    const { c } = b.canvas()
    c.getContext = () => null
    b.setup(c, { images: adresses(3) })
    assert.equal(b.warns.length, 1)
    assert.match(b.warns[0], /2d/)
  })
})

describe('*scrub — suite d\'images', () => {
  let b: any
  afterEach(() => { b.close() })

  it('le gabarit : ### = le numéro, complété de zéros, à partir de first ; chaque suite de # a sa largeur', async () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { frames: 'x/#/f-#####.webp', count: 3, first: 8 })
    b.near()
    assert.deepEqual(b.images.map((i: any) => i.src), ['x/8/f-00008.webp', 'x/9/f-00009.webp', 'x/10/f-00010.webp'])
  })

  it('l\'image voulue d\'abord, puis ses voisines ; rien ne charge tant que la balise est loin de la vue', () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { frames: 'seq-###.webp', count: 20, first: 3 })
    assert.equal(b.images.length, 0, 'balise loin : aucun chargement')
    assert.equal(b.ios[0].opts.rootMargin, '100% 0px')
    b.near()
    assert.deepEqual(b.images.slice(0, 3).map((i: any) => i.src), ['seq-003.webp', 'seq-004.webp', 'seq-005.webp'])
  })

  it('jamais plus de six chargements à la fois : un de plus part quand un se termine, le plus proche de l\'image voulue', async () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { frames: 'seq-###.webp', count: 20, smooth: 0 })
    b.near()
    assert.equal(b.images.length, 6)
    // on saute à la fin : rien ne part tant que six sont en route
    b.scrolls[0].f(1)
    assert.equal(b.images.length, 6)
    await b.libere(0)
    assert.equal(b.images.length, 7)
    assert.equal(b.images[6].src, 'seq-020.webp', 'la nouvelle part de l\'image voulue (la dernière)')
    await b.libere(6)
    assert.equal(b.images[7].src, 'seq-019.webp')
  })

  it('une image perdue n\'est pas redemandée ; tout est chargé, puis plus rien ne part', async () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { images: adresses(4) })
    b.near()
    b.images[1].ko()
    for (const i of [0, 2, 3]) b.images[i].ok()
    await tour()
    assert.equal(b.images.length, 4)
    b.scrolls[0].f(1)
    b.frame()
    assert.equal(b.images.length, 4)
  })

  it('une image pas encore prête cède la place à la plus proche déjà prête', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(5), smooth: 0 })
    b.near()
    b.resize(0, 400, 400)
    await b.libere(3)
    assert.equal(ctx.calls.length, 1)
    assert.ok(ctx.calls[0][0] === b.images[3], 'seule l\'image 3 est prête : c\'est elle qu\'on montre')
    // l'image voulue arrive : elle remplace la voisine
    await b.libere(0)
    assert.equal(ctx.calls.length, 2)
    assert.ok(ctx.calls[1][0] === b.images[0])
  })

  it('canvas, cover : l\'image remplit la balise, rognée au centre', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(2), smooth: 0 })
    b.near()
    b.resize(0, 400, 400)
    await b.libere(0)
    const k = 400 / 270
    assert.deepEqual(ctx.calls[0].slice(1).map((x: number) => Math.round(x * 1000) / 1000), [Math.round((480 - 400 / k) / 2 * 1000) / 1000, 0, Math.round(400 / k * 1000) / 1000, Math.round(400 / k * 1000) / 1000, 0, 0, 400, 400])
  })

  it('canvas, contain : l\'image est entière et centrée, la toile effacée avant', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    const off = b.setup(c, { images: adresses(2), smooth: 0, fit: 'contain' })
    b.near()
    b.resize(0, 400, 400)
    await b.libere(0)
    assert.deepEqual(ctx.calls[0].slice(1), [0, 0, 480, 270, 0, 87.5, 400, 225])
    assert.ok(ctx.clears >= 1)
    // le cadrage change sur place (réglage tenu par une variable) : la même image est redessinée en cover
    assert.equal(off.set('fit', 'cover'), undefined)
    assert.equal(ctx.calls.length, 2)
    assert.equal(ctx.calls[1][1], (480 - 400 / (400 / 270)) / 2)
  })

  it('la toile : taille de la balise × la densité de l\'écran, au plus 2 ; une boîte vide est ignorée ; redessinée au redimensionnement', async () => {
    b = banc({ dpr: 3 })
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(1), smooth: 0 })
    b.near()
    await b.libere(0)
    b.resize(0, 0, 0)
    assert.deepEqual([c.width, c.height], [300, 150], 'boîte vide : rien ne change')
    b.resize(0, 300, 100)
    assert.deepEqual([c.width, c.height], [600, 200], 'densité 3 plafonnée à 2')
    assert.equal(ctx.calls.length, 2, 'la toile vidée est redessinée')
    b.resize(0, 300, 100)
    assert.equal(ctx.calls.length, 2, 'même taille : rien à refaire')
  })

  it('<img> : son src change (l\'adresse d\'origine est rendue au retrait) ; sans src, l\'attribut est retiré', async () => {
    b = banc()
    const img = b.el('<img alt="a" src="origine.webp">')
    const off = b.setup(img, { images: adresses(3), smooth: 0 })
    b.near()
    await b.libere(0)
    assert.equal(img.getAttribute('src'), 'i0.webp')
    b.scrolls[0].f(1)
    await b.libere(2)
    assert.equal(img.getAttribute('src'), 'i2.webp')
    off()
    assert.equal(img.getAttribute('src'), 'origine.webp')
    const nu = b.el('<img alt="b">')
    const off2 = b.setup(nu, { images: adresses(2) })
    b.near()
    await b.libere(b.images.length - 2)
    assert.ok(nu.hasAttribute('src'))
    off2()
    assert.ok(!nu.hasAttribute('src'))
  })

  it('images : un élément est une adresse, ou l\'objet que rend µimage (en objet, ou en texte JSON comme un chemin local de la liste le devient au build) : son src est chargé, jamais une variante de son srcset', () => {
    b = banc()
    const { c } = b.canvas()
    const objet = { src: '/assets/a-0123abcd.webp', srcset: '/assets/a-0123abcd-320.webp 320w, /assets/a-0123abcd-640.webp 640w', sizes: '100vw', width: 1280, height: 720 }
    const texte = JSON.stringify({ src: '/assets/b-4567abcd.webp', srcset: '/assets/b-4567abcd-320.webp 320w', sizes: '100vw', width: 1280, height: 720 })
    b.setup(c, { images: [objet, texte, 'https://exemple.test/c.webp', 'data:image/svg+xml,%3Csvg%3E', 'd.webp'], smooth: 0 })
    b.near()
    assert.deepEqual(b.images.map((i: any) => i.src), ['/assets/a-0123abcd.webp', '/assets/b-4567abcd.webp', 'https://exemple.test/c.webp', 'data:image/svg+xml,%3Csvg%3E', 'd.webp'])
  })

  it('images : un texte entre accolades qui n\'est pas du JSON, ou du JSON sans src, est chargé tel quel (rien n\'est deviné)', () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { images: ['{pas du json', '{"srcset":"x 320w"}'], smooth: 0 })
    b.near()
    assert.deepEqual(b.images.map((i: any) => i.src), ['{pas du json', '{"srcset":"x 320w"}'])
  })

  it('<img> : le src de la balise est l\'adresse de l\'objet de µimage, pas son texte JSON', async () => {
    b = banc()
    const img = b.el('<img alt="a">')
    b.setup(img, { images: [JSON.stringify({ src: '/assets/a-0123abcd.webp', srcset: '' }), { src: '/assets/b-4567abcd.webp', srcset: '/assets/b-4567abcd-320.webp 320w' }], smooth: 0 })
    b.near()
    await b.libere(0)
    assert.equal(img.getAttribute('src'), '/assets/a-0123abcd.webp')
    b.scrolls[0].f(1)
    await b.libere(1)
    assert.equal(img.getAttribute('src'), '/assets/b-4567abcd.webp')
  })

  it('from, to, reverse : la portion de la suite et son sens', async () => {
    b = banc()
    const img = b.el('<img alt="a">')
    b.setup(img, { images: adresses(11), smooth: 0, from: 0.2, to: 0.6, reverse: true })
    b.near()
    await b.tout()
    // p = 0, à l'envers : la fin de la portion (0.6 → image 6)
    assert.equal(img.getAttribute('src'), 'i6.webp')
    b.scrolls[0].f(1)
    assert.equal(img.getAttribute('src'), 'i2.webp', 'p = 1 : le début de la portion (0.2 → image 2)')
  })

  it('la balise s\'éloigne : les chargements en route sont abandonnés, les images lâchées, la toile gardée ; une image qui se termine après coup ne fait rien', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(10), smooth: 0 })
    b.near()
    b.resize(0, 400, 225)
    await b.libere(0, 1, 2)
    assert.equal(b.images.length, 9, 'trois prêtes, six en route')
    const efface = ctx.clears
    b.near(false)
    assert.ok(b.images.slice(3).every((i: any) => i.src === ''), 'les chargements en route sont abandonnés')
    assert.ok(b.images.slice(0, 3).every((i: any) => i.src !== ''), 'les images prêtes sont seulement lâchées')
    assert.equal(ctx.clears, efface, 'la toile garde la dernière image dessinée tant qu\'elle est loin')
    const dessins = ctx.calls.length
    await b.libere(3, 4)
    assert.equal(ctx.calls.length, dessins, 'une image abandonnée qui se termine après coup ne se dessine pas')
    assert.equal(b.images.length, 9, 'et rien de plus ne part tant que la balise est loin')
  })

  it('elle revient : la suite se recharge depuis l\'image où l\'on est, six chargements à la fois, et se redessine', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(10), smooth: 0 })
    b.near()
    b.resize(0, 400, 225)
    await b.tout()
    assert.equal(b.images.length, 10)
    const dessins = ctx.calls.length
    b.near(false)
    b.start = 0.5
    b.near(true)
    assert.equal(ctx.calls.length, dessins, 'rien n\'est redessiné tant qu\'une image rechargée n\'est pas décodée : la toile garde l\'ancienne')
    assert.deepEqual(b.images.slice(10).map((i: any) => i.src), ['i5.webp', 'i6.webp', 'i4.webp', 'i7.webp', 'i3.webp', 'i8.webp'], 'six chargements, les plus proches de l\'image où l\'on est d\'abord')
    await b.libere(10)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[10], 'la nouvelle image 5 est dessinée')
    await b.tout()
    assert.equal(b.images.length, 20, 'toute la suite est redemandée, pas une image de plus')
  })

  it('une image abandonnée qui se termine après le retour ne dérègle pas le compte : six chargements à la fois, pas sept', async () => {
    b = banc()
    const { c } = b.canvas()
    b.setup(c, { images: adresses(20), smooth: 0 })
    b.near()
    assert.equal(b.images.length, 6)
    b.near(false)
    b.near(true)
    assert.equal(b.images.length, 12, 'six nouveaux chargements')
    await b.libere(0, 1)
    assert.equal(b.images.length, 12, 'les anciens, abandonnés, n\'en libèrent aucun de plus')
    await b.libere(6)
    assert.equal(b.images.length, 13, 'un nouveau qui se termine en libère un')
  })

  it('<img> : son src reste sur la dernière image montrée quand la suite est lâchée, et suit de nouveau au retour', async () => {
    b = banc()
    const img = b.el('<img alt="a" src="origine.webp">')
    b.setup(img, { images: adresses(4), smooth: 0 })
    b.near()
    await b.tout()
    assert.equal(img.getAttribute('src'), 'i0.webp')
    b.near(false)
    assert.equal(img.getAttribute('src'), 'i0.webp', 'loin : l\'image reste affichée')
    b.start = 1
    b.near(true)
    await b.tout()
    assert.equal(img.getAttribute('src'), 'i3.webp')
  })
})

describe('*scrub — vidéo', () => {
  let b: any
  afterEach(() => { b.close() })

  it('en pause, muette ; preload ne passe à auto qu\'à l\'approche ; tout est rendu au retrait (son attribut muted compris)', () => {
    b = banc()
    const v = b.video('', 10)
    const off = b.setup(v, {})
    assert.equal(v.st.pauses, 1)
    assert.equal(v.st.muted, true)
    assert.ok(v.hasAttribute('muted'))
    assert.ok(!v.hasAttribute('preload'), 'loin de la vue : aucun preload posé')
    b.near()
    assert.equal(v.getAttribute('preload'), 'auto')
    off()
    assert.equal(v.st.muted, false)
    assert.ok(!v.hasAttribute('muted'))
    assert.ok(!v.hasAttribute('preload'))
  })

  it('une vidéo déjà muette, avec son preload : celui de l\'auteur tant qu\'elle est loin, auto à l\'approche, rendu tel quel au retrait', () => {
    b = banc()
    const v = b.video('muted preload="metadata"', 10)
    const off = b.setup(v, {})
    assert.equal(v.getAttribute('preload'), 'metadata', 'loin de la vue : le preload de l\'auteur')
    b.near()
    assert.equal(v.getAttribute('preload'), 'auto')
    off()
    assert.ok(v.hasAttribute('muted'))
    assert.equal(v.st.muted, true)
    assert.equal(v.getAttribute('preload'), 'metadata')
  })

  it('loin de la vue : le preload de l\'auteur reste en place et rien n\'est écrit dans currentTime, même quand la durée est connue ; la première écriture attend l\'approche', () => {
    b = banc()
    const v = b.video('preload="none"', 10)
    const off = b.setup(v, { smooth: 0 })
    assert.equal(v.getAttribute('preload'), 'none')
    assert.deepEqual(v.st.writes, [], 'durée déjà connue à la pose : aucune recherche')
    assert.equal(b.scrolls.length, 0, 'et aucun suivi du défilement')
    v.dispatchEvent(new b.window.Event('loadedmetadata'))
    v.dispatchEvent(new b.window.Event('seeked'))
    assert.deepEqual(v.st.writes, [], 'les métadonnées arrivent alors qu\'elle est loin : toujours rien')
    assert.equal(v.getAttribute('preload'), 'none')
    b.start = 0.5
    b.near()
    assert.equal(v.getAttribute('preload'), 'auto')
    assert.deepEqual(v.st.writes, [5], 'à l\'approche : la première écriture, à la position où l\'on est')
    off()
    assert.equal(v.getAttribute('preload'), 'none', 'le preload de l\'auteur est rendu')
  })

  it('une vidéo qui s\'éloigne de nouveau ne cherche plus rien (son preload reste à auto, elle ne se décharge pas) ; retirée sans être venue près, elle garde son preload', () => {
    b = banc()
    const v = b.video('preload="metadata"', 10)
    const off = b.setup(v, { smooth: 0 })
    b.near()
    assert.deepEqual(v.st.writes, [0])
    b.near(false)
    v.dispatchEvent(new b.window.Event('loadedmetadata'))
    v.dispatchEvent(new b.window.Event('seeked'))
    assert.deepEqual(v.st.writes, [0], 'de nouveau loin : aucune recherche')
    assert.equal(v.getAttribute('preload'), 'auto')
    off()
    assert.equal(v.getAttribute('preload'), 'metadata', 'rendu au retrait')
    const w = b.video('preload="none"', 10)
    const off2 = b.setup(w, {})
    off2()
    assert.equal(w.getAttribute('preload'), 'none', 'jamais venue près : rien n\'a été touché')
    assert.deepEqual(w.st.writes, [])
  })

  it('un lancement (autoplay, un clic sur les commandes) est remis en pause tant que l\'effet est là', () => {
    b = banc()
    const v = b.video('autoplay', 10)
    const off = b.setup(v, {})
    const avant = v.st.pauses
    v.dispatchEvent(new b.window.Event('play'))
    assert.equal(v.st.pauses, avant + 1)
    off()
    v.dispatchEvent(new b.window.Event('play'))
    assert.equal(v.st.pauses, avant + 1, 'retiré : plus de garde')
  })

  it('la durée est lue à loadedmetadata ; rien n\'est écrit avant', () => {
    b = banc()
    const v = b.video('', 0)
    b.setup(v, { smooth: 0 })
    b.near()
    b.scrolls[0].f(0.5)
    assert.deepEqual(v.st.writes, [])
    v.st.dur = 8
    v.dispatchEvent(new b.window.Event('loadedmetadata'))
    assert.deepEqual(v.st.writes, [4])
  })

  it('currentTime n\'est écrit que si la cible a bougé d\'au moins une image (1/30 s) et qu\'aucune recherche n\'est en cours', () => {
    b = banc()
    const v = b.video('', 10)
    b.setup(v, { smooth: 0 })
    assert.deepEqual(v.st.writes, [], 'loin de la vue : rien n\'est écrit')
    b.near()
    assert.deepEqual(v.st.writes, [0], 'la première image, à l\'approche')
    b.scrolls[0].f(0.01)
    assert.deepEqual(v.st.writes, [0, 0.1])
    b.scrolls[0].f(0.0105)
    assert.equal(v.st.writes.length, 2, 'moins de 1/30 s plus loin : rien')
    v.st.seeking = true
    b.scrolls[0].f(0.5)
    b.scrolls[0].f(0.6)
    assert.equal(v.st.writes.length, 2, 'une recherche en cours : jamais deux empilées')
    v.st.seeking = false
    v.dispatchEvent(new b.window.Event('seeked'))
    assert.deepEqual(v.st.writes, [0, 0.1, 6], 'à la fin de la recherche, la cible du moment est reprise')
    v.dispatchEvent(new b.window.Event('seeked'))
    assert.equal(v.st.writes.length, 3, 'rien de plus : aucune boucle de recherches')
  })

  it('from, to, reverse : la portion de la vidéo et son sens ; la fin reste dans la vidéo', () => {
    b = banc()
    const v = b.video('', 8)
    b.setup(v, { smooth: 0, from: 0.25, to: 0.75 })
    b.near()
    assert.equal(v.st.writes[v.st.writes.length - 1], 2)
    b.scrolls[0].f(1)
    assert.equal(v.st.writes[v.st.writes.length - 1], 6)
    const w = b.video('', 8)
    b.setup(w, { smooth: 0, reverse: true })
    b.near()
    assert.equal(w.st.writes[w.st.writes.length - 1], 7.99, 'à l\'envers, p = 0 : la fin (la durée moins 10 ms)')
  })
})

describe('*scrub — la boucle', () => {
  let b: any
  afterEach(() => { b.close() })

  async function prete(s: any, options = {}) {
    b = banc(options)
    const { c, ctx } = b.canvas()
    const off = b.setup(c, { images: adresses(24), ...s })
    b.near()
    b.resize(0, 240, 135)
    await b.tout()
    return { c, ctx, off }
  }
  const dernier = (ctx: any) => ctx.calls[ctx.calls.length - 1]

  it('au repos : aucune image d\'animation en attente, ni après la pose ni après un défilement qui ne change rien', async () => {
    const { ctx } = await prete({})
    assert.equal(b.images.length, 24)
    assert.equal(b.pending(), 0)
    b.scrolls[0].f(0)
    assert.equal(b.pending(), 0)
    assert.ok(dernier(ctx)[0] === b.images[0])
  })

  it('lissé : la boucle part, rejoint la cible, s\'arrête d\'elle-même et ne laisse aucune image d\'animation', async () => {
    const { ctx } = await prete({ smooth: 0.15 })
    b.scrolls[0].f(1)
    assert.equal(b.pending(), 1)
    let n = 0
    let milieu = -1
    while (b.pending() > 0 && n < 400) {
      b.frame()
      n++
      if (n === 3) milieu = b.images.indexOf(dernier(ctx)[0])
    }
    assert.ok(n > 5 && n < 150, `images d'animation : ${n}`)
    assert.equal(b.pending(), 0)
    assert.ok(dernier(ctx)[0] === b.images[23])
    assert.ok(milieu > 0 && milieu < 23, `après trois images la suite est en route (image ${milieu})`)
    b.frame()
    assert.equal(b.pending(), 0)
  })

  it('un lissage plus fort met plus de temps à arriver', async () => {
    await prete({ smooth: 0.05 })
    b.scrolls[0].f(1)
    let vif = 0
    while (b.pending() > 0 && vif < 600) { b.frame(); vif++ }
    b.close()
    await prete({ smooth: 0.6 })
    b.scrolls[0].f(1)
    let lent = 0
    while (b.pending() > 0 && lent < 600) { b.frame(); lent++ }
    assert.ok(lent > vif * 2, `${lent} images contre ${vif}`)
  })

  it('sans lissage (smooth: 0) : l\'image suit tout de suite, sans aucune image d\'animation', async () => {
    const { ctx } = await prete({ smooth: 0 })
    b.scrolls[0].f(1)
    assert.equal(b.pending(), 0)
    assert.ok(dernier(ctx)[0] === b.images[23])
  })

  it('« réduire les animations » : pas de lissage, la position suit directement', async () => {
    const { ctx } = await prete({ smooth: 0.9 }, { calm: true })
    b.scrolls[0].f(0.5)
    assert.equal(b.pending(), 0)
    assert.ok(dernier(ctx)[0] === b.images[12])
  })

  it('hors de la vue : le défilement n\'est plus écouté, la boucle en route est coupée ; de retour, il repart et la première position est prise d\'un coup', async () => {
    const { ctx } = await prete({ smooth: 0.15 })
    b.scrolls[0].f(1)
    assert.equal(b.pending(), 1)
    b.near(false)
    assert.ok(b.scrolls[0].gone)
    assert.equal(b.pending(), 0)
    b.start = 1
    b.near(true)
    assert.equal(b.scrolls.length, 2)
    assert.ok(!b.scrolls[1].gone)
    assert.equal(b.pending(), 0, 'rien ne se rattrape depuis l\'ancienne position')
    // la suite a été lâchée au départ : elle se recharge, en commençant par l'image où l'on est (la dernière), qui est alors dessinée
    assert.equal(b.images[24].src, 'i23.webp')
    await b.libere(24)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[24])
    b.scrolls[1].f(0)
    assert.equal(b.pending(), 1, 'la suite du défilement est lissée')
  })

  it('à la pose, la première position lue est prise d\'un coup, et le chargement part de l\'image où l\'on est', async () => {
    b = banc()
    b.start = 0.5
    const { c, ctx } = b.canvas()
    b.setup(c, { images: adresses(24), smooth: 0.15 })
    b.near()
    assert.equal(b.pending(), 0)
    assert.equal(b.images[0].src, 'i12.webp', 'la première image demandée est celle de la position')
    await b.tout()
    assert.equal(b.pending(), 0)
    assert.equal(ctx.calls[ctx.calls.length - 1][0].src, 'i12.webp')
  })

  it('on: hover — la souris qui entre est suivie avec le lissage, sans saut', async () => {
    const { c } = await prete({ on: 'hover', smooth: 0.15 })
    c.__rect = { left: 0, width: 200, top: 0, height: 50 }
    c.dispatchEvent(new b.window.MouseEvent('pointerenter', { clientX: 150 }))
    c.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: 150 }))
    assert.equal(b.pending(), 1)
  })

  it('on: scroll — la zone est transmise au suivi du défilement ; on: hover : aucun suivi du défilement', async () => {
    await prete({ zone: '80% 20%' })
    assert.equal(b.scrolls[0].zone, '80% 20%')
    b.close()
    await prete({ on: 'hover' })
    assert.equal(b.scrolls.length, 0)
  })

  it('on: hover — la souris de gauche à droite de la balise ; le retrait enlève les écouteurs', async () => {
    const { c, ctx, off } = await prete({ on: 'hover', smooth: 0 })
    c.__rect = { left: 100, width: 200, top: 0, height: 50 }
    const bouge = (x: number) => c.dispatchEvent(new b.window.MouseEvent('pointermove', { clientX: x }))
    c.dispatchEvent(new b.window.MouseEvent('pointerenter', { clientX: 100 }))
    bouge(200)
    assert.ok(dernier(ctx)[0] === b.images[12], 'à mi-largeur : l\'image du milieu')
    bouge(300)
    assert.ok(dernier(ctx)[0] === b.images[23])
    bouge(50)
    assert.ok(dernier(ctx)[0] === b.images[0], 'hors de la balise à gauche : bornée')
    off()
    const n = ctx.calls.length
    bouge(300)
    assert.equal(ctx.calls.length, n, 'retiré : la souris ne fait plus rien')
  })
})

describe('*scrub — réglages suivis sur place', () => {
  let b: any
  afterEach(() => { b.close() })

  it('smooth, from, to, reverse, fit, zone : suivis sans reposer l\'effet ; frames, count, first, images, on : l\'effet repart', async () => {
    b = banc()
    const { c, ctx } = b.canvas()
    const off = b.setup(c, { images: adresses(11), smooth: 0.5 })
    b.near()
    b.resize(0, 400, 225)
    await b.tout()
    for (const k of ['smooth', 'from', 'to', 'reverse', 'fit']) assert.notEqual(off.set(k, undefined), false, k)
    for (const k of ['frames', 'count', 'first', 'images', 'on']) assert.equal(off.set(k, 'x'), false, k)
    // le lissage tombé à 0 : l'image suit tout de suite
    off.set('smooth', 0)
    b.scrolls[0].f(1)
    assert.equal(b.pending(), 0)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[10])
    // la portion et le sens : la même position montre une autre image
    off.set('to', 0.5)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[5])
    off.set('reverse', true)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[0])
    off.set('from', 0.3)
    assert.ok(ctx.calls[ctx.calls.length - 1][0] === b.images[3], 'p = 1 à l\'envers : le début de la portion, 0.3')
    // la zone : le suivi du défilement repart avec la nouvelle bande
    off.set('zone', '90% 10%')
    assert.ok(b.scrolls[0].gone)
    assert.equal(b.scrolls[1].zone, '90% 10%')
  })

  it('un lissage retombé à 0 pendant que la boucle tourne : elle finit en une image, sans tourner à vide', async () => {
    b = banc()
    const { c } = b.canvas()
    const off = b.setup(c, { images: adresses(5), smooth: 0.5 })
    b.near()
    await b.tout()
    b.scrolls[0].f(1)
    b.frame()
    assert.equal(b.pending(), 1)
    off.set('smooth', 0)
    b.frame()
    assert.equal(b.pending(), 0)
  })
})

describe('*scrub — retrait', () => {
  let b: any
  afterEach(() => { b.close() })

  it('vidéo : ni écouteur, ni suivi, ni image d\'animation ; aucune marque ni variable sur la balise', () => {
    b = banc()
    const v = b.video('', 10)
    const off = b.setup(v, { smooth: 0.15 })
    b.near()
    b.scrolls[0].f(1)
    assert.equal(b.pending(), 1)
    off()
    assert.ok(b.scrolls[0].gone)
    assert.ok(b.ios[0].gone)
    assert.equal(b.pending(), 0)
    const n = v.st.writes.length
    v.dispatchEvent(new b.window.Event('seeked'))
    v.dispatchEvent(new b.window.Event('loadedmetadata'))
    assert.equal(v.st.writes.length, n)
    assert.deepEqual(marques(v), [])
    assert.ok(!/--mjs-/.test(v.getAttribute('style') ?? ''))
  })

  it('canvas : observateurs coupés, dimensions d\'origine rendues, chargements en route abandonnés, rien ne se dessine plus', async () => {
    b = banc()
    const { c, ctx } = b.canvas('width="640" height="360"')
    const off = b.setup(c, { images: adresses(10), smooth: 0.15 })
    b.near()
    b.resize(0, 500, 200)
    assert.deepEqual([c.width, c.height], [500, 200])
    off()
    assert.ok(b.ros[0].gone && b.ios[0].gone)
    assert.deepEqual([c.getAttribute('width'), c.getAttribute('height')], ['640', '360'])
    assert.ok(b.images.slice(0, 6).every((i: any) => i.src === ''), 'les chargements en route sont abandonnés')
    b.images[0].ok()
    await tour()
    assert.equal(ctx.calls.length, 0)
    assert.equal(b.images.length, 6, 'plus aucun chargement ne part')
    // sans width ni height écrits, les attributs sont retirés
    const nu = b.canvas().c
    const off2 = b.setup(nu, { images: adresses(2) })
    b.ros[b.ros.length - 1].cb([{ contentRect: { width: 100, height: 50 } }])
    off2()
    assert.ok(!nu.hasAttribute('width') && !nu.hasAttribute('height'))
  })

  it('une toile sans taille CSS, dont la boîte suit le bitmap, est fixée à sa taille d\'avant (elle doublerait à chaque mesure)', () => {
    b = banc({ dpr: 2 })
    const { c } = b.canvas()
    // la boîte vaut la taille du bitmap (ce que fait une toile sans règle CSS)
    Object.defineProperty(c, '__rect', { get: () => ({ width: c.width, height: c.height, left: 0, top: 0 }) })
    const off = b.setup(c, { images: adresses(2) })
    b.ros[0].cb([{ contentRect: { width: 300, height: 150 } }]) // brut
    assert.deepEqual([c.width, c.height], [600, 300])
    assert.equal(c.style.width, '300px')
    assert.equal(c.style.height, '150px')
    off()
    assert.equal(c.style.width, '')
    assert.equal(c.style.height, '')
    // une toile réglée par la CSS : sa boîte ne bouge pas avec le bitmap, rien n'est fixé
    const css = b.canvas().c
    css.__rect = { width: 300, height: 150, left: 0, top: 0 }
    b.setup(css, { images: adresses(2) })
    b.ros[b.ros.length - 1].cb([{ contentRect: { width: 300, height: 150 } }])
    assert.equal(css.style.width, '')
  })
})
