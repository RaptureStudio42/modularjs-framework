// *blend — les 16 modes de fusion : la balise qui se fond avec ce qu'il y a derrière elle, le calque
// de couleur ou de dégradé, la seconde image ; calque dans une balise à contenu, filtre SVG sur une
// balise sans contenu ; ordre, cadrage, composition avec *filter, retrait sans reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']

const COMPOSANTS: Record<string, string> = {
  'fx-fusion-seule':    '<h1 class="a" *blend(difference)>titre</h1>',
  'fx-fusion-defaut':   '<h1 class="a" *blend>titre</h1>',
  'fx-fusion-couleur':  '<div class="a" *blend(multiply, color: #ff4fa3, opacity: 0.5)>x</div>',
  'fx-fusion-degrade':  '<div class="a" *blend(screen, colors: [#f00, #00f], angle: 90)>x</div>',
  'fx-fusion-image':    '<div class="a" *blend(screen, image: \'/b.jpg\', fit: contain, position: top-left)>x</div>',
  'fx-fusion-dessous':  '<div class="a" *blend(multiply, color: #0f0, order: under)>x</div>',
  'fx-fusion-img':      '<img class="a" src="x.png" alt="" *blend(multiply, color: #ff4fa3)>',
  'fx-fusion-img-deg':  '<img class="a" src="x.png" alt="" *blend(screen, colors: [#f00, #00f], angle: 90)>',
  'fx-fusion-img-img':  '<img class="a" src="x.png" alt="" *blend(screen, image: \'/b.jpg\', fit: stretch, position: bottom-right)>',
  'fx-fusion-img-sous': '<img class="a" src="x.png" alt="" *blend(difference, color: #fff, order: under)>',
  'fx-fusion-img-deux': '<img class="a" src="x.png" alt="" *filter(grayscale) *blend(multiply, color: #f00)>',
  'fx-fusion-survol':   '<div class="a" *blend(multiply, color: #f00, on: hover)>x</div>',
  'fx-fusion-hote':     '<@fx-fusion-carte class="a" *blend(multiply, color: #f00)></@fx-fusion-carte>',
  'fx-fusion-carte':    '<p class="in">dedans</p>',
  'fx-fusion-retrait':  '<script>\n$on = true\n</script>\n{if $on}<img class="a" src="x.png" alt="" *blend(multiply, color: #f00)>{end}\n{if $on}<div class="b" *blend(screen, color: #00f)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

describe('effets — *blend', function () {
  this.timeout(60000)
  let window: any
  let code = ''

  before(async () => {
    const root   = mjsTmp('effets-fusion')
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
    code        = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  const filtreDe = (comp: any) => comp._shadow.querySelector('svg[mjs-fx-blend-svg] filter')

  it('les 16 modes sont acceptés à la compilation, un mode inconnu est refusé', async () => {
    for (const mode of MODES) await compiler(`<div *blend(${mode})>x</div>`)
    await assert.rejects(compiler('<div *blend(burn)>x</div>'), /\*blend(?: \(ligne \d+\))? : mode = burn — permis/)
  })

  it('opacity hors plage et réglage inconnu sont refusés', async () => {
    await assert.rejects(compiler('<div *blend(multiply, opacity: 2)>x</div>'), /\*blend(?: \(ligne \d+\))? : opacity = 2/)
    await assert.rejects(compiler('<div *blend(multiply, zzz: 1)>x</div>'), /\*blend/)
  })

  it('usage 1 : sans couleur ni image, la balise se fond avec ce qu\'il y a derrière (mix-blend-mode)', async () => {
    const comp = await monter('mjs-fx-fusion-seule')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-blend-use'), 'mix')
    assert.equal(el.style.getPropertyValue('--mjs-fx-blend-mode'), 'difference')
    assert.match(el.getAttribute('mjs-fx-on'), /blend/)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'pas de calque')
    assertAbsent(comp._shadow.querySelector('svg[mjs-fx-blend-svg]'), 'pas de filtre')
    assert.match(window.µ._mjs_fxDefs.blend.css, /\[mjs-fx-blend-use="mix"\]\[mjs-fx-on~="blend"\]\{mix-blend-mode:var\(--mjs-fx-blend-mode\)/)
  })

  it('le mode par défaut est multiply', async () => {
    const comp = await monter('mjs-fx-fusion-defaut')
    assert.equal(comp._shadow.querySelector('.a').style.getPropertyValue('--mjs-fx-blend-mode'), 'multiply')
  })

  it('usage 2 sur une balise à contenu : un calque de couleur au-dessus du contenu, la balise isolée', async () => {
    const comp  = await monter('mjs-fx-fusion-couleur')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="blend"]')
    assert.ok(layer, 'le calque')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-blend-color'), '#ff4fa3')
    assert.equal(el.getAttribute('mjs-fx-blend-use'), 'layer')
    assert.equal(el.style.getPropertyValue('--mjs-blend-opacity'), '0.5')
    assert.match(window.µ._mjs_fxDefs.blend.css, /\[mjs-fx-blend-use="layer"\]\{isolation:isolate\}/)
  })

  it('un dégradé : le calque porte un linear-gradient à l\'angle donné', async () => {
    const comp  = await monter('mjs-fx-fusion-degrade')
    const layer = comp._shadow.querySelector('.a [mjs-fx-layer="blend"]')
    assert.match(layer.style.getPropertyValue('--mjs-fx-blend-bg'), /^linear-gradient\(90deg, #f00, #00f\)$/)
  })

  it('une seconde image : le calque la porte, cadrage contain, point en haut à gauche', async () => {
    const comp  = await monter('mjs-fx-fusion-image')
    const layer = comp._shadow.querySelector('.a [mjs-fx-layer="blend"]')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-blend-bg'), 'url("/b.jpg")')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-blend-size'), 'contain')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-blend-repeat'), 'no-repeat')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-blend-pos'), '0% 0%')
  })

  it('fit : cover, contain, stretch et repeat sont traduits en taille et répétition du fond', async () => {
    const css = window.µ._mjs_fxDefs.blend.css
    assert.match(css, /background-size:var\(--mjs-fx-blend-size,cover\)/)
    assert.match(css, /background-repeat:var\(--mjs-fx-blend-repeat,no-repeat\)/)
  })

  it('order: under sur une balise à contenu : un filtre fond le rendu entier de la balise par-dessus le calque (pas de calque dans la balise)', async () => {
    const comp  = await monter('mjs-fx-fusion-dessous')
    const el    = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-blend-order'), 'under')
    assert.equal(el.getAttribute('mjs-fx-blend-use'), 'filter')
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'pas de calque : il ne peut pas fondre un texte nu')
    const b = filtreDe(comp).querySelector('feBlend')
    assert.equal(b.getAttribute('in'), 'SourceGraphic', 'under : la balise par-dessus le calque')
    assert.equal(b.getAttribute('in2'), 'k')
  })

  it('le CSS compose le filtre de *blend avec ceux de *filter, *chromatic et *liquid posés sur la MÊME balise, jamais avec ceux d\'un parent (variables héritées)', () => {
    const css = window.µ._mjs_fxDefs.blend.css
    const U   = '\\[mjs-fx-blend-use="filter"\\]\\[mjs-fx-blend-use="filter"\\]\\[mjs-fx-blend-use="filter"\\]'
    const v   = (n: string) => `var\\(--mjs-fx-${n}\\)`
    assert.match(css, new RegExp(`${U}\\{filter:${v('blend-filter')}\\}`), 'seul')
    assert.match(css, new RegExp(`${U}\\[mjs-fx-chromatic-on\\]\\{filter:${v('chromatic-filter')} ${v('blend-filter')}\\}`), 'avec *chromatic')
    assert.match(css, new RegExp(`${U}\\[mjs-fx-liquid-on\\]\\{filter:${v('liquid-filter')} ${v('blend-filter')}\\}`), 'avec *liquid')
    assert.match(css, new RegExp(`${U}\\[mjs-fx-on~="filter"\\]\\[mjs-fx-liquid-on\\]\\[mjs-fx-chromatic-on\\]\\{filter:${v('filter-value')} ${v('liquid-filter')} ${v('chromatic-filter')} ${v('blend-filter')}\\}`), 'les quatre')
    assert.doesNotMatch(css, /var\(--mjs-fx-(?:liquid|chromatic)-filter,\)/, 'jamais une variable lue sans la marque de son effet sur la balise')
  })

  it('usage 2 sur une <img> : un filtre SVG feFlood + feBlend dans la même racine, posé par filter:url(#…)', async () => {
    const comp = await monter('mjs-fx-fusion-img')
    const el   = comp._shadow.querySelector('.a')
    const f    = filtreDe(comp)
    assert.ok(f, 'le filtre SVG')
    assert.equal(el.getAttribute('mjs-fx-blend-use'), 'filter')
    assert.equal(el.style.getPropertyValue('--mjs-fx-blend-filter'), `url(#${f.getAttribute('id')})`)
    assert.equal(f.getAttribute('color-interpolation-filters'), 'sRGB')
    assert.ok(f.querySelector('feFlood'), 'feFlood')
    const b = f.querySelector('feBlend')
    assert.equal(b.getAttribute('mode'), 'multiply')
    assert.equal(b.getAttribute('in2'), 'SourceGraphic', 'over : le calque par-dessus la balise')
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'pas de calque dans une image')
  })

  it('un dégradé sur une <img> : un feImage d\'un SVG en data:', async () => {
    const comp = await monter('mjs-fx-fusion-img-deg')
    const im   = filtreDe(comp).querySelector('feImage')
    assert.ok(im, 'feImage')
    const href = im.getAttribute('href')
    assert.match(href, /^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(href.replace('data:image/svg+xml,', ''))
    assert.match(svg, /linearGradient/)
    assert.match(svg, /#f00/)
    assert.equal(im.getAttribute('preserveAspectRatio'), 'none')
  })

  it('une seconde image sur une <img> : feImage, stretch → preserveAspectRatio none, point en bas à droite', async () => {
    const comp = await monter('mjs-fx-fusion-img-img')
    const im   = filtreDe(comp).querySelector('feImage')
    assert.equal(im.getAttribute('href'), '/b.jpg')
    assert.equal(im.getAttribute('preserveAspectRatio'), 'none')
    assert.equal(filtreDe(comp).querySelector('feBlend').getAttribute('mode'), 'screen')
  })

  it('order: under sur une <img> : la balise est fondue par-dessus le calque (in et in2 échangés)', async () => {
    const comp = await monter('mjs-fx-fusion-img-sous')
    const b    = filtreDe(comp).querySelector('feBlend')
    assert.equal(b.getAttribute('in'), 'SourceGraphic')
    assert.notEqual(b.getAttribute('in2'), 'SourceGraphic')
    assert.equal(b.getAttribute('mode'), 'difference')
  })

  it('*filter + *blend sur la même <img> : les deux filtres se composent, rien n\'est écrasé', async () => {
    const comp = await monter('mjs-fx-fusion-img-deux')
    const el   = comp._shadow.querySelector('.a')
    assert.match(el.style.getPropertyValue('--mjs-fx-filter-value'), /grayscale/)
    assert.match(el.style.getPropertyValue('--mjs-fx-blend-filter'), /^url\(#mjs-fx-blend-\d+\)$/)
    const css = window.µ._mjs_fxDefs.blend.css
    assert.match(css, /\[mjs-fx-on~="filter"\]\{filter:var\(--mjs-fx-filter-value\) var\(--mjs-fx-blend-filter\)\}/)
  })

  const bornes = (f: any) => {
    const l = f.querySelector('feFlood')
    return { unites: f.getAttribute('primitiveUnits'), x: l.getAttribute('x'), y: l.getAttribute('y'), w: l.getAttribute('width'), h: l.getAttribute('height') }
  }

  it('les bornes du calque d\'un filtre : en px de la boîte (userSpaceOnUse) ; dans Safari, en fractions de la boîte (objectBoundingBox)', async () => {
    const ailleurs = bornes(filtreDe(await monter('mjs-fx-fusion-img')))
    assert.equal(ailleurs.unites, 'userSpaceOnUse')
    assert.deepEqual([ailleurs.x, ailleurs.y], ['0', '0'])
    assert.ok(+ailleurs.w > 1 && +ailleurs.h > 1, `px : ${ailleurs.w} × ${ailleurs.h}`)
    // l'agent d'utilisateur ne fait pas un Safari : un Chromium qui se donne cet agent (émulation d'un iPhone) reste Chromium
    const emule = new Window({ url: 'http://localhost/', settings: { navigator: { userAgent: SAFARI } } })
    try {
      emule.eval(`${code}\nglobalThis.µ = µ;`)
      emule.document.body.innerHTML = '<mjs-fx-fusion-img></mjs-fx-fusion-img>'
      const comp = emule.document.querySelector('mjs-fx-fusion-img')
      await attendre(() => !!comp._shadow?.querySelector('.a'))
      await pause()
      assert.equal(bornes(filtreDe(comp)).unites, 'userSpaceOnUse', 'l\'agent de Safari sans le fabricant d\'Apple : des px')
    } finally {
      emule.close?.()
    }
    // Safari lit x et y en px depuis le coin de la page, pas de la balise : la balise y resterait blanche
    const safari = new Window({ url: 'http://localhost/', settings: { navigator: { userAgent: SAFARI } } })
    // le moteur se reconnaît à son fabricant, que l'agent d'utilisateur ne change pas
    Object.defineProperty(safari.navigator, 'vendor', { value: 'Apple Computer, Inc.', configurable: true })
    try {
      safari.eval(`${code}\nglobalThis.µ = µ;`)
      safari.document.body.innerHTML = '<mjs-fx-fusion-img></mjs-fx-fusion-img>'
      const comp = safari.document.querySelector('mjs-fx-fusion-img')
      await attendre(() => !!comp._shadow?.querySelector('.a'))
      await pause()
      assert.deepEqual(bornes(filtreDe(comp)), { unites: 'objectBoundingBox', x: '0', y: '0', w: '1', h: '1' })
      assert.equal(filtreDe(comp).getAttribute('filterUnits'), null, 'la région du filtre reste celle de la boîte')
    } finally {
      safari.close?.()
    }
  })

  it('l\'opacité tenue par une variable : l\'effet la suit sur place (le moteur lui passe `set`), tout autre réglage repose l\'effet', async () => {
    const comp = await monter('mjs-fx-fusion-img')
    const el   = comp._shadow.querySelector('.a')
    const hot  = el._mjs_fxOff.blend._hot
    assert.equal(typeof hot, 'function', 'l\'effet donne un `set`')
    const pente = () => +filtreDe(comp).querySelector('feFuncA').getAttribute('slope')
    assert.equal(pente(), 1)
    assert.equal(hot('mode', 'screen'), false, 'un autre réglage : l\'effet est reposé')
    assert.equal(hot('opacity', 0.5), undefined)
    await attendre(() => Math.abs(pente() - 0.5) < 0.01, 3000)
    assert.ok(Math.abs(pente() - 0.5) < 0.01, `la force du calque glisse vers 0,5 : ${pente()}`)
    assert.equal(hot('duration', '100ms'), undefined, 'la durée est relue à chaque fondu')
  })

  it('on: hover — la marque n\'est posée qu\'au survol', async () => {
    const comp = await monter('mjs-fx-fusion-survol')
    const el   = comp._shadow.querySelector('.a')
    assert.doesNotMatch(el.getAttribute('mjs-fx-on') || '', /blend/)
    el.dispatchEvent(new window.Event('pointerenter'))
    assert.match(el.getAttribute('mjs-fx-on'), /blend/)
    el.dispatchEvent(new window.Event('pointerleave'))
    assert.doesNotMatch(el.getAttribute('mjs-fx-on') || '', /blend/)
  })

  it('posé sur un composant : le calque est dans son shadow root', async () => {
    const comp = await monter('mjs-fx-fusion-hote')
    const hote = comp._shadow.querySelector('.a')
    await attendre(() => !!hote._shadow?.querySelector('[mjs-fx-layer="blend"]'))
    assert.ok(hote._shadow.querySelector('[mjs-fx-layer="blend"]'), 'calque dans le shadow du composant')
  })

  it('le CSS : transition de la durée, pas de transition si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.blend.css
    assert.match(css, /transition:opacity var\(--mjs-blend-duration,400ms\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/)
  })

  it('le retrait de l\'effet ne laisse rien : ni calque, ni filtre, ni marque, ni variable', async () => {
    const comp = await monter('mjs-fx-fusion-retrait')
    const img  = comp._shadow.querySelector('.a')
    const div  = comp._shadow.querySelector('.b')
    assert.ok(comp._shadow.querySelector('svg[mjs-fx-blend-svg]'), 'filtre posé')
    assert.ok(div.querySelector('[mjs-fx-layer="blend"]'), 'calque posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(comp._shadow.querySelector('svg[mjs-fx-blend-svg]'), 'filtre resté')
    assertAbsent(div.querySelector('[mjs-fx-layer]'), 'calque resté')
    for (const n of [img, div]) {
      assert.equal(n.getAttribute('mjs-fx'), null)
      assert.equal(n.getAttribute('mjs-fx-on'), null)
      assert.equal(n.getAttribute('mjs-fx-blend-use'), null)
      assert.equal(n.style.getPropertyValue('--mjs-fx-blend-mode'), '')
      assert.equal(n.style.getPropertyValue('--mjs-fx-blend-filter'), '')
    }
  })
})
