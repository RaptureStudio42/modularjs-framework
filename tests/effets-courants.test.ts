// Effets courants — ceux que proposent partout les bibliothèques d'animation, les logiciels de
// présentation, de montage et de retouche : les « appels d'attention » (*attention : tada, jello,
// heartbeat…), les annotations dessinées à la main (*annotate), l'écartement des lettres qui se
// resserre (*tracking), les mots qui se relaient (*cycle), le texte en cercle (*circular), les
// étincelles (*sparkles), le lent zoom d'une photo (*kenburns), les filtres photo (*filter, duotone
// compris), les icônes en orbite (*orbit), le dock qui grossit sous la souris (*dock) ; deux
// transitions (*rotate, *wheel) ; et des réglages de plus : la forme de *iris, l'axe de *scale, le
// flou et l'inclinaison de *fly, les mots et le défilement de *stagger, les météores de *particles.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, checkPlacement } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-attention': '<button class="a" *attention(jello, on: click)>A</button>\n<button class="b" *attention(on: load)>B</button>',
  'fx-annote':    '<p><span class="c" *annotate(circle, on: load, color: #f00)>mot</span> <span class="u" *annotate(on: load)>sous</span></p>\n<@fx-boite class="b" *annotate(box, on: load)></@fx-boite>',
  'fx-boite':     '<p class="dedans">boîte</p>',
  'fx-tracking':  '<h1 class="t" *tracking(0.6, on: load)>TITRE</h1>',
  'fx-cycle':     '<h2>On fait des <span class="w" *cycle([sites, applis], speed: 300ms, duration: 50ms)>logos</span></h2>',
  'fx-cercle':    '<span class="r" *circular(50)>ABC DE</span>',
  'fx-etincelle': '<span class="s" *sparkles(gold, count: 30)>Nouveau</span>',
  'fx-kb':        '<figure class="k" *kenburns(1.3, direction: left)><img src="x.png" alt=""></figure>',
  'fx-filtre':    '<img class="f" src="x.png" alt="" *filter(vintage)>\n<img class="g" src="x.png" alt="" *filter(grayscale, on: rest)>\n<img class="d" src="x.png" alt="" *filter(duotone, colors: [#112233, #ffeedd])>',
  'fx-orbite':    '<div class="o" *orbit(80)><i>1</i><i>2</i><i>3</i><i>4</i></div>',
  'fx-dock':      '<nav class="d" *dock(2)><a>1</a><a>2</a><a>3</a></nav>',
  'fx-mots':      '<p class="m" *stagger(fade, unit: word, on: scroll)>un deux trois</p>',
  'fx-mots-gris': '<p class="m" *stagger(fade, unit: word, on: scroll, opacity: .2)>un deux trois</p>\n<p class="n" *stagger(fade, unit: word, on: scroll, step: 100ms, easing: ease-in)>quatre cinq</p>\n<p class="v" *stagger(move, opacity: .5)>six</p>',
  'fx-meteores':  '<div class="p" *particles(meteors, count: 12)></div>',
  'fx-trans':     '<script>\n$v = true\n</script>\n{if $v}<p class="r" @in=*rotate(-90, start: 0.5) @out=*wheel(3)>R</p><p class="i" @transition=*iris(shape: box)>I</p><p class="s" @transition=*scale(axis: x)>S</p><p class="f" @transition=*fly(blur: 8, skew: 20)>F</p>{end}',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pointeur = (el: any, type: string, x = 0, y = 0) => el.dispatchEvent(new el.ownerDocument.defaultView.PointerEvent(type, { bubbles: true, clientX: x, clientY: y }))

describe('effets courants', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-courants')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    return comp._shadow.querySelector(sel)
  }
  const feuilles = (el: any) => el.getRootNode().adoptedStyleSheets.flatMap((f: any) => [...f.cssRules].map((r: any) => r.cssText)).join('\n')

  it('*attention : le style choisi, joué au geste choisi ; ses images clés dans son espace de noms', async () => {
    const a = await monter('mjs-fx-attention', '.a')
    assert.equal(a.getAttribute('mjs-fx-attention-style'), 'jello')
    assert.ok(!(a.getAttribute('mjs-fx-play') ?? '').includes('attention'), 'rien avant le clic')
    a.click()
    assert.ok((a.getAttribute('mjs-fx-play') ?? '').includes('attention'))
    const b = a.getRootNode().querySelector('.b')
    assert.equal(b.getAttribute('mjs-fx-attention-style'), 'tada', 'tada par défaut')
    assert.ok((b.getAttribute('mjs-fx-play') ?? '').includes('attention'), 'on: load : tout de suite')
    assert.match(feuilles(a), /mjs-fx-attention-jello/)
  })

  it('*annotate : un tracé dessiné autour du mot (cercle), sous le mot par défaut, à la couleur choisie', async () => {
    const c = await monter('mjs-fx-annote', '.c')
    const svg = c.querySelector('[mjs-fx-layer="annotate"]')
    assert.ok(svg, 'calque du tracé')
    assert.ok(svg.querySelectorAll('path').length >= 1)
    assert.equal(c.getAttribute('mjs-fx-annotate-style'), 'circle')
    assert.equal(c.style.getPropertyValue('--mjs-annotate-color'), '#f00')
    assert.ok((c.getAttribute('mjs-fx-play') ?? '').includes('annotate'))
    assert.equal(c.getRootNode().querySelector('.u').getAttribute('mjs-fx-annotate-style'), 'underline')
    const b = c.getRootNode().querySelector('.b')
    await attendre(() => !!b._shadow?.querySelector('.dedans'))
    assert.ok(b._shadow.querySelector('[mjs-fx-layer="annotate"]'), 'sur un composant : le tracé DANS le composant, là où il se voit')
    assertAbsent(b.querySelector('[mjs-fx-layer="annotate"]'), 'rien dans les enfants non affichés du composant')
  })

  it('*tracking : les lettres partent écartées (em) et se resserrent', async () => {
    const t = await monter('mjs-fx-tracking', '.t')
    assert.equal(t.style.getPropertyValue('--mjs-tracking-spacing'), '0.6em')
    assert.ok((t.getAttribute('mjs-fx-play') ?? '').includes('tracking'))
    assert.match(feuilles(t), /letter-spacing/)
  })

  it('*cycle : le mot de la balise, puis les mots donnés, chacun à son tour, et on recommence', async () => {
    const w = await monter('mjs-fx-cycle', '.w')
    const mot = () => w.querySelector('[mjs-fx-cycle-word]:not([mjs-fx-cycle-out])')?.textContent
    assert.equal(mot(), 'logos')
    await attendre(() => mot() === 'sites', 1500)
    assert.equal(mot(), 'sites')
    await attendre(() => mot() === 'applis', 1500)
    await attendre(() => mot() === 'logos', 1500)
    assert.equal(mot(), 'logos')
  })

  it('*circular : chaque caractère posé sur le cercle, à son angle, espaces compris', async () => {
    const r = await monter('mjs-fx-cercle', '.r')
    const lettres = [...r.querySelectorAll('[mjs-fx-letter]')]
    assert.equal(lettres.length, 6, 'les espaces aussi prennent leur part du cercle')
    assert.equal(r.querySelector('[mjs-fx-layer="text"]').style.getPropertyValue('--n'), '6')
    assert.equal(r.style.getPropertyValue('--mjs-circular-radius'), '50px')
  })

  it('*sparkles : des étincelles naissent autour du texte, à la couleur choisie', async () => {
    const s = await monter('mjs-fx-etincelle', '.s')
    assert.equal(s.style.getPropertyValue('--mjs-sparkles-color'), 'gold')
    await attendre(() => s.querySelectorAll('[mjs-fx-layer="sparkles"] svg').length > 0, 2000)
    assert.ok(s.querySelectorAll('[mjs-fx-layer="sparkles"] svg').length > 0)
  })

  it('*kenburns : le cadre ne déborde pas, l\'image dedans avance en zoomant vers `direction`', async () => {
    const k = await monter('mjs-fx-kb', '.k')
    assert.equal(k.style.getPropertyValue('--mjs-kenburns-zoom'), '1.3')
    assert.equal(k.style.getPropertyValue('--mjs-fx-kenburns-x'), '-1')
    assert.equal(k.style.getPropertyValue('--mjs-fx-kenburns-y'), '0')
    assert.match(feuilles(k), /overflow:\s*hidden/)
  })

  it('*filter : la chaîne du style ; `on: rest` s\'efface au survol ; duotone = un filtre SVG à deux couleurs', async () => {
    const f = await monter('mjs-fx-filtre', '.f')
    assert.match(f.style.getPropertyValue('--mjs-fx-filter-value'), /sepia\(/)
    assert.ok((f.getAttribute('mjs-fx-on') ?? '').includes('filter'))
    const g = f.getRootNode().querySelector('.g')
    assert.ok((g.getAttribute('mjs-fx-on') ?? '').includes('filter'), 'au repos : filtré')
    pointeur(g, 'pointerenter')
    assert.ok(!(g.getAttribute('mjs-fx-on') ?? '').includes('filter'), 'au survol : les vraies couleurs')
    pointeur(g, 'pointerleave')
    assert.ok((g.getAttribute('mjs-fx-on') ?? '').includes('filter'))
    const d = f.getRootNode().querySelector('.d')
    const v = d.style.getPropertyValue('--mjs-fx-filter-value')
    const id = /url\(#([\w-]+)\)/.exec(v)?.[1]
    assert.ok(id, v)
    const filtre = f.getRootNode().querySelector(`filter#${id}`)
    assert.ok(filtre && filtre.querySelector('feComponentTransfer, fecomponenttransfer'), 'filtre SVG du duotone')
  })

  it('*orbit : chaque enfant sur le cercle, à son angle ; *dock : l\'enfant sous la souris grossit le plus', async () => {
    const o = await monter('mjs-fx-orbite', '.o')
    const angles = [...o.children].map((c: any) => c.style.getPropertyValue('--mjs-fx-orbit-a'))
    assert.deepEqual(angles, ['0', '90', '180', '270'])
    assert.ok([...o.children].every((c: any) => c.hasAttribute('mjs-fx-orbit-item')))
    const d = await monter('mjs-fx-dock', '.d')
    const enfants = [...d.children] as any[]
    enfants.forEach((c, i) => { mesurer(window, c, () => ({ left: i * 50, right: i * 50 + 40, top: 0, bottom: 40, width: 40, height: 40, x: i * 50, y: 0 })) })
    pointeur(d, 'pointermove', 70, 20)
    const s = enfants.map((c) => parseFloat(c.style.getPropertyValue('--mjs-fx-dock-s') || '1'))
    assert.ok(s[1] > s[0] && s[1] > s[2], JSON.stringify(s))
    assert.ok(s[1] <= 2)
    pointeur(d, 'pointerleave')
    assert.ok(enfants.every((c) => (c.style.getPropertyValue('--mjs-fx-dock-s') || '1') === '1'))
  })

  it('*stagger(unit: word, on: scroll) : les mots, pas les lettres ; l\'avancée suit le défilement', async () => {
    const m = await monter('mjs-fx-mots', '.m')
    assert.equal(m.getAttribute('mjs-fx-stagger-unit'), 'word')
    const ks = [...m.querySelectorAll('[mjs-fx-word]')].map((w: any) => w.style.getPropertyValue('--mjs-fx-stagger-k'))
    assert.deepEqual(ks, ['0', '1', '2'])
    assert.ok(m.hasAttribute('mjs-fx-stagger-scroll'))
    window.dispatchEvent(new window.Event('scroll'))
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-p'), '', 'rien sur la balise : l\'avancée est écrite sur chaque mot')
    assert.match(m.querySelector('[mjs-fx-word]').style.getPropertyValue('--mjs-fx-stagger-p'), /^[01](\.\d+)?$|^0?\.\d+$/)
  })

  it('*stagger(opacity: .2) : les lettres ou les mots à venir restent en gris (leur opacité de départ), quel que soit le style', async () => {
    const m = await monter('mjs-fx-mots-gris', '.m')
    assert.equal(m.style.getPropertyValue('--mjs-stagger-opacity'), '0.2')
    const v = m.getRootNode().querySelector('.v')
    assert.equal(v.style.getPropertyValue('--mjs-stagger-opacity'), '0.5')
    // chaque style d'arrivée part de cette opacité
    const css = window.µ._mjs_fxDefs.stagger.css
    const images = [...css.matchAll(/@keyframes (mjs-fx-stagger-\w+)\{from\{([^}]*)\}/g)]
    assert.equal(images.length, 6)
    for (const [, nom, corps] of images) assert.match(corps, /opacity:var\(--mjs-stagger-opacity,0\)/, `${nom} ne part pas de l'opacité réglée : ${corps}`)
  })

  it('*stagger(on: scroll) sans step ni easing : un mot après l\'autre, d\'un pas régulier — comme le « Text Reveal » de Magic UI', async () => {
    const m = await monter('mjs-fx-mots-gris', '.m')
    // chaque mot occupe sa part de la course (le pas vaut la durée d'un mot), sans courbe
    assert.match(m.style.getPropertyValue('--mjs-fx-stagger-st'), /^var\(--mjs-stagger-duration,\s*500ms\)$/)
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-ease'), 'linear')
    // step et easing écrits : ils font foi
    const n = m.getRootNode().querySelector('.n')
    assert.equal(n.style.getPropertyValue('--mjs-fx-stagger-st'), '')
    assert.equal(n.style.getPropertyValue('--mjs-fx-stagger-ease'), '')
  })

  it('défilement d\'une balise collante (position: sticky) : l\'avancée se lit sur son parent — du haut du parent en haut de l\'écran à son bas en bas', () => {
    const vue = { top: 0, height: 720 }
    const colle = window.µ._mjs_fxStuck
    assert.equal(colle({ top: 0, height: 1440 }, vue), 0)
    assert.equal(colle({ top: 200, height: 1440 }, vue), 0, 'parent pas encore en haut')
    assert.equal(colle({ top: -360, height: 1440 }, vue), 0.5)
    assert.equal(colle({ top: -720, height: 1440 }, vue), 1)
    assert.equal(colle({ top: -900, height: 1440 }, vue), 1, 'parent passé')
    assert.equal(colle({ top: 0, height: 600 }, vue), null, 'parent moins haut que l\'écran : rien à lire')
  })

  it('*particles(meteors) : des traits qui filent', async () => {
    const p = await monter('mjs-fx-meteores', '.p')
    const calque = p.querySelector('[mjs-fx-layer="particles"]')
    assert.equal(calque.getAttribute('mjs-fx-particles-mode'), 'meteors')
    assert.equal(calque.querySelectorAll('i').length, 12)
  })

  it('transitions : *rotate (angle, échelle de départ), *wheel (rayons), *iris en carré, *scale sur un axe, *fly flou et incliné', async () => {
    const r = await monter('mjs-fx-trans', '.r')
    const µ = window.µ
    const rot = µ.anim.rotate(µ._mjs_fxAnimOpts('rotate', { angle: -90, start: 0.5 })).intro(r)
    assert.match(rot.css(0, 1).transform, /rotate\(-90deg\).*scale\(0\.5\)|scale\(0\.5\).*rotate\(-90deg\)/)
    assert.match(rot.css(1, 0).transform, /rotate\(0deg\)/)
    const wh = µ.anim.wheel(µ._mjs_fxAnimOpts('wheel', { spokes: 3 })).intro(r)
    assert.match(wh.css(0.5, 0.5).maskImage, /conic-gradient.*60deg/)
    assert.match(µ.anim.iris(µ._mjs_fxAnimOpts('iris', { shape: 'box' })).intro(r).css(0.5, 0.5).clipPath, /^inset\(/)
    assert.match(µ.anim.iris(µ._mjs_fxAnimOpts('iris', { shape: 'diamond' })).intro(r).css(0.5, 0.5).clipPath, /^polygon\(/)
    assert.equal((µ.anim.iris(µ._mjs_fxAnimOpts('iris', { shape: 'cross' })).intro(r).css(0.5, 0.5).clipPath.match(/%\s+[\d.-]+%/g) ?? []).length, 12)
    assert.match(µ.anim.scale(µ._mjs_fxAnimOpts('scale', { axis: 'x' })).intro(r).css(0, 1).transform, /scaleX\(0\)/)
    const fl = µ.anim.fly(µ._mjs_fxAnimOpts('fly', { blur: 8, skew: 20 })).intro(r).css(0, 1)
    assert.match(fl.filter, /blur\(8px\)/)
    assert.match(fl.transform, /skewX\(20deg\)/)
  })

  it('refusés au build, avec la raison : un effet qui dessine dans sa balise sur une image, un effet de texte sur un composant', () => {
    assert.throws(() => checkPlacement('kenburns', parseEffect('kenburns', ''), 'img', false), /img/)
    assert.throws(() => checkPlacement('annotate', parseEffect('annotate', ''), 'input', false), /input/)
    assert.throws(() => checkPlacement('cycle', parseEffect('cycle', '[a, b]'), 'mjs-carte', false), /composant|carte/)
    assert.doesNotThrow(() => checkPlacement('filter', parseEffect('filter', 'sepia'), 'img', false), 'un filtre photo va sur une image')
    assert.deepEqual(parseEffect('iris', 'shape: diamond').fixed, { shape: 'diamond' })
    assert.throws(() => parseEffect('iris', 'shape: star'), /permis/)
    assert.throws(() => parseEffect('attention', 'twist'), /permis/)
  })
})
