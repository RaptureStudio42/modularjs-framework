// *weight — la graisse des lettres ondule sous la souris : le calque de lettres (le texte d'origine
// reste lu une seule fois), les réglages lus, le repli quand la police n'est pas variable, la souris
// proche qui change les lettres, aucune boucle quand rien ne bouge, le refus sur un composant, le
// retrait sans reste. happy-dom n'a pas de mise en page : la mesure de la police variable et les
// graisses vues se regardent dans Chromium et Firefox.

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
  'fx-gs':         '<h1 class="a" *weight>Ondulation</h1>',
  'fx-gs-regles':  '<h1 class="a" *weight(200, strength: 0.5, min: 200, max: 800, axis: wdth, fallback: bold, duration: 300ms, idle: false, speed: 5s)>Ondulation</h1>',
  'fx-gs-calme':   '<h1 class="a" *weight(idle: false)>Ondulation</h1>',
  'fx-gs-etirer':  '<h1 class="a" *weight(fallback: stretch, strength: 0.5, idle: false)>Ondulation</h1>',
  'fx-gs-aucun':   '<h1 class="a" *weight(fallback: none, idle: false)>Ondulation</h1>',
  'fx-gs-etat':    '<script>\n$r = 100\n</script>\n<h1 class="a" *weight(radius: $r, idle: false)>Ondulation</h1>\n<button class="b" @click={$r = 300}>b</button>',
  'fx-gs-retrait': '<script>\n$on = true\n</script>\n{if $on}<h1 class="a" *weight(idle: false)>Ondulation</h1>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *weight', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-graisse-ondulante')
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

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  const lettres = (el: any) => Array.from(el.querySelectorAll('[mjs-fx-layer="text"] [mjs-fx-letter]')) as any[]
  const souris  = () => window.document.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 0, clientY: 0, bubbles: true }))

  it('*weight : un calque de lettres, une lettre par caractère, le texte d\'origine reste lu une seule fois', async () => {
    const comp  = await monter('mjs-fx-gs')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="text"]')
    assert.ok(layer, 'le calque de lettres')
    assert.equal(layer.getAttribute('aria-hidden'), 'true', 'les lettres sont cachées aux lecteurs d\'écran')
    assert.equal(lettres(el).length, 'Ondulation'.length)
    assert.equal(lettres(el).map((l) => l.textContent).join(''), 'Ondulation')
    assert.equal(Array.from(el.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent).join(''), 'Ondulation', 'le texte d\'origine, intact')
    assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes('weight'))
  })

  it('le CSS : lissage de la graisse par la durée, rien ne bouge si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.weight.css
    assert.match(css, /font-variation-settings/)
    assert.match(css, /var\(--mjs-weight-duration,150ms\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('chaque réglage est lu', async () => {
    const comp = await monter('mjs-fx-gs-regles')
    const el   = comp._shadow.querySelector('.a')
    const s    = el._mjs_fxOff.weight._s
    assert.equal(s.radius, 200)
    assert.equal(s.strength, 0.5)
    assert.equal(s.min, 200)
    assert.equal(s.max, 800)
    assert.equal(s.axis, 'wdth')
    assert.equal(s.fallback, 'bold')
    assert.equal(s.idle, false)
    assert.equal(s.speed, '5s')
    assert.equal(el.style.getPropertyValue('--mjs-weight-duration'), '300ms')
  })

  it('sans mise en page (police variable non mesurable) : le repli choisi s\'écrit sur la balise', async () => {
    const auto = (await monter('mjs-fx-gs'))._shadow.querySelector('.a')
    assert.equal(auto.getAttribute('mjs-fx-weight-mode'), 'stretch', 'auto, sans graisses ni police variable : étirement')
    const gras = (await monter('mjs-fx-gs-regles'))._shadow.querySelector('.a')
    assert.equal(gras.getAttribute('mjs-fx-weight-mode'), 'bold')
    const aucun = (await monter('mjs-fx-gs-aucun'))._shadow.querySelector('.a')
    assert.equal(aucun.getAttribute('mjs-fx-weight-mode'), 'none')
  })

  it('la souris près des lettres les change (repli par étirement : scaleY, selon strength), et fallback: none ne touche à rien', async () => {
    const el = (await monter('mjs-fx-gs-etirer'))._shadow.querySelector('.a')
    souris()
    await attendre(() => lettres(el)[0].style.transform !== '')
    assert.equal(lettres(el)[0].style.transform, 'scaleY(1.25)', '1 + 0.5 × 0.5')
    const aucun = (await monter('mjs-fx-gs-aucun'))._shadow.querySelector('.a')
    souris()
    await pause(60)
    assert.equal(lettres(aucun)[0].style.transform + lettres(aucun)[0].style.fontWeight + lettres(aucun)[0].style.fontVariationSettings, '')
  })

  it('aucune boucle quand la souris est loin et idle est faux ; idle vrai : une boucle tourne', async () => {
    const compte = { n: 0 }
    const vrai   = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (f: any) => { compte.n++; return vrai(f) }
    try {
      await monter('mjs-fx-gs-calme')
      compte.n = 0
      await pause(150)
      assert.equal(compte.n, 0, 'idle faux, souris loin : pas une image demandée')
      await monter('mjs-fx-gs')
      compte.n = 0
      await pause(150)
      assert.ok(compte.n > 0, 'idle vrai : la vague tourne')
    }
    finally {
      window.requestAnimationFrame = vrai
    }
  })

  it('radius tenu par une variable : l\'effet n\'est pas reposé', async () => {
    const comp  = await monter('mjs-fx-gs-etat')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="text"]')
    comp._shadow.querySelector('.b').click()
    await pause(30)
    assert.equal(el._mjs_fxOff.weight._s.radius, 300)
    assert.ok(el.querySelector('[mjs-fx-layer="text"]') === layer, 'le même calque')
  })

  it('*weight sur un composant est refusé : l\'effet travaille le texte de sa balise', async () => {
    await assert.rejects(compiler('<@fx-gs-carte *weight></@fx-gs-carte>'), /\*weight travaille le texte de sa balise/)
  })

  it('radius: 5, strength: 2, min: 0, axis: w sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<h1 *weight(radius: 5)>x</h1>'), /\*weight : radius = 5 — permis : int 20\.\.800/)
    await assert.rejects(compiler('<h1 *weight(strength: 2)>x</h1>'), /\*weight : strength = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<h1 *weight(min: 0)>x</h1>'), /\*weight : min = 0 — permis : int 1\.\.1000/)
    await assert.rejects(compiler('<h1 *weight(fallback: gras)>x</h1>'), /\*weight : fallback = gras — permis/)
    await compiler('<h1 *weight(radius: 800, min: 100, max: 900)>x</h1>')
  })

  it('le retrait enlève le calque de lettres, la marque du repli et les variables', async () => {
    const comp = await monter('mjs-fx-gs-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="text"]'))
    souris()
    await pause(40)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''))
    assert.equal(el._mjs_fxOff ?? null, null)
  })
})
