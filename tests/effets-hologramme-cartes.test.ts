// *hologram, les styles de carte — les finitions d'une carte à collectionner : rien dans la page au
// repos, le calque (l'éclat, puis le reflet) naît au survol, un ressort mène le reflet et l'inclinaison,
// tout repart quand la souris s'en va ; la fenêtre, les motifs, l'agrandissement au clic, la
// démonstration, « réduire les animations », le retrait sans reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mesurer } from './helpers/mesure-balise.js'

const STYLES = ['sheen', 'frame', 'curtain', 'night-sky', 'frost', 'lattice', 'opal', 'streaks', 'rays', 'rays-window', 'rays-cloud', 'rays-fade', 'rays-wide', 'haze', 'haze-deep', 'dust-dark', 'dust', 'glint', 'glint-dark', 'bloom']

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')

// des fenêtres d'illustration, écrites en CSS comme le ferait un site : un rectangle, un coin coupé
const RECTANGLE = 'inset(9.85% 8% 52.85% 8%)'
const COIN_COUPE = 'polygon(91.5% 9.85%, 57% 9.85%, 54% 12%, 17% 12%, 16% 14%, 12% 16%, 8% 16%, 8% 47.15%, 92% 47.15%)'
const BAS = 'inset(14.5% 8.5% 48.2% 8.5%)'

const COMPOSANTS: Record<string, string> = {
  'hc-simple':   `<div class="a" *hologram(night-sky, zone: ${RECTANGLE}, seed: 7)>x</div>`,
  'hc-image':    '<div class="a" *hologram(rays, image: \'/i/motif.webp\', mask: \'/i/masque.webp\')>x</div>',
  'hc-nu':       '<div class="a" *hologram(rays)>x</div>',
  'hc-masque':   '<div class="a" *hologram(rays, mask: \'/i/masque.webp\')>x</div>',
  'hc-gravee':   `<div class="a" *hologram(frame, image: '/i/motif.webp', zone: ${RECTANGLE})>x</div>`,
  'hc-zone':     `<div class="a" *hologram(curtain, zone: inset(10% 20% 30% 40%))>x</div><div class="b" *hologram(curtain)>x</div><div class="c" *hologram(curtain, zone: ${COIN_COUPE})>x</div><div class="d" *hologram(curtain, zone: ${BAS})>x</div><div class="e" *hologram(curtain, zone: circle(30% at 50% 40%))>x</div><div class="f" *hologram(frame, zone: inset(10px 2em 5% round 4px))>x</div>`,
  'hc-zone-var': '<script>\n$fenetre = \'inset(10% 20% 30% 40%)\'\n</script>\n<div class="a" *hologram(frame, zone: $fenetre)>x</div><button class="t" @click={$fenetre = \'polygon(10% 10%, 90% 10%, 50% 60%)\'}>t</button>',
  'hc-simple-image': '<div class="a" *hologram(rainbow, image: \'/i/motif.webp\', mask: \'/i/masque.webp\', back: \'/i/dos.webp\')>x</div>',
  'hc-plat':     '<div class="a" *hologram(sheen, glare: false, shadow: false)>x</div>',
  'hc-tilt':     '<div class="a" *hologram(curtain) *tilt>x</div>',
  'hc-toujours': '<div class="a" *hologram(lattice, on: always)>x</div>',
  'hc-zoom':     '<div class="a" *hologram(glint, zoom: true)>x</div><div class="b" *hologram(rays-wide, zoom: true)>x</div><button class="dehors">dehors</button>',
  'hc-force':    '<script>\n$force = 0.5\n</script>\n<div class="a" *hologram(frost, strength: $force)>x</div><button class="t" @click={$force = 0.25}>t</button>',
  'hc-retrait':  '<script>\n$on = true\n</script>\n{if $on}<div class="a" *hologram(rays-window, zoom: true)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'hc-tous':     STYLES.map((s, i) => `<div class="s${i}" *hologram(${s})>x</div>`).join(''),
  'hc-montre':   '<div class="a" *hologram(opal, on: load)>x</div>',
  'hc-deux':     '<script>\n$on = true\n</script>\n{if $on}<div class="a" *hologram(rays-window, zoom: true)>x</div>{end}<div class="b" *hologram(rays-wide)>x</div>\n<button class="t" @click={$on = !$on}>t</button>',
  'hc-carte-vue': '<div class="a" *hologram(opal, on: view)>x</div>',
  'hc-vue':      '<div class="a" *hologram(rainbow, on: view)>x</div>',
  'hc-charge':   '<div class="a" *hologram(foil, on: load)>x</div>',
  'hc-rayon':    '<script>\n$r = null\n</script>\n<div class="a" *hologram(curtain, radius: $r)>x</div><div class="b" *hologram(curtain, radius: 12)>x</div><button class="t1" @click={$r = 24}>t</button><button class="t2" @click={$r = null}>t</button>',
  'hc-eclat':    '<div class="a" *hologram(rays, shine: calm)>x</div><div class="b" *hologram(rays)>x</div><div class="c" *hologram(opal, shine: calm)>x</div>',
  'hc-lueur':    '<script>\n$lueur = \'#ff0000\'\n$eclat = 0.7\n</script>\n<div class="a" *hologram(frame, glow: $lueur, brightness: $eclat)>x</div><button class="t1" @click={$lueur = \'#00ff00\'}>t</button><button class="t2" @click={$eclat = 1.2}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'hc-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *hologram, les styles de carte', function () {
  this.timeout(60000)
  let window: any
  let vraiRaf: any
  let vraiCaf: any
  // les images d'animation, jouées à la main : chaque `image()` avance l'horloge et joue ce qui attend
  let file: Array<[number, (t: number) => void]> = []
  let horloge = 0
  let serie   = 0

  const image = (ms = 1000 / 60) => {
    horloge += ms
    const jeu = file
    file = []
    for (const [, f] of jeu) f(horloge)
  }
  // joue jusqu'à ce que plus rien ne soit demandé ; rend le nombre d'images jouées
  const jusquAuRepos = (ms = 1000 / 60, max = 3000, chaque?: (n: number) => void) => {
    let n = 0
    while (file.length > 0 && n < max) {
      image(ms)
      n++
      if (chaque) chaque(n)
    }
    return n
  }

  before(async () => {
    const root   = mjsTmp('effets-hologramme-cartes')
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
    vraiRaf = window.requestAnimationFrame
    vraiCaf = window.cancelAnimationFrame
  })

  beforeEach(() => {
    file    = []
    horloge = window.performance.now()
    window.requestAnimationFrame = (f: any) => { file.push([++serie, f]); return serie }
    window.cancelAnimationFrame  = (id: number) => { file = file.filter((x) => x[0] !== id) }
  })

  afterEach(() => {
    window.document.body.innerHTML = ''
    window.requestAnimationFrame = vraiRaf
    window.cancelAnimationFrame  = vraiCaf
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

  const BOITE  = () => ({ left: 0, top: 0, right: 200, bottom: 280, width: 200, height: 280, x: 0, y: 0 })
  const calque = (el: any) => el.querySelector('[mjs-fx-layer="hologram"]')
  const lit    = (node: any, k: string) => node.style.getPropertyValue('--mjs-fx-hologram-' + k)
  const entre  = (el: any, x: number, y: number) => el.dispatchEvent(new window.PointerEvent('pointerenter', { clientX: x, clientY: y }))
  const sort   = (el: any) => el.dispatchEvent(new window.PointerEvent('pointerleave', { clientX: 900, clientY: 900 }))
  // la balise mesurée, la souris posée à 25 % × 10 % de la carte
  const survole = (el: any) => {
    mesurer(window, el, BOITE)
    entre(el, 50, 28)
  }

  it('au repos : ni calque, ni transformation, ni image d\'animation — seulement l\'ombre de la carte', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx'), 'hologram')
    assertAbsent(calque(el), 'calque au repos')
    assert.equal(el.getAttribute('mjs-fx-hologram-shadow'), '', 'l\'ombre portée')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    assert.equal(file.length, 0, 'aucune image demandée au repos')
  })

  it('au survol : le calque naît — l\'éclat d\'abord, le reflet par-dessus —, avec son style, sa fenêtre, ses motifs', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    const layer = calque(el)
    assert.ok(layer, 'le calque du reflet')
    assert.ok(el.lastElementChild === layer, 'dernier enfant : au-dessus du contenu')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.equal(layer.getAttribute('mjs-fx-hologram-card'), '')
    assert.equal(layer.getAttribute('mjs-fx-hologram-style'), 'night-sky')
    assert.equal(lit(layer, 'clip'), RECTANGLE, 'la fenêtre : la forme CSS écrite, telle quelle')
    assert.equal(layer.getAttribute('mjs-fx-hologram-zone'), null, 'aucune fenêtre nommée : la forme est une variable du calque')
    assert.equal(layer.getAttribute('mjs-fx-hologram-nu'), '', 'sans image gravée : le style pose son propre motif')
    assert.equal(layer.getAttribute('mjs-fx-hologram-open'), '', 'sans masque : la fenêtre fait la découpe')
    assert.deepEqual([...layer.children].map((c: any) => c.localName), ['b', 'i'], 'l\'éclat sous le reflet')
    assert.equal(lit(layer, 'cosmos'), '433px 345px', 'seed: 7 — la place du ciel, toujours la même')
    assert.equal(/--mjs-fx-hologram-t-/.test(layer.getAttribute('style') || ''), false, 'les motifs viennent du thème seul : l\'effet ne pose aucune image, ne dessine rien')
  })

  it('le ressort amène le reflet sous la souris sans pencher la carte, puis la boucle s\'arrête', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    const layer = calque(el)
    for (let i = 0; i < 5; i++) image()
    const x5 = Number(lit(layer, 'x'))
    assert.ok(x5 < 0.5 && x5 > 0.25, 'en route vers la souris : ' + x5)
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null, 'la carte ne se transforme pas : elle ne penche jamais')
    const n = jusquAuRepos()
    assert.ok(n > 10 && n < 600, 'le ressort se pose en un temps fini : ' + n + ' images')
    assert.equal(lit(layer, 'x'), '0.2500')
    assert.equal(lit(layer, 'y'), '0.1000')
    assert.equal(lit(layer, 'o'), '1.0000')
    assert.equal(lit(layer, 'c'), '0.9434', 'la distance de la souris au centre')
    assert.equal(lit(el, 'rx'), '', 'aucune pente')
    assert.equal(lit(el, 'ry'), '', 'aucune pente')
    assert.equal(el.style.transform, '')
    assert.equal(file.length, 0, 'posé : plus aucune image demandée')
    assert.ok(calque(el), 'la souris est toujours là : le calque reste')
  })

  it('la souris partie : le reflet s\'éteint, le calque repart sans attendre, la carte n\'a rien à redresser, puis plus rien ne reste', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    jusquAuRepos()
    sort(el)
    assert.ok(calque(el), 'une demi-seconde de grâce avant le retour')
    await pause(560)
    let sansCalque = 0
    const n = jusquAuRepos(1000 / 60, 3000, (k) => {
      if (!sansCalque && !calque(el)) sansCalque = k
    })
    assert.ok(n > 30 && n < 1500, 'un retour en douceur : ' + n + ' images')
    assert.ok(sansCalque > 0, 'le calque part')
    assert.ok(n <= sansCalque + 1, `la boucle s'arrête dès qu'il n'y a plus de calque : parti à l'image ${sansCalque}, arrêtée à l'image ${n}`)
    assertAbsent(calque(el), 'calque resté')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    assert.doesNotMatch(el.style.cssText, /--mjs-fx-hologram-/, 'variables de mouvement restées : ' + el.style.cssText)
    assert.equal(file.length, 0, 'au repos : plus aucune image demandée')
  })

  it('le mouvement dure le même temps à toute cadence : dix images par seconde (une machine lente), 120 et 240 (un écran rapide)', async () => {
    const duree = async (ms: number) => {
      const comp = await monter('mjs-hc-simple')
      const el   = comp._shadow.querySelector('.a')
      survole(el)
      jusquAuRepos()
      sort(el)
      await pause(560)
      return jusquAuRepos(ms, 20000) * ms
    }
    const base = await duree(1000 / 60)
    for (const [nom, ms] of [['10 images par seconde', 100], ['120 images par seconde', 1000 / 120], ['240 images par seconde', 1000 / 240]] as Array<[string, number]>) {
      const d = await duree(ms)
      assert.ok(Math.abs(d - base) < base * 0.2, `60 images par seconde : ${Math.round(base)} ms ; ${nom} : ${Math.round(d)} ms`)
    }
  })

  it('image, mask : le motif gravé de la carte ; sans lui, le style garde le motif du thème (l\'effet n\'en pose aucun)', async () => {
    let comp  = await monter('mjs-hc-image')
    let el    = comp._shadow.querySelector('.a')
    survole(el)
    let layer = calque(el)
    assert.equal(lit(layer, 'foil'), 'url("/i/motif.webp")')
    assert.equal(lit(layer, 'mask'), 'url("/i/masque.webp")')
    assert.equal(layer.getAttribute('mjs-fx-hologram-nu'), null, 'une image gravée : pas de motif de remplacement')
    assert.equal(layer.getAttribute('mjs-fx-hologram-open'), null, 'un masque : il fait la découpe')
    comp  = await monter('mjs-hc-nu')
    el    = comp._shadow.querySelector('.a')
    survole(el)
    layer = calque(el)
    assert.equal(lit(layer, 'foil'), '')
    assert.equal(lit(layer, 't-ripples'), '', 'sans image gravée : le motif du style vient du thème, l\'effet n\'en pose aucun')
  })

  it('image et mask ne dépendent pas l\'un de l\'autre : un masque sans image garde le motif du style, une image sans masque brille selon la fenêtre', async () => {
    let comp  = await monter('mjs-hc-masque')
    let el    = comp._shadow.querySelector('.a')
    survole(el)
    let layer = calque(el)
    assert.equal(layer.getAttribute('mjs-fx-hologram-nu'), '', 'pas d\'image : le motif du style, à sa taille')
    assert.equal(layer.getAttribute('mjs-fx-hologram-open'), null, 'un masque : il découpe')
    assert.equal(lit(layer, 't-ripples'), '')
    assert.equal(lit(layer, 'mask'), 'url("/i/masque.webp")')
    comp  = await monter('mjs-hc-gravee')
    el    = comp._shadow.querySelector('.a')
    survole(el)
    layer = calque(el)
    assert.equal(layer.getAttribute('mjs-fx-hologram-nu'), null)
    assert.equal(layer.getAttribute('mjs-fx-hologram-open'), '', 'pas de masque : la fenêtre découpe')
    const css = window.µ._mjs_fxDefs.hologram.css
    assert.match(css, /\[mjs-fx-hologram-style="frame"\]\[mjs-fx-hologram-open\] i\{clip-path:var\(--mjs-fx-hologram-inv\)\}/, 'frame sans masque : tout sauf la fenêtre')
    assert.match(css, /\[mjs-fx-hologram-style="rays"\]\[mjs-fx-hologram-nu\] i[,{][^}]*background-size:33%/, 'rays sans image : son motif en tuiles')
  })

  it('les onze motifs ont nos noms : la feuille lit chacun dans une variable du thème, à défaut celle que le build livre', () => {
    const css = window.µ._mjs_fxDefs.hologram.css
    const noms = [...new Set([...css.matchAll(/var\(--mjs-hologram-pattern-([a-z-]+)/g)].map((m: any) => m[1]))].sort()
    assert.deepEqual(noms, ['discs', 'grain', 'maze', 'ripples', 'ripples-mask', 'sky-far', 'sky-mid', 'sky-near', 'sparkles', 'waves', 'weave'])
    // le thème d'abord, puis l'image que le build livre (cette construction les écrit tous), jamais une couche vide
    const livree = (n: string) => `url\\("[^"]*mjs_hologram_${n}-[0-9a-z]{5}\\.(?:png|webp|jpg)"\\)`
    for (const n of noms) assert.match(css, new RegExp(`var\\(--mjs-hologram-pattern-${n},${livree(n)}\\)`), n + ' : l\'image du thème, à défaut celle que le build livre')
    assert.match(css, new RegExp(`var\\(--mjs-fx-hologram-foil,var\\(--mjs-hologram-pattern-ripples,${livree('ripples')}\\)\\)`), 'l\'image gravée de la carte passe avant, puis le thème, puis l\'image livrée')
    assert.equal(css.includes('--mjs-fx-hologram-t-'), false, 'aucune variable de dessin : l\'effet ne dessine rien')
  })

  it('zone : une forme CSS écrite telle quelle (inset, polygon, circle) ; sans zone : toute la carte', async () => {
    const comp = await monter('mjs-hc-zone')
    const [a, b, c, d, e, f] = ['.a', '.b', '.c', '.d', '.e', '.f'].map((k) => comp._shadow.querySelector(k))
    for (const carte of [a, b, c, d, e, f]) survole(carte)
    // sans virgule superflue : les virgules d'un polygone se lisent avec ou sans espace
    const net = (v: string) => v.replace(/\s*,\s*/g, ',')
    assert.equal(lit(calque(a), 'clip'), 'inset(10% 20% 30% 40%)', 'un rectangle')
    assert.equal(net(lit(calque(c), 'clip')), net(COIN_COUPE), 'un coin coupé : le polygone, tel quel')
    assert.equal(lit(calque(d), 'clip'), BAS, 'un rectangle posé plus bas')
    assert.equal(lit(calque(e), 'clip'), 'circle(30% at 50% 40%)', 'un cercle : la fenêtre vaut pour tout ce que clip-path accepte')
    assert.equal(lit(calque(f), 'clip'), 'inset(10px 2em 5% round 4px)', 'des unités mêlées, des angles arrondis')
    // le contraire (frame sans masque) : le cadre percé de la fenêtre
    assert.equal(lit(calque(a), 'inv'), 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,40% 10%,calc(100% - 20%) 10%,calc(100% - 20%) calc(100% - 30%),40% calc(100% - 30%),40% 10%,0% 0%)', 'inset : le rectangle, en points')
    assert.equal(net(lit(calque(c), 'inv')), 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,91.5% 9.85%,57% 9.85%,54% 12%,17% 12%,16% 14%,12% 16%,8% 16%,8% 47.15%,92% 47.15%,91.5% 9.85%,0% 0%)', 'polygon : ses points, le premier repris')
    assert.equal(lit(calque(f), 'inv'), 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,2em 10px,calc(100% - 2em) 10px,calc(100% - 2em) calc(100% - 5%),2em calc(100% - 5%),2em 10px,0% 0%)', 'inset en unités mêlées : les angles arrondis ne comptent pas')
    assert.equal(lit(calque(e), 'inv'), 'none', 'un cercle n\'a pas de contraire : le cadre brille partout')
    for (const carte of [a, c, d, e, f]) assert.equal(calque(carte).getAttribute('mjs-fx-hologram-zone'), null, 'aucune fenêtre nommée')
    assert.equal(lit(calque(b), 'clip'), '')
    assert.equal(lit(calque(b), 'inv'), '')
  })

  it('zone tenue par une variable : la fenêtre suit sa valeur, le calque reprend la forme neuve', async () => {
    const comp = await monter('mjs-hc-zone-var')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    assert.equal(lit(calque(el), 'clip'), 'inset(10% 20% 30% 40%)')
    comp._shadow.querySelector('.t').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await attendre(() => !calque(comp._shadow.querySelector('.a')) || lit(calque(comp._shadow.querySelector('.a')), 'clip') !== 'inset(10% 20% 30% 40%)', 1000)
    await pause()
    const apres = comp._shadow.querySelector('.a')
    survole(apres)
    assert.equal(lit(calque(apres), 'clip'), 'polygon(10% 10%, 90% 10%, 50% 60%)', 'la forme d\'une variable, lue à la pose du calque')
    assert.equal(lit(calque(apres), 'inv'), 'polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,10% 10%, 90% 10%, 50% 60%,10% 10%,0% 0%)')
  })

  it('un style simple ignore image, mask et back : aucune image chargée, aucune variable de carte', async () => {
    const images: string[] = []
    const Vraie = window.Image
    window.Image = function () { const i: any = new Vraie(); Object.defineProperty(i, 'src', { set: (v: string) => { images.push(v) }, get: () => '' }); return i }
    try {
      const comp = await monter('mjs-hc-simple-image')
      const el   = comp._shadow.querySelector('.a')
      survole(el)
      const layer = calque(el)
      assert.ok(layer, 'le calque du reflet simple')
      assert.equal(layer.getAttribute('mjs-fx-hologram-simple'), '')
      assert.deepEqual(images, [], 'ni l\'image, ni le masque, ni le dos ne sont demandés')
      for (const k of ['foil', 'mask', 'back', 'clip']) assert.equal(lit(layer, k), '', k)
      // témoin : un style de carte, lui, les demande — l'espion voit bien les images
      await monter('mjs-hc-image')
      assert.ok(images.includes('/i/motif.webp') && images.includes('/i/masque.webp'), 'un style de carte charge l\'image et le masque : ' + images.join(' '))
    }
    finally {
      window.Image = Vraie
    }
  })

  it('glare: false, shadow: false — la carte reste à plat, sans éclat, sans ombre', async () => {
    const comp = await monter('mjs-hc-plat')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.getAttribute('mjs-fx-hologram-shadow'), null)
    survole(el)
    jusquAuRepos()
    assert.deepEqual([...calque(el).children].map((c: any) => c.localName), ['i'])
    assert.equal(lit(el, 'rx'), '')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    assert.equal(lit(calque(el), 'x'), '0.2500', 'le reflet, lui, suit')
  })

  it('avec *tilt sur la même balise : *hologram ne transforme rien au survol, son reflet est là (la pente est celle de *tilt)', async () => {
    const comp = await monter('mjs-hc-tilt')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    for (let i = 0; i < 40; i++) image()
    assert.equal(lit(el, 'rx'), '')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    assert.ok(calque(el), 'le reflet est là')
  })

  it('on: always — le reflet est là sans survol et reste après le départ de la souris', async () => {
    const comp = await monter('mjs-hc-toujours')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(calque(el), 'posé d\'emblée')
    assert.equal(lit(calque(el), 'o'), '1.0000')
    survole(el)
    jusquAuRepos()
    sort(el)
    await pause(560)
    jusquAuRepos()
    assert.ok(calque(el), 'toujours là')
    assert.equal(lit(calque(el), 'o'), '1.0000')
    assert.equal(lit(calque(el), 'x'), '0.5000', 'revenu au centre')
    assert.equal(file.length, 0)
  })

  it('zoom : un clic agrandit la carte, une seule à la fois ; un second clic, Échap ou un clic ailleurs la renvoie', async () => {
    const comp = await monter('mjs-hc-zoom')
    const a    = comp._shadow.querySelector('.a')
    const b    = comp._shadow.querySelector('.b')
    assert.equal(a.getAttribute('tabindex'), '0', 'atteignable au clavier')
    assert.equal(a.getAttribute('mjs-fx-hologram-zoom'), '')
    a.click()
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), '')
    assert.equal(a.getAttribute('mjs-fx-hologram-up'), '', 'au-dessus du reste de la page')
    assert.ok(calque(a), 'agrandie : le calque est là')
    b.click()
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), null, 'l\'autre carte rentre')
    assert.equal(b.getAttribute('mjs-fx-hologram-zoomed'), '')
    b.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert.equal(b.getAttribute('mjs-fx-hologram-zoomed'), null, 'Échap')
    a.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), '', 'Entrée vaut un clic')
    comp._shadow.querySelector('.dehors').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, composed: true }))
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), null, 'un clic ailleurs')
    a.click()
    a.click()
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), null, 'un second clic')
    await pause(160)
    jusquAuRepos()
    assert.equal(a.getAttribute('mjs-fx-hologram-up'), null, 'rentrée : elle reprend son rang')
    assertAbsent(calque(a), 'calque resté après le retour')
    assert.equal(file.length, 0)
  })

  it('strength tenu par une variable : l\'intensité suit sans reposer l\'effet', async () => {
    const comp = await monter('mjs-hc-force')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    jusquAuRepos()
    const layer = calque(el)
    assert.equal(lit(layer, 'o'), '0.5000')
    comp._shadow.querySelector('.t').click()
    await pause(40)
    assert.ok(calque(el) === layer, 'le même calque : l\'effet n\'est pas reposé')
    assert.equal(lit(layer, 'o'), '0.2500')
  })

  it('les vingt styles de carte : une marque et une règle de feuille chacun', async () => {
    assert.equal(STYLES.length, 20)
    const comp = await monter('mjs-hc-tous', '.s19')
    const css  = window.µ._mjs_fxDefs.hologram.css
    STYLES.forEach((s, i) => {
      const el = comp._shadow.querySelector('.s' + i)
      survole(el)
      assert.equal(calque(el)?.getAttribute('mjs-fx-hologram-style'), s)
      assert.ok(css.includes(`[mjs-fx-hologram-style="${s}"]`), 'pas de règle pour ' + s)
    })
    assert.match(css, /\[mjs-fx~="hologram"\]\[mjs-fx-hologram-3d\]\{transform:[^}]*will-change:transform\}/, 'la transformation n\'existe que pendant le mouvement')
  })

  it('on: load — la carte se montre toute seule, quatre secondes, puis attend la souris', async () => {
    const comp = await monter('mjs-hc-montre')
    const el   = comp._shadow.querySelector('.a')
    mesurer(window, el, BOITE)
    assertAbsent(calque(el), 'rien avant le départ')
    await attendre(() => !!calque(el), 2600)
    assert.ok(calque(el), 'deux secondes après la pose, la démonstration part')
    horloge = window.performance.now()
    for (let i = 0; i < 150; i++) image()
    assert.ok(Math.abs(Number(lit(calque(el), 'o')) - 0.8) < 0.01, 'le reflet monte à 80 % : ' + lit(calque(el), 'o'))
    const x1 = parseFloat(lit(calque(el), 'x'))
    for (let i = 0; i < 40; i++) image()
    const x2 = parseFloat(lit(calque(el), 'x'))
    assert.ok(Math.abs(x1 - x2) > 0.02, `le reflet se promène seul : ${x1} puis ${x2}`)
    assert.equal(lit(el, 'rx'), '', 'la carte, elle, ne bouge pas')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    // la démonstration finit après quatre secondes ; le retour part à l'image suivante
    for (let i = 0; i < 80; i++) image()
    await pause(30)
    jusquAuRepos()
    assertAbsent(calque(el), 'calque resté après la démonstration')
    assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
    assert.equal(file.length, 0)
  })

  it('« réduire les animations » : ni ressort ni inclinaison — le reflet va droit à la souris', async () => {
    const vrai = window.matchMedia
    window.matchMedia = (q: string) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      const comp = await monter('mjs-hc-simple')
      const el   = comp._shadow.querySelector('.a')
      survole(el)
      image()
      assert.equal(lit(calque(el), 'x'), '0.2500', 'd\'un coup')
      assert.equal(lit(el, 'rx'), '')
      assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
      assert.equal(file.length, 0)
    }
    finally {
      window.matchMedia = vrai
    }
  })

  it('le retrait, carte survolée et agrandie : plus de calque, d\'attribut, de variable ni de boucle', async () => {
    const comp = await monter('mjs-hc-retrait')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    el.click()
    for (let i = 0; i < 10; i++) image()
    assert.equal(el.getAttribute('mjs-fx-hologram-zoomed'), '')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.deepEqual(el.getAttributeNames().filter((n: string) => n.startsWith('mjs-fx') || n === 'tabindex'), [])
    assert.equal(el.style.cssText, '', 'variables restées : ' + el.style.cssText)
    assert.equal(file.length, 0, 'la boucle part avec l\'effet')
    window.document.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
  })

  it('un événement sans coordonnées (ni clientX ni clientY) est ignoré : ni calque, ni valeur non finie, ni boucle qui ne finit jamais', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    mesurer(window, el, BOITE)
    el.dispatchEvent(new window.Event('pointerenter'))
    el.dispatchEvent(new window.Event('pointermove'))
    assertAbsent(calque(el), 'calque posé par un événement sans coordonnées')
    assert.equal(file.length, 0, 'aucune image demandée')
    // la carte répond ensuite à une vraie souris, puis revient au repos
    entre(el, 50, 28)
    const n = jusquAuRepos()
    assert.ok(n > 10 && n < 600, 'le ressort se pose : ' + n + ' images')
    assert.equal(lit(calque(el), 'x'), '0.2500')
    assert.doesNotMatch(el.style.cssText + calque(el).style.cssText, /NaN/)
    sort(el)
    await pause(560)
    jusquAuRepos()
    assert.equal(file.length, 0)
    assertAbsent(calque(el), 'calque resté')
  })

  it('ceinture : une mesure sans chiffres dans le ressort remet tout au repos d\'un coup et arrête la boucle', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    mesurer(window, el, () => ({ left: NaN, top: 0, right: 200, bottom: 280, width: 200, height: 280, x: NaN, y: 0 }))
    entre(el, 50, 28)
    const n = jusquAuRepos(1000 / 60, 400)
    assert.ok(n < 100, 'la boucle s\'arrête d\'elle-même : ' + n + ' images')
    assert.equal(file.length, 0)
    assert.doesNotMatch(el.style.cssText, /NaN/, 'balise : ' + el.style.cssText)
    assertAbsent(calque(el), 'calque resté, reflet éteint')
    // une mesure juste, ensuite : la carte répond comme avant
    mesurer(window, el, BOITE)
    entre(el, 50, 28)
    jusquAuRepos()
    assert.equal(lit(calque(el), 'x'), '0.2500')
  })

  it('radius tenu par une variable : pris à la naissance du calque, qu\'il vienne ou parte quand la carte est au repos', async () => {
    const comp = await monter('mjs-hc-rayon')
    const a    = comp._shadow.querySelector('.a')
    const b    = comp._shadow.querySelector('.b')
    survole(a)
    survole(b)
    assert.equal(calque(a).getAttribute('mjs-fx-hologram-radius'), null, 'pas d\'arrondi donné : celui de la balise')
    assert.equal(calque(b).getAttribute('mjs-fx-hologram-radius'), '', 'radius: 12 écrit dans la page')
    jusquAuRepos()
    sort(a)
    await pause(560)
    jusquAuRepos()
    assertAbsent(calque(a), 'calque parti')
    comp._shadow.querySelector('.t1').click()
    await pause(40)
    survole(a)
    assert.equal(calque(a).getAttribute('mjs-fx-hologram-radius'), '', 'radius: 24 venu pendant que le calque n\'existait pas')
    jusquAuRepos()
    sort(a)
    await pause(560)
    jusquAuRepos()
    assertAbsent(calque(a), 'calque parti')
    comp._shadow.querySelector('.t2').click()
    await pause(40)
    survole(a)
    assert.equal(calque(a).getAttribute('mjs-fx-hologram-radius'), null, 'radius retiré pendant que le calque n\'existait pas')
    // calque là : le changement se voit tout de suite, sans reposer l'effet
    const layer = calque(a)
    comp._shadow.querySelector('.t1').click()
    await pause(40)
    assert.ok(calque(a) === layer, 'le même calque')
    assert.equal(layer.getAttribute('mjs-fx-hologram-radius'), '')
  })

  it('glow et brightness tenus par une variable : leur variable CSS suit sans reposer l\'effet', async () => {
    const comp = await monter('mjs-hc-lueur')
    const el   = comp._shadow.querySelector('.a')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-brightness'), '0.7')
    assert.notEqual(el.style.getPropertyValue('--mjs-hologram-glow'), '', 'la lueur écrite sur la balise')
    survole(el)
    const layer = calque(el)
    const lueur = el.style.getPropertyValue('--mjs-hologram-glow')
    comp._shadow.querySelector('.t2').click()
    await pause(40)
    assert.ok(calque(el) === layer, 'brightness : le même calque, l\'effet n\'est pas reposé')
    assert.equal(el.style.getPropertyValue('--mjs-hologram-brightness'), '1.2')
    comp._shadow.querySelector('.t1').click()
    await pause(40)
    assert.ok(calque(el) === layer, 'glow : le même calque, l\'effet n\'est pas reposé')
    assert.notEqual(el.style.getPropertyValue('--mjs-hologram-glow'), lueur, 'la lueur a changé')
  })

  it('un très long temps entre deux images (onglet qui revient, machine saisie) n\'avance le ressort que d\'une demi-seconde', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    survole(el)
    image()
    image(20000)
    assert.ok(file.length > 0, 'pas encore posé : le temps perdu est plafonné')
    const x = Number(lit(calque(el), 'x'))
    assert.ok(x > 0.25 && x < 0.5, 'en route vers la souris : ' + x)
  })

  it('onglet caché : tout revient d\'un coup et le calque part ; onglet qui redevient visible : rien ne change', async () => {
    const comp = await monter('mjs-hc-simple')
    const el   = comp._shadow.querySelector('.a')
    const doc  = window.document
    const etat = (v: string) => {
      Object.defineProperty(doc, 'visibilityState', { value: v, configurable: true })
      doc.dispatchEvent(new window.Event('visibilitychange'))
    }
    try {
      survole(el)
      jusquAuRepos()
      etat('visible')
      assert.ok(calque(el), 'visible : rien ne bouge')
      assert.equal(lit(calque(el), 'x'), '0.2500')
      etat('hidden')
      assertAbsent(calque(el), 'calque resté, invisible, après l\'onglet caché')
      assert.equal(el.getAttribute('mjs-fx-hologram-3d'), null)
      assert.doesNotMatch(el.style.cssText, /--mjs-fx-hologram-/, 'variables restées : ' + el.style.cssText)
      assert.equal(file.length, 0)
      etat('visible')
      entre(el, 50, 28)
      assert.ok(calque(el), 'la carte répond de nouveau à la souris')
    }
    finally {
      delete (doc as any).visibilityState
    }
  })

  it('onglet caché, carte agrandie : le calque reste (la carte est toujours là), le reflet revient au centre', async () => {
    const comp = await monter('mjs-hc-zoom')
    const el   = comp._shadow.querySelector('.a')
    const doc  = window.document
    try {
      survole(el)
      el.click()
      jusquAuRepos()
      Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true })
      doc.dispatchEvent(new window.Event('visibilitychange'))
      assert.ok(calque(el), 'agrandie : le calque reste')
      assert.equal(lit(calque(el), 'x'), '0.5000')
    }
    finally {
      delete (doc as any).visibilityState
    }
  })

  it('on: view, un style simple — le reflet ne dérive que tant que la balise est à l\'écran ; on: load vaut always', async () => {
    const observateurs: any[] = []
    const vrai = window.IntersectionObserver
    window.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; observateurs.push(this) } observe() {} disconnect() {} unobserve() {} takeRecords() { return [] } }
    try {
      let comp = await monter('mjs-hc-vue')
      let el   = comp._shadow.querySelector('.a')
      assert.equal(el.getAttribute('mjs-fx'), 'hologram')
      assert.ok(el.querySelector('[mjs-fx-layer="hologram"]'), 'le calque est là dès la pose (il ne dépend pas du survol)')
      assert.equal(el.querySelector('[mjs-fx-layer="hologram"]').hasAttribute('mjs-fx-hologram-hover'), false)
      assert.equal(file.length, 0, 'pas encore à l\'écran : aucune image demandée')
      const io = observateurs[observateurs.length - 1]
      assert.ok(io, 'un observateur attend la balise')
      io.cb([{ isIntersecting: true, intersectionRatio: 1 }])
      assert.equal(file.length, 1, 'à l\'écran : la dérive part')
      io.cb([{ isIntersecting: false, intersectionRatio: 0 }])
      assert.equal(file.length, 0, 'sortie de l\'écran : la dérive s\'arrête')
      io.cb([{ isIntersecting: true, intersectionRatio: 1 }])
      assert.equal(file.length, 1, 'de retour : elle repart')
      window.document.body.innerHTML = ''
      file = []
      comp = await monter('mjs-hc-charge')
      el   = comp._shadow.querySelector('.a')
      assert.equal(file.length, 1, 'on: load : comme always, la dérive part avec la pose')
      assert.equal(el.querySelector('[mjs-fx-layer="hologram"]').hasAttribute('mjs-fx-hologram-hover'), false)
    }
    finally {
      window.IntersectionObserver = vrai
    }
  })

  it('on: view, une carte — elle se montre une fois à son arrivée à l\'écran, puis attend la souris', async () => {
    const observateurs: any[] = []
    const vrai = window.IntersectionObserver
    window.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; observateurs.push(this) } observe() {} disconnect() {} unobserve() {} takeRecords() { return [] } }
    try {
      const comp = await monter('mjs-hc-carte-vue')
      const el   = comp._shadow.querySelector('.a')
      mesurer(window, el, BOITE)
      assertAbsent(calque(el), 'rien avant l\'arrivée à l\'écran')
      const io = observateurs[observateurs.length - 1]
      assert.ok(io, 'un observateur attend la balise')
      io.cb([{ isIntersecting: true, intersectionRatio: 1 }])
      assert.ok(calque(el), 'arrivée à l\'écran : la démonstration part')
      horloge = window.performance.now()
      for (let i = 0; i < 150; i++) image()
      assert.ok(Math.abs(Number(lit(calque(el), 'o')) - 0.8) < 0.01, 'le reflet monte à 80 % : ' + lit(calque(el), 'o'))
    }
    finally {
      window.IntersectionObserver = vrai
    }
  })

  it('la carte agrandie retirée de la page ne fige pas les autres : elles répondent toujours à la souris', async () => {
    const comp = await monter('mjs-hc-deux')
    const a    = comp._shadow.querySelector('.a')
    const b    = comp._shadow.querySelector('.b')
    survole(a)
    a.click()
    for (let i = 0; i < 10; i++) image()
    assert.equal(a.getAttribute('mjs-fx-hologram-zoomed'), '')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    survole(b)
    assert.ok(calque(b), 'l\'autre carte réagit à la souris')
  })

  it('shine : l\'éclat est une marque du calque, les règles de la feuille le suivent ; sans lui, l\'éclat de base', async () => {
    const comp = await monter('mjs-hc-eclat')
    const [a, b, c] = ['.a', '.b', '.c'].map((k) => comp._shadow.querySelector(k))
    survole(a)
    survole(b)
    survole(c)
    assert.equal(calque(a).getAttribute('mjs-fx-hologram-shine'), 'calm')
    assert.equal(calque(b).getAttribute('mjs-fx-hologram-shine'), null, 'sans shine : aucune marque, la base')
    assert.equal(calque(c).getAttribute('mjs-fx-hologram-shine'), 'calm')
    const css = window.µ._mjs_fxDefs.hologram.css
    assert.match(css, /\[mjs-fx-hologram-style="rays"\]\[mjs-fx-hologram-shine="calm"\] b\{/, 'rays calm : son éclat')
    assert.match(css, /\[mjs-fx-hologram-style="rays"\]\[mjs-fx-hologram-shine="shade"\] b\{/, 'rays shade : son éclat')
    assert.match(css, /\[mjs-fx-hologram-style="opal"\]\[mjs-fx-hologram-shine="calm"\] b\{/, 'opal calm : son éclat')
    assert.equal(/shine="bright"/.test(css), false, 'bright est la base : aucune règle à part')
  })

  it('les anciens noms de style ne sont plus acceptés (aucun alias)', async () => {
    for (const ancien of ['basic', 'reverse', 'holo', 'cosmos', 'amazing', 'radiant', 'gallery', 'gallery-holo', 'v', 'v-full', 'gallery-v', 'shiny-v', 'shiny', 'trainer-full', 'vstar', 'vmax', 'rainbow-rare', 'rainbow-alt', 'secret', 'secret-rainbow', 'gallery-secret', 'gallery-vmax', 'shiny-vmax', 'opal-dim', 'rays-bright', 'rays-calm', 'rays-shade']) {
      await assert.rejects(compiler('<div *hologram(' + ancien + ')>x</div>'), /\*hologram : style = /, ancien)
    }
    const css = window.µ._mjs_fxDefs.hologram.css
    for (const ancien of ['gallery', 'holo', 'cosmos', 'shiny', 'vmax', 'secret']) assert.equal(css.includes('style="' + ancien + '"'), false, ancien + ' : plus de règle')
    for (const ancien of ['art', 'stage', 'trainer', 'picture', 'notched', 'lowered']) assert.equal(css.includes('zone="' + ancien + '"'), false, ancien + ' : plus de zone')
    assert.equal(css.includes('mjs-fx-hologram-zone'), false, 'la feuille ne porte aucune fenêtre : la forme vient de la page')
    for (const reste of ['9.85%', '52.85%', '47.15%', '48.2%']) assert.equal(css.includes(reste), false, reste + ' : aucun chiffre d\'une carte à jouer dans la feuille')
  })

  it('zone : une forme CSS (inset, polygon, circle, ellipse, path) est acceptée, tenue ou non par une variable', async () => {
    const bons = [RECTANGLE, COIN_COUPE, 'inset(10px 2em 5% round 4px / 8px)', 'circle(40% at 50% 30%)', 'ellipse(30% 20% at 50% 50%)', 'path(\'M 10 10 H 90 V 60 Z\')', '\'inset(10% 20%)\'', '$fenetre']
    for (const bon of bons) await compiler('<script>\n$fenetre = \'inset(10%)\'\n</script>\n<div *hologram(curtain, zone: ' + bon + ')>x</div>')
  })

  it('zone : un mot, un nombre ou une forme que clip-path ne connaît pas est refusé à la compilation', async () => {
    for (const mauvais of ['art', 'stage', 'trainer', '\'ailleurs\'', '\'10 20 30\'', '\'a b c d\'', 'rect(0, 0, 10px, 10px)', 'url(#fenetre)', '\'inset()\'', '\'inset(10%); color: red\'']) {
      await assert.rejects(compiler('<div *hologram(curtain, zone: ' + mauvais + ')>x</div>'), /\*hologram : zone = /, mauvais)
    }
  })

  it('zone : quatre nombres « haut droite bas gauche » sont refusés, et le refus donne la forme CSS qui les remplace', async () => {
    const equivalents: Array<[string, string]> = [
      ['\'10 20 30 40\'', 'inset(10% 20% 30% 40%)'],
      ['\'10.5 0 30 40\'', 'inset(10.5% 0% 30% 40%)']
    ]
    for (const [ancien, css] of equivalents) {
      await assert.rejects(compiler('<div *hologram(curtain, zone: ' + ancien + ')>x</div>'), (e: Error) => e.message.includes('*hologram : zone = ' + ancien.replace(/'/g, '')) && e.message.includes(css), ancien)
    }
  })

  it('zone : un mot est refusé avec les formes CSS permises, même le nom d\'une fenêtre de carte à jouer — le compilateur n\'en connaît aucun', async () => {
    for (const mot of ['picture', 'notched', 'lowered', 'ailleurs']) {
      await assert.rejects(compiler('<div *hologram(curtain, zone: ' + mot + ')>x</div>'), (e: Error) => {
        assert.ok(e.message.includes('*hologram : zone = ' + mot), mot + ' : le refus nomme la valeur : ' + e.message)
        assert.match(e.message, /inset\(.*polygon\(.*circle\(.*ellipse\(.*path\(/, mot + ' : les formes permises : ' + e.message)
        assert.doesNotMatch(e.message, /9\.85|52\.85|47\.15|48\.2|91\.5/, mot + ' : aucun chiffre d\'une carte à jouer dans le refus : ' + e.message)
        return true
      }, mot)
    }
  })

  it('le compilateur ne porte aucun nom de fenêtre de carte à jouer, ni dans le catalogue ni dans ses messages', () => {
    for (const fichier of ['src/effects/catalog.ts', 'src/messages/fr.ts', 'src/messages/en.ts']) {
      const source = readFileSync(join(RACINE, fichier), 'utf-8')
      for (const nom of ['picture', 'notched', 'lowered']) assert.equal(new RegExp('\\b' + nom + '\\b').test(source), false, fichier + ' : ' + nom)
      assert.equal(source.includes('regle-zone-carte'), false, fichier + ' : le message de la règle qui nommait ces fenêtres n\'a plus de lecteur')
    }
  })

  it('la compilation : les styles et les réglages de carte acceptés, les valeurs hors bornes refusées', async () => {
    await compiler('<div *hologram(night-sky, zone: ' + RECTANGLE + ', zoom: true, seed: 3, glow: #f00, brightness: 0.7, image: \'i.png\', mask: \'m.png\', shadow: false, on: load)>x</div>')
    await compiler('<div *hologram(rainbow, on: view)>x</div>')
    await compiler('<div *hologram(rainbow, on: load)>x</div>')
    await assert.rejects(compiler('<div *hologram(night-sky, tilt: 10)>x</div>'), /tilt/)
    await assert.rejects(compiler('<div *hologram(rays, shine: dim)>x</div>'), /\*hologram : shine = dim/)
    await assert.rejects(compiler('<div *hologram(frame, brightness: 3)>x</div>'), /\*hologram : brightness = 3 — permis : float 0\.\.2/)
    await assert.rejects(compiler('<div *hologram(night-sky, seed: 1000)>x</div>'), /\*hologram : seed = 1000 — permis : int 0\.\.999/)
    await assert.rejects(compiler('<div *hologram(holographique)>x</div>'), /\*hologram : style = holographique/)
    await assert.rejects(compiler('<div *hologram(night-sky, textures: \'/t\')>x</div>'), /textures/)
  })
})
