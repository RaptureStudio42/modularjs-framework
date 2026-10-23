// *spoiler — un texte caché, révélé au clic : les marques posées (caché, bouton au clavier, libellé),
// la révélation au clic, à Entrée, à Espace, au survol, le second clic (`again`), l'état `revealed`
// suivi par une variable, l'événement `mjs:reveal`, les quatre styles, les refus de compilation, le
// retrait sans reste. Le rendu des grains et la sélection se regardent dans Chromium et Firefox.

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
  'fx-sp':         '<p class="a" *spoiler>le code est 4815</p>',
  'fx-sp-regles':  '<p class="a" *spoiler(blur, color: #ff0000, density: 8, size: 2, speed: 2s, duration: 200ms, on: hover, again: true, radius: 10)>secret</p>',
  'fx-sp-barre':   '<p class="a" *spoiler(bar)>secret</p>',
  'fx-sp-paves':   '<p class="a" *spoiler(pixels)>secret</p>',
  'fx-sp-flou':    '<p class="a" *spoiler(blur)>secret</p>',
  'fx-sp-encore':  '<p class="a" *spoiler(again: true)>secret</p>',
  'fx-sp-etat':    '<script>\n$r = false\n</script>\n<p class="a" *spoiler(revealed: $r)>secret</p>\n<button class="b" @click={$r = !$r}>b</button>',
  'fx-sp-deja':    '<p class="a" *spoiler(revealed: true)>secret</p>',
  'fx-sp-attrs':   '<p class="a" tabindex="-1" role="note" aria-label="mien" *spoiler>secret</p>',
  'fx-sp-carte':   '<p class="c">dans la carte</p>',
  'fx-sp-hote':    '<@fx-sp-carte class="h" *spoiler></@fx-sp-carte>',
  'fx-sp-retrait': '<script>\n$on = true\n</script>\n{if $on}<p class="a" *spoiler(radius: 9)>x</p>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *spoiler', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-texte-masque')
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
    // les libellés du runtime (celui de la balise cachée) viennent du manifeste
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;${libelles ? ` µ._runtimeLabels = ${libelles[1]};` : ''}`)
    window.document.documentElement.lang = 'fr'
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

  const cache = (el: any) => el.hasAttribute('mjs-fx-spoiler-hidden')
  const touche = (el: any, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  it('*spoiler : le texte est caché — bouton au clavier, libellé en français, grains par défaut', async () => {
    const comp = await monter('mjs-fx-sp')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(cache(el), true)
    assert.equal(el.getAttribute('role'), 'button')
    assert.equal(el.getAttribute('tabindex'), '0')
    assert.equal(el.getAttribute('aria-label'), 'Texte masqué, activer pour l\'afficher')
    assert.equal(el.getAttribute('mjs-fx-spoiler-style'), 'grains')
    const layer = el.querySelector('[mjs-fx-layer="spoiler"]')
    assert.ok(layer, 'le calque des grains')
    assert.equal(layer.localName, 'canvas')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
  })

  it('le CSS : texte transparent et non sélectionnable tant qu\'il est caché, fondu à la durée, rien ne bouge si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.spoiler.css
    assert.match(css, /user-select:none/)
    assert.match(css, /color:transparent/)
    assert.match(css, /text-shadow:0 0 \.4em/)
    assert.match(css, /var\(--mjs-spoiler-duration,500ms\)/)
    assert.match(css, /:host\(\[mjs-fx~="spoiler"\]\[mjs-fx-spoiler-hidden\]\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*transition:none/)
  })

  it('un clic révèle : marques rendues, événement mjs:reveal qui remonte, un second clic ne cache pas', async () => {
    const comp = await monter('mjs-fx-sp')
    const el   = comp._shadow.querySelector('.a')
    let n = 0
    comp._shadow.addEventListener('mjs:reveal', () => n++)
    el.click()
    assert.equal(cache(el), false)
    assert.equal(n, 1, 'mjs:reveal une fois, remonté jusqu\'au shadow')
    for (const a of ['role', 'tabindex', 'aria-label']) assert.equal(el.hasAttribute(a), false, a + ' rendu')
    el.click()
    assert.equal(cache(el), false, 'sans again, rien ne recache')
    assert.equal(n, 1)
  })

  it('Entrée et Espace révèlent', async () => {
    const comp = await monter('mjs-fx-sp')
    const el   = comp._shadow.querySelector('.a')
    touche(el, 'a')
    assert.equal(cache(el), true, 'une autre touche ne fait rien')
    touche(el, 'Enter')
    assert.equal(cache(el), false)
    const comp2 = await monter('mjs-fx-sp')
    const el2   = comp2._shadow.querySelector('.a')
    touche(el2, ' ')
    assert.equal(cache(el2), false)
  })

  it('again: un second clic recache, et rend la marque', async () => {
    const comp = await monter('mjs-fx-sp-encore')
    const el   = comp._shadow.querySelector('.a')
    el.click()
    assert.equal(cache(el), false)
    el.click()
    assert.equal(cache(el), true)
    assert.equal(el.getAttribute('role'), 'button')
    assert.equal(el.getAttribute('tabindex'), '0')
  })

  it('les quatre styles : grains et pavés sur une toile, barre sur une pastille, flou sans calque', async () => {
    const grains = (await monter('mjs-fx-sp'))._shadow.querySelector('.a')
    assert.equal(grains.querySelector('[mjs-fx-layer="spoiler"]').localName, 'canvas')
    const barre = (await monter('mjs-fx-sp-barre'))._shadow.querySelector('.a')
    assert.equal(barre.getAttribute('mjs-fx-spoiler-style'), 'bar')
    assert.equal(barre.querySelector('[mjs-fx-layer="spoiler"]').localName, 'span')
    const paves = (await monter('mjs-fx-sp-paves'))._shadow.querySelector('.a')
    assert.equal(paves.getAttribute('mjs-fx-spoiler-style'), 'pixels')
    assert.equal(paves.querySelector('[mjs-fx-layer="spoiler"]').localName, 'canvas')
    const flou = (await monter('mjs-fx-sp-flou'))._shadow.querySelector('.a')
    assert.equal(flou.getAttribute('mjs-fx-spoiler-style'), 'blur')
    assertAbsent(flou.querySelector('[mjs-fx-layer]'), 'le flou n\'a pas de calque')
  })

  it('chaque réglage est lu : couleur, densité, taille, vitesse, durée, déclencheur, again, arrondi', async () => {
    const comp = await monter('mjs-fx-sp-regles')
    const el   = comp._shadow.querySelector('.a')
    const s    = el._mjs_fxOff.spoiler._s
    assert.equal(s.style, 'blur')
    assert.equal(s.color, '#ff0000')
    assert.equal(s.density, 8)
    assert.equal(s.size, 2)
    assert.equal(s.speed, '2s')
    assert.equal(s.on, 'hover')
    assert.equal(s.again, true)
    assert.equal(el.style.getPropertyValue('--mjs-spoiler-color'), '#ff0000')
    assert.equal(el.style.getPropertyValue('--mjs-spoiler-duration'), '200ms')
    assert.equal(el.style.borderRadius, '10px')
  })

  it('on: hover : le survol révèle, la sortie recache', async () => {
    const comp = await monter('mjs-fx-sp-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(cache(el), true)
    el.dispatchEvent(new window.MouseEvent('pointerenter'))
    assert.equal(cache(el), false)
    el.dispatchEvent(new window.MouseEvent('pointerleave'))
    assert.equal(cache(el), true)
  })

  it('revealed tenu par une variable : vrai révèle, faux recache ; déjà vrai au départ, rien n\'est caché', async () => {
    const comp = await monter('mjs-fx-sp-etat')
    const el   = comp._shadow.querySelector('.a')
    let n = 0
    el.addEventListener('mjs:reveal', () => n++)
    assert.equal(cache(el), true)
    comp._shadow.querySelector('.b').click()
    await pause(30)
    assert.equal(cache(el), false)
    assert.equal(n, 1, 'mjs:reveal quand la variable révèle')
    assert.equal(el.hasAttribute('role'), false)
    comp._shadow.querySelector('.b').click()
    await pause(30)
    assert.equal(cache(el), true)
    assert.equal(el.getAttribute('role'), 'button')
    const deja = (await monter('mjs-fx-sp-deja'))._shadow.querySelector('.a')
    assert.equal(cache(deja), false)
    assert.equal(deja.hasAttribute('role'), false)
  })

  it('un tabindex, un role et un aria-label déjà écrits sont gardés puis rendus tels quels', async () => {
    const comp = await monter('mjs-fx-sp-attrs')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('tabindex'), '-1', 'tabindex gardé')
    assert.equal(el.getAttribute('role'), 'button')
    assert.equal(el.getAttribute('aria-label'), 'Texte masqué, activer pour l\'afficher')
    el.click()
    assert.equal(el.getAttribute('tabindex'), '-1')
    assert.equal(el.getAttribute('role'), 'note', 'le role d\'avant est rendu')
    assert.equal(el.getAttribute('aria-label'), 'mien')
  })

  it('sur un composant : le calque est dans son shadow root', async () => {
    const comp = await monter('mjs-fx-sp-hote', '.h')
    const h    = comp._shadow.querySelector('.h')
    await attendre(() => !!h._shadow?.querySelector('.c'))
    await pause()
    assert.ok(h._shadow.querySelector('[mjs-fx-layer="spoiler"]'))
    assert.equal(cache(h), true)
  })

  it('density: 11 et size: 9 sont refusés à la compilation ; style inconnu aussi', async () => {
    await assert.rejects(compiler('<p *spoiler(density: 11)>x</p>'), /\*spoiler : density = 11 — permis : int 1\.\.10/)
    await assert.rejects(compiler('<p *spoiler(size: 9)>x</p>'), /\*spoiler : size = 9 — permis : float 0\.5\.\.6/)
    await assert.rejects(compiler('<p *spoiler(wave)>x</p>'), /\*spoiler : style = wave — permis/)
    await assert.rejects(compiler('<p *spoiler(on: drag)>x</p>'), /\*spoiler : on = drag — permis/)
    await compiler('<p *spoiler(density: 10, size: 6)>x</p>')
  })

  it('le retrait rend tout : marques, attributs, calque, arrondi, variables', async () => {
    const comp = await monter('mjs-fx-sp-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(el.querySelector('[mjs-fx-layer="spoiler"]'))
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
    for (const a of ['role', 'tabindex', 'aria-label']) assert.equal(el.hasAttribute(a), false, a + ' resté')
    assert.equal(el.style.borderRadius, '')
    assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''))
    assert.equal(el._mjs_fxOff ?? null, null)
  })
})
