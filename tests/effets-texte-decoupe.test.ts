// *gradient.knockout (l'ancien *knockout) — un texte découpé, rempli par une image ou un dégradé qui bouge : les
// variables posées sur la balise, chaque réglage lu, le repli sans `background-clip: text`, les refus de compilation,
// le composant, le retrait.

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
  'fx-decoupe':         '<h1 class="a" *gradient.knockout>TEXTE</h1>',
  'fx-decoupe-image':   "<h1 class=\"a\" *gradient.knockout(image: '/photo.png', size: 300, direction: up)>TEXTE</h1>",
  'fx-decoupe-liste':   '<h1 class="a" *gradient.knockout(colors: [#f00, #0f0], angle: 45, size: 150, direction: right, speed: 8s)>TEXTE</h1>',
  'fx-decoupe-contour': '<h1 class="a" *gradient.knockout(outline: #fff, width: 2, animate: false)>TEXTE</h1>',
  'fx-decoupe-survol':  '<h1 class="a" *gradient.knockout(on: hover)>TEXTE</h1>',
  'fx-decoupe-verticale': '<h1 class="a" *gradient.knockout(colors: [#f00, #0f0], angle: 180, direction: down)>TEXTE</h1>',
  'fx-decoupe-carte':   '<@fx-decoupe-corps class="b" *gradient.knockout></@fx-decoupe-corps>',
  'fx-decoupe-corps':   '<p>dedans</p>',
  'fx-decoupe-retrait': '<script>\n$on = true\n</script>\n{if $on}<h1 class="a" *gradient.knockout>TEXTE</h1>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *gradient.knockout', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-texte-decoupe')
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
    return comp._shadow.querySelector(sel)
  }

  const v = (el: any, nom: string) => el.style.getPropertyValue(nom)

  it('*gradient.knockout : un dégradé par défaut (trois couleurs, 90deg), sans calque : le texte n\'est pas réécrit', async () => {
    const el = await monter('mjs-fx-decoupe')
    assert.match(v(el, '--mjs-fx-gradient'), /^linear-gradient\(90deg,#ff4fa3,#7c3aed,#22d3ee,#ff4fa3\)$/)
    assert.equal(el.textContent, 'TEXTE')
    assert.equal(el.children.length, 0, 'aucun calque, aucune lettre découpée')
    assertAbsent(el.querySelector('[mjs-fx-layer]'))
  })

  it('le dégradé qui avance à gauche : boucle sans couture (une tuile de 200 %, de 0 à 200 %)', async () => {
    const el = await monter('mjs-fx-decoupe')
    assert.equal(v(el, '--mjs-fx-gradient-size'), '200% 100%')
    assert.equal(v(el, '--mjs-fx-gradient-from'), '0% 0%')
    assert.equal(v(el, '--mjs-fx-gradient-to'), '200% 0%')
    assert.equal(el.getAttribute('mjs-fx-gradient-flow'), null, 'une boucle, pas un va-et-vient')
  })

  it('*gradient.knockout(image: …, size: 300, direction: up) : l\'image en fond, en va-et-vient vertical', async () => {
    const el = await monter('mjs-fx-decoupe-image')
    assert.equal(v(el, '--mjs-fx-gradient'), 'url("/photo.png")')
    assert.equal(v(el, '--mjs-fx-gradient-size'), 'auto 300%')
    assert.equal(el.getAttribute('mjs-fx-gradient-flow'), 'swing')
    assert.equal(v(el, '--mjs-fx-gradient-from'), '50% 0%')
    assert.equal(v(el, '--mjs-fx-gradient-to'), '50% 100%')
  })

  it('*gradient.knockout(colors, angle, size, direction: right, speed) : la liste, l\'angle, la taille et le sens lus', async () => {
    const el = await monter('mjs-fx-decoupe-liste')
    assert.match(v(el, '--mjs-fx-gradient'), /^linear-gradient\(45deg,#f00,#0f0,#f00\)$/)
    assert.equal(v(el, '--mjs-fx-gradient-size'), '150% 100%')
    assert.equal(el.getAttribute('mjs-fx-gradient-flow'), 'swing', 'un angle de biais ne se raccorde pas : va-et-vient')
    assert.equal(v(el, '--mjs-gradient-speed'), '8s')
    assert.equal(v(el, '--mjs-fx-gradient-from'), '100% 50%')
    assert.equal(v(el, '--mjs-fx-gradient-to'), '0% 50%')
  })

  it('un dégradé vertical (180deg) qui descend : boucle sans couture, taille sur la hauteur', async () => {
    const el = await monter('mjs-fx-decoupe-verticale')
    assert.equal(v(el, '--mjs-fx-gradient-size'), '100% 200%')
    assert.equal(el.getAttribute('mjs-fx-gradient-flow'), null)
    assert.equal(v(el, '--mjs-fx-gradient-from'), '0% 0%')
    assert.equal(v(el, '--mjs-fx-gradient-to'), '0% -200%')
  })

  it('*gradient.knockout(outline: #fff, width: 2, animate: false) : contour, épaisseur, fond immobile', async () => {
    const el = await monter('mjs-fx-decoupe-contour')
    assert.equal(v(el, '--mjs-gradient-outline'), '#fff')
    assert.equal(v(el, '--mjs-gradient-width'), '2px')
    assert.equal(el.getAttribute('mjs-fx-gradient-still'), '')
  })

  it('*gradient.knockout(on: hover) : l\'animation est coupée au repos, relancée au survol', async () => {
    const el = await monter('mjs-fx-decoupe-survol')
    assert.equal(v(el, '--mjs-fx-gradient-go'), 'none')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(v(el, '--mjs-fx-gradient-go'), '')
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    assert.equal(v(el, '--mjs-fx-gradient-go'), 'none')
  })

  it('le CSS : le texte rempli par le fond, le repli sans background-clip, rien d\'animé si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.gradient.css
    assert.match(css, /@supports \(\(-webkit-background-clip:text\) or \(background-clip:text\)\)\{/)
    assert.match(css, /background-clip:text/)
    assert.match(css, /-webkit-text-fill-color:transparent/)
    assert.match(css, /-webkit-text-stroke:var\(--mjs-gradient-width,0px\)/)
    assert.match(css, /@keyframes mjs-fx-gradient\{/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/)
    assert.doesNotMatch(css.split('@supports')[0], /transparent/, 'hors @supports, le texte garde sa couleur')
  })

  it('posé sur un composant : l\'effet marque l\'hôte, rien n\'est écrit dans son shadow', async () => {
    const hote = await monter('mjs-fx-decoupe-carte', '.b')
    assert.equal(hote.getAttribute('mjs-fx'), 'gradient')
    assert.match(v(hote, '--mjs-fx-gradient'), /^linear-gradient/)
    assertAbsent(hote._shadow.querySelector('[mjs-fx-layer]'))
  })

  it('size: 50 et width: 20 sont refusés à la compilation, comme une direction inconnue', async () => {
    await assert.rejects(compiler('<h1 *gradient(size: 50)>x</h1>'), /\*gradient : size = 50 — permis : int 100\.\.800/)
    await assert.rejects(compiler('<h1 *gradient(width: 20)>x</h1>'), /\*gradient : width = 20 — permis : float 0\.\.10/)
    await assert.rejects(compiler('<h1 *gradient(direction: sideways)>x</h1>'), /\*gradient : direction/)
    await assert.rejects(compiler('<h1 *gradient(teinte: 3)>x</h1>'), /\*gradient/)
    await compiler('<h1 *gradient(size: 800, width: 10, direction: down)>x</h1>')
  })

  it('le retrait de l\'effet rend la balise comme avant', async () => {
    const comp = window.document.body.appendChild(window.document.createElement('mjs-fx-decoupe-retrait'))
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    const el = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx'), 'gradient')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(el.getAttribute('mjs-fx'), null, 'marque restée')
    assert.equal(el.getAttribute('mjs-fx-gradient-flow'), null)
    assert.equal(el.getAttribute('style') || '', '', 'variables restées')
  })
})
