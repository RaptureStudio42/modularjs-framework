// *spotlight(where: veil) — la lampe torche : un voile de la couleur choisie posé sur tout le contenu et
// percé d'un trou de lumière qui suit la souris. Le calque et sa feuille, le survol et le toujours-allumé,
// le lissage du suivi (une boucle qui s'arrête d'elle-même), les réglages lus, une variable suivie sur
// place, un composant, `<@document>`, les refus de compilation, le retrait sans reste — et le halo et le
// liseré (sans voile) : des pseudo-éléments, aucun nœud dans la balise ; le halo suit la souris par les images
// clés d'une animation du pseudo-élément (un faux ici : happy-dom n'a pas l'animation Web), le liseré par ses
// deux variables d'avant.

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

const COMPOSANTS: Record<string, string> = {
  'fx-spot-voile':        '<div class="a" *spotlight(where: veil, on: always)>x</div>',
  'fx-spot-survol':       '<div class="a" *spotlight(where: veil)>x</div>',
  'fx-spot-regles':       '<div class="a" *spotlight(where: veil, color: #123456, fill: 0.5, size: 100, soft: 30, radius: 12, on: always)>x</div>',
  'fx-spot-lent':         '<div class="a" *spotlight(where: veil, smooth: 0.5)>x</div>',
  'fx-spot-halo':         '<div class="a" *spotlight>x</div>',
  'fx-spot-halo-lent':    '<div class="a" *spotlight(smooth: 0.5)>x</div>',
  'fx-spot-halo-toujours': '<div class="a" *spotlight(on: always)>x</div>',
  'fx-spot-variable':     '<script>\n$lent = 0.5\n$bord = 120\n</script>\n<div class="a" *spotlight(where: veil, smooth: $lent, soft: $bord)>x</div>\n<button class="t" @click={$lent = 1}>t</button>\n<button class="u" @click={$bord = 40}>u</button>',
  'fx-spot-mode':         '<script>\n$mode = \'veil\'\n</script>\n<div class="a" *spotlight(where: $mode)>x</div>\n<button class="t" @click={$mode = \'both\'}>t</button>',
  'fx-spot-retrait':      '<script>\n$on = true\n</script>\n{if $on}<div class="a" *spotlight(where: veil, smooth: 0.5)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-spot-boite':        '<div class="b">dedans</div>',
  'fx-spot-hote':         '<@fx-spot-boite class="h" *spotlight(where: veil, on: always)></@fx-spot-boite>',
  'fx-spot-page':         '<@document *spotlight(where: veil, on: always)></@document>\n<p class="p">page</p>'
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *spotlight(where: veil)', function () {
  this.timeout(90000)
  let window: any
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('effets-spot-voile')
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
    // happy-dom n'a pas l'animation Web des pseudo-éléments : un faux qui garde les images clés du halo ; le prototype des éléments est partagé par
    // toutes les fenêtres du processus, le faux est rendu à la fin du groupe (sinon un test d'un autre fichier appelle le faux au lieu de sa balise)
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function (this: any, frames: any, opts: any) {
      const a: any = { frames, opts, paused: false, cancelled: false, effect: { setKeyframes(f: any) { a.frames = f } }, finish() { a.finished = true }, cancel() { a.cancelled = true } }
      ;(this.__animations ||= []).push(a)
      return a
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
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

  const calque = (el: any) => el.querySelector('[mjs-fx-layer="spotlight"]')
  // la boîte de la balise : 300 × 200 à (100, 50), et sa taille de mise en page (happy-dom n'en a pas : l'échelle serait infinie)
  const taille = (el: any) => {
    Object.defineProperty(el, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true })
  }
  // l'intérieur de la balise (le cadre du halo) : 300 × 200 aussi
  const interieur = (el: any) => {
    Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true })
  }
  const boite  = (el: any) => {
    taille(el)
    mesurer(window, el, () => ({ left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200, x: 100, y: 50 }))
  }
  const geste  = (el: any, type: string, x: number, y: number) => el.dispatchEvent(new window.PointerEvent(type, { clientX: x, clientY: y }))
  // la lumière d'un calque : le `translate` de son disque, le décalage de son centre (la balise de happy-dom n'a pas de taille : le centre est à 0)
  const pos    = (n: any) => (n.firstChild.style.getPropertyValue('translate') || '').split(' ')
  const posX   = (n: any) => pos(n)[0] ?? ''
  const posY   = (n: any) => pos(n)[1] ?? ''
  // le halo d'une balise : l'animation de son pseudo-élément (le faux ci-dessus), sa place (le `translate` de ses images clés) et son rognage
  const halo   = (el: any) => (el.__animations ?? [])[0]
  const haloAt = (el: any) => (halo(el)?.frames[0].translate ?? '').split(' ')
  const haloX  = (el: any) => haloAt(el)[0] ?? ''
  const haloY  = (el: any) => haloAt(el)[1] ?? ''

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
      // une image de 1/60 s : joue les rappels en attente
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

  it('where: veil : un calque après le contenu, qui ne capte rien, sans halo ni liseré ; allumé d\'office avec on: always', async () => {
    const comp  = await monter('mjs-fx-spot-voile')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    assert.ok(layer, 'le calque du voile')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.ok(el.lastElementChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(layer.getAttribute('mjs-fx-lamp'), 'veil', 'le calque du voile')
    assert.equal(layer.children.length, 1, 'un seul disque dans le calque')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '', 'on: always : allumé sans survol')
    assert.equal(el.getAttribute('mjs-fx-spot-on'), null, 'le halo n\'est pas allumé')
    assert.equal(layer.hasAttribute('mjs-fx-veil-doc'), false, 'sur une balise, le calque n\'est pas fixe')
  })

  it('la feuille : le voile par défaut (#0a0a0f, 0.97, disque de 160 px, bord de 120 px), percé par un masque radial', async () => {
    await monter('mjs-fx-spot-voile')
    const css = window.µ._mjs_fxDefs.spotlight.css
    assert.match(css, /\[mjs-fx-layer="spotlight"\]\{[^}]*pointer-events:none/)
    assert.match(css, /--mjs-fx-veil-c:var\(--mjs-spotlight-color\)/, 'la couleur écrite sur la balise, ou posée par un thème')
    assert.match(css, /var\(--mjs-fx-veil-c,#0a0a0f\) calc\(var\(--mjs-fx-veil-f,\.97\) \* 100%\)/)
    assert.match(css, /radial-gradient\(circle closest-side,transparent calc\(var\(--mjs-fx-veil-d,160px\) \/ 2\),color-mix\(in srgb,var\(--mjs-fx-veil-c,#0a0a0f\) calc\(var\(--mjs-fx-veil-f,\.97\) \* 100%\),transparent\) 100%\)/, 'le trou : net sur le diamètre, puis le voile revient sur le bord')
    assert.match(css, /box-shadow:0 0 0 var\(--mjs-fx-veil-r,1000px\) color-mix\(in srgb,var\(--mjs-fx-veil-c,#0a0a0f\)/, 'l\'ombre portée fait le voile autour du disque, sur l\'étendue que le script écrit (jamais 100000 px)')
    assert.doesNotMatch(css, /100000px/, 'l\'ombre n\'est plus démesurée')
    assert.doesNotMatch(css, /mask-image:radial-gradient\(circle at var/, 'plus de masque dont le centre suit la souris')
    assert.doesNotMatch(css, /var\(--mjs-fx-veil-[xy]/, 'le voile n\'a plus de variable de position')
    assert.match(css, /::before\{[^}]*radial-gradient\(circle var\(--mjs-spotlight-size,200px\) at var\(--mjs-fx-spot-x,50%\) var\(--mjs-fx-spot-y,50%\)/, 'le liseré lit les variables d\'avant')
    assert.match(css, /::after\{[^}]*width:0;height:0[^}]*border-image:radial-gradient\(circle closest-side/, 'le halo : un point dont la lumière est une image de bordure')
    const promus = css.match(/[^{}+]*\{[^}]*will-change[^}]*\}/g) ?? []
    assert.ok(promus.length >= 2 && promus.every((r: string) => /\[mjs-fx-live\]/.test(r)), 'rien n\'est promu hors survol : chaque will-change est sous [mjs-fx-live]')
    assert.match(css, /\[mjs-fx-layer="spotlight"\]\[mjs-fx-veil-doc\]\{position:fixed\}/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\[mjs-fx-layer="spotlight"\]\[mjs-fx-veil-on\]\{transition:none\}/)
  })

  it('les réglages : color, fill, size et soft arrivent en variables CSS sur la balise, radius arrondit la balise', async () => {
    const comp = await monter('mjs-fx-spot-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-spotlight-color'), '#123456')
    assert.equal(el.style.getPropertyValue('--mjs-spotlight-fill'), '0.5')
    assert.equal(el.style.getPropertyValue('--mjs-spotlight-size'), '100px')
    assert.equal(el.style.getPropertyValue('--mjs-spotlight-soft'), '30px')
    assert.equal(el.style.borderRadius, '12px')
    assert.ok(calque(el), 'le calque')
  })

  it('on: hover (défaut) : le calque naît à l\'entrée et le voile s\'allume, le trou naît sous la souris ; la sortie l\'éteint, puis le calque part ; promu seulement pendant le survol', async () => {
    const comp = await monter('mjs-fx-spot-survol')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    assertAbsent(calque(el), 'aucun calque au repos')
    assert.equal(el.children.length, 0, 'la balise n\'a pas d\'enfant de plus')
    geste(el, 'pointerenter', 150, 90)
    const layer = calque(el)
    assert.ok(layer, 'le calque naît à l\'entrée de la souris')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '')
    assert.equal(posX(layer), '50.0px', 'x = 150 - 100 : sous la souris, sans glissade')
    assert.equal(posY(layer), '40.0px')
    assert.equal(layer.getAttribute('mjs-fx-live'), '', 'promu : la feuille promeut le disque')
    geste(el, 'pointermove', 250, 150)
    assert.equal(posX(layer), '150.0px', 'smooth: 1 : collé à la souris')
    assert.equal(posY(layer), '100.0px')
    geste(el, 'pointerleave', 600, 150)
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), null)
    assert.equal(layer.getAttribute('mjs-fx-live'), null, 'plus de promotion hors survol')
    assert.ok(calque(el) === layer, 'il reste le temps de son effacement')
    // une nouvelle entrée pendant l'effacement reprend le même calque
    geste(el, 'pointerenter', 200, 100)
    assert.ok(calque(el) === layer, 'le même calque')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '')
    geste(el, 'pointerleave', 600, 150)
    await attendre(() => !calque(el), 2000)
    assertAbsent(calque(el), 'le calque est parti après son effacement')
    assert.equal(el.children.length, 0)
    geste(el, 'pointerenter', 150, 90)
    assert.ok(calque(el), 'et une nouvelle visite le refait')
    geste(el, 'pointerleave', 600, 150)
  })

  it('une souris déjà dans la balise (aucune entrée vue) : le premier mouvement allume le voile', async () => {
    const comp = await monter('mjs-fx-spot-survol')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    geste(el, 'pointermove', 200, 100)
    const layer = calque(el)
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '')
    assert.equal(posX(layer), '100.0px')
  })

  it('on: always : le trou est au centre (aucune variable) tant que la souris n\'est pas venue, et y revient à la sortie', async () => {
    const comp  = await monter('mjs-fx-spot-voile')
    const el    = comp._shadow.querySelector('.a')
    const layer = calque(el)
    boite(el)
    assert.equal(posX(layer), '', 'au centre : la feuille met 50 %')
    assert.equal(posY(layer), '')
    geste(el, 'pointerenter', 180, 120)
    assert.equal(posX(layer), '80.0px')
    geste(el, 'pointerleave', 600, 120)
    assert.equal(posX(layer), '', 'retiré : le trou revient au centre')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '', 'toujours allumé')
  })

  it('smooth: 0.5 : la lumière rattrape la souris image après image, puis la boucle s\'arrête d\'elle-même', async () => {
    const comp = await monter('mjs-fx-spot-lent')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      const layer = calque(el)
      assert.equal(posX(layer), '50.0px', 'à l\'entrée, elle naît sous la souris')
      assert.equal(bc.demandes(), 0, 'rien ne tourne tant que la souris ne bouge pas')
      geste(el, 'pointermove', 350, 90)
      assert.equal(posX(layer), '50.0px', 'rien n\'est écrit avant l\'image')
      assert.equal(bc.demandes(), 1, 'une seule boucle')
      geste(el, 'pointermove', 350, 90)
      assert.equal(bc.demandes(), 1, 'un autre mouvement n\'en demande pas une seconde')
      const vus: number[] = []
      for (let i = 0; i < 80 && bc.demandes() > 0; i++) {
        bc.image()
        vus.push(parseFloat(posX(layer)))
      }
      assert.ok(vus.length > 4 && vus.length < 40, `converge en ${vus.length} images`)
      assert.ok(vus.every((v, i) => i === 0 || v >= vus[i - 1]), 'de plus en plus près')
      assert.ok(vus[0] > 50 && vus[0] < 250, 'la première image n\'est pas au bout')
      assert.equal(posX(layer), '250.0px', 'elle finit exactement sur la souris')
      // par image, un `translate` sur le disque et rien d'autre : ni le calque, ni la balise ne portent la moindre écriture
      const noms = (layer.firstChild.getAttribute('style') ?? '').split(';').map((d: string) => d.split(':')[0].trim()).filter(Boolean).sort()
      assert.deepEqual(noms, ['translate'], 'une seule écriture sur le disque')
      assert.equal((layer.getAttribute('style') ?? '').split(';').map((d: string) => d.split(':')[0].trim()).filter(Boolean).join(), '--mjs-fx-veil-r', 'le calque est immobile : sa seule écriture est l\'étendue de l\'ombre, posée une fois')
      assert.equal(el.getAttribute('style'), null, 'la balise non plus')
      assert.equal(bc.demandes(), 0, 'la boucle s\'est arrêtée : plus aucune image demandée')
      geste(el, 'pointermove', 150, 90)
      assert.equal(bc.demandes(), 1, 'un mouvement la relance')
      geste(el, 'pointerleave', 600, 90)
      assert.equal(bc.demandes(), 0, 'la sortie l\'arrête')
    }
    finally {
      bc.rendre()
    }
  })

  it('smooth: 1 (défaut) : aucune image demandée, jamais', async () => {
    const comp = await monter('mjs-fx-spot-survol')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      for (let i = 0; i < 5; i++) geste(el, 'pointermove', 160 + i * 20, 90)
      assert.equal(bc.demandes(), 0)
      assert.equal(posX(calque(el)), '140.0px')
    }
    finally {
      bc.rendre()
    }
  })

  it('« réduire les animations » : le lissage est ignoré, la lumière colle à la souris', async () => {
    const vrai = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    const bc = boucle()
    try {
      const comp = await monter('mjs-fx-spot-lent')
      const el   = comp._shadow.querySelector('.a')
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      geste(el, 'pointermove', 350, 90)
      assert.equal(posX(calque(el)), '250.0px')
      assert.equal(bc.demandes(), 0)
    }
    finally {
      bc.rendre()
      window.matchMedia = vrai
    }
  })

  it('la boîte n\'est lue qu\'à l\'entrée : pas une fois par mouvement ; un défilement la fait relire', async () => {
    const comp = await monter('mjs-fx-spot-survol')
    const el   = comp._shadow.querySelector('.a')
    let lues   = 0
    taille(el)
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
  })

  it('le halo et le liseré (sans veil) : aucun nœud dans la balise ; le halo suit la souris par les images clés de son pseudo-élément, le liseré par ses deux variables', async () => {
    const comp = await monter('mjs-fx-spot-halo')
    const el   = comp._shadow.querySelector('.a')
    boite(el)
    interieur(el)
    assertAbsent(calque(el), 'aucun calque')
    assert.equal(el.children.length, 0, 'la balise n\'a pas d\'enfant de plus')
    assert.equal(el.getAttribute('mjs-fx-spot-on'), null, 'éteint au repos')
    assert.equal(el.getAttribute('mjs-fx-live'), null, 'pas promu au repos')
    assert.equal(halo(el), undefined, 'aucune animation au repos')
    geste(el, 'pointerenter', 150, 90)
    assert.equal(el.children.length, 0, 'toujours aucun enfant')
    assert.equal(el.getAttribute('mjs-fx-spot-on'), '', 'allumé')
    assert.equal(el.getAttribute('mjs-fx-live'), '', 'promu le temps du survol')
    assert.equal(el.getAttribute('mjs-fx-spot-where'), null, 'both : aucune marque de mode')
    assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '50.0px', 'le liseré : la variable d\'avant')
    assert.equal(el.style.getPropertyValue('--mjs-fx-spot-y'), '40.0px')
    const a = halo(el)
    assert.equal(a.opts.pseudoElement, '::after', 'le halo est le pseudo-élément ::after')
    assert.equal(a.finished, true, 'une animation terminée : seules ses images clés bougent, rien n\'est promu au repos')
    assert.equal(haloX(el), '50.0px')
    assert.equal(haloY(el), '40.0px')
    assert.equal(a.frames[0].clipPath, 'inset(-40.0px -250.0px -160.0px -50.0px)', 'la balise de 300 × 200, vue depuis le point du halo, sans arrondi')
    assert.equal(a.frames[1].clipPath, a.frames[0].clipPath, 'deux images clés semblables : la place est celle-là')
    // deux mouvements dans la même image : dans le gestionnaire, les images clés du halo ne changent pas (Firefox perdrait le fondu d'allumage), le liseré est écrit tout de suite ;
    // l'image qui suit écrit la dernière position, et elle seule
    geste(el, 'pointermove', 200, 120)
    geste(el, 'pointermove', 250, 150)
    assert.ok(halo(el) === a, 'la même animation : ses images clés changent')
    assert.equal(haloX(el), '50.0px', 'dans le gestionnaire du mouvement, les images clés ne changent pas')
    assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '150.0px', 'le liseré est écrit tout de suite')
    await attendre(() => haloX(el) === '150.0px')
    assert.equal(haloX(el), '150.0px', 'à l\'image qui suit : la dernière position')
    assert.equal(haloY(el), '100.0px')
    geste(el, 'pointerleave', 600, 150)
    assert.equal(el.getAttribute('mjs-fx-spot-on'), null, 'éteint')
    assert.equal(el.getAttribute('mjs-fx-live'), '', 'encore promu pendant le fondu : le halo s\'éteint à sa place')
    assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '150.0px')
    assert.equal(haloX(el), '150.0px')
    await attendre(() => el.getAttribute('mjs-fx-live') === null, 2000)
    assert.equal(el.getAttribute('mjs-fx-live'), null, 'puis plus promu')
    assert.equal(a.cancelled, true, 'et le halo d\'avant revient : l\'animation est défaite')
    assert.equal(el.children.length, 0)
  })

  it('where: fill ne pose que le halo, where: border que le liseré ; le halo toujours allumé (on: always) est là dès la pose : au centre sans souris, de nouveau au centre à la sortie', async () => {
    const def  = window.µ._mjs_fxDefs.spotlight
    const comp = await monter('mjs-fx-spot-halo')
    try {
      for (const [where, marque, anime] of [['fill', 'fill', true], ['border', 'border', false], ['both', null, true]] as const) {
        const n = window.document.createElement('div')
        comp._shadow.appendChild(n)
        boite(n)
        interieur(n)
        const off = def.setup(n, { where, on: 'always' })
        assert.equal(n.getAttribute('mjs-fx-spot-where'), marque, where + ' : la marque du mode d\'avant')
        assert.equal(n.getAttribute('mjs-fx-spot-on'), '', where + ' : allumé d\'office')
        assert.equal(n.children.length, 0, where + ' : aucun nœud posé')
        assert.equal(halo(n), undefined, where + ' : au repos, aucune animation : le halo est celui d\'avant, en CSS')
        geste(n, 'pointerenter', 180, 120)
        assert.equal(!!halo(n), anime, where + ' : au survol, le halo n\'est animé que s\'il est demandé')
        if (anime) assert.equal(haloX(n), '80.0px', where + ' : sous la souris')
        geste(n, 'pointerleave', 600, 120)
        off()
        assert.equal(n.getAttribute('mjs-fx-spot-on'), null, where + ' : le retrait éteint')
        assert.equal(n.getAttribute('mjs-fx-spot-where'), null)
        if (anime) assert.equal(halo(n).cancelled, true, where + ' : le retrait défait l\'animation')
        n.remove()
      }
      const comp2 = await monter('mjs-fx-spot-halo-toujours')
      const el    = comp2._shadow.querySelector('.a')
      boite(el)
      interieur(el)
      assert.equal(el.getAttribute('mjs-fx-spot-on'), '', 'allumé d\'office')
      assert.equal(el.children.length, 0, 'aucun nœud dans la balise')
      geste(el, 'pointerenter', 180, 120)
      assert.equal(haloX(el), '80.0px')
      assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '80.0px')
      const a2 = halo(el)
      assert.equal(a2.cancelled, false)
      geste(el, 'pointerleave', 600, 120)
      assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '', 'le liseré perd sa position : la feuille le met au centre')
      assert.equal(el.getAttribute('mjs-fx-spot-on'), '', 'toujours allumé')
      assert.equal(el.getAttribute('mjs-fx-live'), null, 'plus promu')
      assert.equal(a2.cancelled, true, 'le halo d\'avant revient au centre : l\'animation est défaite')
    }
    finally {
    }
  })

  it('une balise sans taille intérieure (en ligne : un lien, un composant) garde le halo d\'avant : aucune animation de pseudo-élément, aucune promotion, deux variables placent la lumière', async () => {
    const def  = window.µ._mjs_fxDefs.spotlight
    const comp = await monter('mjs-fx-spot-halo')
    for (const [where, always] of [['fill', false], ['both', false], ['fill', true]] as const) {
      const n = window.document.createElement('a')
      comp._shadow.appendChild(n)
      // une taille de mise en page, mais aucune taille intérieure : happy-dom donne 0 à clientWidth et clientHeight, comme une balise en ligne
      boite(n)
      const off = def.setup(n, { where, on: always ? 'always' : 'hover', smooth: 1 })
      try {
        geste(n, 'pointerenter', 150, 90)
        assert.equal(halo(n), undefined, where + ' : aucune animation de pseudo-élément')
        assert.equal(n.getAttribute('mjs-fx-live'), null, where + ' : rien n\'est promu')
        assert.equal(n.getAttribute('mjs-fx-spot-on'), '', where + ' : allumé')
        assert.equal(n.style.getPropertyValue('--mjs-fx-spot-x'), '50.0px', where + ' : la lumière est sous la souris, dans le repère de la balise')
        assert.equal(n.style.getPropertyValue('--mjs-fx-spot-y'), '40.0px')
        geste(n, 'pointermove', 250, 150)
        assert.equal(n.style.getPropertyValue('--mjs-fx-spot-x'), '150.0px', where + ' : et la suit')
        assert.equal(n.style.getPropertyValue('--mjs-fx-spot-y'), '100.0px')
        geste(n, 'pointerleave', 600, 150)
        if (always) {
          assert.equal(n.style.getPropertyValue('--mjs-fx-spot-x'), '', 'toujours allumé : la lumière revient au centre, la feuille y met le halo')
          assert.equal(n.getAttribute('mjs-fx-spot-on'), '')
        }
        else assert.equal(n.getAttribute('mjs-fx-spot-on'), null, where + ' : éteint à la sortie')
        assert.equal(halo(n), undefined, where + ' : toujours aucune animation')
      }
      finally {
        off()
        n.remove()
      }
    }
  })

  it('la balise cachée puis montrée de nouveau (display: none) perd l\'animation de son pseudo-élément, sans un événement : son changement de taille la repose là où la souris l\'a laissée', async () => {
    const def     = window.µ._mjs_fxDefs.spotlight
    const comp    = await monter('mjs-fx-spot-halo')
    const vrai    = window.ResizeObserver
    const guets: any[] = []
    window.ResizeObserver = class {
      f: any
      vivant = true
      constructor(f: any) { this.f = f; guets.push(this) }
      observe() {}
      disconnect() { this.vivant = false }
    }
    const n = window.document.createElement('div')
    comp._shadow.appendChild(n)
    boite(n)
    interieur(n)
    const off = def.setup(n, { where: 'fill', on: 'hover', smooth: 1 })
    try {
      assert.equal(guets.length, 0, 'au repos, aucun observateur')
      geste(n, 'pointerenter', 150, 90)
      assert.equal(guets.length, 1, 'pendant le survol, un observateur de la taille de la balise')
      const [g] = guets
      const a = n.__animations[0]
      g.f([])
      assert.equal(a.cancelled, false, 'la première annonce dit seulement que l\'observateur est posé')
      // cachée : la taille tombe à zéro, l\'animation perdue est défaite, rien n\'est posé sur une balise sans boîte
      Object.defineProperty(n, 'clientWidth', { value: 0, configurable: true })
      Object.defineProperty(n, 'clientHeight', { value: 0, configurable: true })
      g.f([])
      assert.equal(a.cancelled, true, 'cachée : l\'animation perdue est défaite')
      assert.equal(n.__animations.length, 1, 'et aucune n\'est posée tant que la balise n\'a pas de boîte')
      // montrée : une neuve, là où la lumière était
      interieur(n)
      g.f([])
      assert.equal(n.__animations.length, 2, 'montrée : une animation neuve')
      assert.equal(n.__animations[1].frames[0].translate, '50.0px 40.0px', 'à la place où la souris l\'avait laissée')
      assert.equal(n.__animations[1].cancelled, false)
      // la souris sort : l\'observateur part avec le halo, et un changement de taille ne ranime rien
      geste(n, 'pointerleave', 600, 150)
      g.f([])
      assert.equal(n.__animations.length, 2, 'la souris partie, la taille ne repose rien')
      await attendre(() => !g.vivant, 2000)
      assert.equal(g.vivant, false, 'l\'observateur est déconnecté une fois le halo effacé')
      geste(n, 'pointerenter', 150, 90)
      assert.equal(guets.length, 2, 'à l\'entrée suivante, un observateur neuf')
      off()
      assert.equal(guets[1].vivant, false, 'le retrait de l\'effet pendant le survol le déconnecte aussi')
    }
    finally {
      off()
      window.ResizeObserver = vrai
      n.remove()
    }
  })

  it('smooth vaut aussi pour le halo : il rattrape la souris et la boucle s\'arrête', async () => {
    const comp = await monter('mjs-fx-spot-halo-lent')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      interieur(el)
      geste(el, 'pointerenter', 150, 90)
      geste(el, 'pointermove', 350, 90)
      assert.equal(haloX(el), '50.0px')
      for (let i = 0; i < 80 && bc.demandes() > 0; i++) bc.image()
      assert.equal(haloX(el), '250.0px')
      assert.equal(el.style.getPropertyValue('--mjs-fx-spot-x'), '250.0px', 'le liseré l\'a rejoint aussi')
      assert.equal(bc.demandes(), 0)
    }
    finally {
      bc.rendre()
    }
  })

  it('un retard tenu par une variable est suivi sur place (le calque reste), `where` relance l\'effet', async () => {
    const comp = await monter('mjs-fx-spot-variable')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      const layer = calque(el)
      geste(el, 'pointermove', 350, 90)
      assert.equal(posX(layer), '50.0px', 'smooth: 0.5 : en route')
      comp._shadow.querySelector('.t').click()
      await pause(40)
      assert.ok(calque(el) === layer, 'le même calque : rien n\'a été reposé')
      geste(el, 'pointermove', 300, 90)
      assert.equal(posX(layer), '200.0px', 'smooth: 1 : collé à la souris')
      assert.equal(el.style.getPropertyValue('--mjs-spotlight-soft'), '120px')
      comp._shadow.querySelector('.u').click()
      await pause(40)
      assert.equal(el.style.getPropertyValue('--mjs-spotlight-soft'), '40px', 'le bord suit sa variable : la feuille le relit')
      assert.ok(calque(el) === layer, 'toujours le même calque')
    }
    finally {
      bc.rendre()
    }
    const comp2 = await monter('mjs-fx-spot-mode')
    const el2   = comp2._shadow.querySelector('.a')
    boite(el2)
    geste(el2, 'pointerenter', 150, 90)
    assert.ok(calque(el2), 'where: veil : le calque naît à l\'entrée')
    comp2._shadow.querySelector('.t').click()
    await attendre(() => !calque(el2))
    assertAbsent(calque(el2), 'where: both : plus de voile')
    assert.equal(el2.getAttribute('mjs-fx-spot-where'), null)
    boite(el2)
    interieur(el2)
    geste(el2, 'pointerenter', 150, 90)
    assert.equal(el2.children.length, 0, 'le halo et le liseré ne posent aucun nœud')
    assert.equal(haloX(el2), '50.0px', 'le halo a pris le relais')
  })

  it('le halo d\'avant relit la boîte à chaque mouvement, avec ou sans retard (une carte qui bouge au survol) ; jamais dans la boucle d\'images', async () => {
    for (const tag of ['mjs-fx-spot-halo', 'mjs-fx-spot-halo-lent']) {
      const comp = await monter(tag)
      const el   = comp._shadow.querySelector('.a')
      const bc   = boucle()
      let lues   = 0
      taille(el)
      mesurer(window, el, () => {
        lues++
        return { left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200, x: 100, y: 50 }
      })
      try {
        geste(el, 'pointerenter', 150, 90)
        for (let i = 0; i < 30; i++) geste(el, 'pointermove', 150 + i, 90)
        assert.equal(lues, 31, tag + ' : une lecture à l\'entrée et une par mouvement, comme avant')
        const avant = lues
        for (let i = 0; i < 20 && bc.demandes() > 0; i++) bc.image()
        assert.equal(lues, avant, tag + ' : aucune lecture dans la boucle d\'images')
        window.document.dispatchEvent(new window.Event('scroll'))
        geste(el, 'pointermove', 200, 90)
        assert.equal(lues, avant + 1, tag + ' : un seul passage de plus')
        geste(el, 'pointerleave', 600, 90)
      }
      finally {
        bc.rendre()
      }
    }
  })

  it('smooth hors bornes (0, négatif, trop grand, illisible) : ramené entre 0,01 et 1 à la pose et dans le suivi sur place ; la lumière avance, la boucle finit', async () => {
    const comp = await monter('mjs-fx-spot-survol')
    const def  = window.µ._mjs_fxDefs.spotlight
    const bc   = boucle()
    try {
      for (const via of ['pose', 'suivi']) {
        for (const vu of [0, -1, -50, 3, 'x']) {
          const n = window.document.createElement('div')
          comp._shadow.appendChild(n)
          boite(n)
          const off = def.setup(n, { where: 'veil', smooth: via === 'pose' ? vu : 0.5 })
          if (via === 'suivi') off.set('smooth', vu)
          geste(n, 'pointerenter', 150, 90)
          const layer = calque(n)
          geste(n, 'pointermove', 350, 90)
          const lent  = typeof vu === 'number' && vu < 1
          assert.equal(bc.demandes(), lent ? 1 : 0, `${via} ${vu} : ${lent ? 'une boucle' : 'collé à la souris, aucune boucle'}`)
          let dernier = parseFloat(posX(layer))
          let images  = 0
          for (; images < 4000 && bc.demandes() > 0; images++) {
            bc.image()
            const x = parseFloat(posX(layer))
            assert.ok(x >= dernier && x <= 250, `${via} ${vu} : la lumière avance vers la souris (${dernier} puis ${x})`)
            dernier = x
          }
          assert.ok(bc.demandes() === 0, `${via} ${vu} : la boucle finit (${images} images)`)
          assert.equal(posX(layer), '250.0px', `${via} ${vu} : et la lumière est sur la souris`)
          off()
          n.remove()
        }
      }
    }
    finally {
      bc.rendre()
    }
  })

  it('sur un composant : le calque est dans son shadow root, qui adopte la feuille', async () => {
    const comp = await monter('mjs-fx-spot-hote', '.h')
    const hote = comp._shadow.querySelector('.h')
    await attendre(() => !!hote._shadow?.querySelector('.b'))
    const layer = hote._shadow.querySelector('[mjs-fx-layer="spotlight"]')
    assert.ok(layer, 'le calque dans le shadow du composant')
    assertAbsent(hote.querySelector('[mjs-fx-layer="spotlight"]'), 'calque dans le DOM clair du composant')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '')
    assert.ok(window.µ._mjs_fxInner(hote).adoptedStyleSheets.length > 0, 'la feuille est adoptée par le composant')
  })

  it('le retrait ({if} refermé) enlève calque, marques, variables, écouteurs et la boucle en route', async () => {
    const comp = await monter('mjs-fx-spot-retrait')
    const el   = comp._shadow.querySelector('.a')
    const bc   = boucle()
    try {
      boite(el)
      geste(el, 'pointerenter', 150, 90)
      geste(el, 'pointermove', 350, 90)
      assert.equal(bc.demandes(), 1, 'une image attend')
      assert.ok(calque(el))
      comp._shadow.querySelector('.t').click()
      await attendre(() => !comp._shadow.querySelector('.a'))
      await pause(50)
      assert.equal(bc.demandes(), 0, 'le retrait annule l\'image demandée')
      assertAbsent(calque(el), 'calque resté')
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
      assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
      geste(el, 'pointermove', 300, 90)
      assert.equal(bc.demandes(), 0, 'plus aucun écouteur')
    }
    finally {
      bc.rendre()
    }
  })

  it('sur <@document> : un calque fixe dans la page, le trou suit la souris dans la fenêtre, tout part avec le composant', async () => {
    const doc = window.document
    doc.body.innerHTML = '<mjs-fx-spot-page></mjs-fx-spot-page>'
    const comp = doc.querySelector('mjs-fx-spot-page')
    await attendre(() => !!comp._shadow?.querySelector('.p') && !!doc.querySelector('[mjs-fx-layer="spotlight"]'))
    const layer = doc.querySelector('[mjs-fx-layer="spotlight"]')
    assert.ok(layer, 'le calque dans la page')
    assert.ok(layer.parentNode === doc.body)
    assert.equal(layer.getAttribute('mjs-fx-veil-doc'), '', 'position fixe')
    assert.equal(layer.getAttribute('mjs-fx-veil-on'), '')
    assert.equal(layer.getAttribute('mjs-fx-lamp'), 'veil')
    assert.ok(window.µ._mjs_fxDefs.spotlight && doc.adoptedStyleSheets.length > 0, 'la feuille est adoptée par le document')
    doc.documentElement.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 30, clientY: 40 }))
    assert.equal(posX(layer), '30.0px', 'dans la fenêtre : aucune boîte à lire')
    assert.equal(posY(layer), '40.0px')
    doc.documentElement.dispatchEvent(new window.PointerEvent('pointerleave', { clientX: -1, clientY: 40 }))
    assert.equal(posX(layer), '', 'revenu au centre de la fenêtre')
    doc.body.innerHTML = ''
    await attendre(() => !doc.documentElement.hasAttribute('mjs-fx'))
    assert.equal(doc.documentElement.getAttribute('mjs-fx'), null)
    assertAbsent(doc.querySelector('[mjs-fx-layer="spotlight"]'), 'le calque est retiré')
  })

  it('les refus de compilation disent quoi écrire ; <@document> accepte *spotlight', async () => {
    await assert.rejects(compiler('<div *spotlight(where: nuit)>x</div>'), /\*spotlight : where = nuit/)
    await assert.rejects(compiler('<div *spotlight(soft: 2000)>x</div>'), /\*spotlight : soft = 2000 — permis : int 0\.\.1000/)
    await assert.rejects(compiler('<div *spotlight(smooth: 2)>x</div>'), /\*spotlight : smooth = 2 — permis : float 0\.01\.\.1/)
    await assert.rejects(compiler('<div *spotlight(smooth: 0)>x</div>'), /\*spotlight : smooth = 0 — permis : float 0\.01\.\.1/)
    await assert.rejects(compiler('<img *spotlight(where: veil) src="a.png" alt="a">'), /\*spotlight[\s\S]*dessine à l'intérieur/)
    await compiler('<div *spotlight(where: veil, soft: 0, smooth: 0.01, size: 10, fill: 1)>x</div>')
    await compiler('<div *spotlight(where: veil, soft: 1000, smooth: 1, size: 1000, fill: 0)>x</div>')
    await compiler('<@document *spotlight(where: veil, on: always, smooth: 0.15)></@document>\n<p>x</p>')
  })

  it('sur <@document>, seul where: veil est accepté : le halo et le liseré gardent l\'erreur de compilation d\'avant', async () => {
    const root   = mjsTmp('effets-spot-voile-document')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const refuses = [
      '<@document *spotlight(color: #ff0, fill: 0.4, size: 150)></@document>',
      '<@document *spotlight></@document>',
      '<@document *spotlight(where: both)></@document>',
      '<@document *spotlight(where: fill)></@document>',
      '<@document *spotlight(where: border)></@document>'
    ]
    refuses.forEach((src, i) => writeFileSync(join(srcDir, `fx-doc-refus-${i}.mjs`), src + '\n<p>x</p>'))
    writeFileSync(join(srcDir, 'fx-doc-voile.mjs'), '<@document *spotlight(where: veil)></@document>\n<p>x</p>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    const msgs = stats.errors.map((e: any) => e.message as string)
    const refus = /\*spotlight ne se pose pas sur <@document> : seuls les effets de toute la page y vont \([^)]*\)\. Posez \*spotlight sur une balise HTML ou un composant\./
    assert.equal(msgs.filter((m) => refus.test(m)).length, refuses.length, 'chaque halo et chaque liseré est refusé, avec le texte d\'avant : ' + msgs.join(' | '))
    assert.equal(msgs.length, refuses.length, 'le voile (where: veil) passe, et il n\'y a pas d\'autre erreur')
    // le message n'annonce pas *spotlight parmi les effets qui vont sur la page, puisque ce mode-là n'y va pas
    assert.ok(msgs.every((m) => !/\*spotlight[,)]/.test(m.replace('*spotlight ne se pose pas', '').replace('Posez *spotlight sur', ''))), 'la liste ne cite pas *spotlight')
  })
})
