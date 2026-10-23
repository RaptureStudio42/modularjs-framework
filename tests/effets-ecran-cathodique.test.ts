// *crt — un vieil écran cathodique : le calque posé et retiré, chaque réglage lu, les refus de compilation.

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
  'fx-cathode':         '<div class="a" *crt>x</div>',
  'fx-cathode-regles':  '<div class="a" *crt(6, opacity: 0.6, flicker: 0, roll: false, speed: 3s, vignette: 0.8, tint: #3dff8a, glow: 0, radius: 40, on: hover)>x</div>',
  'fx-cathode-enfant':  '<p class="c">dedans</p>',
  'fx-cathode-compo':   '<@fx-cathode-enfant class="a" *crt></@fx-cathode-enfant>',
  'fx-cathode-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *crt(tint: #0f0)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *crt', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-ecran-cathodique')
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

  it('*crt : un calque par-dessus le contenu, qui ne capte pas les clics, avec lignes, bords, scintillement et bande', async () => {
    const comp  = await monter('mjs-fx-cathode')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="crt"]')
    assert.ok(layer, 'le calque')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastChild === layer, 'dernier enfant : par-dessus le contenu')
    for (const p of ['lines', 'vignette', 'flick', 'roll']) assert.ok(layer.querySelector('.mjs-fx-crt-' + p), p)
    assertAbsent(el.querySelector('[mjs-fx-layer="crt-tint"]'), 'pas de teinte sans tint')
    assert.equal(el.style.borderRadius, '18px', 'coins bombés par défaut')
    assert.ok(!el.hasAttribute('mjs-fx-crt-flat'), 'halo par défaut')
  })

  it('le CSS : pas de clic capté, lignes, bande, scintillement, immobile si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.crt.css
    assert.match(css, /\[mjs-fx-layer="crt"\][^{]*\{[^}]*pointer-events:none/)
    assert.match(css, /repeating-linear-gradient\(to bottom/)
    assert.match(css, /@keyframes mjs-fx-crt-roll\{/)
    assert.match(css, /@keyframes mjs-fx-crt-flick\{/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/)
  })

  it('*crt(6, opacity: 0.6, flicker: 0, roll: false, …) : réglages lus, pas de bande, teinte posée, halo coupé, coins de 40 px', async () => {
    const comp  = await monter('mjs-fx-cathode-regles')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="crt"]')
    assert.equal(el.style.getPropertyValue('--mjs-crt-lines'), '6px')
    assert.equal(el.style.getPropertyValue('--mjs-crt-opacity'), '0.6')
    assert.equal(el.style.getPropertyValue('--mjs-crt-flicker'), '0')
    assert.equal(el.style.getPropertyValue('--mjs-crt-speed'), '3s')
    assert.equal(el.style.getPropertyValue('--mjs-crt-vignette'), '0.8')
    assert.equal(el.style.getPropertyValue('--mjs-crt-tint'), '#3dff8a')
    assert.equal(el.style.getPropertyValue('--mjs-crt-glow'), '0')
    assert.equal(el.style.borderRadius, '40px')
    assertAbsent(layer.querySelector('.mjs-fx-crt-roll'), 'roll: false')
    assert.ok(el.querySelector('[mjs-fx-layer="crt-tint"]'), 'la teinte')
    assert.ok(el.hasAttribute('mjs-fx-crt-flat'), 'glow: 0')
  })

  it('sur un composant : le calque est dans le shadow root du composant', async () => {
    const comp  = await monter('mjs-fx-cathode-compo')
    const hote  = comp._shadow.querySelector('.a')
    const layer = hote._shadow.querySelector('[mjs-fx-layer="crt"]')
    assert.ok(layer, 'calque dans le composant')
  })

  it('lines: 0 est refusé, opacity: 2 aussi, un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<div *crt(lines: 0)>x</div>'), /\*crt : lines = 0 — permis : int 1\.\.12/)
    await assert.rejects(compiler('<div *crt(opacity: 2)>x</div>'), /\*crt : opacity = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<div *crt(bombe: 2)>x</div>'), /\*crt/)
    await compiler('<div *crt(12, opacity: 1, flicker: 1, roll: false, speed: 2s, vignette: 1, tint: #0f0, glow: 1, radius: 200, on: view)>x</div>')
  })

  it('*crt sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *crt src="a.png" alt="a">'), /\*crt[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait enlève les calques, la marque et l\'arrondi', async () => {
    const comp = await monter('mjs-fx-cathode-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="crt"]'), 'calque posé')
    assert.ok(el.querySelector('[mjs-fx-layer="crt-tint"]'), 'teinte posée')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(el.style.borderRadius, '')
    assert.ok(!el.hasAttribute('mjs-fx-crt-flat'))
  })
})
