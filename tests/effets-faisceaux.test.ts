// *beam — des faisceaux de lumière floue qui entrent par un coin, au fond de la balise : le calque
// et ses faisceaux, les réglages lus, les refus de compilation, le retrait.

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
  'fx-faisceau':         '<div class="a" *beam>x</div>',
  'fx-faisceau-regles':  '<div class="a" *beam(#0ff, count: 3, angle: 20, origin: top-right)>x</div>',
  'fx-faisceau-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *beam>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *beam', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-faisceaux')
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

  it('*beam : un calque au fond de la balise, avec 2 faisceaux', async () => {
    const comp  = await monter('mjs-fx-faisceau')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="beam"]')
    assert.ok(layer, 'le calque des faisceaux')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.firstChild === layer, 'premier enfant de la balise')
    assert.equal(layer.querySelectorAll('i').length, 2)
    assert.equal(layer.getAttribute('mjs-fx-beam-origin'), null, 'coin haut gauche par défaut')
  })

  it('*beam(#0ff, count: 3, angle: 20, origin: top-right) : 3 faisceaux, couleur, angle et coin lus', async () => {
    const comp  = await monter('mjs-fx-faisceau-regles')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="beam"]')
    assert.equal(layer.querySelectorAll('i').length, 3)
    assert.equal(el.style.getPropertyValue('--mjs-beam-color'), '#0ff')
    assert.equal(el.style.getPropertyValue('--mjs-beam-angle'), '20deg')
    assert.equal(layer.getAttribute('mjs-fx-beam-origin'), 'top-right')
  })

  it('le CSS : faisceaux flous à l\'arrêt, joués à l\'entrée, miroir à droite, affichés tout de suite si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.beam.css
    assert.match(css, /filter:blur\(var\(--mjs-beam-blur,70px\)\)/)
    assert.match(css, /transform-origin:0 50%/)
    assert.match(css, /@keyframes mjs-fx-beam-in\{/)
    assert.match(css, /\[mjs-fx-beam-origin="top-right"\]\{[^}]*scaleX\(-1\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/)
  })

  it('count: 9 est refusé à la compilation', async () => {
    await assert.rejects(compiler('<div *beam(count: 9)>x</div>'), /\*beam : count = 9 — permis : int 1\.\.4/)
    await compiler('<div *beam(count: 4)>x</div>')
  })

  it('*beam sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *beam src="a.png" alt="a">'), /\*beam[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque', async () => {
    const comp = await monter('mjs-fx-faisceau-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="beam"]'), 'calque posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
  })
})
