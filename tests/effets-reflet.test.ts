// *reflect — un reflet miroir sous une image ou un titre : la technique choisie (reflet natif,
// -moz-element, copie inerte), chaque réglage lu, les refus de compilation, le composant, le retrait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='

const COMPOSANTS: Record<string, string> = {
  'fx-reflet':         `<div class="p"><img class="a" *reflect src="${GIF}" alt="a"></div>`,
  'fx-reflet-regles':  `<div class="p"><img class="a" *reflect(8, opacity: 0.3, size: 40, direction: up) src="${GIF}" alt="a"></div>`,
  'fx-reflet-flou':    `<div class="p"><h1 class="a" id="titre" *reflect(blur: 6)>Titre <b>fort</b><button class="b">ok</button></h1></div>`,
  'fx-reflet-eau':     `<div class="p"><h1 class="a" *reflect(water: true, speed: 2s, direction: right)>Titre</h1></div>`,
  'fx-reflet-texte':   `<script>\n$mot = 'un'\n</script>\n<div class="p"><h1 class="a" *reflect(blur: 2)>{$mot}</h1></div>\n<button class="t" @click={$mot = 'deux'}>t</button>`,
  'fx-reflet-carte':   '<p class="in">carte</p>',
  'fx-reflet-hote':    '<div class="p"><@fx-reflet-carte class="a" *reflect></@fx-reflet-carte></div>',
  'fx-reflet-retrait': `<script>\n$on = true\n</script>\n<div class="p">{if $on}<h1 class="a" *reflect(blur: 3, water: true)>Titre</h1>{end}</div>\n<button class="t" @click={$on = !$on}>t</button>`,
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *reflect', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom (celui de `CSS` compris) sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-reflet')
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

  // le navigateur joué : le reflet natif (Chromium, Safari), -moz-element (Firefox) ou aucun des deux
  const navigateur = (natif: boolean, moz = false) => {
    window.__sup = (a: string, b?: string) => (/box-reflect/.test(a) && natif) || (/background/.test(a) && /-moz-element/.test(String(b)) && moz)
  }

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  const reflets = (el: any) => Array.from(el.parentNode.children).filter((n: any) => n.getAttribute('mjs-fx-layer') === 'reflect') as any[]

  it('reflet natif : une image reçoit la direction et la technique, aucun nœud de plus', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'box')
    assert.equal(el.getAttribute('mjs-fx-reflect-dir'), 'down')
    assert.equal(reflets(el).length, 0, 'pas de copie')
    assert.equal(el.parentNode.children.length, 1)
  })

  it('*reflect(8, opacity: 0.3, size: 40, direction: up) : chaque réglage est lu', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-reflect-gap'), '8px')
    assert.equal(el.style.getPropertyValue('--mjs-reflect-opacity'), '0.3')
    assert.equal(el.style.getPropertyValue('--mjs-reflect-size'), '40%')
    assert.equal(el.getAttribute('mjs-fx-reflect-dir'), 'up')
  })

  it('le CSS : reflet natif dans les quatre sens, copie retournée, mouvement réduit', () => {
    const css = window.µ._mjs_fxDefs.reflect.css
    for (const [sens, mot] of [['down', 'below'], ['up', 'above'], ['left', 'left'], ['right', 'right']]) {
      assert.match(css, new RegExp(`\\[mjs-fx-reflect-mode="box"\\]\\[mjs-fx-reflect-dir="${sens}"\\]\\{-webkit-box-reflect:${mot} var\\(--mjs-reflect-gap,4px\\)`), sens)
    }
    assert.match(css, /--mjs-reflect-opacity,0\.5/)
    assert.match(css, /--mjs-reflect-size,50%/)
    assert.match(css, /\[mjs-fx-layer="reflect"\]\{position:absolute/)
    assert.match(css, /scaleY\(-1\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/)
  })

  it('sans reflet natif : une copie inerte, retournée, sous la balise, qui ne prend pas de place', async () => {
    navigateur(false)
    const comp = await monter('mjs-fx-reflet-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'copy')
    const [box] = reflets(el)
    assert.ok(box, 'la copie')
    assert.equal(box.tagName, 'IMG')
    assert.equal(box.getAttribute('aria-hidden'), 'true')
    assert.ok(box.hasAttribute('inert'))
    assert.equal(box.getAttribute('tabindex'), '-1')
    assert.equal(box.getAttribute('mjs-fx-reflect-dir'), 'up')
    assert.equal(box.getAttribute('src'), el.getAttribute('src'))
    assert.equal(box.getAttribute('id'), null)
    assert.equal(box.getAttribute('mjs-fx'), null, 'la copie ne porte pas l\'effet')
    assert.equal(box.style.getPropertyValue('--mjs-reflect-gap'), '8px')
    assert.equal(box.style.getPropertyValue('--mjs-reflect-size'), '40%')
  })

  it('blur : la copie est de rigueur même là où le reflet natif existe ; ni identifiant ni bouton actif dans la copie', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-flou')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'copy')
    const [box] = reflets(el)
    assert.equal(box.style.getPropertyValue('--mjs-reflect-blur'), '6px')
    assert.equal(box.textContent, 'Titre fortok')
    assert.equal(box.getAttribute('id'), null)
    assert.equal(box.querySelector('button').getAttribute('tabindex'), '-1')
    assert.equal(box.querySelector('button').getAttribute('class'), 'b')
  })

  it('Firefox : -moz-element, une boîte vide dont le fond est la balise', async () => {
    navigateur(false, true)
    const comp = await monter('mjs-fx-reflet')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'moz')
    assert.match(el.getAttribute('id'), /^mjs-fx-reflect-/, 'identifiant propre à l\'effet')
    const [box] = reflets(el)
    assert.ok(box)
    assert.equal(box.children.length, 0)
    assert.equal(box.getAttribute('aria-hidden'), 'true')
    assert.equal(box.style.getPropertyValue('--mjs-fx-reflect-src'), '-moz-element(#' + el.getAttribute('id') + ')')
  })

  it('une balise qui a déjà un identifiant le garde, avec -moz-element', async () => {
    navigateur(false, true)
    window.document.body.innerHTML = '<h1 id="titre" class="a">T</h1>'
    const h = window.document.querySelector('h1')
    const off = window.µ._mjs_fx(null, h, 'reflect', { blur: 2 }, null, null)
    assert.equal(h.getAttribute('id'), 'titre')
    assert.equal(reflets(h)[0].style.getPropertyValue('--mjs-fx-reflect-src'), '-moz-element(#titre)')
    off()
    assert.equal(h.getAttribute('id'), 'titre')
  })

  it('water : un filtre d\'ondulation (SVG) à côté de la copie, son onde menée par une boucle d\'images (aucune animation SMIL) ; la copie y renvoie', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-eau')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'copy')
    assert.equal(el.getAttribute('mjs-fx-reflect-dir'), 'right')
    const [box] = reflets(el)
    const svg   = el.parentNode.querySelector('svg')
    assert.ok(svg, 'le filtre')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    const filtre = svg.querySelector('filter')
    assert.ok(filtre.getAttribute('id').startsWith('mjs-fx-reflect-'))
    assert.ok(filtre.querySelector('feTurbulence'))
    assert.ok(filtre.querySelector('feDisplacementMap'))
    // l'onde : la fréquence du bruit menée image après image entre ses deux bornes (direction right : de 0.04 0.004 à
    // 0.07 0.008) ; une animation SMIL dans le filtre restait souvent figée dans Chromium
    assert.ok(!filtre.querySelector('animate'), 'une animation SMIL dans le filtre')
    const turb = filtre.querySelector('feTurbulence')
    const lu   = [turb.getAttribute('baseFrequency')]
    await new Promise((r) => setTimeout(r, 150))
    lu.push(turb.getAttribute('baseFrequency'))
    assert.notEqual(lu[0], lu[1], 'la fréquence ne bouge pas : ' + lu.join(' / '))
    for (const v of lu) {
      const [fx, fy] = v.split(' ').map(Number)
      assert.ok(fx >= 0.04 && fx <= 0.07 && fy >= 0.004 && fy <= 0.008, 'hors des bornes : ' + v)
    }
    assert.equal(box.style.getPropertyValue('--mjs-fx-reflect-water'), 'url(#' + filtre.getAttribute('id') + ')')
  })

  it('un composant : le reflet natif marche, la copie de blur est refusée avec un avertissement', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-hote')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), 'box')
    assert.equal(reflets(el).length, 0)
    const avis: string[] = []
    const garde = window.µ.warn
    window.µ.warn = (...a: any[]) => { avis.push(a.join(' ')) }
    window.µ._mjs_fxClear(el)
    navigateur(true)
    const off = window.µ._mjs_fx(null, el, 'reflect', { blur: 4 }, null, null)
    window.µ.warn = garde
    off()
    assert.ok(avis.some((m) => /\*reflect/.test(m) && /composant/.test(m) && /blur/.test(m) && /\bvous\b|\bvotre\b|\bvos\b/.test(m)), avis.join('|'))
  })

  it('la copie suit le contenu de la balise', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-texte')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(reflets(el)[0].textContent, 'un')
    comp._shadow.querySelector('.t').click()
    await attendre(() => reflets(el)[0]?.textContent === 'deux')
    assert.equal(reflets(el)[0].textContent, 'deux')
  })

  it('direction: diagonal, gap: 500, réglage inconnu : refusés à la compilation', async () => {
    await assert.rejects(compiler('<img *reflect(direction: up-left) src="a.png" alt="a">'), /\*reflect/)
    await assert.rejects(compiler('<img *reflect(gap: 500) src="a.png" alt="a">'), /\*reflect : gap = 500 — permis : int 0\.\.100/)
    await assert.rejects(compiler('<img *reflect(size: 2) src="a.png" alt="a">'), /\*reflect : size = 2/)
    await assert.rejects(compiler('<img *reflect(opacity: 2) src="a.png" alt="a">'), /\*reflect : opacity = 2/)
    await assert.rejects(compiler('<img *reflect(foo: 1) src="a.png" alt="a">'), /foo/)
    await compiler('<img *reflect(8, opacity: 0.3, size: 40, blur: 4, direction: left, water: true, speed: 2s) src="a.png" alt="a">')
  })

  it('le retrait de l\'effet défait tout : copie, filtre, marques, variables', async () => {
    navigateur(true)
    const comp = await monter('mjs-fx-reflet-retrait')
    const p    = comp._shadow.querySelector('.p')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(p.children.length, 3, 'balise, copie, filtre')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(p.children.length, 0, 'plus rien à côté')
    assert.equal(el.getAttribute('mjs-fx-reflect-mode'), null)
    assert.equal(el.getAttribute('mjs-fx-reflect-dir'), null)
    assertAbsent(p.querySelector('[mjs-fx-layer]'), 'copie restée')
    assertAbsent(p.querySelector('svg'), 'filtre resté')
  })

  it('retiré à la main : les marques de la balise et son identifiant sont rendus', async () => {
    navigateur(false, true)
    window.document.body.innerHTML = '<h1 class="a">T</h1>'
    const h   = window.document.querySelector('h1')
    const off = window.µ._mjs_fx(null, h, 'reflect', { direction: 'left' }, null, null)
    assert.ok(h.getAttribute('id'))
    off()
    assert.equal(h.getAttribute('id'), null)
    assert.equal(h.getAttribute('mjs-fx-reflect-mode'), null)
    assert.equal(h.getAttribute('mjs-fx'), null)
    assert.equal(window.document.body.children.length, 1)
  })
})
