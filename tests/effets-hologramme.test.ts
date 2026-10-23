// *hologram — un reflet irisé qui suit la souris, comme sur une carte à collectionner brillante : le
// calque et ses couches, les réglages lus, le suivi du pointeur, les refus de compilation, un
// composant, le retrait sans reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mesurer } from './helpers/mesure-balise.js'

const COMPOSANTS: Record<string, string> = {
  'fx-holo':          '<div class="a" *hologram>x</div>',
  'fx-holo-regles':   '<div class="a" *hologram(galaxy, colors: [#f00, #0f0, #00f], strength: 0.4, size: 300, angle: 45, blend: overlay, glare: false, speed: 3s, on: hover, radius: 20)>x</div>',
  'fx-holo-styles':   '<div class="s1" *hologram(rainbow)>x</div><div class="s2" *hologram(foil)>x</div><div class="s3" *hologram(galaxy)>x</div><div class="s4" *hologram(prism)>x</div><div class="s5" *hologram(gold)>x</div>',
  'fx-holo-hover':    '<div class="a" *hologram(on: hover)>x</div>',
  'fx-holo-boite':    '<div class="b">dedans</div>',
  'fx-holo-hote':     '<@fx-holo-boite class="h" *hologram(foil)></@fx-holo-boite>',
  'fx-holo-retrait':  '<script>\n$on = true\n</script>\n{if $on}<div class="a" *hologram>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *hologram', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-hologramme')
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

  const calque = (el: any) => el.querySelector('[mjs-fx-layer="hologram"]')

  it('*hologram : un calque au-dessus du contenu, qui ne capte rien, le style rainbow, l\'éclat', async () => {
    const comp  = await monter('mjs-fx-holo')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.ok(layer, 'le calque du reflet')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastElementChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(layer.getAttribute('mjs-fx-hologram-style'), 'rainbow')
    assert.equal(layer.querySelectorAll('i').length, 1, 'le motif')
    assert.equal(layer.querySelectorAll('b').length, 1, 'l\'éclat blanc par défaut')
    assert.equal(layer.getAttribute('mjs-fx-hologram-hover'), null, 'always par défaut : visible sans survol')
    assert.match(layer.style.getPropertyValue('--mjs-fx-hologram-pal'), /#ff3d81.*#a03dff, #ff3d81$/, 'palette du style, refermée sur sa première couleur')
  })

  it('les cinq styles : une marque chacun', async () => {
    const comp = await monter('mjs-fx-holo-styles', '.s5')
    const vus  = ['rainbow', 'foil', 'galaxy', 'prism', 'gold'].map((n, k) => calque(comp._shadow.querySelector('.s' + (k + 1)))?.getAttribute('mjs-fx-hologram-style'))
    assert.deepEqual(vus, ['rainbow', 'foil', 'galaxy', 'prism', 'gold'])
  })

  it('*hologram(galaxy, colors, strength, size, angle, blend, glare, speed, on, radius) : chaque réglage lu', async () => {
    const comp  = await monter('mjs-fx-holo-regles')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(layer.getAttribute('mjs-fx-hologram-style'), 'galaxy')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-strength'), '0.4')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-size'), '300%')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-angle'), '45deg')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-blend'), 'overlay')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-radius'), '20px')
    assert.equal(layer.getAttribute('mjs-fx-hologram-radius'), '', 'l\'arrondi écrit : le calque le prend')
    assert.equal(layer.querySelectorAll('b').length, 0, 'glare: false : pas d\'éclat')
    assert.equal(layer.getAttribute('mjs-fx-hologram-hover'), '', 'on: hover : le calque attend le survol')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-hologram-pal'), '#f00, #0f0, #00f, #f00', 'sa palette remplace celle du style')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-hologram-c1'), '#f00')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-hologram-c3'), '#00f')
  })

  it('le CSS : mode de fusion, intensité, bandes inclinées, rien ne capte les clics, calme si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.hologram.css
    assert.match(css, /mix-blend-mode:var\(--mjs-hologram-blend,color-dodge\)/)
    assert.match(css, /opacity:var\(--mjs-hologram-strength,\.7\)/)
    assert.match(css, /linear-gradient\(var\(--mjs-hologram-angle,110deg\)/)
    assert.match(css, /\[mjs-fx-layer="hologram"\]\{[^}]*pointer-events:none/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('on: hover — le survol allume le calque et le reflet suit la souris ; la sortie l\'éteint', async () => {
    const comp  = await monter('mjs-fx-holo-hover')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    mesurer(window, el, () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0 }))
    assert.equal(layer.getAttribute('mjs-fx-hologram-on'), null)
    el.dispatchEvent(new window.PointerEvent('pointerenter', { clientX: 10, clientY: 10 }))
    assert.equal(layer.getAttribute('mjs-fx-hologram-on'), '')
    el.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 150, clientY: 25 }))
    assert.equal(layer.style.getPropertyValue('--mjs-fx-hologram-x'), '0.750')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-hologram-y'), '0.250')
    el.dispatchEvent(new window.PointerEvent('pointerleave', { clientX: 400, clientY: 25 }))
    assert.equal(layer.getAttribute('mjs-fx-hologram-on'), null)
  })

  it('une boucle de dérive seulement avec on: always, et elle part avec l\'effet', async () => {
    const vraiRaf = window.requestAnimationFrame
    const vraiCaf = window.cancelAnimationFrame
    const lances  = new Set<number>()
    // une image demandée reste « ouverte » jusqu'à ce qu'elle se joue ou qu'on l'annule
    window.requestAnimationFrame = (f: any) => { const id = vraiRaf.call(window, (t: number) => { lances.delete(id); f(t) }); lances.add(id); return id }
    window.cancelAnimationFrame  = (id: number) => { lances.delete(id); return vraiCaf.call(window, id) }
    try {
      await monter('mjs-fx-holo-hover')
      assert.equal(lances.size, 0, 'on: hover : pas de boucle')
      const comp = await monter('mjs-fx-holo-retrait')
      assert.ok(lances.size > 0, 'on: always : la dérive tourne')
      comp._shadow.querySelector('.t').click()
      await attendre(() => !comp._shadow.querySelector('.a'))
      await pause(50)
      assert.equal(lances.size, 0, 'le retrait arrête la boucle')
    }
    finally {
      window.requestAnimationFrame = vraiRaf
      window.cancelAnimationFrame  = vraiCaf
    }
  })

  it('posé sur un composant : le calque est dans son shadow, et l\'effet est retiré avec lui', async () => {
    const comp = await monter('mjs-fx-holo-hote', '.h')
    const hote = comp._shadow.querySelector('.h')
    await attendre(() => !!hote._shadow?.querySelector('.b'))
    const layer = hote._shadow.querySelector('[mjs-fx-layer="hologram"]')
    assert.ok(layer, 'le calque dans le shadow du composant')
    assertAbsent(hote.querySelector('[mjs-fx-layer="hologram"]'), 'calque dans le DOM clair du composant')
    assert.equal(layer.getAttribute('mjs-fx-hologram-style'), 'foil')
    assert.ok(window.µ._mjs_fxInner(hote).adoptedStyleSheets.length > 0, 'la feuille de l\'effet est adoptée par le composant')
  })

  it('style: neon, strength: 2, size: 20 sont refusés à la compilation ; un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<div *hologram(neon)>x</div>'), /\*hologram : style = neon/)
    await assert.rejects(compiler('<div *hologram(strength: 2)>x</div>'), /\*hologram : strength = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<div *hologram(size: 20)>x</div>'), /\*hologram : size = 20 — permis : int 50\.\.600/)
    await assert.rejects(compiler('<div *hologram(blend: multiply)>x</div>'), /\*hologram : blend = multiply/)
    await assert.rejects(compiler('<div *hologram(couleur: #f00)>x</div>'), /couleur/)
    await compiler('<div *hologram(prism, size: 600, strength: 1)>x</div>')
  })

  it('*hologram sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *hologram src="a.png" alt="a">'), /\*hologram[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque, la marque et les variables', async () => {
    const comp = await monter('mjs-fx-holo-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(calque(el), 'calque posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
  })
})
