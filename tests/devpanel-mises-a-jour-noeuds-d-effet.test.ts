// mjs_devpanel — « mises à jour » n'éclaire que ce que MJS réécrit : un nœud qu'un effet pose dans la page — un
// <canvas mjs-fx-dissolve-dust> ajouté au <body> par *dissolve, une lettre mjs-fx-letter, le <svg> d'un filtre —
// porte un attribut `mjs-fx-…` ; l'ajouter, le retirer ou le réécrire n'est pas une mise à jour. Seul le calque
// `mjs-fx-layer` était reconnu : le <body> entier s'éclairait sans la moindre mise à jour. Une balise habillée d'un
// effet (`mjs-fx`, et ses marques `mjs-fx-gauge-style`…) reste une balise de la page : son texte réécrit s'éclaire.
// happy-dom n'a pas d'Element.animate : un faux compte les éclairs.
//
// Pipeline RÉEL (Bundler → cœur de développement + composant compilé, monté dans happy-dom).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const SOURCE = [
  '<script>',
  '$n = 1',
  '</script>',
  '<p class="t">Total : {$n}</p>',
  '<b class="fixe">fixe</b>',
  '<button class="plus" @click={$n++}>+</button>',
].join('\n')

describe('mjs_devpanel — « mises à jour » et les nœuds que les effets posent', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const eclairs: any[] = []

  before(async () => {
    const root   = mjsTmp('devpanel-maj-effets')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'majfx-carte.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    window.eval(lire(files.find((f) => /^majfx-carte-[0-9a-z]{5}\.js$/.test(f))!))
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function(kf: any, o: any) {
      eclairs.push({ el: this, kf, o })
      return { cancel() {}, finished: Promise.resolve(), onfinish: null }
    }
  })

  after(async () => {
    // happy-dom partage la classe Element entre ses fenêtres : rendre `animate` aux fichiers suivants
    if (animateAvant === undefined) delete window.Element.prototype.animate
    else window.Element.prototype.animate = animateAvant
    if (window?.µ?.console) window.µ.console(false)
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const racine  = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const touches = () => eclairs.map((e) => e.el.tagName + (e.el.className ? '.' + e.el.className : ''))

  // le mode « mises à jour » coché, la page montée et au repos
  async function monter() {
    window.document.body.innerHTML = '<mjs-majfx-carte></mjs-majfx-carte>'
    const comp = window.document.querySelector('mjs-majfx-carte')
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    window.µ.console(true)
    await attendre(() => !!racine()?.querySelector('[data-action="maj"]'))
    if (racine().querySelector('[data-action="maj"]').getAttribute('aria-pressed') !== 'true') clic(racine().querySelector('[data-action="maj"]'))
    await pause(120)
    eclairs.length = 0
    return comp
  }

  afterEach(() => {
    if (!window?.µ?.console) return
    if (racine()?.querySelector('[data-action="maj"][aria-pressed="true"]')) clic(racine().querySelector('[data-action="maj"]'))
    window.µ.console(false)
  })

  it('un <canvas mjs-fx-dissolve-dust> ajouté, réécrit puis retiré du <body> : aucun éclair, ni sur le <body> ni sur le canvas', async () => {
    await monter()
    const canvas = window.document.createElement('canvas')
    canvas.setAttribute('mjs-fx-dissolve-dust', '')
    window.document.body.appendChild(canvas)
    await pause(150)
    assert.deepEqual(touches(), [], 'ajouté')
    canvas.setAttribute('width', '10')
    await pause(150)
    assert.deepEqual(touches(), [], 'réécrit')
    canvas.remove()
    await pause(150)
    assert.deepEqual(touches(), [], 'retiré')
  })

  it('ce qui se passe DANS un nœud d\'effet (une lettre mjs-fx-letter dont le texte change) n\'est pas une mise à jour non plus', async () => {
    const comp = await monter()
    const lettre = window.document.createElement('span')
    lettre.setAttribute('mjs-fx-letter', '')
    lettre.textContent = 'a'
    comp._shadow.querySelector('.fixe').appendChild(lettre)
    await pause(150)
    eclairs.length = 0
    lettre.textContent = 'b'
    await pause(150)
    assert.deepEqual(touches(), [])
  })

  it('une vraie mise à jour s\'éclaire toujours : le texte réécrit par MJS, et le texte d\'une balise habillée d\'un effet (`mjs-fx` et ses marques)', async () => {
    const comp = await monter()
    const sh = comp._shadow
    clic(sh.querySelector('.plus'))
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.t')))
    assert.ok(eclairs.some((e) => e.el === sh.querySelector('.t')), 'le texte réécrit par MJS : ' + touches())
    // la balise `.fixe` telle qu'un effet l'habille : sa marque `mjs-fx` et une marque d'état `mjs-fx-<effet>-<réglage>`
    sh.querySelector('.fixe').setAttribute('mjs-fx', 'gauge')
    sh.querySelector('.fixe').setAttribute('mjs-fx-gauge-style', 'fill')
    await pause(120)
    eclairs.length = 0
    sh.querySelector('.fixe').textContent = 'réécrit'
    await attendre(() => eclairs.some((e) => e.el === sh.querySelector('.fixe')))
    assert.ok(eclairs.some((e) => e.el === sh.querySelector('.fixe')), 'une balise habillée reste une balise de la page : ' + touches())
  })
})
