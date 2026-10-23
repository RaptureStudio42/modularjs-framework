// *filter.lens — l'ancien *lens, rendu par la zone sans filtre de *filter : le texte flou, une loupe nette et cerclée qui suit la souris
// de près. Ce que la zone gagne pour cela : `ring` (un cercle la borde, de la couleur `color`), `near` (elle se montre dès que la souris
// approche de la balise, à moins de son rayon et de son bord, et part d'un coup, sans fondu ; loin de la balise rien n'est écrit) et
// `parallax` (la balise, par un filtre SVG qui la décale, et son double, par son ancrage, glissent avec la zone, puis restent où la souris
// les a laissés). De vrais composants compilés, chargés dans happy-dom ; le pixel près est vérifié au navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-loupe-defaut':  '<p class="a" *filter.lens>Un texte flou</p>',
  'fx-loupe-couleur': '<p class="a" *filter.lens(color: #f00)>Un texte flou</p>',
  'fx-loupe-nue':     '<p class="a" *filter.lens(ring: false, parallax: 0)>Un texte flou</p>',
  'fx-loupe-survol':  '<p class="a" *filter(blur: 4, spot: 100, ring: true)>Un texte flou</p>',
  'fx-loupe-douce':   '<p class="a" *filter(blur: 4, spot: 100, soft: 20, near: true)>Un texte flou</p>',
  'fx-loupe-retrait': '<script>\n$on = true\n</script>\n{if $on}<p class="a" *filter.lens>Un texte flou</p>{end}\n<button class="t" @click={$on = !$on}>t</button>'
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('*filter.lens — la loupe de l\'ancien *lens, par la zone de *filter', function () {
  this.timeout(90000)
  let window: any
  let bundle = ''

  before(async () => {
    const root   = mjsTmp('effets-filtre-loupe')
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
    bundle = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${bundle}\nglobalThis.µ = µ;`)
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
    return comp._shadow.querySelector('.a')
  }

  // la boîte de la balise : 300 × 40 à (100, 50)
  const boite   = (el: any) => mesurer(window, el, () => ({ left: 100, top: 50, right: 400, bottom: 90, width: 300, height: 40, x: 100, y: 50 }))
  const lentille = (el: any) => el.parentNode.querySelector('[mjs-fx-filter-lens]')
  const cercle   = (el: any) => el.parentNode.querySelector('[mjs-fx-filter-ring]')
  const ancrage  = (el: any) => lentille(el)?.firstChild
  const decalage = (el: any) => el.getRootNode().querySelector('filter feOffset')
  const bouger   = (x: number, y: number) => window.document.dispatchEvent(new window.PointerEvent('pointermove', { clientX: x, clientY: y }))

  // une boucle d'images que le test fait tourner à la main : ce qui est demandé attend qu'on joue l'image
  function boucle() {
    const vraiRaf = window.requestAnimationFrame
    const vraiCaf = window.cancelAnimationFrame
    const file    = new Map<number, (t: number) => void>()
    let n = 0
    let t = 1000
    window.requestAnimationFrame = (f: any) => { file.set(++n, f); return n }
    window.cancelAnimationFrame  = (id: number) => { file.delete(id) }
    return {
      image() {
        t += 1000 / 60
        const l = [...file.values()]
        file.clear()
        for (const f of l) f(t)
      },
      rendre() {
        window.requestAnimationFrame = vraiRaf
        window.cancelAnimationFrame  = vraiCaf
      }
    }
  }

  it('les réglages émis : le flou de l\'ancien *lens (10 px), une zone de 200 px de diamètre au bord net, collée à la souris, cerclée, qui se montre à l\'approche, et sa dérive', () => {
    assert.ok(bundle.includes('"filter", {"style":"none","blur":10,"spot":200,"soft":0,"smooth":1,"ring":true,"near":true,"parallax":0.04}'), 'la pose de *filter.lens')
  })

  it('la feuille : le cercle (2 px de la couleur `color`, blanc sans elle, une ombre douce, en fondu, peint avec la page), la zone de l\'approche sans fondu (découpée, à bord net), la dérive avant le filtre', () => {
    const css = window.µ._mjs_fxDefs.filter.css
    assert.ok(css.includes('[mjs-fx-filter-ring][mjs-fx-filter-ring]{left:0;top:0;width:var(--mjs-fx-filter-d,0px);height:var(--mjs-fx-filter-d,0px);margin:calc(var(--mjs-fx-filter-d,0px) / -2) 0 0 calc(var(--mjs-fx-filter-d,0px) / -2);box-sizing:border-box;border:2px solid var(--mjs-fx-filter-c,#fff);border-radius:50%;box-shadow:0 5px 25px rgba(0,0,0,.25);pointer-events:none;animation:mjs-fx-filter-in .2s ease}'), css)
    assert.ok(css.includes('[mjs-fx-filter-ring="out"][mjs-fx-filter-ring="out"]{animation:mjs-fx-filter-out .2s ease both}'))
    assert.ok(css.includes('[mjs-fx-filter-lens="near"][mjs-fx-filter-lens="near"]{animation:none}'))
    assert.ok(css.includes('[mjs-fx-filter-lens="sharp"][mjs-fx-filter-lens="sharp"]{animation:none;will-change:auto;-webkit-mask-image:none;mask-image:none;clip-path:circle(calc(var(--mjs-fx-filter-d,0px) / 2))}'))
    assert.ok(css.includes('[mjs-fx-filter-lens="sharp"][mjs-fx-filter-lens="sharp"]>div{will-change:auto}'))
    assert.ok(css.includes('[mjs-fx~="filter"][mjs-fx-on~="filter"][mjs-fx-filter-drift]{filter:var(--mjs-fx-filter-drift) var(--mjs-fx-filter-value)}'))
    assert.match(css, /prefers-reduced-motion:reduce\)\{[^@]*\[mjs-fx-filter-ring\]\[mjs-fx-filter-ring\]\{animation:none\}/)
  })

  it('la balise floue de 10 px, toujours ; rien n\'est posé ni écrit tant que la souris est loin d\'elle', async () => {
    const el = await monter('mjs-fx-loupe-defaut')
    boite(el)
    const b = boucle()
    try {
      assert.equal(el.style.getPropertyValue('--mjs-fx-filter-value'), 'blur(10px)')
      let ecrit = 0
      const mo = new window.MutationObserver((l: any[]) => { ecrit += l.length })
      mo.observe(el.getRootNode(), { attributes: true, childList: true, subtree: true })
      // à 101 px à gauche, à 101 px au-dessus, à 101 px à droite, à 101 px en dessous : hors de la zone
      for (const [x, y] of [[-1, 60], [200, -51], [501, 60], [200, 191], [900, 600]]) {
        bouger(x, y)
        b.image()
      }
      await pause()
      mo.disconnect()
      assert.equal(ecrit, 0, 'aucune écriture loin de la balise')
      assertAbsent(lentille(el))
      assertAbsent(cercle(el))
    }
    finally {
      b.rendre()
    }
  })

  it('à moins du rayon de la balise, avant d\'y entrer : la zone et son cercle sous la souris, la zone sans fondu, le cercle par-dessus, une image plus tard', async () => {
    const el = await monter('mjs-fx-loupe-defaut')
    boite(el)
    const b = boucle()
    try {
      bouger(40, 60)
      assertAbsent(lentille(el), 'lu à l\'image suivante, pas dans l\'événement')
      b.image()
      const l = lentille(el)
      const c = cercle(el)
      assert.ok(l && c, 'la zone et son cercle')
      assert.equal(l.getAttribute('mjs-fx-filter-lens'), 'sharp', 'la zone de l\'approche, à bord net : sans fondu, découpée')
      assert.equal(l.querySelector('[mjs-fx-filter-copy]').style.getPropertyValue('will-change'), 'auto', 'le double peint avec la page')
      assert.ok(l.nextElementSibling === c, 'le cercle juste après la zone')
      assert.ok(el.compareDocumentPosition(l) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'après la balise, dans son parent')
      assert.equal(l.style.getPropertyValue('translate'), '-60.0px 10.0px', 'la zone sous la souris, collée')
      assert.equal(c.style.getPropertyValue('translate'), '-60.0px 10.0px', 'le cercle aussi')
      assert.equal(c.style.getPropertyValue('--mjs-fx-filter-d'), '200px')
      assert.equal(c.style.getPropertyValue('--mjs-fx-filter-c'), '', 'sans `color` : le blanc de la feuille')
      assert.equal(c.getAttribute('mjs-fx-layer'), 'filter')
      assert.equal(l.style.getPropertyValue('left'), c.style.getPropertyValue('left'))
      assert.equal(l.style.getPropertyValue('top'), c.style.getPropertyValue('top'))
      bouger(250, 70)
      b.image()
      assert.equal(l.style.getPropertyValue('translate'), '150.0px 20.0px', 'elle suit, sur la balise aussi')
      assert.equal(c.style.getPropertyValue('translate'), '150.0px 20.0px')
    }
    finally {
      b.rendre()
    }
  })

  it('la dérive : la balise par un filtre SVG qui la décale (avant le sien), le double par son ancrage, de 0.04 fois l\'écart de la zone au centre', async () => {
    const el = await monter('mjs-fx-loupe-defaut')
    boite(el)
    const b = boucle()
    try {
      assert.equal(el.hasAttribute('mjs-fx-filter-drift'), false, 'rien avant que la zone ne bouge')
      bouger(40, 60)
      b.image()
      // la souris à (-60, 10) de la balise, son centre à (150, 20) : la dérive est de (-8.4, -0.4)
      const f = decalage(el)
      assert.ok(f, 'un décalage SVG dans la racine de la balise')
      assert.equal(f.getAttribute('dx'), '-8.4')
      assert.equal(f.getAttribute('dy'), '-0.4')
      assert.equal(f.parentNode.getAttribute('color-interpolation-filters'), 'sRGB')
      assert.equal(el.getAttribute('mjs-fx-filter-drift'), '')
      assert.equal(el.style.getPropertyValue('--mjs-fx-filter-drift'), 'url(#' + f.parentNode.id + ')')
      assert.equal(ancrage(el).style.getPropertyValue('translate'), '51.6px -10.4px', 'le double revient à sa place, plus la dérive')
      assert.equal(el.style.getPropertyValue('translate'), '', 'la balise ne bouge pas : sa boîte et sa place restent')
      bouger(250, 70)
      b.image()
      assert.equal(f.getAttribute('dx'), '0')
      assert.equal(f.getAttribute('dy'), '0')
      assert.equal(ancrage(el).style.getPropertyValue('translate'), '-150.0px -20.0px')
    }
    finally {
      b.rendre()
    }
  })

  it('la souris s\'éloigne : la zone part d\'un coup, à la place de la souris ; le cercle s\'efface là ; la dérive reste celle de ce dernier point', async () => {
    const el = await monter('mjs-fx-loupe-defaut')
    boite(el)
    const b = boucle()
    try {
      bouger(40, 60)
      b.image()
      assert.ok(lentille(el))
      bouger(-50, 60)
      b.image()
      assertAbsent(lentille(el), 'la zone est partie, sans fondu')
      const c = cercle(el)
      assert.ok(c, 'le cercle s\'efface encore')
      assert.equal(c.getAttribute('mjs-fx-filter-ring'), 'out')
      assert.equal(c.style.getPropertyValue('translate'), '-150.0px 10.0px', 'à la place de la souris')
      assert.equal(decalage(el).getAttribute('dx'), '-12', 'la dérive de ce dernier point, qui reste')
      assert.equal(decalage(el).getAttribute('dy'), '-0.4')
      await attendre(() => !cercle(el), 1500)
      assertAbsent(cercle(el), 'puis le cercle part')
      assert.equal(decalage(el).getAttribute('dx'), '-12', 'la dérive est restée')
    }
    finally {
      b.rendre()
    }
  })

  it('une balise sans boîte (cachée par `display: none`, la sienne ou celle d\'un parent, ou retirée) n\'a pas de zone ; cachée par `visibility`, son cercle l\'est aussi', async () => {
    const el = await monter('mjs-fx-loupe-defaut')
    const b  = boucle()
    try {
      // happy-dom ne met rien en page : sans boîte donnée, la balise a une boîte vide en (0, 0)
      bouger(10, 10)
      b.image()
      assertAbsent(lentille(el), 'aucune zone, la souris sur la boîte vide')
      assertAbsent(cercle(el))
      boite(el)
      el.style.setProperty('visibility', 'hidden')
      bouger(150, 60)
      b.image()
      assert.ok(lentille(el), 'avec une boîte, la zone')
      assert.equal(cercle(el).style.getPropertyValue('visibility'), 'hidden', 'le cercle, hors de la balise, en reçoit la visibilité')
    }
    finally {
      b.rendre()
    }
  })

  it('`near` avec un bord doux : la zone sans fondu, masquée et promue comme celle du survol', async () => {
    const el = await monter('mjs-fx-loupe-douce')
    boite(el)
    const b = boucle()
    try {
      // le bord compte dans la distance : 50 + 20 px
      bouger(35, 60)
      b.image()
      const l = lentille(el)
      assert.ok(l, 'à 65 px de la balise')
      assert.equal(l.getAttribute('mjs-fx-filter-lens'), 'near')
      assert.equal(l.querySelector('[mjs-fx-filter-copy]').style.getPropertyValue('will-change'), 'transform')
      bouger(29, 60)
      b.image()
      assertAbsent(lentille(el), 'à 71 px : partie')
    }
    finally {
      b.rendre()
    }
  })

  it('`color` : la couleur du cercle', async () => {
    const el = await monter('mjs-fx-loupe-couleur')
    boite(el)
    const b = boucle()
    try {
      bouger(150, 60)
      b.image()
      assert.equal(cercle(el).style.getPropertyValue('--mjs-fx-filter-c'), '#f00')
    }
    finally {
      b.rendre()
    }
  })

  it('`ring: false, parallax: 0` : la zone seule, sans cercle ni dérive', async () => {
    const el = await monter('mjs-fx-loupe-nue')
    boite(el)
    const b = boucle()
    try {
      bouger(40, 60)
      b.image()
      assert.ok(lentille(el), 'la zone')
      assertAbsent(cercle(el), 'sans cercle')
      assertAbsent(decalage(el), 'sans décalage')
      assert.equal(el.hasAttribute('mjs-fx-filter-drift'), false)
      assert.equal(ancrage(el).style.getPropertyValue('translate'), '60.0px -10.0px')
    }
    finally {
      b.rendre()
    }
  })

  it('`ring` sans `near` : le cercle vient et part avec la zone, au survol de la balise, en fondu tous les deux', async () => {
    const el = await monter('mjs-fx-loupe-survol')
    boite(el)
    bouger(40, 60)
    await pause(40)
    assertAbsent(lentille(el), 'sans `near`, rien avant le survol')
    el.dispatchEvent(new window.PointerEvent('pointerenter', { clientX: 150, clientY: 60 }))
    const l = lentille(el)
    const c = cercle(el)
    assert.ok(l && c)
    assert.equal(l.getAttribute('mjs-fx-filter-lens'), '', 'la zone en fondu')
    assert.equal(c.style.getPropertyValue('--mjs-fx-filter-d'), '100px')
    el.dispatchEvent(new window.PointerEvent('pointerleave', { clientX: 600, clientY: 60 }))
    assert.equal(l.getAttribute('mjs-fx-filter-lens'), 'out')
    assert.equal(c.getAttribute('mjs-fx-filter-ring'), 'out')
    await attendre(() => !lentille(el) && !cercle(el), 1500)
    assertAbsent(lentille(el))
    assertAbsent(cercle(el))
  })

  it('le retrait de l\'effet : ni zone, ni cercle, ni décalage, ni marque, ni variable', async () => {
    window.document.body.innerHTML = '<mjs-fx-loupe-retrait></mjs-fx-loupe-retrait>'
    const comp = window.document.querySelector('mjs-fx-loupe-retrait')
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    const el = comp._shadow.querySelector('.a')
    boite(el)
    const b = boucle()
    try {
      bouger(150, 60)
      b.image()
      assert.ok(lentille(el) && cercle(el) && decalage(el))
      comp._shadow.querySelector('.t').click()
      await attendre(() => !comp._shadow.querySelector('.a'))
      await pause()
      assertAbsent(comp._shadow.querySelector('[mjs-fx-filter-lens]'))
      assertAbsent(comp._shadow.querySelector('[mjs-fx-filter-ring]'))
      assertAbsent(comp._shadow.querySelector('filter feOffset'))
      assert.equal(el.hasAttribute('mjs-fx-filter-drift'), false)
      assert.equal(el.style.getPropertyValue('--mjs-fx-filter-drift'), '')
      bouger(160, 60)
      b.image()
      assertAbsent(comp._shadow.querySelector('[mjs-fx-filter-lens]'), 'plus rien n\'écoute')
    }
    finally {
      b.rendre()
    }
  })
})
