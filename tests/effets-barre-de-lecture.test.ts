// *scrollprogress — une barre de lecture qui suit le défilement : le calque et ses marques, chaque
// réglage lu, le suivi par variable CSS quand la ligne de temps du défilement manque, l'accessibilité,
// les refus de compilation, le composant, le retrait.

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
  'fx-barre':         '<div class="a" *scrollprogress>texte</div>',
  'fx-barre-defile':  '<div class="a" style="overflow-y: auto" *scrollprogress>texte</div>',
  'fx-barre-regles':  '<div class="a" *scrollprogress(#f00, thickness: 8, place: bottom, source: page, origin: center, radius: 4, glow: 6, zindex: 99, track: #222, duration: 300ms)>texte</div>',
  'fx-barre-degrade': '<div class="a" *scrollprogress(colors: [#f00, #00f], place: left)>texte</div>',
  'fx-barre-droite':  '<div class="a" *scrollprogress(place: right, origin: end)>texte</div>',
  'fx-barre-carte':   '<p class="in">carte</p>',
  'fx-barre-hote':    '<@fx-barre-carte class="a" *scrollprogress></@fx-barre-carte>',
  'fx-barre-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *scrollprogress(source: page)>texte</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *scrollprogress', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom (celui de `CSS` compris) sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-barre-de-lecture')
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
    garder(Object.getPrototypeOf(window.CSS), ['supports'])
    // `CSS` rend un objet neuf à chaque lecture : la méthode se remplace sur son prototype
    window.eval('globalThis.__sup = function() { return false }; Object.getPrototypeOf(CSS).supports = function(a, b) { return globalThis.__sup(a, b) }')
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // la ligne de temps du défilement (Chromium) ou son absence (Firefox par défaut)
  const navigateur = (timeline: boolean) => { window.__sup = (a: string) => /animation-timeline/.test(a) && timeline }

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  it('*scrollprogress : un calque en premier dans la balise, un rail et une barre, une barre de progression pour les lecteurs d\'écran', async () => {
    navigateur(false)
    const comp  = await monter('mjs-fx-barre')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    assert.ok(layer, 'le calque')
    assert.ok(el.firstChild === layer, 'premier enfant (place top)')
    assert.equal(layer.getAttribute('role'), 'progressbar')
    assert.equal(layer.getAttribute('aria-valuemin'), '0')
    assert.equal(layer.getAttribute('aria-valuemax'), '100')
    assert.equal(layer.getAttribute('aria-valuenow'), '0')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-place'), 'top')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-source'), 'self')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-origin'), 'start')
    assert.equal(layer.querySelectorAll('i').length, 1)
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-native'), null, 'sans ligne de temps : le suivi se fait en JavaScript')
  })

  it('avec la ligne de temps du défilement, sur une balise qui défile : la marque native, aucune variable écrite', async () => {
    navigateur(true)
    const comp  = await monter('mjs-fx-barre-defile')
    const layer = comp._shadow.querySelector('.a').querySelector('[mjs-fx-layer="scrollprogress"]')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-native'), '')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-scrollprogress-p'), '')
    // une balise qui ne défile pas : la ligne de temps remonterait jusqu'à la page, la barre passe par la variable
    const fixe = (await monter('mjs-fx-barre'))._shadow.querySelector('.a').querySelector('[mjs-fx-layer="scrollprogress"]')
    assert.equal(fixe.getAttribute('mjs-fx-scrollprogress-native'), null)
  })

  it('chaque réglage est lu : variables sur la balise, place, source et origine sur le calque', async () => {
    navigateur(true)
    const comp  = await monter('mjs-fx-barre-regles')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    const v = (n: string) => el.style.getPropertyValue('--mjs-scrollprogress-' + n)
    assert.equal(v('color'), '#f00')
    assert.equal(v('thickness'), '8px')
    assert.equal(v('radius'), '4px')
    assert.equal(v('glow'), '6px')
    assert.equal(v('zindex'), '99')
    assert.equal(v('track'), '#222')
    assert.equal(v('duration'), '300ms')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-place'), 'bottom')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-source'), 'page')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-origin'), 'center')
    assert.ok(el.lastChild === layer, 'place bottom : dernier enfant')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-native'), null, 'une durée de lissage : le suivi passe par la variable')
  })

  it('colors : un dégradé à la place de la couleur ; place left : barre verticale', async () => {
    navigateur(true)
    const comp  = await monter('mjs-fx-barre-degrade')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    assert.equal(el.style.getPropertyValue('--mjs-scrollprogress-colors'), '#f00, #00f')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-gradient'), '')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-place'), 'left')
    assert.ok(el.firstChild === layer, 'left : premier enfant')
  })

  it('place right : premier enfant, comme left (un flottant se pose en tête), origine end', async () => {
    navigateur(true)
    const comp  = await monter('mjs-fx-barre-droite')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    assert.ok(el.firstChild === layer, 'le calque est le premier enfant de la balise')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-place'), 'right')
    assert.equal(layer.getAttribute('mjs-fx-scrollprogress-origin'), 'end')
  })

  it('le CSS : barre à l\'échelle, ligne de temps du défilement, fixée pour la page, collée pour la balise, lissage coupé si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.scrollprogress.css
    assert.match(css, /animation-timeline:scroll\(nearest\)/)
    assert.match(css, /animation-timeline:scroll\(root\)/)
    assert.match(css, /@keyframes mjs-fx-scrollprogress-grow\{/)
    assert.match(css, /\[mjs-fx-scrollprogress-source="page"\]\{position:fixed/)
    assert.match(css, /position:sticky/)
    assert.match(css, /scaleX\(var\(--mjs-fx-scrollprogress-p,0\)\)/)
    assert.match(css, /--mjs-scrollprogress-thickness,4px/)
    assert.match(css, /--mjs-scrollprogress-zindex,10/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('sans ligne de temps : le défilement de la balise pose la part lue (0 → 1) et la valeur annoncée, quatre fois par seconde au plus', async () => {
    navigateur(false)
    const comp  = await monter('mjs-fx-barre')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    let haut = 0
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(el, 'scrollTop', { get: () => haut, configurable: true })
    haut = 400
    el.dispatchEvent(new window.Event('scroll'))
    await attendre(() => layer.style.getPropertyValue('--mjs-fx-scrollprogress-p') === '0.5')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-scrollprogress-p'), '0.5')
    await attendre(() => layer.getAttribute('aria-valuenow') === '50', 800)
    assert.equal(layer.getAttribute('aria-valuenow'), '50')
    let n = 0
    const garde = layer.setAttribute.bind(layer)
    layer.setAttribute = (k: string, v: string) => { if (k === 'aria-valuenow') n++; garde(k, v) }
    for (let i = 0; i <= 20; i++) {
      haut = i * 40
      el.dispatchEvent(new window.Event('scroll'))
      await pause(10)
    }
    await pause(300)
    assert.ok(n <= 3, `${n} mises à jour de aria-valuenow en ~0,5 s`)
    assert.equal(layer.getAttribute('aria-valuenow'), '100')
  })

  it('une balise qui ne déborde pas : barre vide, aucune erreur', async () => {
    navigateur(false)
    const comp  = await monter('mjs-fx-barre')
    const el    = comp._shadow.querySelector('.a')
    const layer = el.querySelector('[mjs-fx-layer="scrollprogress"]')
    el.dispatchEvent(new window.Event('scroll'))
    await pause(300)
    assert.equal(layer.getAttribute('aria-valuenow'), '0')
    assert.ok(['', '0'].includes(layer.style.getPropertyValue('--mjs-fx-scrollprogress-p')))
  })

  it('un composant : le calque vit dans son shadow root', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-barre-hote')
    const host = comp._shadow.querySelector('.a')
    assert.ok(host._shadow.querySelector('[mjs-fx-layer="scrollprogress"]'), 'le calque est dans le composant')
    assertAbsent(host.querySelector('[mjs-fx-layer]'), 'rien dans le DOM de la balise')
  })

  it('thickness: 99, place: middle, source: window : refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *scrollprogress(thickness: 99)>x</div>'), /\*scrollprogress : thickness = 99 — permis : int 1\.\.40/)
    await assert.rejects(compiler('<div *scrollprogress(place: middle)>x</div>'), /\*scrollprogress/)
    await assert.rejects(compiler('<div *scrollprogress(source: window)>x</div>'), /\*scrollprogress/)
    await assert.rejects(compiler('<div *scrollprogress(glow: 99)>x</div>'), /\*scrollprogress : glow = 99/)
    await compiler('<div *scrollprogress(#f00, colors: [#f00, #00f], track: #222, thickness: 4, place: left, source: page, origin: end, radius: 3, glow: 5, zindex: 3, duration: 200ms)>x</div>')
  })

  it('*scrollprogress sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *scrollprogress src="a.png" alt="a">'), /\*scrollprogress[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque, les variables et l\'écouteur de défilement de la page', async () => {
    navigateur(false)
    const comp = await monter('mjs-fx-barre-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="scrollprogress"]'), 'calque posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(el.getAttribute('mjs-fx'), null)
    window.dispatchEvent(new window.Event('scroll'))
    await pause(300)
  })
})
