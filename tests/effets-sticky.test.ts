// *sticky — une barre qui se fige en haut de l'écran après un seuil de défilement : la marque et les
// variables de chaque réglage, le seuil suivi par un observateur d'intersection (sa marge porte
// offset, top et la hauteur), le tenant-lieu et l'état figé (jeton dans mjs-fx-on), l'écoute du
// défilement seulement pendant que la barre est figée et que `hide` la demande, le sens du défilement
// (un va-et-vient de moins de 8 px ne compte pas), le clavier qui ramène la barre cachée, les réglages
// suivis sur place, les refus de compilation, le retrait. Les observateurs sont des bouchons : la
// mise en page se vérifie dans les navigateurs réels (effets-sticky-browser.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-fige':         '<header class="a" *sticky>texte</header>',
  'fx-fige-regles':  '<header class="a" *sticky(500, hide: true, top: 12, duration: 250ms, easing: ease-out, zindex: 50)>texte</header>',
  'fx-fige-cache':   '<header class="a" *sticky(hide: true)><a class="l" href="#un">lien</a></header>',
  'fx-fige-vars':    '<script>\n$decalage = 300\n$marge = 0\n$cache = false\n$duree = \'400ms\'\n$courbe = \'ease\'\n$z = 1000\n</script>\n<header class="a" *sticky($decalage, top: $marge, hide: $cache, duration: $duree, easing: $courbe, zindex: $z)><a class="l" href="#un">lien</a></header>\n<button class="b1" @click={$decalage = 700}>1</button>\n<button class="b2" @click={$marge = 20}>2</button>\n<button class="b3" @click={$cache = true}>3</button>\n<button class="b4" @click={$cache = false}>4</button>\n<button class="b5" @click={$duree = \'1s\'; $courbe = \'linear\'; $z = 5}>5</button>',
  'fx-fige-retrait': '<script>\n$on = true\n</script>\n{if $on}<header class="a" *sticky(hide: true)>texte</header>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

// ce que l'observateur d'intersection rend à la barre : sa base est passée sous le bord haut (sortie par le
// haut), ou elle y est encore (visible), ou elle n'est pas encore arrivée (sous le bord bas)
const SORTIE  = { isIntersecting: false, boundingClientRect: { bottom: -5 }, rootBounds: { top: 0 } }
const VISIBLE = { isIntersecting: true, boundingClientRect: { bottom: 40 }, rootBounds: { top: 0 } }
const EN_BAS  = { isIntersecting: false, boundingClientRect: { bottom: 900 }, rootBounds: { top: 0 } }

describe('effets — *sticky', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` ; ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-sticky')
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
    garder(window.Element.prototype, ['getBoundingClientRect'])
    // une boîte de 800 × 64, au-dessus de l'écran (le bas à -236) : happy-dom ne mesure rien
    window.Element.prototype.getBoundingClientRect = function () { return { top: -300, bottom: -236, left: 8, right: 808, width: 800, height: 64, x: 8, y: -300, toJSON() {} } }
    window.eval(`${code}\nglobalThis.µ = µ;`)
    // des observateurs de bouchon qui gardent leurs cibles, leurs options et leur rappel ; le défilement de la page et ses écouteurs comptés
    window.eval(`
      globalThis.__obs = { io: [], ro: [] };
      var Faux = function(liste) {
        return class {
          constructor(cb, opts) { this.cb = cb; this.opts = opts || {}; this.cibles = []; this.fini = false; liste.push(this); }
          observe(t) { this.cibles.push(t); }
          unobserve(t) { this.cibles = this.cibles.filter(function(x) { return x !== t; }); }
          disconnect() { this.cibles = []; this.fini = true; }
        };
      };
      globalThis.IntersectionObserver = Faux(globalThis.__obs.io);
      globalThis.ResizeObserver = Faux(globalThis.__obs.ro);
      globalThis.__y = 0;
      Object.defineProperty(window, 'scrollY', { get: function() { return globalThis.__y; }, configurable: true });
      globalThis.__defile = 0;
    `)
    // les écouteurs de défilement, posés moins retirés, sur tout ce qui écoute (la fenêtre, le document, les ombres) : la classe qui
    // porte addEventListener se cherche dans la chaîne de prototypes du document (happy-dom retire lui-même par removeEventListener
    // l'écouteur dont le signal d'annulation est tombé)
    let base: any = window.document
    while (base && !Object.prototype.hasOwnProperty.call(base, 'addEventListener')) base = Object.getPrototypeOf(base)
    garder(base, ['addEventListener', 'removeEventListener'])
    const ajoute = base.addEventListener
    const retire = base.removeEventListener
    base.addEventListener = function (this: any, t: string, f: any, o: any) {
      if (t === 'scroll') window.__defile++
      return ajoute.call(this, t, f, o)
    }
    base.removeEventListener = function (this: any, t: string, f: any, o: any) {
      if (t === 'scroll') window.__defile--
      return retire.call(this, t, f, o)
    }
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const obs = () => window.__obs
  const vivants = (liste: any[]) => liste.filter((o) => !o.fini)

  async function monter(tag: string) {
    obs().io.length = 0
    obs().ro.length = 0
    window.__y = 0
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp
  }

  // la balise est mesurée (le rappel de l'observateur de taille), puis le dernier observateur d'intersection vivant
  function mesurer() {
    const ro = vivants(obs().ro)[0]
    ro.cb([])
    return vivants(obs().io)[0]
  }

  const jeton = (el: any) => (el.getAttribute('mjs-fx-on') || '').split(' ').includes('sticky')
  const sieges = (el: any) => Array.from(el.parentNode.querySelectorAll('[mjs-fx-seat]')) as any[]

  it('la marque, aucune variable sans réglage, un observateur de taille sur la balise ; l\'observateur du seuil attend la première mesure', async () => {
    const comp = await monter('mjs-fx-fige')
    const el   = comp._shadow.querySelector('.a')
    assert.ok((el.getAttribute('mjs-fx') || '').split(' ').includes('sticky'))
    assert.ok(!/--mjs-/.test(el.getAttribute('style') || ''), 'aucune variable posée sans réglage écrit')
    assert.equal(jeton(el), false, 'pas figée au repos')
    assert.equal(vivants(obs().ro).length, 1)
    assert.ok(vivants(obs().ro)[0].cibles[0] === el)
    assert.equal(vivants(obs().io).length, 0, 'la hauteur n\'est pas connue avant la mesure')
  })

  it('le seuil : un observateur sur la balise, sans racine, marge = offset - top - hauteur (0, 0, 64)', async () => {
    const comp = await monter('mjs-fx-fige')
    const el   = comp._shadow.querySelector('.a')
    const io   = mesurer()
    assert.ok(io, 'l\'observateur du seuil est posé à la première mesure')
    assert.equal(io.opts.rootMargin, '-64px 0px 0px 0px')
    assert.equal(io.opts.threshold, 0)
    assert.equal(io.opts.root, null, 'la page : pas de conteneur')
    assert.ok(io.cibles[0] === el)
  })

  it('chaque réglage est lu : variables sur la balise, marge du seuil (500, top 12, hauteur 64)', async () => {
    const comp = await monter('mjs-fx-fige-regles')
    const el   = comp._shadow.querySelector('.a')
    const st   = el.style
    assert.equal(st.getPropertyValue('--mjs-sticky-top'), '12px')
    assert.equal(st.getPropertyValue('--mjs-sticky-duration'), '250ms')
    assert.equal(st.getPropertyValue('--mjs-sticky-easing'), 'ease-out')
    assert.equal(st.getPropertyValue('--mjs-sticky-zindex'), '50')
    assert.equal(mesurer().opts.rootMargin, '424px 0px 0px 0px')
  })

  it('sortie par le haut : la balise se fige — tenant-lieu à sa taille, jeton dans mjs-fx-on, place posée, glissement depuis le haut ; revenue : tout est rendu', async () => {
    const comp = await monter('mjs-fx-fige')
    const el   = comp._shadow.querySelector('.a')
    const io   = mesurer()
    io.cb([SORTIE])
    assert.equal(jeton(el), true, 'figée : le jeton sticky')
    const s = sieges(el)
    assert.equal(s.length, 1, 'un tenant-lieu')
    assert.ok(el.nextSibling === s[0], 'juste après la balise, qui garde son rang parmi ses frères')
    assert.equal(s[0].getAttribute('aria-hidden'), 'true')
    assert.equal(s[0].style.height, '64px')
    assert.equal(el.style.getPropertyValue('--mjs-fx-sticky-x'), '8px')
    assert.equal(el.style.getPropertyValue('--mjs-fx-sticky-w'), '800px')
    // la balise était à 300 px au-dessus de la ligne du haut : elle revient d'une hauteur plus haut, pas de plus loin
    assert.equal(el.style.getPropertyValue('--mjs-fx-sticky-from'), '-64px')
    assert.equal(el.hasAttribute('mjs-fx-sticky-box'), false, 'la page : pas de découpe de conteneur')
    assert.ok(io.cibles[0] === s[0], 'le seuil est suivi sur le tenant-lieu')
    assert.ok(vivants(obs().ro)[0].cibles[0] === comp, 'la taille est suivie sur le conteneur, d\'où vient la largeur de la balise')
    assert.equal(el.hasAttribute('mjs-fx-sticky-pin'), true, 'la balise est fixée')
    io.cb([VISIBLE])
    assert.equal(jeton(el), false)
    assert.equal(sieges(el).length, 0, 'le tenant-lieu est parti')
    assert.equal(el.getAttribute('mjs-fx-on'), null)
    assert.equal(el.hasAttribute('mjs-fx-sticky-pin'), false, 'plus fixée')
    for (const k of ['x', 'w', 'from', 'y']) assert.equal(el.style.getPropertyValue('--mjs-fx-sticky-' + k), '')
    assert.ok(io.cibles[0] === el, 'le seuil est de nouveau suivi sur la balise')
  })

  it('une balise qui n\'est pas encore arrivée (sous le bord bas) ne se fige pas ; le dernier relevé compte', async () => {
    const comp = await monter('mjs-fx-fige')
    const el   = comp._shadow.querySelector('.a')
    const io   = mesurer()
    io.cb([EN_BAS])
    assert.equal(jeton(el), false, 'sous le bord bas : pas figée')
    io.cb([SORTIE, VISIBLE])
    assert.equal(jeton(el), false, 'sortie puis revenue dans le même lot : le dernier relevé compte')
    io.cb([VISIBLE, SORTIE])
    assert.equal(jeton(el), true)
  })

  it('l\'état figé garde le jeton des autres effets de la balise (mjs-fx-on est une liste)', async () => {
    const comp = await monter('mjs-fx-fige')
    const el   = comp._shadow.querySelector('.a')
    el.setAttribute('mjs-fx-on', 'neon')
    const io = mesurer()
    io.cb([SORTIE])
    assert.deepEqual((el.getAttribute('mjs-fx-on') || '').split(' ').sort(), ['neon', 'sticky'])
    io.cb([VISIBLE])
    assert.equal(el.getAttribute('mjs-fx-on'), 'neon')
  })

  it('sans hide : aucun écouteur de défilement, figée ou non', async () => {
    const comp = await monter('mjs-fx-fige')
    const base = window.__defile
    const io   = mesurer()
    io.cb([SORTIE])
    await pause(40)
    assert.equal(window.__defile, base, 'figée sans hide : rien n\'écoute le défilement')
    io.cb([VISIBLE])
    assert.equal(window.__defile, base)
    assert.ok(comp)
  })

  it('hide : l\'écoute du défilement ne dure que pendant que la balise est figée', async () => {
    const comp = await monter('mjs-fx-fige-cache')
    const base = window.__defile
    const io   = mesurer()
    assert.equal(window.__defile, base, 'avant la figeaison : rien')
    io.cb([SORTIE])
    assert.ok(window.__defile > base, 'figée : l\'écoute part')
    io.cb([VISIBLE])
    assert.equal(window.__defile, base, 'rendue à sa place : l\'écoute s\'arrête')
    assert.ok(comp)
  })

  it('hide : cachée dès qu\'on descend de plus de 8 px, revenue en remontant de plus de 8 px, un va-et-vient de quelques pixels la laisse', async () => {
    const comp = await monter('mjs-fx-fige-cache')
    const el   = comp._shadow.querySelector('.a')
    const io   = mesurer()
    window.__y = 600
    io.cb([SORTIE])
    await pause(40)
    const vers = async (y: number) => {
      window.__y = y
      window.document.dispatchEvent(new window.Event('scroll'))
      await pause(50)
    }
    const cache = () => el.getAttribute('mjs-fx-sticky')
    await vers(604)
    await vers(600)
    await vers(605)
    await vers(601)
    assert.equal(cache(), null, 'un va-et-vient de moins de 8 px ne la cache pas')
    await vers(630)
    assert.equal(cache(), 'hidden', 'cachée en descendant')
    await vers(626)
    assert.equal(cache(), 'hidden', 'un petit retour ne la ramène pas')
    await vers(600)
    assert.equal(cache(), null, 'ramenée en remontant')
    await vers(640)
    assert.equal(cache(), 'hidden')
    io.cb([VISIBLE])
    assert.equal(cache(), null, 'rendue à sa place : plus de marque de cachée')
  })

  it('hide : le clavier qui entre dans la barre cachée la ramène', async () => {
    const comp = await monter('mjs-fx-fige-cache')
    const el   = comp._shadow.querySelector('.a')
    const io   = mesurer()
    window.__y = 600
    io.cb([SORTIE])
    await pause(40)
    window.__y = 640
    window.document.dispatchEvent(new window.Event('scroll'))
    await pause(50)
    assert.equal(el.getAttribute('mjs-fx-sticky'), 'hidden')
    el.querySelector('.l').dispatchEvent(new window.Event('focusin', { bubbles: true }))
    assert.equal(el.getAttribute('mjs-fx-sticky'), null, 'le focus dans la barre la fait revenir')
  })

  it('réglages suivis sur place : offset et top refont la marge du seuil, hide démarre et arrête l\'écoute ; duration, easing et zindex sont des variables', async () => {
    const comp = await monter('mjs-fx-fige-vars')
    const el   = comp._shadow.querySelector('.a')
    const base = window.__defile
    let io     = mesurer()
    assert.equal(io.opts.rootMargin, '236px 0px 0px 0px', 'offset 300, top 0, hauteur 64')
    comp._shadow.querySelector('.b1').click()
    await attendre(() => vivants(obs().io)[0] !== io)
    assert.ok(io.fini, 'l\'ancien observateur est défait')
    io = vivants(obs().io)[0]
    assert.equal(io.opts.rootMargin, '636px 0px 0px 0px', 'offset 700')
    assert.ok(io.cibles[0] === el)
    comp._shadow.querySelector('.b2').click()
    await attendre(() => vivants(obs().io)[0] !== io)
    io = vivants(obs().io)[0]
    assert.equal(io.opts.rootMargin, '616px 0px 0px 0px', 'top 20 : le seuil recule de 20 px')
    assert.equal(el.style.getPropertyValue('--mjs-sticky-top'), '20px')
    // figée sans hide : pas d'écoute ; hide mis à vrai pendant qu'elle est figée : l'écoute part, sans reposer l'effet
    io.cb([SORTIE])
    await pause(40)
    assert.equal(window.__defile, base)
    const retrait = el._mjs_fxOff.sticky
    comp._shadow.querySelector('.b3').click()
    await attendre(() => window.__defile > base)
    assert.ok(window.__defile > base, 'hide à vrai : l\'écoute part')
    assert.ok(el._mjs_fxOff.sticky === retrait, 'l\'effet n\'a pas été reposé')
    assert.equal(jeton(el), true, 'toujours figée')
    // cachée, puis hide à faux : elle revient, l'écoute s'arrête
    window.__y = 100
    window.document.dispatchEvent(new window.Event('scroll'))
    await pause(50)
    window.__y = 150
    window.document.dispatchEvent(new window.Event('scroll'))
    await pause(50)
    assert.equal(el.getAttribute('mjs-fx-sticky'), 'hidden')
    comp._shadow.querySelector('.b4').click()
    await attendre(() => el.getAttribute('mjs-fx-sticky') === null)
    assert.equal(el.getAttribute('mjs-fx-sticky'), null, 'hide à faux : la barre cachée revient')
    assert.equal(window.__defile, base, 'et l\'écoute s\'arrête')
    // la durée, la courbe et le z-index sont des variables : elles suivent sur place, sans reposer l'effet
    const pose = el._mjs_fxOff.sticky
    assert.equal(el.style.getPropertyValue('--mjs-sticky-duration'), '400ms')
    comp._shadow.querySelector('.b5').click()
    await attendre(() => el.style.getPropertyValue('--mjs-sticky-duration') === '1s')
    assert.equal(el.style.getPropertyValue('--mjs-sticky-duration'), '1s')
    assert.equal(el.style.getPropertyValue('--mjs-sticky-easing'), 'linear')
    assert.equal(el.style.getPropertyValue('--mjs-sticky-zindex'), '5')
    assert.ok(el._mjs_fxOff.sticky === pose, 'l\'effet n\'a pas été reposé')
  })

  it('hide : l\'écoute du défilement passe par l\'outil du cœur (µ._mjs_fxWatch), sans surveiller la taille de la balise ; l\'outil rend ses écouteurs avec la figeaison', async () => {
    await monter('mjs-fx-fige-cache')
    const el     = window.document.querySelector('mjs-fx-fige-cache')._shadow.querySelector('.a')
    const µ      = window.µ
    const outil  = µ._mjs_fxWatch
    const appels: any[][] = []
    let rendus = 0
    µ._mjs_fxWatch = function (this: any, ...a: any[]) {
      appels.push(a)
      const off = outil.apply(this, a)
      return () => { rendus++; off() }
    }
    try {
      const io = mesurer()
      assert.equal(appels.length, 0, 'avant la figeaison : rien')
      io.cb([SORTIE])
      assert.equal(appels.length, 1, 'figée : une surveillance, posée par l\'outil (les écouteurs ne sont pas recopiés dans l\'effet)')
      assert.ok(appels[0][0] === el, 'celle de la balise')
      assert.equal(typeof appels[0][1], 'function', 'qui rappelle l\'effet')
      assert.ok(appels[0][2], 'sans surveiller la taille')
      assert.equal(vivants(obs().ro).length, 1, 'l\'observateur de la mesure, aucun de plus')
      io.cb([VISIBLE])
      assert.equal(rendus, 1, 'rendue à sa place : l\'outil a rendu ses écouteurs')
    } finally {
      µ._mjs_fxWatch = outil
    }
  })

  it('la réserve d\'ancre change avec l\'ancrage de défilement coupé en ligne le temps d\'une mise en page forcée, puis rendu comme l\'auteur l\'avait (valeur et priorité) : posée, rendue, reposée, rendue', async () => {
    const dom  = window.µ._mjs_dom
    const lire = dom.getBoundingClientRect
    for (const [valeur, priorite] of [['', ''], ['auto', 'important']]) {
      const comp = await monter('mjs-fx-fige-cache')
      const html = window.document.documentElement
      html.removeAttribute('style')
      if (valeur) html.style.setProperty('overflow-anchor', valeur, priorite)
      // l'ancrage et la réserve à chaque lecture de la mise en page de <html> : la lecture est ce qui met la réserve neuve en page
      const lus: string[] = []
      dom.getBoundingClientRect = function (this: any, el: any) {
        if (el === html) lus.push(html.style.getPropertyValue('overflow-anchor') + '/' + html.style.getPropertyPriority('overflow-anchor') + '/' + html.style.getPropertyValue('scroll-padding-top'))
        return lire.call(this, el)
      }
      try {
        const ancrage = () => html.style.getPropertyValue('overflow-anchor') + '/' + html.style.getPropertyPriority('overflow-anchor')
        const vers = async (y: number) => {
          window.__y = y
          window.document.dispatchEvent(new window.Event('scroll'))
          await pause(50)
        }
        const io = mesurer()
        window.__y = 600
        io.cb([SORTIE])
        await pause(40)
        const rendu = valeur + '/' + priorite
        assert.deepEqual(lus.slice(-1), ['none/important/64px'], 'figée : la réserve est posée, l\'ancrage coupé pendant la lecture')
        assert.equal(ancrage(), rendu, 'puis rendu comme l\'auteur l\'avait')
        assert.equal(html.style.getPropertyValue('scroll-padding-top'), '64px')
        // un réglage qui laisse la réserve telle quelle ne force aucune mise en page
        window.µ._mjs_fxSet(comp._shadow.querySelector('.a'), 'sticky', { offset: 50 })
        assert.equal(lus.length, 1, 'la même réserve n\'est pas reposée')
        await vers(630)
        assert.equal(comp._shadow.querySelector('.a').getAttribute('mjs-fx-sticky'), 'hidden')
        assert.deepEqual(lus.slice(-1), ['none/important/'], 'cachée : la réserve est rendue, l\'ancrage coupé pendant la lecture')
        assert.equal(ancrage(), rendu)
        await vers(600)
        assert.deepEqual(lus.slice(-1), ['none/important/64px'], 'revenue : la réserve revient, l\'ancrage coupé pendant la lecture')
        assert.equal(ancrage(), rendu)
        io.cb([VISIBLE])
        assert.deepEqual(lus.slice(-1), ['none/important/'], 'rendue à sa place : la réserve est rendue, l\'ancrage coupé pendant la lecture')
        assert.equal(ancrage(), rendu)
        assert.equal(html.style.getPropertyValue('scroll-padding-top'), '')
        assert.equal(lus.length, 4, 'une mise en page forcée par changement de la réserve, pas une de plus')
      } finally {
        dom.getBoundingClientRect = lire
      }
    }
  })

  it('le retrait ({if} refermé) pendant qu\'elle est figée : tenant-lieu, jeton, variables, observateurs et écoute de défilement partent', async () => {
    const comp = await monter('mjs-fx-fige-retrait')
    const el   = comp._shadow.querySelector('.a')
    const base = window.__defile
    const io   = mesurer()
    window.__y = 600
    io.cb([SORTIE])
    await pause(40)
    assert.ok(window.__defile > base)
    assert.equal(sieges(el).length, 1)
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx-seat]').length, 0, 'le tenant-lieu est parti')
    assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'aucune marque restée')
    assert.ok(!/--mjs-/.test(el.getAttribute('style') || ''), 'aucune variable restée')
    assert.equal(el._mjs_fxOff ?? null, null)
    assert.equal(vivants(obs().io).length, 0, 'l\'observateur du seuil est défait')
    assert.equal(vivants(obs().ro).length, 0, 'l\'observateur de taille aussi')
    assert.equal(window.__defile, base, 'plus d\'écouteur de défilement')
  })

  it('le CSS : fixe et découpée à la boîte, glissement depuis la variable, cachée hors de l\'écran puis transparente, « réduire les animations » sans glisser', () => {
    const css = window.µ._mjs_fxDefs.sticky.css
    assert.match(css, /\[mjs-fx~="sticky"\]\[mjs-fx-sticky-pin\]\{position:fixed!important/)
    assert.match(css, /@media print\{\[mjs-fx-seat="sticky"\]\{display:none!important\}\}@media not print\{\[mjs-fx~="sticky"\]\[mjs-fx-sticky-pin\]\{position:fixed!important/, 'à l\'impression : le tenant-lieu s\'efface et rien n\'est fixe')
    assert.match(css, /--mjs-sticky-top,0px/)
    assert.match(css, /--mjs-sticky-duration,400ms/)
    assert.match(css, /--mjs-sticky-easing,ease/)
    assert.match(css, /--mjs-sticky-zindex,1000/)
    assert.match(css, /@keyframes mjs-fx-sticky-in\{from\{translate:0 var\(--mjs-fx-sticky-from,0px\)\}\}/)
    assert.match(css, /\[mjs-fx-sticky="hidden"\]\{translate:0 calc\(-100% - var\(--mjs-sticky-top,0px\)\);opacity:0/)
    assert.match(css, /\[mjs-fx-sticky-box\]\{clip-path:inset\(/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\[mjs-fx~="sticky"\]\{animation:none!important;transition:none!important\}\}/)
  })

  it('offset: 30000, top: 600, zindex: -1, hide: 3, une valeur inconnue : refusés à la compilation', async () => {
    await assert.rejects(compiler('<header *sticky(offset: 30000)>x</header>'), /\*sticky : offset = 30000 — permis : int 0\.\.20000/)
    await assert.rejects(compiler('<header *sticky(top: 600)>x</header>'), /\*sticky : top = 600/)
    await assert.rejects(compiler('<header *sticky(zindex: -1)>x</header>'), /\*sticky : zindex = -1/)
    await assert.rejects(compiler('<header *sticky(hide: 3)>x</header>'), /\*sticky/)
    await assert.rejects(compiler('<header *sticky(speed: 3)>x</header>'), /\*sticky/)
    await compiler('<header *sticky(500, hide: true, top: 12, duration: 250ms, easing: ease-out, zindex: 50)>x</header>')
  })

  it('sans IntersectionObserver ni ResizeObserver : la balise reste en place, sans erreur', async () => {
    const IO = window.IntersectionObserver
    const RO = window.ResizeObserver
    window.IntersectionObserver = undefined
    window.ResizeObserver = undefined
    try {
      const comp = await monter('mjs-fx-fige')
      const el   = comp._shadow.querySelector('.a')
      assert.ok((el.getAttribute('mjs-fx') || '').split(' ').includes('sticky'))
      assert.equal(jeton(el), false)
      assert.equal(sieges(el).length, 0)
    }
    finally {
      window.IntersectionObserver = IO
      window.ResizeObserver = RO
    }
  })
})
