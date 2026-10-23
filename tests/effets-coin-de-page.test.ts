// *peel — un coin de page qui se soulève : le calque (le dessous et le dos de la page), les quatre
// coins, les réglages lus, le déclencheur, l'image du dessous, les refus de compilation, un composant,
// le retrait sans reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-coin':          '<div class="a" *peel>x</div>',
  'fx-coin-regles':   '<div class="a" *peel(bottom-left, size: 30, grow: 120, on: click, color: #fff, under: #0f0, shadow: false, duration: 1s, easing: ease-out)>x</div>',
  'fx-coin-coins':    '<div class="c1" *peel(top-right)>x</div><div class="c2" *peel(top-left)>x</div><div class="c3" *peel(bottom-right)>x</div><div class="c4" *peel(bottom-left)>x</div>',
  'fx-coin-image':    '<div class="a" *peel(image: \'/dessous.png\')>x</div>',
  'fx-coin-boite':    '<div class="b">dedans</div>',
  'fx-coin-hote':     '<@fx-coin-boite class="h" *peel(bottom-right)></@fx-coin-boite>',
  'fx-coin-retrait':  '<script>\n$on = true\n</script>\n{if $on}<div class="a" *peel(on: always)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *peel', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-coin-de-page')
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

  const calque = (el: any) => el.querySelector('[mjs-fx-layer="peel"]')
  const actif  = (el: any) => (el.getAttribute('mjs-fx-on') || '').split(' ').includes('peel')

  it('*peel : un calque au-dessus du contenu (le dessous et le dos de la page), coin en haut à droite, ombre', async () => {
    const comp  = await monter('mjs-fx-coin')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.ok(layer, 'le calque du coin')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastElementChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(layer.getAttribute('mjs-fx-peel-corner'), 'top-right')
    assert.equal(layer.querySelectorAll('i').length, 1, 'le dessous')
    assert.equal(layer.querySelectorAll('b').length, 1, 'le dos de la page')
    assert.equal(layer.hasAttribute('mjs-fx-peel-shadow'), true)
    assert.equal(layer.hasAttribute('mjs-fx-peel-image'), false)
    assert.equal(actif(el), false, 'au repos tant qu\'on ne survole pas')
  })

  it('on: hover — le survol soulève le coin, la sortie le repose', async () => {
    const comp = await monter('mjs-fx-coin')
    const el   = comp._shadow.querySelector('.a')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(actif(el), true)
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    assert.equal(actif(el), false)
  })

  it('les quatre coins : une marque chacun', async () => {
    const comp = await monter('mjs-fx-coin-coins', '.c4')
    const vus  = [1, 2, 3, 4].map((k) => calque(comp._shadow.querySelector('.c' + k))?.getAttribute('mjs-fx-peel-corner'))
    assert.deepEqual(vus, ['top-right', 'top-left', 'bottom-right', 'bottom-left'])
  })

  it('*peel(bottom-left, size, grow, on, color, under, shadow, duration, easing) : chaque réglage lu', async () => {
    const comp  = await monter('mjs-fx-coin-regles')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.equal(layer.getAttribute('mjs-fx-peel-corner'), 'bottom-left')
    assert.equal(el.style.getPropertyValue('--mjs-peel-size'), '30px')
    assert.equal(el.style.getPropertyValue('--mjs-peel-grow'), '120px')
    assert.equal(el.style.getPropertyValue('--mjs-peel-color'), '#fff')
    assert.equal(el.style.getPropertyValue('--mjs-peel-under'), '#0f0')
    assert.equal(el.style.getPropertyValue('--mjs-peel-duration'), '1s')
    assert.equal(el.style.getPropertyValue('--mjs-peel-easing'), 'ease-out')
    assert.equal(layer.hasAttribute('mjs-fx-peel-shadow'), false, 'shadow: false')
    assert.equal(actif(el), false)
    el.click()
    assert.equal(actif(el), true, 'on: click : un clic soulève')
    el.click()
    assert.equal(actif(el), false, 'le clic suivant repose')
  })

  it('image : le dessous montre l\'image (adresse passée par µ._mjs_fxImage)', async () => {
    const comp  = await monter('mjs-fx-coin-image')
    const layer = calque(comp._shadow.querySelector('.a'))
    assert.equal(layer.hasAttribute('mjs-fx-peel-image'), true)
    assert.equal(layer.style.getPropertyValue('--mjs-fx-peel-img'), 'url("/dessous.png")')
  })

  it('le CSS : coin découpé en polygone, taille au repos puis agrandie, calque sans clic, calme si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.peel.css
    assert.match(css, /\[mjs-fx-layer="peel"\]\{[^}]*pointer-events:none/)
    assert.match(css, /clip-path:polygon\(calc\(100% - var\(--mjs-peel-size,40px\)\) 0,100% 0,100% var\(--mjs-peel-size,40px\)\)/)
    assert.match(css, /\[mjs-fx-on~="peel"\] > \[mjs-fx-layer="peel"\]\[mjs-fx-peel-corner="top-right"\] i[^{]*\{clip-path:polygon\(calc\(100% - var\(--mjs-peel-grow,90px\)\) 0/)
    assert.match(css, /transition:clip-path var\(--mjs-peel-duration,300ms\) var\(--mjs-peel-easing,ease\)/)
    assert.match(css, /var\(--mjs-peel-color,#f5f5f5\)/)
    assert.match(css, /var\(--mjs-peel-under,#111827\)/)
    assert.match(css, /drop-shadow/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('posé sur un composant : le calque est dans son shadow, la feuille adoptée', async () => {
    const comp  = await monter('mjs-fx-coin-hote', '.h')
    const hote  = comp._shadow.querySelector('.h')
    await attendre(() => !!hote._shadow?.querySelector('.b'))
    const layer = hote._shadow.querySelector('[mjs-fx-layer="peel"]')
    assert.ok(layer, 'le calque dans le shadow du composant')
    assertAbsent(hote.querySelector('[mjs-fx-layer="peel"]'), 'calque dans le DOM clair du composant')
    assert.equal(layer.getAttribute('mjs-fx-peel-corner'), 'bottom-right')
    assert.ok(window.µ._mjs_fxInner(hote).adoptedStyleSheets.length > 0)
  })

  it('corner: middle, size: 5, grow: 700, color: rouge;, on: auto sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *peel(middle)>x</div>'), /\*peel : corner = middle/)
    await assert.rejects(compiler('<div *peel(size: 5)>x</div>'), /\*peel : size = 5 — permis : int 10\.\.400/)
    await assert.rejects(compiler('<div *peel(grow: 700)>x</div>'), /\*peel : grow = 700 — permis : int 10\.\.600/)
    await assert.rejects(compiler('<div *peel(on: auto)>x</div>'), /\*peel : on = auto/)
    await assert.rejects(compiler('<div *peel(duration: vite)>x</div>'), /\*peel : duration = vite/)
    await assert.rejects(compiler('<div *peel(couleur: red)>x</div>'), /couleur/)
    await compiler('<div *peel(top-left, size: 400, grow: 600, on: view)>x</div>')
  })

  it('*peel sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *peel src="a.png" alt="a">'), /\*peel[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque, les marques et les variables', async () => {
    const comp = await monter('mjs-fx-coin-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(calque(el), 'calque posé')
    assert.equal(actif(el), true, 'on: always : soulevé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(actif(el), false)
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
  })
})
