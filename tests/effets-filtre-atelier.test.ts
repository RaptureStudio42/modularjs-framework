// *filter, l'atelier de retouche : les dix réglages fins (une fonction CSS chacun, cumulables avec une
// ambiance), les 42 styles acceptés, `none`, le style par défaut, le tritone, un composant, une
// variable suivie sur place, le retrait sans reste. Les pixels vrais sont vus dans
// effets-filtre-atelier-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const STYLES = [
  'grayscale', 'sepia', 'vintage', 'noir', 'warm', 'cool', 'vivid', 'faded', 'dramatic', 'duotone', 'blur', 'invert',
  'polaroid', 'lomo', 'kodachrome', 'technicolor', 'cyberpunk', 'sunset', 'night', 'nightvision', 'thermal', 'xray', 'newsprint', 'bleach', 'cross', 'pastel', 'matrix',
  'posterize', 'threshold', 'sharpen', 'emboss', 'edges', 'chromatic', 'pixelate', 'grain', 'halftone', 'vignette', 'tiltshift', 'bloom', 'ripple', 'scanlines'
]

const COMPOSANTS: Record<string, string> = {
  'fx-fa-fins':     '<img class="a" src="x.png" alt="" *filter(brightness: 1.2, hue: 40)>',
  'fx-fa-dix':      '<img class="a" src="x.png" alt="" *filter(brightness: 1.1, contrast: 1.2, saturate: 1.3, hue: 20, grayscale: .5, sepia: .3, invert: .2, blur: 2, opacity: .8, shadow: \'0 8px 20px #0008\')>',
  'fx-fa-cumul':    '<img class="a" src="x.png" alt="" *filter(sepia, brightness: 1.2)>',
  'fx-fa-aucun':    '<img class="a" src="x.png" alt="" *filter(none, contrast: 1.5)>\n<img class="b" src="x.png" alt="" *filter(none)>',
  'fx-fa-defaut':   '<img class="a" src="x.png" alt="" *filter>\n<img class="b" src="x.png" alt="" *filter(duration: 1s)>',
  'fx-fa-dose':     '<img class="a" src="x.png" alt="" *filter(sepia, amount: .5)>\n<img class="b" src="x.png" alt="" *filter(thermal, amount: .5)>',
  'fx-fa-tritone':  '<img class="a" src="x.png" alt="" *filter(duotone, colors: [#000000, #ff0000, #ffffff])>\n<img class="b" src="x.png" alt="" *filter(duotone, colors: [#000000, #ffffff])>',
  'fx-fa-nouveau':  '<img class="p" src="x.png" alt="" *filter(polaroid)>\n<img class="l" src="x.png" alt="" *filter(lomo)>\n<img class="n" src="x.png" alt="" *filter(night, amount: 0)>',
  'fx-fa-special':  '<img class="po" src="x.png" alt="" *filter(posterize, levels: 3)>\n<img class="th" src="x.png" alt="" *filter(threshold, threshold: .6)>\n<img class="pi" src="x.png" alt="" *filter(pixelate, size: 12)>\n<img class="ch" src="x.png" alt="" *filter(chromatic, shift: 9)>\n<img class="sc" src="x.png" alt="" *filter(scanlines, gap: 6)>',
  'fx-fa-hote':     '<@fx-fa-carte class="h" *filter(posterize)></@fx-fa-carte>',
  'fx-fa-carte':    '<p>carte</p>',
  'fx-fa-variable': '<script>\n$l = 1.2\n$n = 3\n</script>\n<img class="a" src="x.png" alt="" *filter(brightness: $l)>\n<img class="b" src="x.png" alt="" *filter(posterize, levels: $n)>\n<button class="t" @click={$l = 1.5; $n = 5}>t</button>',
  'fx-fa-retrait':  '<script>\n$on = true\n</script>\n{if $on}<img class="a" src="x.png" alt="" *filter(posterize, brightness: 1.2)>{end}\n{if $on}<img class="c" src="x.png" alt="" *filter(sepia)>{end}\n<button class="t" @click={$on = !$on}>t</button>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *filter, l\'atelier de retouche', function () {
  this.timeout(120000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-filtre-atelier')
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

  async function monter(tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp
  }

  const valeur = (el: any) => el.style.getPropertyValue('--mjs-fx-filter-value')
  const idDe   = (v: string) => /url\(#([\w-]+)\)/.exec(v)?.[1]
  // happy-dom range les noms de balise SVG en minuscules : on cherche sans tenir compte de la casse
  const filtreDe = (el: any) => {
    const id = idDe(valeur(el))
    return id ? el.getRootNode().querySelector(`filter#${id}`) : null
  }
  const balises = (f: any, nom: string) => [...f.querySelectorAll('*')].filter((n: any) => n.localName.toLowerCase() === nom.toLowerCase())

  it('brightness et hue : chacun écrit sa fonction CSS, et rien d\'autre (pas d\'ambiance, pas de filtre SVG)', async () => {
    const comp = await monter('mjs-fx-fa-fins')
    const a = comp._shadow.querySelector('.a')
    assert.equal(valeur(a), 'brightness(1.2) hue-rotate(40deg)')
    assert.equal(a.getRootNode().querySelectorAll('svg').length, 0)
  })

  it('les dix réglages fins écrivent leur fonction, ombre portée comprise', async () => {
    const comp = await monter('mjs-fx-fa-dix')
    const v = valeur(comp._shadow.querySelector('.a'))
    for (const f of ['brightness(1.1)', 'contrast(1.2)', 'saturate(1.3)', 'hue-rotate(20deg)', 'grayscale(0.5)', 'sepia(0.3)', 'invert(0.2)', 'blur(2px)', 'opacity(0.8)', 'drop-shadow(0 8px 20px #0008)']) {
      assert.ok(v.includes(f), `${f} absent de « ${v} »`)
    }
    assert.ok(v.indexOf('opacity(') < v.indexOf('drop-shadow('), 'l\'ombre est dessinée en dernier')
  })

  it('un réglage fin et une ambiance se cumulent : l\'ambiance d\'abord, le réglage ensuite', async () => {
    const comp = await monter('mjs-fx-fa-cumul')
    const v = valeur(comp._shadow.querySelector('.a'))
    assert.match(v, /^sepia\(1\) brightness\(1\.2\)$/)
  })

  it('style: none = les réglages fins seuls ; none tout seul = un filtre neutre', async () => {
    const comp = await monter('mjs-fx-fa-aucun')
    assert.equal(valeur(comp._shadow.querySelector('.a')), 'contrast(1.5)')
    assert.equal(valeur(comp._shadow.querySelector('.b')), 'opacity(1)', 'un filtre neutre, jamais `none` : la valeur se combine avec celle de *blend')
  })

  it('`*filter` seul reste grayscale ; un réglage qui n\'est pas fin (duration) ne change pas le style', async () => {
    const comp = await monter('mjs-fx-fa-defaut')
    assert.equal(valeur(comp._shadow.querySelector('.a')), 'grayscale(1)')
    assert.equal(valeur(comp._shadow.querySelector('.b')), 'grayscale(1)')
  })

  it('amount dose l\'ambiance (CSS) et l\'effet (SVG) ; 0 = l\'image d\'origine', async () => {
    const comp = await monter('mjs-fx-fa-dose')
    assert.equal(valeur(comp._shadow.querySelector('.a')), 'sepia(0.5)')
    const f = filtreDe(comp._shadow.querySelector('.b'))
    assert.ok(f, 'thermal : un filtre SVG')
    const mix = balises(f, 'feComposite').find((n: any) => n.getAttribute('operator') === 'arithmetic')
    assert.ok(mix, 'le mélange avec l\'original')
    assert.equal(+mix.getAttribute('k2'), 0.5)
    assert.equal(+mix.getAttribute('k3'), 0.5)
    window.document.body.innerHTML = '<mjs-fx-fa-nouveau></mjs-fx-fa-nouveau>'
    const c2 = window.document.querySelector('mjs-fx-fa-nouveau')
    await attendre(() => !!c2._shadow?.querySelector('.n'))
    await pause()
    const n = c2._shadow.querySelector('.n')
    assert.equal(idDe(valeur(n)), undefined, 'amount: 0 : aucune teinte, aucun filtre SVG')
    assert.equal(n.getRootNode().querySelectorAll('svg').length, 2, 'seuls les deux filtres des autres images')
  })

  it('tritone : trois couleurs = trois valeurs par canal (ombres, tons moyens, lumières) ; deux couleurs = deux', async () => {
    const comp = await monter('mjs-fx-fa-tritone')
    const tables = (el: any) => balises(filtreDe(el), 'feFuncR').map((n: any) => n.getAttribute('tableValues'))
    assert.deepEqual(tables(comp._shadow.querySelector('.a')), ['0 1 1'])
    assert.deepEqual(tables(comp._shadow.querySelector('.b')), ['0 1'])
  })

  it('les ambiances neuves passent par un filtre SVG (teinte fondue : feFlood + feBlend), dans la racine de la balise', async () => {
    const comp = await monter('mjs-fx-fa-nouveau', '.p')
    const p = comp._shadow.querySelector('.p')
    const f = filtreDe(p)
    assert.ok(f, 'polaroid : un filtre SVG')
    assert.equal(f.getAttribute('color-interpolation-filters'), 'sRGB')
    assert.equal(balises(f, 'feFlood').length > 0, true, 'feFlood')
    assert.equal(balises(f, 'feBlend').some((n: any) => n.getAttribute('mode') === 'soft-light'), true, 'feBlend soft-light')
    assert.match(valeur(p), /^brightness\(1\.08\) contrast\(0\.92\) saturate\(1\.25\) sepia\(0\.18\) url\(#[\w-]+\)$/, 'les fonctions CSS de l\'ambiance précèdent l\'url')
    const l = comp._shadow.querySelector('.l')
    const fl = filtreDe(l)
    assert.ok(balises(fl, 'feImage').length > 0, 'lomo : teinte en dégradé (feImage)')
  })

  it('effets spéciaux : chacun écrit ses réglages dans son filtre', async () => {
    const comp = await monter('mjs-fx-fa-special', '.po')
    const q = (c: string) => comp._shadow.querySelector('.' + c)
    assert.equal(balises(filtreDe(q('po')), 'feFuncR')[0].getAttribute('tableValues'), '0 0.5 1', 'posterize levels: 3')
    assert.equal(balises(filtreDe(q('th')), 'feFuncR')[0].getAttribute('intercept'), String(-120 * 0.6))
    assert.equal(balises(filtreDe(q('pi')), 'feComposite')[0].getAttribute('width'), '12', 'pixelate size: 12')
    assert.equal(balises(filtreDe(q('pi')), 'feMorphology')[0].getAttribute('radius'), '6', 'pavé de 12 : rayon 6')
    assert.equal(balises(filtreDe(q('ch')), 'feOffset')[0].getAttribute('dx'), '-9', 'chromatic shift: 9')
    assert.ok(balises(filtreDe(q('sc')), 'feFlood').length > 0)
    assert.equal(balises(filtreDe(q('sc')), 'feComposite')[0].getAttribute('width'), '6', 'scanlines gap: 6')
  })

  it('42 styles acceptés à la compilation, `none` aussi', async () => {
    for (const s of STYLES) await compiler(`<img src="a.png" alt="a" *filter(${s})>`)
    assert.equal(STYLES.length, 41, '12 + 15 + 14 = 41 styles nommés, plus none : 42')
    await compiler('<img src="a.png" alt="a" *filter(none)>')
    await compiler('<img src="a.png" alt="a" *filter(style: matrix, amount: .4)>')
  })

  it('un style inconnu est refusé ; un réglage hors plage aussi', async () => {
    await assert.rejects(compiler('<img src="a.png" alt="a" *filter(polaroidd)>'), /\*filter/)
    await assert.rejects(compiler('<img src="a.png" alt="a" *filter(brightness: 5)>'), /\*filter : brightness = 5/)
    await assert.rejects(compiler('<img src="a.png" alt="a" *filter(posterize, levels: 9)>'), /\*filter : levels = 9/)
  })

  it('le CSS : transition sur filter avec durée et courbe en variables, immobile si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.filter.css
    assert.match(css, /transition:filter var\(--mjs-filter-duration,400ms\) var\(--mjs-filter-easing,ease\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^}]*transition:none/)
    assert.deepEqual(Object.keys(window.µ._mjs_fxDefs.filter.vars).sort(), ['duration', 'easing'])
  })

  it('sur un composant : la balise hôte porte la propriété, le filtre SVG est dans la racine qui la contient', async () => {
    window.document.body.innerHTML = '<mjs-fx-fa-hote></mjs-fx-fa-hote>'
    const comp = window.document.querySelector('mjs-fx-fa-hote')
    await attendre(() => !!comp._shadow?.querySelector('.h'))
    await pause()
    const h = comp._shadow.querySelector('.h')
    assert.ok(filtreDe(h), 'le filtre est dans la racine de l\'hôte')
  })

  it('une variable suivie sur place : la valeur change, le filtre SVG reste le même nœud, réécrit', async () => {
    const comp = await monter('mjs-fx-fa-variable')
    const a = comp._shadow.querySelector('.a')
    const b = comp._shadow.querySelector('.b')
    assert.equal(valeur(a), 'brightness(1.2)')
    const f0 = filtreDe(b)
    assert.equal(balises(f0, 'feFuncR')[0].getAttribute('tableValues'), '0 0.5 1')
    comp._shadow.querySelector('.t').click()
    await pause(60)
    assert.equal(valeur(a), 'brightness(1.5)')
    assert.equal(a.getAttribute('mjs-fx'), 'filter', 'l\'effet n\'a pas été retiré puis reposé')
    const f1 = filtreDe(b)
    assert.ok(f1 === f0, 'même nœud filtre : pas de clignotement')
    assert.equal(balises(f1, 'feFuncR')[0].getAttribute('tableValues').split(' ').length, 5)
  })

  it('le retrait ne laisse ni <svg> orphelin, ni variable, ni marque', async () => {
    const comp = await monter('mjs-fx-fa-retrait')
    const a = comp._shadow.querySelector('.a')
    const c = comp._shadow.querySelector('.c')
    assert.ok(filtreDe(a), 'filtre posé')
    assert.equal(comp._shadow.querySelectorAll('svg').length, 1)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(comp._shadow.querySelectorAll('svg').length, 0, 'svg resté')
    assert.equal(valeur(a), '', 'variable restée')
    assert.equal(valeur(c), '', 'variable restée (CSS pur)')
    assert.ok(!(a.getAttribute('mjs-fx') ?? '').includes('filter'), 'marque restée')
    assert.ok(!(a.getAttribute('mjs-fx-on') ?? '').includes('filter'), 'état resté')
    assertAbsent(comp._shadow.querySelector('filter'), 'filtre resté')
  })
})
