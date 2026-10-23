// *scratch — une carte à gratter : une toile posée par-dessus le contenu de la balise. Ce test couvre
// ce que happy-dom sait faire (pas de toile 2D : le trait lui-même se vérifie dans Chromium et
// Firefox) : la toile et ses marques, chaque réglage lu, les refus de compilation, un composant
// qui porte l'effet, l'état `revealed` suivi par une variable, le retrait sans reste.

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
  'fx-gr':         '<div class="a" *scratch>sous la couche</div>',
  'fx-gr-regles':  '<div class="a" *scratch(#336699, text: \'Grattez\', ink: #ffffff, brush: 40, shape: square, threshold: 0.4, duration: 200ms, radius: 12)>sous</div>',
  'fx-gr-degrade': '<div class="a" *scratch(colors: [#ff0000, #0000ff])>sous</div>',
  'fx-gr-image':   '<div class="a" *scratch(image: \'/couverture.png\')>sous</div>',
  'fx-gr-etat':    '<script>\n$r = false\n</script>\n<div class="a" *scratch(revealed: $r)>sous</div>\n<button class="b" @click={$r = !$r}>b</button>',
  'fx-gr-carte':   '<p class="c">dans la carte</p>',
  'fx-gr-hote':    '<@fx-gr-carte class="h" *scratch(#999999)></@fx-gr-carte>',
  'fx-gr-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *scratch(#336699, radius: 9)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *scratch', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-carte-a-gratter')
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

  const toile = (el: any) => el.querySelector('canvas[mjs-fx-layer="scratch"]')

  it('*scratch : une toile par-dessus le contenu, cachée aux lecteurs d\'écran, sans focus, qui garde le geste', async () => {
    const comp = await monter('mjs-fx-gr')
    const el   = comp._shadow.querySelector('.a')
    const cv   = toile(el)
    assert.ok(cv, 'la toile de la couche')
    assert.equal(cv.getAttribute('aria-hidden'), 'true')
    assert.equal(cv.hasAttribute('tabindex'), false, 'la toile ne prend pas le focus')
    assert.ok(el.lastChild === cv, 'dernier enfant : posée par-dessus le contenu')
    assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes('scratch'))
    assert.equal(el.textContent.trim(), 'sous la couche', 'le contenu dessous reste lisible')
    assert.equal(cv.hasAttribute('mjs-fx-scratch-done'), false, 'couche entière au départ')
  })

  it('le CSS : toile sur la balise, touch-action none, fondu à la durée, rien qui bouge si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.scratch.css
    assert.match(css, /touch-action:none/)
    assert.match(css, /position:absolute;inset:0/)
    assert.match(css, /transition:opacity var\(--mjs-scratch-duration,500ms\)/)
    assert.match(css, /\[mjs-fx-scratch-done\]\{[^}]*pointer-events:none/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('*scratch(#336699, text, ink, brush, shape, threshold, duration, radius) : chaque réglage est lu', async () => {
    const comp = await monter('mjs-fx-gr-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-scratch-duration'), '200ms')
    assert.equal(el.style.borderRadius, '12px', 'radius : l\'arrondi de la balise')
    const regles = comp._shadow.querySelector('.a')._mjs_fxOff.scratch._s
    assert.equal(regles.color, '#336699')
    assert.equal(regles.text, 'Grattez')
    assert.equal(regles.ink, '#ffffff')
    assert.equal(regles.brush, 40)
    assert.equal(regles.shape, 'square')
    assert.equal(regles.threshold, 0.4)
  })

  it('colors et image : posés sans erreur, la toile est là', async () => {
    const degrade = await monter('mjs-fx-gr-degrade')
    const dg      = degrade._shadow.querySelector('.a')
    assert.ok(toile(dg), 'dégradé')
    assert.deepEqual(Array.from(dg._mjs_fxOff.scratch._s.colors), ['#ff0000', '#0000ff'])
    const comp = await monter('mjs-fx-gr-image')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(toile(el), 'image')
    assert.equal(el._mjs_fxOff.scratch._s.image, '/couverture.png')
  })

  it('revealed tenu par une variable : vrai, tout est découvert ; faux, la couche revient', async () => {
    const comp = await monter('mjs-fx-gr-etat')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(toile(el).hasAttribute('mjs-fx-scratch-done'), false)
    comp._shadow.querySelector('.b').click()
    await pause(30)
    assert.equal(toile(el).hasAttribute('mjs-fx-scratch-done'), true, 'découverte')
    assert.equal(el._mjs_fxOff.scratch._s.revealed, true)
    comp._shadow.querySelector('.b').click()
    await pause(30)
    assert.equal(toile(el).hasAttribute('mjs-fx-scratch-done'), false, 'la couche est revenue')
  })

  it('sur un composant : la toile est dans son shadow root', async () => {
    const comp = await monter('mjs-fx-gr-hote', '.h')
    const h    = comp._shadow.querySelector('.h')
    await attendre(() => !!h._shadow?.querySelector('.c'))
    await pause()
    assert.ok(h._shadow.querySelector('canvas[mjs-fx-layer="scratch"]'), 'toile dans le shadow du composant')
    assertAbsent(h.querySelector('canvas[mjs-fx-layer]'), 'pas de toile dans le light DOM du composant')
  })

  it('brush: 3 et threshold: 2 sont refusés à la compilation ; un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<div *scratch(brush: 3)>x</div>'), /\*scratch : brush = 3 — permis : int 4\.\.200/)
    await assert.rejects(compiler('<div *scratch(threshold: 2)>x</div>'), /\*scratch : threshold = 2 — permis : float 0\.05\.\.1/)
    await assert.rejects(compiler('<div *scratch(shape: star)>x</div>'), /\*scratch : shape = star — permis/)
    await assert.rejects(compiler('<div *scratch(pinceau: 3)>x</div>'), /\*scratch : réglage « pinceau » inconnu/)
    await compiler('<div *scratch(brush: 4, threshold: 1)>x</div>')
  })

  it('*scratch sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *scratch src="a.png" alt="a">'), /\*scratch[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève la toile, l\'arrondi, la position et les variables', async () => {
    const comp = await monter('mjs-fx-gr-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(toile(el), 'toile posée')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('canvas'), 'toile restée')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.equal(el.style.borderRadius, '', 'arrondi rendu')
    assert.equal(el.style.position, '', 'position rendue')
    assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''))
    assert.equal(el._mjs_fxOff ?? null, null)
  })
})
