// Effets — un réglage visuel tenu par une variable, que l'effet recopie aussi dans son code : la
// variable CSS suit sur place (le moteur), et la copie de l'effet doit suivre avec elle (son
// `set(k, v)`), sans que l'effet reparte. Sinon la variable change et l'effet garde l'ancienne valeur :
// un grain parti immobile ne bouge jamais, une profondeur partie de 0 n'apparaît jamais, des
// étincelles ou des bouffées retirées à l'ancienne durée (coupées en plein éclat), les anneaux de
// <@document> à l'ancienne couleur, des mots qui se relaient à l'ancien rythme, un pas de *stagger au
// défilement qui reste le pas régulier. Vrais composants, chargés dans happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-grain':       '<script>\n$v = "0"\n</script>\n<div class="n" *noise(speed: $v)>n</div>\n<button class="va" @click={$v = "500ms"}>b</button>\n<button class="fige" @click={$v = "0"}>b</button>',
  'fx-relief':      '<script>\n$d = 0\n</script>\n<div class="t" *tilt(depth: $d)><b>a</b></div>\n<button class="loin" @click={$d = 60}>b</button>\n<button class="plat" @click={$d = 0}>b</button>',
  'fx-eclats':      '<script>\n$vie = "100ms"\n</script>\n<span class="s" *sparkles(speed: $vie)>Nouveau</span>\n<button class="b" @click={$vie = "3s"}>b</button>',
  'fx-fumee':       '<script>\n$d = "100ms"\n</script>\n<div class="f" *smoke(duration: $d)>f</div>\n<button class="b" @click={$d = "2s"}>b</button>',
  // <@document> ne prend que des valeurs fixes au gabarit ; ses réglages se retouchent à chaud par le
  // panneau de développement, qui passe par µ._mjs_fxSet comme une variable
  'fx-onde-page':   '<@document *ripple(color: #ff0000, duration: 100ms)></@document>\n<p class="p">page</p>',
  'fx-frappe':      '<script>\n$s = "300ms"\n</script>\n<span class="t" *cycle.frame([B], speed: $s, delay: 0s)>A</span>\n<button class="b" @click={$s = "5s"}>b</button>',
  'fx-lettres-pas': '<script>\n$p = null\n$e = null\n</script>\n<p class="m" *stagger(fade, unit: word, on: scroll, step: $p, easing: $e)>un deux trois</p>\n<button class="p" @click={$p = "80ms"}>p</button>\n<button class="e" @click={$e = "ease-in"}>e</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('effets — un réglage visuel recopié dans le code de l\'effet suit sa variable', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-reglage-recopie')
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

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause(20)
    return comp._shadow.querySelector(sel)
  }

  it('*noise : le grain parti immobile (speed: 0) s\'agite quand la vitesse passe à 500ms, et se fige quand elle revient à 0', async () => {
    const n = await monter('mjs-fx-grain', '.n')
    const sh = n.getRootNode()
    assert.equal(n.hasAttribute('mjs-fx-noise-moving'), false, 'au départ : immobile')
    sh.querySelector('.va').click()
    await pause(20)
    assert.equal(n.style.getPropertyValue('--mjs-noise-speed'), '500ms', 'la variable CSS suit')
    assert.equal(n.hasAttribute('mjs-fx-noise-moving'), true, 'le grain s\'agite')
    sh.querySelector('.fige').click()
    await pause(20)
    assert.equal(n.hasAttribute('mjs-fx-noise-moving'), false, 'le grain se fige')
  })

  it('*tilt : la profondeur partie de 0 apparaît quand depth passe à 60, et disparaît à 0', async () => {
    const t = await monter('mjs-fx-relief', '.t')
    const sh = t.getRootNode()
    assert.equal(t.hasAttribute('mjs-fx-tilt-depth'), false, 'au départ : à plat')
    sh.querySelector('.loin').click()
    await pause(20)
    assert.equal(t.style.getPropertyValue('--mjs-tilt-depth'), '60px', 'la variable CSS suit')
    assert.equal(t.hasAttribute('mjs-fx-tilt-depth'), true, 'les enfants flottent devant la carte')
    sh.querySelector('.plat').click()
    await pause(20)
    assert.equal(t.hasAttribute('mjs-fx-tilt-depth'), false, 'de nouveau à plat')
  })

  it('*sparkles : la vie d\'une étincelle suit speed — allongée à 3s, une étincelle née après vit plus longtemps, et le nombre à la fois reste celui de count', async () => {
    const s = await monter('mjs-fx-eclats', '.s')
    const eclats = () => [...s.querySelectorAll('[mjs-fx-layer="sparkles"] svg')]
    await attendre(() => eclats().length > 0, 1000)
    s.getRootNode().querySelector('.b').click()
    await pause(450)
    const nees = eclats()
    assert.ok(nees.length > 0, 'des étincelles, nées après le changement')
    await pause(500)
    assert.ok(nees.every((e: any) => e.isConnected), 'une étincelle née après le changement vit 3 s, pas l\'ancienne durée')
    assert.ok(eclats().length <= 12, `au plus une dizaine à la fois (count : 10), vu ${eclats().length}`)
  })

  it('*smoke : la vie d\'une bouffée suit duration — allongée à 2s, les bouffées ne partent pas à l\'ancienne durée', async () => {
    const f = await monter('mjs-fx-fumee', '.f')
    f.getRootNode().querySelector('.b').click()
    await pause(20)
    // chaque image fait naître les bouffées par un arrondi au hasard (à 2 s de vie, moins d'une par image en moyenne) : l'une peut n'en faire naître aucune — le pointeur bouge jusqu'à la première, 60 fois au plus
    for (let i = 0; i < 60 && f.querySelectorAll('[mjs-fx-layer="smoke"] i').length === 0; i++) {
      f.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
      await pause(20)
    }
    const nees = [...f.querySelectorAll('[mjs-fx-layer="smoke"] i')]
    assert.ok(nees.length > 0, 'des bouffées sous le pointeur')
    await pause(400)
    assert.ok(nees.every((p: any) => p.isConnected), 'encore là à 400 ms : elles vivent 2 s')
  })

  it('*ripple sur <@document>, retouché à chaud (panneau de développement) : les anneaux prennent la nouvelle couleur, et vivent la nouvelle durée', async () => {
    await monter('mjs-fx-onde-page', '.p')
    const µ = window.µ
    const html = window.document.documentElement
    const page = () => window.document.querySelector('[mjs-fx-layer="ripple-page"]')
    await attendre(() => !!page(), 1000)
    assert.equal(page().style.getPropertyValue('--mjs-fx-ripple-c'), '#ff0000')
    µ._mjs_fxSet(html, 'ripple', { color: '#00ff00' }, { color: ['c', 'couleur'] })
    assert.equal(html.style.getPropertyValue('--mjs-ripple-color'), '#00ff00', 'la variable CSS suit')
    assert.equal(page().style.getPropertyValue('--mjs-fx-ripple-c'), '#00ff00', 'la couleur des anneaux suit')
    µ._mjs_fxSet(html, 'ripple', { duration: '2s' }, { duration: ['t', 'durée'] })
    window.document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
    const anneau = page().querySelector('[mjs-fx-ring]')
    assert.ok(anneau, 'un anneau au point cliqué')
    await pause(400)
    assert.equal(anneau.isConnected, true, 'encore là à 400 ms : il vit 2 s')
  })

  it('*cycle (cadre) : le rythme des mots suit speed — passé de 300ms à 5s, le mot affiché reste le temps d\'un mot à 5 s', async () => {
    const t = await monter('mjs-fx-frappe', '.t')
    const mot = () => t.querySelector('[mjs-fx-cycle-word]')?.firstChild?.textContent
    await attendre(() => mot() === 'B', 1500)
    t.getRootNode().querySelector('.b').click()
    await pause(150)
    assert.equal(t.style.getPropertyValue('--mjs-cycle-speed'), '5s', 'la variable CSS suit')
    const vu = mot()
    const vus = new Set<string>()
    for (let i = 0; i < 18; i++) {
      vus.add(String(mot()))
      await pause(50)
    }
    assert.deepEqual([...vus], [String(vu)], 'le même mot pendant 900 ms (à l\'ancien rythme, trois changements)')
  })

  it('*stagger(on: scroll) : un pas ou une courbe écrits après coup (variable) remplacent le pas régulier et la courbe linéaire du défilement', async () => {
    const m = await monter('mjs-fx-lettres-pas', '.m')
    const sh = m.getRootNode()
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-st'), 'var(--mjs-stagger-duration,500ms)', 'sans pas écrit : un mot après l\'autre, d\'un pas régulier')
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-ease'), 'linear', 'sans courbe écrite : linéaire')
    sh.querySelector('.p').click()
    await pause(20)
    assert.equal(m.style.getPropertyValue('--mjs-stagger-step'), '80ms', 'la variable CSS suit')
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-st'), '', 'le pas écrit s\'applique')
    sh.querySelector('.e').click()
    await pause(20)
    assert.equal(m.style.getPropertyValue('--mjs-fx-stagger-ease'), '', 'la courbe écrite s\'applique')
  })
})
