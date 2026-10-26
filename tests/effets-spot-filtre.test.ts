// *filter(…, spot) — l'image filtrée, nette sous la souris : pendant le survol seulement, un double de la balise
// SANS filtre est posé dans une lentille (un cadre de la taille de la zone, au masque radial immobile, que la souris
// déplace par `translate`) et un ancrage (qui revient en sens inverse), en dernier enfant du parent de la balise.
// Sa pose et sa marque, ce qu'il garde et ce qu'il perd, son fondu, le lissage du suivi (une boucle qui s'arrête
// d'elle-même), ce qui n'est pas couvert, une variable suivie sur place, le retrait sans reste — et le `*filter` d'avant
// (sans spot) qui n'écoute rien et ne pose rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mesurer } from './helpers/mesure-balise.js'

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

const COMPOSANTS: Record<string, string> = {
  'fx-spotf-defaut':   `<img class="a" *filter(grayscale) src="${GIF}" alt="a">`,
  'fx-spotf-img':      `<img class="a" *filter(grayscale, spot: 200) src="${GIF}" alt="a">`,
  'fx-spotf-collee':   `<img class="a" *filter(grayscale, spot: 200, smooth: 1) src="${GIF}" alt="a">`,
  'fx-spotf-bloc':     '<div class="a" id="x" *filter(sepia, spot: 120, soft: 10)><p class="p" id="y" onclick="1">texte</p></div>',
  'fx-spotf-lent':     `<img class="a" *filter(blur: 4, spot: 100, smooth: 0.5) src="${GIF}" alt="a">`,
  'fx-spotf-survol':   `<img class="a" *filter(grayscale, on: hover, spot: 100) src="${GIF}" alt="a">`,
  'fx-spotf-repos':    `<img class="a" *filter(grayscale, on: rest, spot: 100) src="${GIF}" alt="a">`,
  'fx-spotf-video':    '<video class="a" *filter(grayscale, spot: 100)></video>',
  'fx-spotf-variable': `<script>\n$d = 100\n$s = 40\n$m = 0.5\n</script>\n<img class="a" *filter(grayscale, spot: $d, soft: $s, smooth: $m) src="${GIF}" alt="a">\n<button class="t" @click={$d = 0}>t</button>\n<button class="u" @click={$s = 10}>u</button>\n<button class="v" @click={$m = 1}>v</button>`,
  'fx-spotf-retrait':  `<script>\n$on = true\n</script>\n{if $on}<img class="a" *filter(grayscale, spot: 100, smooth: 0.5) src="${GIF}" alt="a">{end}\n<button class="t" @click={$on = !$on}>t</button>`,
  'fx-spotf-boite':    '<div class="b">dedans</div>',
  'fx-spotf-hote':     '<@fx-spotf-boite class="h" *filter(grayscale, spot: 100)></@fx-spotf-boite>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *filter(…, spot)', function () {
  this.timeout(90000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-spot-filtre')
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

  // la boîte de la balise : 300 × 200 à (100, 50)
  const boite  = (el: any) => mesurer(window, el, () => ({ left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200, x: 100, y: 50 }))
  const geste  = (el: any, type: string, x: number, y: number) => el.dispatchEvent(new window.PointerEvent(type, { clientX: x, clientY: y }))
  const copies = (el: any) => Array.from(el.parentNode.querySelectorAll('[mjs-fx-filter-copy]')) as any[]
  // le double est dans l'ancrage, lui-même dans la lentille : la lentille porte la taille de la zone et le `translate` qui la suit
  const ancrage  = (c: any) => c.parentNode
  const lentille = (c: any) => c.parentNode.parentNode
  const pos      = (c: any) => (lentille(c).style.getPropertyValue('translate') || '').split(' ')
  const posX     = (c: any) => pos(c)[0] ?? ''
  const posY     = (c: any) => pos(c)[1] ?? ''

  // une boucle d'images que le banc fait tourner à la main : ce qui est demandé attend qu'on joue l'image
  function boucle() {
    const vraiRaf = window.requestAnimationFrame
    const vraiCaf = window.cancelAnimationFrame
    const file    = new Map<number, (t: number) => void>()
    let n = 0
    let t = 1000
    window.requestAnimationFrame = (f: any) => { file.set(++n, f); return n }
    window.cancelAnimationFrame  = (id: number) => { file.delete(id) }
    return {
      demandes: () => file.size,
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

  // happy-dom 20.14 a getAnimations et animate sur tout élément, 20.11 non, et le cœur les lit par le prototype, partagé par toutes les fenêtres : un test écrit pour le chemin sans l'API Web Animations les ôte le temps de son déroulement
  // (ses propres faux, s'il en a, se posent ensuite sur ce prototype) et appelle la fonction rendue dans un finally, qui remet ce qui y était
  function sansAnimations() {
    const proto = window.Element.prototype
    const avant = ['getAnimations', 'animate'].map((nom) => [nom, Object.getOwnPropertyDescriptor(proto, nom)] as const)
    for (const [nom] of avant) delete proto[nom]
    return () => {
      for (const [nom, d] of avant) {
        if (d) Object.defineProperty(proto, nom, d)
        else delete proto[nom]
      }
    }
  }

  it('sans spot (défaut) : rien n\'écoute, rien n\'est posé, le filtre est celui d\'avant', async () => {
    const comp = await monter('mjs-fx-spotf-defaut')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointerenter', 150, 90)
    geste(el, 'pointermove', 160, 90)
    assert.equal(copies(el).length, 0)
    assert.equal(el.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)')
    assert.equal(el.getAttribute('mjs-fx'), 'filter')
    geste(el, 'pointerleave', 600, 90)
  })

  it('spot : un double sans filtre, dernier enfant du parent, marqué calque d\'effet, inerte, sans autre marque ni identifiant ; il disparaît après la sortie', async () => {
    const comp = await monter('mjs-fx-spotf-collee')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    assert.equal(copies(el).length, 0, 'rien au repos : le double n\'existe que pendant le survol')
    geste(el, 'pointerenter', 150, 90)
    const [c] = copies(el)
    assert.equal(copies(el).length, 1)
    assert.ok(el.parentNode.lastElementChild === lentille(c), 'la lentille est le dernier enfant du parent : aucun frère ne change de rang')
    assert.equal(lentille(c).getAttribute('mjs-fx-layer'), 'filter', 'la lentille est un calque d\'effet pour les autres effets')
    assert.ok(lentille(c).firstChild === ancrage(c) && lentille(c).children.length === 1 && ancrage(c).children.length === 1, 'lentille > ancrage > double, rien d\'autre')
    assert.equal(c.getAttribute('aria-hidden'), 'true')
    assert.equal(c.hasAttribute('inert'), true)
    assert.deepEqual(c.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')).sort(), ['mjs-fx-filter-copy', 'mjs-fx-layer'], 'aucune marque d\'effet recopiée : la sienne, et celle des calques')
    assert.equal(c.getAttribute('mjs-fx-layer'), 'filter')
    assert.equal(c.getAttribute('class'), el.getAttribute('class'))
    assert.equal(c.getAttribute('src'), el.getAttribute('src'))
    assert.equal(c.getAttribute('loading'), 'eager')
    assert.equal(c.style.getPropertyValue('position'), 'absolute')
    assert.equal(c.style.getPropertyValue('pointer-events'), 'none')
    assert.equal(c.style.getPropertyValue('width'), '300px')
    assert.equal(c.style.getPropertyValue('height'), '200px')
    assert.equal(c.style.getPropertyValue('left'), '0px', 'le double est à l\'origine de son ancrage')
    assert.equal(lentille(c).style.getPropertyValue('left'), '100px', 'la place de la balise est celle de la lentille')
    assert.equal(lentille(c).style.getPropertyValue('top'), '50px')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-d'), '200px')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-s'), '40px', 'soft : 40 par défaut')
    assert.equal(posX(c), '50.0px', 'née sous la souris')
    assert.equal(posY(c), '40.0px')
    assert.equal(ancrage(c).style.getPropertyValue('translate'), '-50.0px -40.0px', 'l\'ancrage revient en sens inverse : le double ne bouge pas')
    assert.equal(el.getAttribute('mjs-fx'), 'filter', 'la balise garde son filtre')
    assert.equal(el.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)')
    geste(el, 'pointermove', 250, 150)
    assert.equal(posX(c), '150.0px')
    assert.equal(posY(c), '100.0px')
    assert.equal(ancrage(c).style.getPropertyValue('translate'), '-150.0px -100.0px')
    assert.equal(c.getAttribute('style').includes('translate'), false, 'rien n\'est écrit sur le double lui-même')
    geste(el, 'pointerleave', 600, 150)
    assert.equal(lentille(c).getAttribute('mjs-fx-filter-lens'), 'out', 'elle s\'efface')
    await attendre(() => copies(el).length === 0, 1500)
    assert.equal(copies(el).length, 0, 'et il repart')
  })

  it('un bloc : copie profonde de son contenu, identifiants et gestionnaires en ligne retirés', async () => {
    const comp = await monter('mjs-fx-spotf-bloc')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointerenter', 150, 90)
    const [c] = copies(el)
    assert.ok(c, 'le double')
    assert.equal(c.localName, 'div')
    assert.equal(c.querySelector('p').textContent, 'texte')
    assert.equal(c.getAttribute('id'), null)
    assert.equal(c.querySelector('p').hasAttribute('id'), false)
    assert.equal(c.querySelector('p').hasAttribute('onclick'), false)
    assert.equal(el.getAttribute('id'), 'x', 'la balise garde son identifiant')
    assert.equal(el.querySelector('p').getAttribute('id'), 'y')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-d'), '120px')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-s'), '10px', 'soft: 10')
    geste(el, 'pointerleave', 600, 150)
  })

  it('on: hover : le double se pose à l\'entrée ; on: rest : jamais (la balise n\'est pas filtrée pendant le survol)', async () => {
    const comp = await monter('mjs-fx-spotf-survol')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointerenter', 150, 90)
    assert.equal(copies(el).length, 1)
    geste(el, 'pointerleave', 600, 90)
    const comp2 = await monter('mjs-fx-spotf-repos')
    const el2   = comp2._shadow.querySelector('.a')
    boite(el2)
    geste(el2, 'pointerenter', 150, 90)
    geste(el2, 'pointermove', 160, 90)
    assert.equal(copies(el2).length, 0)
    assert.equal(el2.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)', 'le filtre est posé')
  })

  it('non couvert — une vidéo, un composant : le filtre reste, aucune zone nette, aucun double', async () => {
    const comp = await monter('mjs-fx-spotf-video')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointerenter', 150, 90)
    assert.equal(copies(el).length, 0)
    assert.equal(el.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)')
    const comp2 = await monter('mjs-fx-spotf-hote', '.h')
    const hote  = comp2._shadow.querySelector('.h')
    boite(hote)
    geste(hote, 'pointerenter', 150, 90)
    assert.equal(copies(hote).length, 0)
    assert.equal(hote.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)')
  })

  it('le suivi de la balise : une transition (transitionrun) et une animation du cœur (µ._mjs_animate) sont suivies tant qu\'elles durent, celle du script de l\'auteur est trouvée au mouvement de la souris ; souris immobile, rien ne tourne', async () => {
    const comp = await monter('mjs-fx-spotf-img')
    const bc   = boucle()
    let anims: any[] = []
    let releves = 0
    const n = window.document.createElement('div')
    comp._shadow.appendChild(n)
    boite(n)
    // aucune minuterie, ni avant, ni pendant, ni après le survol
    let minuteries = 0
    const vraiSet = window.setInterval
    window.setInterval = (...a: any[]) => { minuteries++; return vraiSet.apply(window, a as any) }
    // les faux de la balise, là où le cœur les lit : sur le prototype, filtrés sur elle ; la zone règle son suivi à sa pose, ils la précèdent
    const rendreApi = sansAnimations()
    const proto     = window.Element.prototype
    proto.getAnimations = function (this: any) {
      if (this !== n) return []
      releves++
      return anims
    }
    proto.animate = function (this: any) { return this === n ? { playState: 'running' } : undefined }
    let zone: any
    try {
      zone = window._mjsFxSpot(n, { spot: 100, soft: 40, smooth: 1, on: 'hover' })
      geste(n, 'pointerenter', 150, 90)
      assert.equal(bc.demandes(), 1, 'à l\'entrée, deux images pour reprendre la transformation que le survol applique')
      // la transition part juste après l'entrée : l'événement arme le suivi, qui dure tant que le navigateur la dit en cours
      anims = [{ playState: 'running', transitionProperty: 'scale' }]
      n.dispatchEvent(new window.Event('transitionrun'))
      for (let i = 0; i < 12; i++) bc.image()
      assert.equal(bc.demandes(), 1, 'douze images plus tard, la transition dure encore : le suivi continue')
      anims = []
      for (let i = 0; i < 4 && bc.demandes() > 0; i++) bc.image()
      assert.equal(bc.demandes(), 0, 'la transition est finie : plus aucune image demandée')
      // le cœur anime la balise (µ._mjs_animate) : le relais prévient la zone, sans événement ni minuterie
      anims = [{ playState: 'running', transitionProperty: undefined }]
      window.µ._mjs_animate(n, [], {})
      assert.equal(bc.demandes(), 1, 'le cœur anime la balise : le suivi repart')
      for (let i = 0; i < 12; i++) bc.image()
      assert.equal(bc.demandes(), 1, 'et dure tant que l\'animation dure')
      anims = []
      for (let i = 0; i < 4 && bc.demandes() > 0; i++) bc.image()
      assert.equal(bc.demandes(), 0)
      // une animation lancée par le script de l'auteur ne s'annonce par rien : souris immobile, rien ne la cherche (ni image, ni relevé)
      anims = [{ playState: 'running', transitionProperty: undefined }]
      const avant = releves
      await pause(150)
      assert.equal(bc.demandes(), 0, 'souris immobile : aucune image demandée')
      assert.equal(releves, avant, 'et aucun relevé des animations')
      // le mouvement suivant de la souris la trouve
      geste(n, 'pointermove', 160, 90)
      assert.equal(bc.demandes(), 1, 'un mouvement de la souris a trouvé l\'animation : le suivi repart')
      for (let i = 0; i < 12; i++) bc.image()
      assert.equal(bc.demandes(), 1, 'et dure tant que l\'animation dure')
      anims = []
      for (let i = 0; i < 4 && bc.demandes() > 0; i++) bc.image()
      assert.equal(bc.demandes(), 0)
      // deux mouvements à la suite ne relèvent qu'une fois (au plus un relevé tous les 50 ms)
      await pause(60)
      const r0 = releves
      geste(n, 'pointermove', 161, 90)
      geste(n, 'pointermove', 162, 90)
      assert.equal(releves - r0, 1, 'deux mouvements à la suite : un seul relevé')
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 1, 'pendant le survol, la zone est dans la liste du relais')
      geste(n, 'pointerleave', 600, 90)
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 0, 'la souris partie, la zone a quitté la liste du relais')
      anims = [{ playState: 'running', transitionProperty: undefined }]
      window.µ._mjs_animate(n, [], {})
      await pause(150)
      assert.equal(bc.demandes(), 0, 'la souris partie, le relais ne prévient plus la zone')
      geste(n, 'pointerenter', 150, 90)
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 1, 'une nouvelle entrée : la zone revient dans la liste')
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 1, 'la zone est dans la liste du relais')
      zone.off()
      // le dernier retrait rend au cœur sa fonction d'origine (le relais n'est plus là : voir le test du relais)
      assert.equal(window.µ._mjs_animate._mjsFxSpot, undefined, 'le retrait en plein survol sort la zone du relais, qui part avec elle')
      window.µ._mjs_animate(n, [], {})
      assert.equal(minuteries, 0, 'le suivi n\'a posé aucune minuterie')
    }
    finally {
      // un retrait qui lève ne laisse pas les faux sur le prototype, partagé par tout le processus
      try {
        zone?.off()
      }
      finally {
        window.setInterval = vraiSet
        n.remove()
        bc.rendre()
        rendreApi()
      }
    }
  })

  it('le relais posé sur µ._mjs_animate part avec le dernier *filter(spot) : le cœur retrouve sa fonction d\'origine, et le relais revient à la zone suivante', async () => {
    const comp = await monter('mjs-fx-spotf-img')
    const bc   = boucle()
    const vrai = window.µ._mjs_animate
    // la fonction d'origine du cœur, remplacée par une sentinelle le temps du test
    const origine = function (_n: any, _images: any, _options: any) { return { playState: 'running' } }
    window.µ._mjs_animate = origine
    const a = window.document.createElement('div')
    const b = window.document.createElement('div')
    comp._shadow.appendChild(a)
    comp._shadow.appendChild(b)
    for (const n of [a, b]) {
      n.getAnimations = () => []
      boite(n)
    }
    const zoneA = window._mjsFxSpot(a, { spot: 100, soft: 40, smooth: 1, on: 'hover' })
    const zoneB = window._mjsFxSpot(b, { spot: 100, soft: 40, smooth: 1, on: 'hover' })
    try {
      assert.equal(window.µ._mjs_animate, origine, 'au repos, aucune zone survolée : le cœur n\'est pas enveloppé')
      geste(a, 'pointerenter', 150, 90)
      geste(b, 'pointerenter', 150, 90)
      assert.notEqual(window.µ._mjs_animate, origine, 'pendant le survol, le relais enveloppe le cœur')
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 2, 'les deux zones sont dans sa liste')
      zoneA.off()
      assert.notEqual(window.µ._mjs_animate, origine, 'une zone reste survolée : le relais reste')
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 1)
      zoneB.off()
      assert.equal(window.µ._mjs_animate, origine, 'le dernier retrait : le cœur retrouve exactement sa fonction d\'origine')
      // le cœur marche toujours, et une zone qui revient repose un relais
      assert.deepEqual(window.µ._mjs_animate(a, [], {}), { playState: 'running' })
      const zoneC = window._mjsFxSpot(a, { spot: 100, soft: 40, smooth: 1, on: 'hover' })
      geste(a, 'pointerenter', 150, 90)
      assert.equal(window.µ._mjs_animate._mjsFxSpot.length, 1, 'une zone neuve repose un relais')
      zoneC.off()
      assert.equal(window.µ._mjs_animate, origine, 'et le retire à son retrait')
    }
    finally {
      zoneA.off()
      zoneB.off()
      window.µ._mjs_animate = vrai
      a.remove()
      b.remove()
      bc.rendre()
    }
  })

  it('smooth: 0.5 : la zone rattrape la souris image après image, puis la boucle s\'arrête d\'elle-même', async () => {
    const rendreApi = sansAnimations()
    try {
      const comp = await monter('mjs-fx-spotf-lent')
      const el   = comp._shadow.querySelector('.a')
      const bc   = boucle()
      try {
        boite(el)
        geste(el, 'pointerenter', 150, 90)
        const [c] = copies(el)
        assert.equal(posX(c), '50.0px', 'née sous la souris')
        assert.equal(bc.demandes(), 0, 'rien ne tourne tant que la souris ne bouge pas')
        geste(el, 'pointermove', 350, 90)
        assert.equal(posX(c), '50.0px')
        assert.equal(bc.demandes(), 1)
        geste(el, 'pointermove', 350, 90)
        assert.equal(bc.demandes(), 1, 'une seule boucle')
        const vus: number[] = []
        for (let i = 0; i < 80 && bc.demandes() > 0; i++) {
          bc.image()
          vus.push(parseFloat(posX(c)))
        }
        assert.ok(vus.length > 4 && vus.length < 40, `converge en ${vus.length} images`)
        assert.ok(vus.every((v, i) => i === 0 || v >= vus[i - 1]))
        assert.equal(posX(c), '250.0px')
        assert.equal(bc.demandes(), 0, 'la boucle s\'est arrêtée')
        geste(el, 'pointermove', 150, 90)
        assert.equal(bc.demandes(), 1)
        geste(el, 'pointerleave', 600, 90)
        assert.equal(bc.demandes(), 0, 'la sortie l\'arrête')
      }
      finally {
        bc.rendre()
      }
    }
    finally {
      rendreApi()
    }
  })

  it('smooth par défaut (0.2) : un retard, une boucle ; « réduire les animations » : collé à la souris, double ôté sans fondu', async () => {
    const rendreApi = sansAnimations()
    try {
      const comp = await monter('mjs-fx-spotf-img')
      const el   = comp._shadow.querySelector('.a')
      const bc   = boucle()
      try {
        boite(el)
        geste(el, 'pointerenter', 150, 90)
        geste(el, 'pointermove', 350, 90)
        assert.equal(bc.demandes(), 1, '0.2 : la zone traîne')
        geste(el, 'pointerleave', 600, 90)
      }
      finally {
        bc.rendre()
      }
      await attendre(() => copies(el).length === 0, 1500)
      const vrai = window.matchMedia
      window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
      const bc2 = boucle()
      try {
        const comp2 = await monter('mjs-fx-spotf-lent')
        const el2   = comp2._shadow.querySelector('.a')
        boite(el2)
        geste(el2, 'pointerenter', 150, 90)
        geste(el2, 'pointermove', 350, 90)
        assert.equal(posX(copies(el2)[0]), '250.0px')
        assert.equal(bc2.demandes(), 0)
        geste(el2, 'pointerleave', 600, 90)
        assert.equal(copies(el2).length, 0, 'sans fondu : parti aussitôt')
      }
      finally {
        bc2.rendre()
        window.matchMedia = vrai
      }
    }
    finally {
      rendreApi()
    }
  })

  it('la boîte n\'est lue qu\'à l\'entrée : pas une fois par mouvement ; un défilement la fait relire', async () => {
    const comp = await monter('mjs-fx-spotf-img')
    const el   = comp._shadow.querySelector('.a')
    let lues   = 0
    mesurer(window, el, () => {
      lues++
      return { left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200, x: 100, y: 50 }
    })
    geste(el, 'pointerenter', 150, 90)
    for (let i = 0; i < 30; i++) geste(el, 'pointermove', 150 + i, 90)
    assert.equal(lues, 1, 'une lecture pour trente mouvements')
    window.document.dispatchEvent(new window.Event('scroll'))
    geste(el, 'pointermove', 200, 90)
    assert.equal(lues, 2, 'après un défilement, la boîte est relue au mouvement suivant')
    for (let i = 0; i < 10; i++) geste(el, 'pointermove', 200 + i, 90)
    assert.equal(lues, 2)
    geste(el, 'pointerleave', 600, 90)
  })

  it('un diamètre tenu par une variable est suivi sur place : à 0, le double part et plus rien n\'écoute', async () => {
    const comp = await monter('mjs-fx-spotf-variable')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointerenter', 150, 90)
    const c = copies(el)[0]
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-d'), '100px')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-s'), '40px')
    comp._shadow.querySelector('.u').click()
    await attendre(() => lentille(c).style.getPropertyValue('--mjs-fx-filter-s') === '10px')
    assert.equal(lentille(c).style.getPropertyValue('--mjs-fx-filter-s'), '10px', 'soft : le bord de la zone qui existe suit sa variable')
    assert.ok(copies(el)[0] === c, 'le même double')
    const bc = boucle()
    try {
      geste(el, 'pointermove', 350, 90)
      assert.equal(posX(c), '50.0px', 'smooth: 0.5 : la zone traîne')
      comp._shadow.querySelector('.v').click()
      await pause(40)
      geste(el, 'pointermove', 300, 90)
      assert.equal(posX(c), '200.0px', 'smooth: 1 (par variable) : collée à la souris, sans reposer l\'effet')
    }
    finally {
      bc.rendre()
    }
    comp._shadow.querySelector('.t').click()
    await attendre(() => copies(el).length === 0)
    assert.equal(copies(el).length, 0, 'spot: 0 : le double est parti')
    geste(el, 'pointerleave', 600, 90)
    geste(el, 'pointerenter', 150, 90)
    assert.equal(copies(el).length, 0, 'et la balise n\'écoute plus')
    assert.equal(el.style.getPropertyValue('--mjs-fx-filter-value'), 'grayscale(1)', 'le filtre, lui, reste')
  })

  it('smooth hors bornes (0, négatif, trop grand, illisible) : ramené entre 0,01 et 1 à la pose et dans le suivi sur place ; la zone avance, la boucle finit', async () => {
    const rendreApi = sansAnimations()
    try {
      const comp = await monter('mjs-fx-spotf-collee')
      const def  = window.µ._mjs_fxDefs.filter
      const bc   = boucle()
      try {
        for (const via of ['pose', 'suivi']) {
          for (const vu of [0, -1, -50, 3, 'x']) {
            const n = window.document.createElement('img')
            n.setAttribute('src', GIF)
            comp._shadow.appendChild(n)
            boite(n)
            const stop = def.setup(n, { style: 'grayscale', spot: 100, soft: 0, smooth: via === 'pose' ? vu : 0.5 })
            if (via === 'suivi') stop.set('smooth', vu)
            geste(n, 'pointerenter', 150, 90)
            const c = copies(n)[0]
            geste(n, 'pointermove', 350, 90)
            const lent = typeof vu === 'number' ? vu < 1 : false
            const arret = vu === 3 || vu === 'x'
            assert.ok(c, via + ' ' + vu + ' : le double')
            let dernier = parseFloat(posX(c))
            let images  = 0
            if (arret && via === 'pose' && vu === 3) assert.equal(bc.demandes(), 0, 'collé à la souris : aucune boucle')
            for (; images < 4000 && bc.demandes() > 0; images++) {
              bc.image()
              const x = parseFloat(posX(c))
              assert.ok(x >= dernier && x <= 250, via + ' ' + vu + ' : la zone avance vers la souris (' + dernier + ' puis ' + x + ')')
              dernier = x
            }
            assert.ok(bc.demandes() === 0, via + ' ' + vu + ' : la boucle finit (' + images + ' images' + (lent ? '' : ', collée') + ')')
            assert.equal(posX(c), '250.0px', via + ' ' + vu + ' : et la zone est sur la souris')
            geste(n, 'pointerleave', 600, 90)
            stop()
            n.remove()
          }
        }
      }
      finally {
        bc.rendre()
      }
    }
    finally {
      rendreApi()
    }
  })

  it('la feuille : lentille à masque radial immobile, net sur le diamètre puis effacé sur le bord, fondu d\'entrée et de sortie, mouvement réduit', async () => {
    await monter('mjs-fx-spotf-img')
    const css = window.µ._mjs_fxDefs.filter.css
    assert.match(css, /\[mjs-fx-filter-lens\]\[mjs-fx-filter-lens\]\{[^}]*-webkit-mask-image:radial-gradient\(circle,#000 calc\(var\(--mjs-fx-filter-d,0px\) \/ 2\),transparent calc\(var\(--mjs-fx-filter-d,0px\) \/ 2 \+ var\(--mjs-fx-filter-s,40px\)\)\)/, 'le masque est centré sur la lentille, pas sur la souris')
    assert.match(css, /\[mjs-fx-filter-lens\]\[mjs-fx-filter-lens\]\{[^}]*overflow:clip[^}]*will-change:transform/, 'la lentille rogne et se promeut')
    assert.match(css, /\[mjs-fx-filter-lens\]\[mjs-fx-filter-lens\]>div\{position:absolute;left:50%;top:50%;width:0;height:0;will-change:transform\}/, 'l\'ancrage est au centre de la lentille')
    assert.doesNotMatch(css, /var\(--mjs-fx-filter-[xy]/, 'plus de variable de position')
    assert.match(css, /@keyframes mjs-fx-filter-in\{from\{opacity:0\}to\{opacity:1\}\}/)
    assert.match(css, /@keyframes mjs-fx-filter-out\{from\{opacity:1\}to\{opacity:0\}\}/)
    assert.match(css, /prefers-reduced-motion:reduce\)\{[^@]*\[mjs-fx-filter-lens\]\[mjs-fx-filter-lens\]\{animation:none\}/)
  })

  it('le retrait ({if} refermé) enlève le double, le fondu en cours, la boucle et les écouteurs', async () => {
    const comp = await monter('mjs-fx-spotf-retrait')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      geste(el, 'pointermove', 350, 90)
      assert.equal(copies(el).length, 1)
      assert.equal(bc.demandes(), 1)
      comp._shadow.querySelector('.t').click()
      await attendre(() => !comp._shadow.querySelector('.a'))
      await pause(50)
      assert.equal(bc.demandes(), 0, 'la boucle est arrêtée')
      assert.equal(comp._shadow.querySelectorAll('[mjs-fx-filter-copy]').length, 0, 'plus aucun double')
      assert.equal(el._mjs_fxOff ?? null, null)
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
      assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'variables restées : ' + el.getAttribute('style'))
      geste(el, 'pointerenter', 150, 90)
      assert.equal(comp._shadow.querySelectorAll('[mjs-fx-filter-copy]').length, 0, 'plus aucun écouteur')
    }
    finally {
      bc.rendre()
    }
    assertAbsent(comp._shadow.querySelector('[mjs-fx-filter-copy]'), 'double resté')
  })

  it('les refus de compilation disent quoi écrire ; les écritures de la démonstration passent', async () => {
    await assert.rejects(compiler('<img *filter(grayscale, spot: 3000) src="a.png" alt="a">'), /\*filter : spot = 3000 — permis : int 0\.\.2000/)
    await assert.rejects(compiler('<img *filter(grayscale, spot: 100, soft: 1500) src="a.png" alt="a">'), /\*filter : soft = 1500 — permis : int 0\.\.1000/)
    await assert.rejects(compiler('<img *filter(grayscale, spot: 100, smooth: 0) src="a.png" alt="a">'), /\*filter : smooth = 0 — permis : float 0\.01\.\.1/)
    await assert.rejects(compiler('<img *filter(grayscale, spot: 100, smooth: 2) src="a.png" alt="a">'), /\*filter : smooth = 2 — permis : float 0\.01\.\.1/)
    await compiler('<img *filter(grayscale, spot: 240) src="a.png" alt="a">')
    await compiler('<img *filter(blur: 8, spot: 200, soft: 80) src="a.png" alt="a">')
    await compiler('<img *filter(duotone, spot: 2000, soft: 0, smooth: 0.01) src="a.png" alt="a">')
  })
})
