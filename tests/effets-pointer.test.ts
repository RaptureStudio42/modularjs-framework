// *pointer : le curseur de celui qui regarde — le calque et ses pièces selon le style, chaque réglage lu (variables sur
// le calque, filtre de la lentille), la boucle de lissage qui s'arrête d'elle-même (et compte le temps, pas les images),
// la balise survolée (grossissement, mot écrit par textContent, jamais interprété), l'appui, la sortie, le toucher
// ignoré, un écran sans souris, le suivi d'un réglage sans reposer l'effet, le retrait, <@document> et son refus ailleurs.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const LIEN = '<a class="a" href="#x" data-pointer="Voir">lien</a><p class="p">texte</p>'
const COMPOSANTS: Record<string, string> = {
  'fx-pt-base':      `<div class="z" *pointer>${LIEN}</div>`,
  'fx-pt-anneau':    `<div class="z" *pointer(ring)>${LIEN}</div>`,
  'fx-pt-point':     `<div class="z" *pointer(dot)>${LIEN}</div>`,
  'fx-pt-lentille':  `<div class="z" *pointer(lens)>${LIEN}</div>`,
  'fx-pt-sepia':     `<div class="z" *pointer(lens, filter: sepia)>${LIEN}</div>`,
  'fx-pt-regles':    `<div class="z" *pointer(lens, color: #f00, size: 160, blend: normal, filter: blur, grow: 3, smooth: 0.5, hide: true, text: false, press: 0.5, zindex: 99)>${LIEN}</div>`,
  'fx-pt-retrait':   `<script>\n$on = true\n</script>\n{if $on}<div class="z" *pointer(ring, hide: true)>${LIEN}</div>{end}\n<button class="t" @click={$on = !$on}>t</button>`,
  'fx-pt-variables': `<script>\n$grand = false\n$vif = false\n$cache = false\n$mot = true\n$inv = false\n$rond = false\n$teinte = false\n$mode = false\n$gros = false\n$serre = false\n$haut = false\n$taille = $grand ? 80 : 36\n$retard = $vif ? 1 : 0.5\n$filtre = $inv ? 'invert' : 'grayscale'\n$forme = $rond ? 'ring' : 'lens'\n$couleur = $teinte ? '#f00' : '#fff'\n$fusion = $mode ? 'normal' : 'difference'\n$croit = $gros ? 4 : 2.2\n$appui = $serre ? 0.5 : 0.8\n$etage = $haut ? 5 : 2147483000\n</script>\n<div class="z" *pointer(style: $forme, color: $couleur, size: $taille, blend: $fusion, filter: $filtre, grow: $croit, smooth: $retard, hide: $cache, text: $mot, press: $appui, zindex: $etage)>${LIEN}</div>\n<button class="b-grand" @click={$grand = !$grand}>g</button><button class="b-vif" @click={$vif = !$vif}>v</button><button class="b-cache" @click={$cache = !$cache}>c</button><button class="b-mot" @click={$mot = !$mot}>m</button><button class="b-inv" @click={$inv = !$inv}>i</button><button class="b-rond" @click={$rond = !$rond}>r</button><button class="b-teinte" @click={$teinte = !$teinte}>t</button><button class="b-mode" @click={$mode = !$mode}>d</button><button class="b-gros" @click={$gros = !$gros}>x</button><button class="b-serre" @click={$serre = !$serre}>p</button><button class="b-haut" @click={$haut = !$haut}>z</button>`,
  'fx-pt-page':      '<@document *pointer(ring, size: 48)></@document>\n<p class="p">page</p>',
  'fx-pt-dehors':    `<div class="z" *pointer(lens, outside: true, filter: blur, size: 100)>${LIEN}</div>`,
  'fx-pt-dehors-faux': `<div class="z" *pointer(lens, outside: false)>${LIEN}</div>`,
  'fx-pt-dehors-disque': `<div class="z" *pointer(disc, outside: true)>${LIEN}</div>`,
  'fx-pt-dehors-page': '<@document *pointer(lens, outside: true)></@document>\n<p class="p">page</p>',
  'fx-pt-dehors-var': `<script>\n$dehors = true\n$flou = false\n$filtre = $flou ? 'blur' : 'sepia'\n</script>\n<div class="z" *pointer(lens, outside: $dehors, filter: $filtre)>${LIEN}</div>\n<button class="b-dehors" @click={$dehors = !$dehors}>d</button><button class="b-flou" @click={$flou = !$flou}>f</button>`
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('effets — *pointer', function () {
  this.timeout(90000)
  let window: any
  // les images d'animation, à la main : une file que le test fait avancer (la boucle s'arrête quand elle est vide)
  let compteur = 0
  let horloge  = 0
  const file   = new Map<number, (t: number) => void>()

  before(async () => {
    const root   = mjsTmp('effets-pointer')
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
    window.requestAnimationFrame = (f: any) => {
      file.set(++compteur, f)
      return compteur
    }
    window.cancelAnimationFrame = (id: number) => { file.delete(id) }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // une image : tout ce qui attendait la prochaine image part, `dt` ms plus tard
  const image = (dt = 16.7) => {
    const fonctions = [...file.values()]
    file.clear()
    horloge += dt
    for (const f of fonctions) f(horloge)
  }
  // des images jusqu'à ce que plus rien n'attende (garde-fou : max) ; rend leur nombre
  const jusqu = (dt = 16.7, max = 400) => {
    let n = 0
    while (file.size > 0 && n < max) {
      image(dt)
      n++
    }
    return n
  }

  const evt = (type: string, x = 0, y = 0, pointerType = 'mouse', button = 0) => {
    const e = new window.PointerEvent(type, { clientX: x, clientY: y, button, bubbles: type !== 'pointerleave', composed: true })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    return e
  }
  const bouger = (cible: any, x: number, y: number, pointerType = 'mouse') => cible.dispatchEvent(evt('pointermove', x, y, pointerType))

  async function monter(tag: string, zone = '.z') {
    window.document.body.innerHTML = ''
    await pause()
    file.clear()
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(zone))
    await pause()
    return comp
  }

  const calques = () => [...window.document.body.querySelectorAll('[mjs-fx-pointer-layer]')]
  const calque  = () => calques()[0]
  const disque  = () => calque().querySelector('i')
  const mot     = () => calque().querySelector('b')
  const a       = (nom: string) => calque().hasAttribute('mjs-fx-pointer-' + nom)
  const marques = (el: any) => el.getAttributeNames().filter((n: string) => n.startsWith('mjs-fx'))

  it('un calque dans le document, un disque et le mot dedans ; le point en plus pour dot ; rien ne se voit avant la souris', async () => {
    const comp  = await monter('mjs-fx-pt-base')
    const el    = comp._shadow.querySelector('.z')
    assert.equal(calques().length, 1)
    const layer = calque()
    assert.ok(layer.parentNode === window.document.body, 'le calque est dans le document, pas dans la balise')
    assert.equal(layer.getAttribute('mjs-fx-pointer-layer'), 'disc')
    assert.equal(layer.getAttribute('aria-hidden'), 'true')
    assert.equal(layer.querySelectorAll('i').length, 1)
    assert.equal(layer.querySelectorAll('u').length, 0)
    assert.ok(disque().querySelector('b'), 'le mot est dans le disque')
    assert.equal(mot().textContent, '')
    assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes('pointer'))
    assert.ok(!a('on'), 'caché tant que la souris n\'est pas venue')
    assert.equal(disque().style.translate ?? '', '')
    assert.equal(calque().getAttribute('style'), null, 'aucun réglage écrit : aucune variable sur le calque')

    await monter('mjs-fx-pt-anneau')
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'ring')
    await monter('mjs-fx-pt-point')
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'dot')
    assert.equal(calque().querySelectorAll('u').length, 1, 'dot : un point et son anneau')
    assert.equal(calque().querySelectorAll('i').length, 1)
  })

  it('chaque réglage est lu : variables sur le calque (la balise n\'est pas son parent), filtre de la lentille', async () => {
    const comp = await monter('mjs-fx-pt-regles')
    const el   = comp._shadow.querySelector('.z')
    const v    = (n: string) => calque().style.getPropertyValue('--mjs-pointer-' + n)
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'lens')
    assert.equal(v('color'), '#f00')
    assert.equal(v('size'), '160px')
    assert.equal(v('blend'), 'normal')
    assert.equal(v('grow'), '3')
    assert.equal(v('press'), '0.5')
    assert.equal(v('zindex'), '99')
    assert.equal(calque().style.getPropertyValue('--mjs-fx-pointer-bf'), 'blur(6px)')
    assert.ok(el.hasAttribute('mjs-fx-pointer-hide'), 'hide : la balise le dit à la feuille')
    await monter('mjs-fx-pt-lentille')
    assert.equal(calque().style.getPropertyValue('--mjs-fx-pointer-bf'), 'grayscale(1)', 'la lentille défait les couleurs par défaut')
    await monter('mjs-fx-pt-sepia')
    assert.equal(calque().style.getPropertyValue('--mjs-fx-pointer-bf'), 'sepia(1)')
    await monter('mjs-fx-pt-base')
    assert.equal(calque().style.getPropertyValue('--mjs-fx-pointer-bf'), '', 'un disque ne porte aucun filtre')
  })

  it('la première position : le disque apparaît sous la souris ; ensuite une seule boucle, qui s\'arrête à moins de 0,1 px', async () => {
    const comp = await monter('mjs-fx-pt-base')
    const el   = comp._shadow.querySelector('.z')
    bouger(el, 100, 100)
    assert.ok(a('on'), 'visible')
    assert.equal(disque().style.translate, '100.0px 100.0px', 'sans voyage')
    jusqu()
    assert.equal(file.size, 0, 'arrivé : plus aucune image demandée')
    assert.ok(!a('live'), 'et la couche se rend')
    // un déplacement : la boucle repart, le disque est en retard, puis il rejoint la souris et tout s'arrête
    bouger(el, 300, 100)
    assert.equal(file.size, 1, 'une seule image demandée, même après dix mouvements')
    for (let i = 0; i < 9; i++) bouger(el, 300, 100)
    assert.equal(file.size, 1)
    assert.ok(a('live'), 'la couche seulement pendant le mouvement')
    image()
    const x = parseFloat(disque().style.translate)
    assert.ok(x > 100 && x < 300, 'en route : ' + x)
    const n = jusqu()
    assert.ok(n > 15 && n < 80, 'images pour arriver : ' + n)
    assert.equal(disque().style.translate, '300.0px 100.0px', 'posé sur la souris')
    assert.equal(file.size, 0)
    assert.ok(!a('live'))
  })

  it('le retard se compte en temps : un écran à 30 images par seconde arrive en deux fois moins d\'images', async () => {
    const comp = await monter('mjs-fx-pt-base')
    const el   = comp._shadow.querySelector('.z')
    const trajet = (dt: number) => {
      bouger(el, 0, 0)
      jusqu(dt)
      bouger(el, 400, 0)
      return jusqu(dt)
    }
    const n60 = trajet(16.7)
    const n30 = trajet(33.4)
    assert.ok(n30 < n60, `${n30} images à 30 Hz, ${n60} à 60 Hz`)
    assert.ok(Math.abs(n60 / 2 - n30) <= 3, `${n30} images à 30 Hz pour ${n60} à 60 Hz`)
  })

  it('ce qui se clique : le disque grossit, la balise à data-pointer donne son mot par textContent ; un texte simple, rien', async () => {
    const comp = await monter('mjs-fx-pt-base')
    const el   = comp._shadow.querySelector('.z')
    const lien = el.querySelector('.a')
    bouger(lien, 50, 50)
    image()
    assert.ok(a('hot'), 'sur un lien')
    assert.ok(a('word'))
    assert.equal(mot().textContent, 'Voir')
    bouger(el.querySelector('.p'), 60, 60)
    image()
    assert.ok(!a('hot'))
    assert.ok(!a('word'))
    assert.equal(mot().textContent, '')
    // le mot n'est jamais du HTML
    lien.setAttribute('data-pointer', '<img src=x onerror=alert(1)>')
    bouger(lien, 52, 50)
    image()
    assert.equal(mot().textContent, '<img src=x onerror=alert(1)>')
    assert.equal(mot().querySelectorAll('*').length, 0, 'aucun élément né du mot')
    // un data-pointer vide : il grossit, sans mot
    lien.setAttribute('data-pointer', '')
    bouger(lien, 54, 50)
    image()
    assert.ok(a('hot'))
    assert.ok(!a('word'))
    // les champs, boutons, étiquettes et rôles de bouton grossissent aussi
    for (const [balise, hot] of [['input', true], ['button', true], ['label', true], ['select', true], ['textarea', true], ['summary', true], ['div role="button"', true], ['a', false], ['span', false]] as Array<[string, boolean]>) {
      const nom = balise.split(' ')[0]
      el.insertAdjacentHTML('beforeend', `<${balise} class="x">x</${nom}>`)
      const n = el.querySelector('.x')
      bouger(el.querySelector('.p'), 1, 1)
      image()
      bouger(n, 70, 70)
      image()
      assert.equal(a('hot'), hot, `<${balise}>`)
      n.remove()
    }
  })

  it('text: false : il grossit, sans mot ; grow, size, press : valeurs sur le calque', async () => {
    const comp = await monter('mjs-fx-pt-regles')
    const el   = comp._shadow.querySelector('.z')
    bouger(el.querySelector('.a'), 40, 40)
    image()
    assert.ok(a('hot'))
    assert.ok(!a('word'), 'text: false')
    assert.equal(mot().textContent, '')
  })

  it('l\'appui, puis le relâchement ou l\'annulation ; la souris sort : le disque s\'efface et tout revient au repos', async () => {
    const comp = await monter('mjs-fx-pt-base')
    const el   = comp._shadow.querySelector('.z')
    bouger(el.querySelector('.a'), 50, 50)
    image()
    el.dispatchEvent(evt('pointerdown', 50, 50))
    assert.ok(a('down'))
    el.dispatchEvent(evt('pointerup', 50, 50))
    assert.ok(!a('down'))
    el.dispatchEvent(evt('pointerdown', 50, 50))
    el.dispatchEvent(evt('pointercancel', 50, 50))
    assert.ok(!a('down'), 'annulé')
    el.dispatchEvent(evt('pointerdown', 50, 50))
    window.dispatchEvent(new window.Event('blur'))
    assert.ok(!a('down'), 'la fenêtre perd le focus : plus d\'appui')
    el.dispatchEvent(evt('pointerdown', 50, 50, 'touch'))
    assert.ok(!a('down'), 'un doigt n\'appuie pas le disque')
    el.dispatchEvent(evt('pointerdown', 50, 50, 'mouse', 2))
    assert.ok(!a('down'), 'un clic droit n\'appuie pas le disque')
    // une image en attente quand la souris sort : annulée
    el.dispatchEvent(evt('pointerdown', 50, 50))
    bouger(el, 300, 300)
    assert.equal(file.size, 1)
    el.dispatchEvent(evt('pointerleave', 300, 300))
    assert.equal(file.size, 0, 'la boucle est annulée')
    assert.ok(!a('on'))
    assert.ok(!a('hot'))
    assert.ok(!a('word'))
    assert.ok(!a('down'))
    assert.ok(!a('live'))
    assert.equal(mot().textContent, '')
    // le retour : sous la souris, sans voyage depuis l'ancienne place
    bouger(el, 20, 30)
    assert.ok(a('on'))
    assert.equal(disque().style.translate, '20.0px 30.0px')
  })

  it('un doigt ne mène pas le disque', async () => {
    const comp = await monter('mjs-fx-pt-base')
    const el   = comp._shadow.querySelector('.z')
    bouger(el, 10, 10, 'touch')
    assert.ok(!a('on'))
    assert.equal(file.size, 0)
    bouger(el, 10, 10, 'pen')
    assert.ok(a('on'), 'un stylet survole comme une souris')
  })

  it('un écran sans souris (hover: none) : rien n\'est posé, rien n\'écoute', async () => {
    const avant = window.matchMedia
    window.matchMedia = (q: string) => ({ matches: /hover:\s*none/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      const comp = await monter('mjs-fx-pt-base')
      const el   = comp._shadow.querySelector('.z')
      assert.equal(calques().length, 0, 'aucun calque')
      bouger(el, 100, 100)
      assert.equal(calques().length, 0)
      assert.equal(file.size, 0, 'aucune image demandée')
    }
    finally {
      window.matchMedia = avant
    }
  })

  it('un réglage tenu par une variable se suit sur place : filtre, taille, retard, hide, text ; le style repose l\'effet', async () => {
    const comp  = await monter('mjs-fx-pt-variables')
    const el    = comp._shadow.querySelector('.z')
    const layer = calque()
    const bouton = async (nom: string) => {
      comp._shadow.querySelector('.b-' + nom).click()
      await pause()
    }
    assert.equal(layer.style.getPropertyValue('--mjs-fx-pointer-bf'), 'grayscale(1)')
    assert.equal(layer.style.getPropertyValue('--mjs-pointer-size'), '36px')
    await bouton('inv')
    assert.ok(calque() === layer, 'le même calque : rien n\'a été reposé')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-pointer-bf'), 'invert(1)')
    await bouton('grand')
    assert.ok(calque() === layer)
    assert.equal(layer.style.getPropertyValue('--mjs-pointer-size'), '80px')
    // les autres réglages visuels : leur variable sur le calque suit, le calque reste le même
    const v = (n: string) => layer.style.getPropertyValue('--mjs-pointer-' + n)
    assert.deepEqual([v('color'), v('blend'), v('grow'), v('press'), v('zindex')], ['#fff', 'difference', '2.2', '0.8', '2147483000'])
    for (const [nom, cle, valeur] of [['teinte', 'color', '#f00'], ['mode', 'blend', 'normal'], ['gros', 'grow', '4'], ['serre', 'press', '0.5'], ['haut', 'zindex', '5']]) {
      await bouton(nom)
      assert.ok(calque() === layer, nom + ' : le même calque')
      assert.equal(v(cle), valeur, nom)
      await bouton(nom)
      assert.equal(v(cle), { color: '#fff', blend: 'difference', grow: '2.2', press: '0.8', zindex: '2147483000' }[cle as 'color'], nom + ' rendu')
    }
    // le retard : 0,5 puis 1 (collé à la souris) — la boucle arrive en une image
    bouger(el, 0, 0)
    jusqu()
    bouger(el, 200, 0)
    const lent = jusqu()
    assert.ok(lent > 3, 'retard 0,5 : ' + lent + ' images')
    await bouton('vif')
    assert.ok(calque() === layer)
    bouger(el, 0, 0)
    const vif = jusqu()
    assert.equal(vif, 1, 'collé à la souris : une image')
    assert.equal(disque().style.translate, '0.0px 0.0px')
    // hide : la marque sur la balise va et vient sans reposer l'effet
    assert.ok(!el.hasAttribute('mjs-fx-pointer-hide'))
    await bouton('cache')
    assert.ok(el.hasAttribute('mjs-fx-pointer-hide'))
    assert.ok(calque() === layer)
    await bouton('cache')
    assert.ok(!el.hasAttribute('mjs-fx-pointer-hide'))
    // text : sans mot
    bouger(el.querySelector('.a'), 5, 5)
    image()
    assert.ok(a('word'))
    await bouton('mot')
    assert.ok(!a('word'), 'text: false efface le mot montré')
    assert.ok(calque() === layer)
    bouger(el.querySelector('.p'), 6, 6)
    image()
    bouger(el.querySelector('.a'), 7, 7)
    image()
    assert.ok(a('hot') && !a('word'))
    // le style change la forme du calque : l'effet repart avec un calque neuf, jamais deux
    await bouton('rond')
    await attendre(() => calque() && calque() !== layer)
    assert.equal(calques().length, 1, 'un seul calque')
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'ring')
    assert.ok(!layer.isConnected, 'l\'ancien est parti')
  })

  it('le retrait : plus de calque, plus de marque, plus d\'écouteur, plus d\'image', async () => {
    const comp  = await monter('mjs-fx-pt-retrait')
    const el    = comp._shadow.querySelector('.z')
    assert.equal(calques().length, 1)
    assert.ok(marques(el).includes('mjs-fx-pointer-hide'))
    bouger(el, 40, 40)
    image()
    assert.ok(a('on'))
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.z'))
    await pause()
    assert.equal(calques().length, 0, 'le calque est parti')
    assert.deepEqual(marques(el), [], 'aucune marque sur la balise retirée')
    assert.equal(el.getAttribute('style') ?? '', '')
    file.clear()
    bouger(el, 90, 90)
    el.dispatchEvent(evt('pointerdown', 90, 90))
    assert.equal(file.size, 0, 'la balise retirée n\'écoute plus la souris')
    assert.equal(calques().length, 0)
    // remise : un calque neuf, une seule fois
    comp._shadow.querySelector('.t').click()
    await attendre(() => !!comp._shadow.querySelector('.z'))
    await pause()
    assert.equal(calques().length, 1)
  })

  it('<@document> : posé sur la page entière, retiré avec le composant ; la liste des effets de page cite *pointer', async () => {
    const comp = await monter('mjs-fx-pt-page', '.p')
    const doc  = window.document
    await attendre(() => calques().length === 1)
    assert.equal(calques().length, 1)
    assert.ok((doc.documentElement.getAttribute('mjs-fx') ?? '').split(' ').includes('pointer'))
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'ring')
    assert.equal(calque().style.getPropertyValue('--mjs-pointer-size'), '48px')
    doc.documentElement.dispatchEvent(evt('pointermove', 30, 40))
    assert.ok(a('on'))
    assert.equal(disque().style.translate, '30.0px 40.0px')
    comp.remove()
    await attendre(() => calques().length === 0)
    assert.equal(calques().length, 0)
    assert.deepEqual(marques(doc.documentElement), [], 'la page ne garde aucune marque')
  })

  // le filtre inverse : le voile (un calque percé d'un trou) est un enfant de la balise, jamais du calque du disque
  const voiles = (racine: any) => [...racine.querySelectorAll('[mjs-fx-layer="pointer"]')]
  const marque = (n: any, nom: string) => n.hasAttribute('mjs-fx-pointer-' + nom)
  const vx     = (v: any) => parseFloat(v.style.getPropertyValue('--mjs-fx-pointer-x'))

  it('outside : un voile dans la balise, caché avant la souris, le trou posé sur le disque à chaque image ; le calque en porte la marque', async () => {
    const comp  = await monter('mjs-fx-pt-dehors')
    const el    = comp._shadow.querySelector('.z')
    const [v]   = voiles(comp._shadow)
    assert.equal(voiles(comp._shadow).length, 1, 'un voile')
    assert.ok(v.parentNode === el, 'dans la balise')
    assert.ok(!calque().contains(v), 'jamais dans le calque du disque')
    assert.equal(v.getAttribute('aria-hidden'), 'true')
    assert.ok(a('out'), 'le calque porte la marque : son disque ne filtre plus, il est le trou')
    assert.ok(!marque(v, 'on'), 'caché tant que la souris n\'est pas venue')
    assert.ok(!marque(v, 'doc'))
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-bf'), 'blur(6px)', 'le filtre est sur le voile')
    // la souris : le voile s'allume, le trou est sous la souris, sans voyage
    bouger(el, 100, 100)
    assert.ok(marque(v, 'on'))
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-x'), '100.0px')
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-y'), '100.0px')
    jusqu()
    // un déplacement : le trou suit le disque, image après image, avec le même retard
    bouger(el, 300, 100)
    assert.equal(file.size, 1, 'une seule boucle, celle du disque')
    for (let i = 0; i < 6; i++) {
      image()
      assert.equal(vx(v), parseFloat(disque().style.translate), 'le trou est sous le disque, image ' + i)
    }
    assert.ok(vx(v) > 100 && vx(v) < 300, 'en route : ' + vx(v))
    jusqu()
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-x'), '300.0px')
    assert.equal(file.size, 0, 'arrivé : plus rien ne tourne')
    // le disque ne filtre plus : c'est le voile qui filtre, tout autour
    assert.equal(calque().getAttribute('mjs-fx-pointer-layer'), 'lens')
    // sur ce qui se clique, à l'appui : le voile le sait (le trou grossit, se resserre)
    bouger(el.querySelector('.a'), 50, 50)
    image()
    assert.ok(marque(v, 'hot') && a('hot'))
    el.dispatchEvent(evt('pointerdown', 50, 50))
    assert.ok(marque(v, 'down') && a('down'))
    el.dispatchEvent(evt('pointerup', 50, 50))
    assert.ok(!marque(v, 'down'))
    // la souris sort : le voile s'éteint
    el.dispatchEvent(evt('pointerleave', 50, 50))
    assert.ok(!marque(v, 'on') && !marque(v, 'hot') && !marque(v, 'down'))
    assert.ok(!a('on'))
  })

  it('sans outside rien ne change : ni voile ni marque (absent, faux, ou un style qui l\'ignore)', async () => {
    for (const tag of ['mjs-fx-pt-lentille', 'mjs-fx-pt-dehors-faux', 'mjs-fx-pt-dehors-disque']) {
      const comp = await monter(tag)
      assert.equal(voiles(comp._shadow).length + voiles(window.document).length, 0, tag + ' : aucun voile')
      assert.ok(!a('out'), tag + ' : le calque n\'est pas marqué')
      assert.equal(calque().children.length, 1, tag + ' : le calque garde son seul disque')
      bouger(comp._shadow.querySelector('.z'), 40, 40)
      assert.equal(voiles(comp._shadow).length, 0, tag + ' : toujours aucun voile')
    }
  })

  it('<@document> et outside : le voile est un calque fixe du document, retiré avec la page', async () => {
    const comp = await monter('mjs-fx-pt-dehors-page', '.p')
    const doc  = window.document
    await attendre(() => voiles(doc).length === 1)
    const [v] = voiles(doc)
    assert.equal(voiles(doc).length, 1)
    assert.ok(v.parentNode === doc.body, 'dans le document')
    assert.ok(marque(v, 'doc'), 'fixe, sur la fenêtre')
    assert.ok(a('out'))
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-bf'), 'grayscale(1)', 'le filtre par défaut')
    doc.documentElement.dispatchEvent(evt('pointermove', 30, 40))
    assert.ok(marque(v, 'on'))
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-x'), '30.0px')
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-y'), '40.0px')
    comp.remove()
    await attendre(() => voiles(doc).length === 0)
    assert.equal(voiles(doc).length, 0, 'plus de voile')
    assert.equal(calques().length, 0)
  })

  it('outside et filter tenus par des variables : le filtre suit sur place, outside pose et défait le voile, une seule fois', async () => {
    const comp  = await monter('mjs-fx-pt-dehors-var')
    const el    = comp._shadow.querySelector('.z')
    const layer = calque()
    const [v]   = voiles(comp._shadow)
    const bouton = async (nom: string) => {
      comp._shadow.querySelector('.b-' + nom).click()
      await pause()
    }
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-bf'), 'sepia(1)')
    await bouton('flou')
    assert.ok(calque() === layer && voiles(comp._shadow)[0] === v, 'le filtre se suit sur place : ni calque ni voile reposés')
    assert.equal(v.style.getPropertyValue('--mjs-fx-pointer-bf'), 'blur(6px)')
    assert.equal(layer.style.getPropertyValue('--mjs-fx-pointer-bf'), 'blur(6px)')
    // outside faux : l'effet repart sans voile, rien ne reste
    await bouton('dehors')
    await attendre(() => calque() && calque() !== layer)
    assert.equal(calques().length, 1, 'un seul calque')
    assert.ok(!layer.isConnected, 'l\'ancien est parti')
    assert.equal(voiles(comp._shadow).length, 0, 'plus de voile')
    assert.ok(!v.isConnected)
    assert.ok(!a('out'))
    bouger(el, 20, 20)
    assert.equal(voiles(comp._shadow).length, 0)
    // vrai de nouveau : un voile neuf, un seul
    await bouton('dehors')
    await attendre(() => voiles(comp._shadow).length === 1)
    assert.equal(voiles(comp._shadow).length, 1)
    assert.equal(calques().length, 1)
    assert.ok(a('out'))
    // le retrait de la balise emporte tout
    comp.remove()
    await attendre(() => calques().length === 0)
    assert.equal(calques().length, 0)
    assert.equal(voiles(window.document).length, 0)
  })
})

describe('effets — *pointer : compilation', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  async function construire(nom: string, fichiers: Record<string, string>) {
    const root   = mjsTmp(nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    return stats
  }

  it('refusé : un style, un filtre, un mode de fusion ou un nombre hors règle ; sur <@document>, une variable', async () => {
    const cas: Array<[string, RegExp]> = [
      ['<div *pointer(square)>x</div>', /\*pointer \(ligne 1\) : style = square/],
      ['<div *pointer(lens, filter: sharpen)>x</div>', /\*pointer \(ligne 1\) : filter = sharpen/],
      ['<div *pointer(blend: dodge)>x</div>', /\*pointer \(ligne 1\) : blend = dodge/],
      ['<div *pointer(size: 3)>x</div>', /\*pointer \(ligne 1\) : size = 3/],
      ['<div *pointer(smooth: 0)>x</div>', /\*pointer \(ligne 1\) : smooth = 0/],
      ['<div *pointer(lens, outside: 3)>x</div>', /\*pointer \(ligne 1\) : outside = 3/],
      ['<script>\n$s = "ring"\n</script>\n<@document *pointer($s)></@document>', /\*pointer sur <@document> : une valeur fixe/],
      ['<@document *neon></@document>', /\*neon ne se pose pas sur <@document>[\s\S]*\*pointer/]
    ]
    for (const [src, attendu] of cas) {
      const stats = await construire('effets-pointer-refus', { 'fx-refus.mjs': src + '\n<p>x</p>' })
      assert.match(stats.errors.map((e: any) => e.message).join('\n'), attendu, src)
    }
  })

  it('accepté : toutes les écritures, avec le style sans nom, sur une balise, un composant ou <@document>', async () => {
    const stats = await construire('effets-pointer-ecritures', {
      'fx-ok-dehors.mjs':  '<section *pointer(lens, outside: true, filter: blur, size: 160)>x</section>',
      'fx-ok-balise.mjs':  '<section *pointer(lens, filter: grayscale, size: 160)>x</section><a data-pointer="Voir" href="/projet" *pointer(dot, blend: exclusion, grow: 4, hide: true)>y</a>',
      'fx-ok-carte.mjs':   '<p>c</p>',
      'fx-ok-compose.mjs': '<@fx-ok-carte *pointer(ring, color: #f0f, press: 1.5, smooth: 1, text: false, zindex: 10)></@fx-ok-carte>',
      'fx-ok-page.mjs':    '<@document *pointer(disc, size: 600, blend: screen)></@document><p>page</p>'
    })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })
})
