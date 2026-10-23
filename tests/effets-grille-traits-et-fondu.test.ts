// *grid — le style `lines` (un quadrillage de traits, sans case ni écoute de la souris) et le
// réglage `fade` (un fondu en masque sur le calque, pour tous les styles), sur de vrais composants
// compilés chargés dans happy-dom.

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
  'fx-traits':        '<div class="a" *grid(lines)>x</div>',
  'fx-traits-regles': '<div class="a" *grid(lines, size: 32, color: #f00)>x</div>',
  'fx-hex-fondu':     '<div class="a" *grid(hex, fade: down)>x</div>',
  'fx-traits-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *grid(lines, fade: edges)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *grid(lines) et fade', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-grille-traits')
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
    garder(window.HTMLElement.prototype, ['clientWidth', 'clientHeight'])
    // happy-dom ne met rien en page : le calque mesure 300 × 200 pour que les styles à cases en posent
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 })
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 200 })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
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

  it('*grid(lines) : un calque marqué lines, sans aucune case, à 64 px', async () => {
    const comp  = await monter('mjs-fx-traits')
    const layer = comp._shadow.querySelector('.a [mjs-fx-layer="grid"], [mjs-fx-layer="grid"]')
    assert.ok(layer, 'le calque de la grille')
    assert.equal(layer.getAttribute('mjs-fx-grid'), 'lines')
    assert.equal(layer.querySelectorAll('i').length, 0, 'aucune case')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-grid-s'), '64px')
    assert.equal(layer.getAttribute('mjs-fx-grid-fade'), null, 'sans fondu par défaut')
  })

  it('*grid(lines, size: 32, color: #f00) : taille et couleur lues', async () => {
    const comp  = await monter('mjs-fx-traits-regles')
    const layer = comp._shadow.querySelector('[mjs-fx-layer="grid"]')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-grid-s'), '32px')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-grid-c'), '#f00')
  })

  it('*grid(hex, fade: down) : le fondu est posé sur le calque, qui garde ses cases', async () => {
    const comp  = await monter('mjs-fx-hex-fondu')
    const layer = comp._shadow.querySelector('[mjs-fx-layer="grid"]')
    assert.equal(layer.getAttribute('mjs-fx-grid'), 'hex')
    assert.equal(layer.getAttribute('mjs-fx-grid-fade'), 'down')
    assert.ok(layer.querySelectorAll('i').length > 0, 'les cases du hex')
  })

  it('le CSS du fondu : un masque par sens, posé par règle et non en ligne', () => {
    const css = window.µ._mjs_fxDefs.grid.css
    assert.match(css, /\[mjs-fx-grid-fade="down"\]\{[^}]*mask-image:linear-gradient\(#000,transparent\)/)
    assert.match(css, /\[mjs-fx-grid-fade="up"\]\{[^}]*mask-image:linear-gradient\(transparent,#000\)/)
    assert.match(css, /\[mjs-fx-grid-fade="right"\]\{[^}]*mask-image:linear-gradient\(90deg,#000,transparent\)/)
    assert.match(css, /\[mjs-fx-grid-fade="left"\]\{[^}]*mask-image:linear-gradient\(90deg,transparent,#000\)/)
    assert.match(css, /\[mjs-fx-grid-fade="edges"\]\{[^}]*mask-image:radial-gradient\(ellipse at center,#000 30%,transparent 75%\)/)
    assert.match(css, /-webkit-mask-image:/)
    assert.match(css, /\[mjs-fx-grid="lines"\]\{[^}]*linear-gradient\(90deg,var\(--mjs-fx-grid-c\) 1px,transparent 1px\),linear-gradient\(var\(--mjs-fx-grid-c\) 1px,transparent 1px\)[^}]*background-size:var\(--mjs-fx-grid-s\) var\(--mjs-fx-grid-s\)/)
  })

  it('fade: une valeur inconnue est refusée à la compilation, une permise passe', async () => {
    await assert.rejects(compiler('<div *grid(lines, fade: nimporte)>x</div>'), /\*grid : fade = nimporte — permis/)
    await compiler('<div *grid(lines, fade: edges)>x</div>')
    await compiler('<div *grid(lines)>x</div>')
  })

  it('le retrait de l\'effet enlève le calque', async () => {
    const comp = await monter('mjs-fx-traits-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="grid"]'), 'calque posé')
    assert.equal(el.querySelector('[mjs-fx-layer="grid"]').getAttribute('mjs-fx-grid-fade'), 'edges')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
  })
})
