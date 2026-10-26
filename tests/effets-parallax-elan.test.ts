// *parallax(smooth) — l'élan : la balise rattrape le défilement avec retard au lieu d'y être collée.
// La logique se prouve ici, images d'animation menées à la main (happy-dom n'a pas de mise en page : la
// place de repos d'origin: view, le défilement d'un conteneur et le rendu réel se regardent dans
// Chromium, cf. effets-parallax-elan-browser.test.ts) : sans élan le tracé d'avant (une écriture par
// défilement, aucune boucle), avec élan une part de l'écart par image (60 images par seconde ou 144,
// même élan), une boucle qui s'arrête d'elle-même sous 0,1 px, `will-change` le temps du mouvement,
// aucun élan sous « réduire les animations », balise qui se pose d'un coup quand ni elle ni sa cible
// ne se voient et dans un onglet caché (emportée hors de l'écran par son élan, elle revient en
// glissant), `smooth` suivi sans reposer l'effet, retrait sans reste.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const CODE    = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8') + '\n' + readFileSync(join(RUNTIME, 'mjs_fx_parallax.ts'), 'utf-8')
const IMAGE   = 1000 / 60
const VAR     = '--mjs-fx-parallax-y'
// le plus d'images qu'un rattrapage de ces tests demande (0.2 : une quarantaine) ; au-delà, la boucle ne s'arrête pas
const IMAGES_MAX = 300

// `banc()` donne la boîte des balises par le prototype des éléments, que toutes les fenêtres de happy-dom du processus partagent : il est rendu
// à la fin de chaque essai, sinon la boîte de ce fichier suit les essais des fichiers suivants
const ELEMENT = new Window({ url: 'http://localhost/' }).Element.prototype
const NATIF   = ELEMENT.getBoundingClientRect
const rendre  = () => { ELEMENT.getBoundingClientRect = NATIF }

// une fenêtre avec le moteur d'effets et *parallax ; les images d'animation ne partent que quand le test le dit
function banc(options: { calme?: boolean } = {}) {
  const window: any = new Window({ url: 'http://localhost/' })
  const file = new Map<number, (t: number) => void>()
  const annulees: number[] = []
  let ecoutes = 0
  let n    = 0
  let haut = 0
  let t    = 1000
  window.requestAnimationFrame  = (f: (t: number) => void) => { file.set(++n, f); return n }
  window.cancelAnimationFrame   = (id: number) => { annulees.push(id); file.delete(id) }
  window.matchMedia             = (q: string) => ({ matches: !!options.calme && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
  // happy-dom ne mesure rien : la boîte d'une balise est celle qu'on lui donne (`place`), sinon nulle
  window.Element.prototype.getBoundingClientRect = function () { return this.__boite || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } }
  const ajoute = window.document.addEventListener.bind(window.document)
  const retire = window.document.removeEventListener.bind(window.document)
  window.document.addEventListener    = (k: string, ...a: any[]) => { if (k === 'visibilitychange') ecoutes++; return ajoute(k, ...a) }
  window.document.removeEventListener = (k: string, ...a: any[]) => { if (k === 'visibilitychange') ecoutes--; return retire(k, ...a) }
  Object.defineProperty(window, 'scrollY', { get: () => haut, configurable: true })
  window.eval('var µ = {};\n' + CODE + '\nglobalThis.µ = µ;')
  const doc = window.document
  return {
    window,
    µ: window.µ,
    // les images en attente, les écoutes de visibilité de l'onglet vivantes
    attente: () => file.size,
    ecoutes: () => ecoutes,
    annulees,
    // une image à l'heure t (ms) ; sans argument, l'image suivante à 60 par seconde
    image(pas = IMAGE) {
      t += pas
      const q = [...file.values()]
      file.clear()
      for (const f of q) f(t)
      return q.length
    },
    // des images jusqu'à ce que la boucle s'arrête ; rend leur nombre. Borné : une boucle qui ne s'arrête pas fait
    // échouer le test tout de suite, avec ce message, au lieu de le laisser tourner sans fin ; `chaque` est appelé
    // après chaque image
    jusqu_au_repos(pas = IMAGE, chaque?: () => void) {
      let k = 0
      while (file.size && k < IMAGES_MAX) { this.image(pas); k++; if (chaque) chaque() }
      assert.equal(file.size, 0, `la boucle d'élan ne s'arrête pas : encore une image en attente après ${IMAGES_MAX} images`)
      return k
    },
    // l'événement de défilement porte l'heure de l'horloge du banc : un geste est une suite d'événements à moins d'un quart de seconde
    defile(y: number) {
      haut = y
      const e = new window.Event('scroll')
      Object.defineProperty(e, 'timeStamp', { value: t })
      window.dispatchEvent(e)
    },
    // du temps passe sans image ni défilement : le défilement suivant est celui d'un nouveau geste
    pause(ms: number) { t += ms },
    // la fenêtre change de taille, à l'heure de l'horloge du banc
    redimensionne() {
      const e = new window.Event('resize')
      Object.defineProperty(e, 'timeStamp', { value: t })
      window.dispatchEvent(e)
    },
    // la boîte de la balise à l'écran : son haut (px), 40 px de haut ; la fenêtre fait 1 024 sur 768
    place(el: any, haut: number) { el.__boite = { top: haut, bottom: haut + 40, left: 100, right: 300, width: 200, height: 40 } },
    poser(reglages: Record<string, unknown>) {
      const el = doc.createElement('div')
      doc.body.appendChild(el)
      window.µ._mjs_fx(null, el, 'parallax', reglages)
      return el
    },
    pose: (el: any) => parseFloat(el.style.getPropertyValue(VAR)),
    brut: (el: any) => el.style.getPropertyValue(VAR)
  }
}

describe('*parallax(smooth) — le catalogue', () => {
  it('smooth : un décimal de 0.01 à 1, 1 par défaut (la balise est collée au défilement, comme avant)', () => {
    const r = EFFECTS.parallax.settings.smooth
    assert.equal(r.rule, 'float 0.01..1')
    assert.equal(r.dflt, 1)
    assert.deepEqual(Object.keys(EFFECTS.parallax.settings), ['speed', 'axis', 'origin', 'smooth'], 'les trois réglages d\'avant ne bougent pas, dans le même ordre')
    assert.equal(EFFECTS.parallax.main, 'speed')
  })
})

describe('*parallax(smooth) — sans élan, le tracé d\'avant', () => {
  afterEach(rendre)

  it('sans smooth, comme avec smooth: 1 : une image par défilement, la balise arrive d\'un coup, rien ne reste en attente', () => {
    for (const reglages of [{ origin: 'page' }, { origin: 'page', smooth: 1 }]) {
      const b  = banc()
      const el = b.poser(reglages)
      assert.equal(b.brut(el), '0.0px', 'posée sans décalage')
      b.defile(800)
      assert.equal(b.attente(), 1, 'une seule image demandée par défilement')
      b.defile(900)
      assert.equal(b.attente(), 1, 'le second défilement de l\'image n\'en demande pas une de plus')
      b.image()
      assert.equal(b.brut(el), '450.0px', 'la moitié du défilement, tout de suite')
      assert.equal(b.attente(), 0, 'aucune boucle : rien ne tourne au repos')
      assert.equal(el.style.getPropertyValue('will-change'), '', 'pas de will-change sans élan')
      assert.equal(b.ecoutes(), 0, 'aucune écoute de l\'onglet sans élan')
      b.window.close()
    }
  })

  it('sans élan, une seule écriture de la variable à la pose et une par image de défilement — celles d\'avant', () => {
    const b       = banc()
    const el      = b.window.document.createElement('div')
    const ecrit: string[] = []
    const poser   = el.style.setProperty.bind(el.style)
    el.style.setProperty = (k: string, v: string) => { if (k === VAR) ecrit.push(v); return poser(k, v) }
    b.window.document.body.appendChild(el)
    b.window.µ._mjs_fx(null, el, 'parallax', { origin: 'page' })
    assert.deepEqual(ecrit, ['0.0px'])
    b.defile(200)
    b.image()
    b.defile(200)
    b.image()
    assert.deepEqual(ecrit, ['0.0px', '100.0px', '100.0px'], 'une écriture par image de défilement, même valeur comprise')
    b.window.close()
  })

  it('sans élan, origin: page ne mesure aucune boîte : le tracé d\'avant', () => {
    const b = banc()
    b.poser({ origin: 'page' })
    let lectures = 0
    const lire = b.window.Element.prototype.getBoundingClientRect
    b.window.Element.prototype.getBoundingClientRect = function () { lectures++; return lire.call(this) }
    b.defile(300)
    b.image()
    assert.equal(lectures, 0, 'origin: page sans élan ne mesure rien')
    b.window.close()
  })
})

describe('*parallax(smooth) — l\'élan', () => {
  afterEach(rendre)

  it('smooth: 0.2 : chaque image rapproche la balise de 20 % de l\'écart, puis la boucle s\'arrête toute seule sur la cible', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.2 })
    b.defile(1000)
    const vus: number[] = []
    for (let k = 1; k <= 5; k++) {
      b.image()
      vus.push(b.pose(el))
      assert.equal(b.attente(), 1, `image ${k} : la boucle continue`)
    }
    // cible 500 : 500 × (1 − 0,8^k)
    const attendu = [1, 2, 3, 4, 5].map((k) => 500 * (1 - 0.8 ** k))
    vus.forEach((v, i) => assert.ok(Math.abs(v - attendu[i]) < 0.11, `image ${i + 1} : ${v} px, attendu ${attendu[i].toFixed(1)}`))
    assert.ok(vus.every((v, i) => i === 0 || v > vus[i - 1]) && vus[4] < 500, 'la balise monte vers la cible sans la dépasser')
    const images = b.jusqu_au_repos()
    assert.ok(images >= 30 && images <= 40, `la boucle s'arrête d'elle-même (${images} images de plus)`)
    assert.equal(b.brut(el), '500.0px', 'arrivée exactement sur la cible')
    assert.equal(b.attente(), 0, 'plus aucune image en attente')
    b.defile(1000)
    assert.equal(b.attente(), 1, 'un défilement relance la boucle')
    b.image()
    assert.equal(b.attente(), 0, 'cible inchangée : rien à rattraper, elle repart au repos aussitôt')
    b.window.close()
  })

  it('elle continue après l\'arrêt du défilement : la balise bouge encore sans qu\'aucun événement n\'arrive', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    b.defile(600)
    b.image()
    const avant = b.pose(el)
    assert.ok(avant > 0 && avant < 300, `avant : ${avant}`)
    b.image()
    b.image()
    const apres = b.pose(el)
    assert.ok(apres > avant && apres < 300, `après deux images sans défilement : ${apres} > ${avant}`)
    b.window.close()
  })

  it('le même élan à 60 images par seconde et à 144 : l\'écart fond au rythme du temps écoulé, pas du nombre d\'images', () => {
    // la première image après un repos compte pour une image à 60 par seconde (on ne sait pas encore la
    // cadence) ; ensuite l'écart se réduit de 0,8 par 1/60 s : sur 200 ms, de 0,8^12
    const ecart = (pas: number, images: number[]) => {
      const b  = banc()
      const el = b.poser({ origin: 'page', smooth: 0.2 })
      b.defile(1000)
      const vus: number[] = []
      for (let k = 1; k <= images[1]; k++) {
        b.image(pas)
        if (k === images[0] || k === images[1]) vus.push(500 - b.pose(el))
      }
      b.window.close()
      return vus[1] / vus[0]
    }
    const attendu = 0.8 ** 12
    const lent    = ecart(1000 / 60, [6, 18])
    const vite    = ecart(1000 / 144, [14, 43])
    assert.ok(Math.abs(lent - attendu) < 0.003, `60 par seconde : l'écart est multiplié par ${lent.toFixed(4)}, attendu ${attendu.toFixed(4)}`)
    assert.ok(Math.abs(vite - attendu) < 0.003, `144 par seconde : l'écart est multiplié par ${vite.toFixed(4)}, attendu ${attendu.toFixed(4)}`)
  })

  it('le défilement qui repart pendant le rattrapage déplace la cible : la balise la suit, dans les deux sens, sans à-coup', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.2 })
    b.defile(1000)
    for (let k = 0; k < 6; k++) b.image()
    const milieu = b.pose(el)
    assert.ok(milieu > 0 && milieu < 500)
    b.defile(0)
    const vus: number[] = []
    b.jusqu_au_repos(IMAGE, () => vus.push(b.pose(el)))
    assert.ok(vus.every((v, i) => i === 0 || v <= vus[i - 1]), 'la balise redescend sans rebond')
    assert.ok(vus.every((v) => v >= 0), 'sans dépasser la cible')
    assert.equal(b.brut(el), '0.0px')
    b.window.close()
  })

  it('un grand saut de temps (onglet repris) ne projette pas la balise : la part rattrapée est plafonnée', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.05 })
    b.defile(1000)
    b.image()
    const premiere = b.pose(el)
    b.image(5000)
    // 5 s d'attente comptées 100 ms au plus : 6 images à 60 par seconde
    const attendu = 500 * (1 - 0.95 ** 7)
    assert.ok(Math.abs(b.pose(el) - attendu) < 0.5, `${b.pose(el)} px au lieu de ${attendu.toFixed(1)}`)
    assert.ok(premiere > 0)
    b.window.close()
  })

  it('will-change: translate seulement pendant le mouvement, puis rendu tel que l\'auteur l\'avait écrit', () => {
    const b  = banc()
    const el = b.window.document.createElement('div')
    b.window.document.body.appendChild(el)
    el.style.setProperty('will-change', 'opacity')
    b.window.µ._mjs_fx(null, el, 'parallax', { origin: 'page', smooth: 0.3 })
    assert.equal(el.style.getPropertyValue('will-change'), 'opacity', 'à la pose, la valeur de l\'auteur')
    b.defile(400)
    b.image()
    assert.equal(el.style.getPropertyValue('will-change'), 'translate', 'pendant le mouvement')
    b.jusqu_au_repos()
    assert.equal(el.style.getPropertyValue('will-change'), 'opacity', 'au repos : celle de l\'auteur est revenue')
    b.window.close()
  })

  it('smooth hors des bornes est ramené : sous 0.01 → 0.01, au-dessus de 1 ou illisible → pas d\'élan', () => {
    const b  = banc()
    const a  = b.poser({ origin: 'page', smooth: 0.001 })
    const c  = b.poser({ origin: 'page', smooth: 7 })
    const d  = b.poser({ origin: 'page', smooth: 'beaucoup' })
    b.defile(1000)
    b.image()
    assert.ok(Math.abs(b.pose(a) - 5) < 0.11, `plancher 0.01 : 1 % de 500 = 5 px, vus ${b.pose(a)}`)
    assert.equal(b.brut(c), '500.0px', 'au-dessus de 1 : collée')
    assert.equal(b.brut(d), '500.0px', 'illisible : collée')
    assert.equal(b.attente(), 1, 'seule la balise à 0.01 attend une image de plus')
    b.window.close()
  })

  it('une cible qui n\'est pas un nombre n\'entretient pas la boucle', () => {
    const b = banc()
    b.poser({ origin: 'page', smooth: 0.5, speed: 'vite' })
    b.defile(300)
    b.image()
    assert.equal(b.attente(), 0, 'NaN compte comme atteinte : rien ne tourne')
    b.window.close()
  })

  it('avec élan, l\'onglet est écouté : une seule écoute, et sa boîte est lue une fois par geste de défilement — dans l\'événement, jamais dans une image', () => {
    const b = banc()
    b.poser({ origin: 'page', smooth: 0.3 })
    assert.equal(b.ecoutes(), 1)
    let lectures = 0
    let dansImage = 0
    let enImage = false
    const lire = b.window.Element.prototype.getBoundingClientRect
    b.window.Element.prototype.getBoundingClientRect = function () { lectures++; if (enImage) dansImage++; return lire.call(this) }
    const image = () => { enImage = true; b.image(); enImage = false }
    b.defile(300)
    assert.equal(lectures, 1, 'une lecture au début du geste, dans l\'événement')
    image()
    b.defile(340)
    image()
    assert.equal(lectures, 1, 'le défilement suivant du même geste ne relit rien : la place se déduit du défilement')
    while (b.attente()) { enImage = true; b.image(); enImage = false }
    assert.equal(lectures, 1, 'aucune pendant le rattrapage')
    b.pause(300)
    b.defile(400)
    assert.equal(lectures, 2, 'un nouveau geste (plus d\'un quart de seconde après) relit la boîte')
    image()
    assert.equal(dansImage, 0, 'aucune lecture dans les images d\'animation')
    b.window.close()
  })
})

describe('*parallax(smooth) — réduire les animations, onglet caché, hors de l\'écran', () => {
  afterEach(rendre)

  it('« réduire les animations » : pas d\'élan, la balise arrive d\'un coup', () => {
    const b  = banc({ calme: true })
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    b.defile(1000)
    b.image()
    assert.equal(b.brut(el), '500.0px')
    assert.equal(b.attente(), 0)
    b.window.close()
  })

  it('l\'onglet se cache pendant le rattrapage : l\'image attendue est annulée et la balise se pose sur sa cible', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    b.defile(1000)
    b.image()
    b.image()
    assert.equal(b.attente(), 1)
    assert.ok(b.pose(el) < 500)
    Object.defineProperty(b.window.document, 'hidden', { get: () => true, configurable: true })
    b.window.document.dispatchEvent(new b.window.Event('visibilitychange'))
    assert.equal(b.attente(), 0, 'plus d\'image en attente')
    assert.ok(b.annulees.length > 0, 'l\'image attendue a été annulée')
    assert.equal(b.brut(el), '500.0px', 'posée sur la cible')
    // caché, un défilement se pose d'un coup : aucune boucle
    b.defile(1200)
    b.image()
    assert.equal(b.brut(el), '600.0px')
    assert.equal(b.attente(), 0)
    // l'onglet revient : l'élan aussi
    Object.defineProperty(b.window.document, 'hidden', { get: () => false, configurable: true })
    b.window.document.dispatchEvent(new b.window.Event('visibilitychange'))
    b.defile(1400)
    b.image()
    assert.ok(b.pose(el) > 600 && b.pose(el) < 700, `l'élan est revenu : ${b.pose(el)}`)
    assert.equal(b.attente(), 1)
    b.window.close()
  })

  it('ni la balise ni sa cible ne se voient : elle se pose d\'un coup, sans boucle ; dès que sa cible est à l\'écran, l\'élan reprend', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    // à 3 000 px sous l'écran, et sa cible (500 px plus bas) aussi
    b.place(el, 3000)
    b.defile(1000)
    b.image()
    assert.equal(b.brut(el), '500.0px', 'd\'un coup')
    assert.equal(b.attente(), 0, 'aucune boucle pour une balise qu\'on ne voit pas')
    // la balise est maintenant à l'écran : le prochain geste de défilement la rattrape avec retard (la mise en page se relit au début d'un geste)
    b.place(el, 400)
    b.pause(300)
    b.defile(1200)
    b.image()
    assert.ok(b.pose(el) > 500 && b.pose(el) < 600, `l'élan repart (${b.pose(el)})`)
    assert.equal(b.attente(), 1)
    b.window.close()
  })

  it('emportée hors de l\'écran par son élan mais visée à l\'écran : elle revient en glissant, sans saut', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    // la balise est au-dessus de l'écran (haut à -400) ; sa cible, 500 px plus bas, est à l'écran
    b.place(el, -400)
    b.defile(1000)
    b.image()
    assert.ok(Math.abs(b.pose(el) - 50) < 0.11, `10 % de l'écart, pas la cible (${b.pose(el)})`)
    assert.equal(b.attente(), 1, 'la boucle continue')
    // elle ne se voit toujours pas, sa cible non plus : l'élan se pose d'un coup
    b.place(el, -3000)
    b.pause(300)
    b.defile(1100)
    b.image()
    assert.equal(b.brut(el), '550.0px')
    assert.equal(b.attente(), 0)
    b.window.close()
  })
})

describe('*parallax(smooth) — suivi par µ._mjs_fxSet, retrait', () => {
  afterEach(rendre)

  it('smooth change en direct sans reposer l\'effet ; 1 pose la balise d\'un coup ; speed, lui, repose l\'effet', () => {
    const b   = banc()
    const el  = b.poser({ origin: 'page', smooth: 0.1 })
    const off = el._mjs_fxOff.parallax
    b.defile(1000)
    b.image()
    assert.ok(b.pose(el) < 500 && b.attente() === 1)
    b.µ._mjs_fxSet(el, 'parallax', { smooth: 1 })
    assert.ok(el._mjs_fxOff.parallax === off, 'même effet : pas reposé')
    assert.equal(b.brut(el), '500.0px', 'la balise se pose d\'un coup')
    assert.equal(b.attente(), 0, 'et la boucle est arrêtée')
    // l'élan revient sans reposer, à la nouvelle part
    b.µ._mjs_fxSet(el, 'parallax', { smooth: 0.5 })
    assert.ok(el._mjs_fxOff.parallax === off)
    b.defile(1100)
    b.image()
    assert.ok(Math.abs(b.pose(el) - 525) < 0.11, `50 % de l'écart de 50 px : ${b.pose(el)}`)
    // un autre réglage reprend la pose
    b.µ._mjs_fxSet(el, 'parallax', { speed: 1 })
    assert.ok(el._mjs_fxOff.parallax !== off, 'speed : l\'effet est reposé')
    b.window.close()
  })

  it('retiré : ni variable, ni will-change, ni image en attente, ni écoute (un défilement ne l\'écrit plus)', () => {
    const b  = banc()
    const el = b.poser({ origin: 'page', smooth: 0.1 })
    b.defile(1000)
    b.image()
    assert.equal(b.attente(), 1)
    assert.equal(el.style.getPropertyValue('will-change'), 'translate')
    b.µ._mjs_fxClear(el)
    assert.equal(b.attente(), 0, 'l\'image attendue est annulée')
    assert.equal(el.style.getPropertyValue(VAR), '')
    assert.equal(el.style.getPropertyValue('will-change'), '')
    assert.equal(el.getAttribute('mjs-fx'), null)
    b.defile(2000)
    assert.equal(b.attente(), 0, 'plus d\'écoute : le défilement ne demande rien')
    assert.equal(el.style.getPropertyValue(VAR), '')
    assert.equal(b.ecoutes(), 0, 'l\'écoute de l\'onglet est retirée')
    b.window.close()
  })
})

describe('*parallax — la mise en page se relit quand elle change, même en plein geste', () => {
  afterEach(rendre)

  it('une fenêtre qui change de taille en plein geste fait relire la boîte de la balise', () => {
    const b  = banc()
    const el = b.window.document.createElement('div')
    b.window.document.body.appendChild(el)
    b.place(el, 364)
    b.window.µ._mjs_fx(null, el, 'parallax', {})
    b.defile(10)
    b.image()
    assert.equal(b.pose(el), 0, 'au milieu de la fenêtre (384 sur 768) : la balise est à sa place')
    // la boîte monte de 200 px (la fenêtre a changé de taille) dans le même geste : moins d'un quart de seconde depuis le défilement
    b.place(el, 164)
    b.redimensionne()
    b.image()
    assert.equal(b.pose(el), 100, 'la boîte est relue : (384 - (164 + 20)) * 0.5')
    b.window.close()
  })

  it('un conteneur devenu défilable après la pose est reconnu au défilement suivant, même quand c\'est la page qui défile', () => {
    const b         = banc()
    const doc       = b.window.document
    const conteneur = doc.createElement('div')
    const el        = doc.createElement('div')
    conteneur.style.overflowY = 'auto'
    conteneur.appendChild(el)
    doc.body.appendChild(conteneur)
    let contenu = 100
    let haut    = 0
    Object.defineProperty(conteneur, 'clientHeight', { get: () => 100, configurable: true })
    Object.defineProperty(conteneur, 'scrollHeight', { get: () => contenu, configurable: true })
    Object.defineProperty(conteneur, 'scrollTop', { get: () => haut, configurable: true })
    b.window.µ._mjs_fx(null, el, 'parallax', { origin: 'page' })
    b.defile(10)
    b.image()
    assert.equal(b.pose(el), 5, 'rien ne déborde : c\'est la page qui compte (10 * 0.5)')
    // le contenu grandit, le conteneur défile de 40 px : dans le même geste, la page défile à son tour
    contenu = 400
    haut    = 40
    b.defile(200)
    b.image()
    assert.equal(b.pose(el), 20, 'le conteneur, devenu défilable, compte à la place de la page (40 * 0.5, non 200 * 0.5)')
    b.window.close()
  })

  it('une balise sticky ou fixed ne suit pas le défilement en ligne droite : sa boîte est relue à chaque événement', () => {
    for (const position of ['sticky', 'fixed']) {
      const b  = banc()
      const el = b.window.document.createElement('div')
      el.style.position = position
      b.window.document.body.appendChild(el)
      b.place(el, 364)
      b.window.µ._mjs_fx(null, el, 'parallax', {})
      b.defile(10)
      b.image()
      assert.equal(b.pose(el), 0, position + ' : au milieu de la fenêtre')
      // le défilement ne la déplace pas à l'écran : sa boîte est toujours en 364, et c'est ce que l'effet doit lire
      b.defile(210)
      b.image()
      assert.equal(b.pose(el), 0, position + ' : sa boîte n\'a pas bougé, la balise non plus (prédite en ligne droite, elle aurait glissé de 100 px)')
      b.window.close()
    }
  })
})
