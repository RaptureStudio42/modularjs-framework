// *sticky dans Chromium, Firefox et WebKit réels : une vraie mise en page est nécessaire (happy-dom ne
// mesure rien). La barre se fige au seuil (offset, le haut de l'écran, `top`), en position fixe, la
// place qu'elle laissait tenue par un tenant-lieu (la page ne saute pas, le défilement non plus), et
// reprend sa place sous le seuil ; dans une boîte qui défile elle se fige en haut de CETTE boîte, même
// quand la barre est dans un composant de la boîte, et suit la boîte quand la page défile ; `hide`
// la cache dès qu'on descend de plus de 8 px et la ramène en remontant ou quand le clavier y entre ;
// « réduire les animations » : sans glisser ; rien ne tourne au repos (aucun écouteur de défilement
// tant que `hide` est faux, aucune image d'animation en attente) ; retirée, elle ne laisse rien.
// La réserve d'ancre (`scroll-padding-top`) change sans que la page saute (WebKit recale le défilement de la valeur dont
// elle change, tant que son ancrage de défilement n'est pas coupé), et une page qui remonte sous le seuil pendant le
// glissement de retour ne laisse la barre ni décalée ni refigée, sans couper ce que l'auteur anime lui-même (sa transition de `translate`).
// Un navigateur qui n'est pas installé est sauté.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// la barre : 64 px, transparente, un fond et une ombre une fois figée (l'habillage est à l'auteur)
const BARRE = '\n.barre\n  display: flex\n  justify-content: space-between\n  align-items: center\n  height: 64px\n  padding: 0 16px\n  background: transparent\n.barre[mjs-fx-on~=sticky]\n  background: #fff\n  box-shadow: 0 4px 16px rgba(0, 0, 0, .35)\n'
const PLEIN  = '.plein\n  height: 3000px\n'
const BOITE  = '.titre\n  margin: 0\n  height: 40px\n.scene\n  height: 360px\n  overflow: auto\n.reste\n  height: 1800px\n.apres\n  height: 3000px\n'
const barre  = (fx: string) => `<header class="barre" ${fx}><b>Logo</b><a class="lien" href="#un">Un</a></header>`
const boite  = (fx: string) => `<h3 class="titre"></h3>\n<div class="scene">${barre(fx)}<div class="reste"></div></div>\n<div class="apres"></div>\n<style>${BARRE}${BOITE}</style>\n`
// une barre d'en-tête ordinaire : ni hauteur écrite, ni remplissage, ni bordure, donc les marges de ses enfants sortent d'elle
const ENTETE = '\n.ban\n  height: 100px\n.entete\n  background: #ccc\n.entete[mjs-fx-on~=sticky]\n  background: #fff\n.suite\n  height: 50px\n'
const entete = (balise: string, dedans: string) => `<div class="ban"></div>\n<${balise} class="entete" *sticky(300)>${dedans}</${balise}>\n<main class="suite">après</main>\n<div class="plein"></div>\n`
// soixante lignes de texte, pour que le document imprimé tienne sur plusieurs pages
const LIGNES = Array.from({ length: 60 }, (_, i) => `<p class="l">ligne ${i + 1} du document à imprimer, assez de texte pour remplir la page.</p>`).join('')

const SOURCES: Record<string, string> = {
  'sticky-page.mjs':       `${barre('*sticky(500)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  'sticky-boite.mjs':      boite('*sticky(300)'),
  'sticky-boite-cache.mjs': boite('*sticky(hide: true)'),
  // la barre touche le haut de l'écran après 200 px de bandeau
  // l'auteur anime lui-même `translate` de sa barre (une classe la décale de 40 px, sur 1 s) : sa transition n'est pas celle de l'effet
  'sticky-auteur.mjs':     `${barre('*sticky(300)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}.barre\n  transition: translate 1s linear\n.barre.decale\n  translate: 40px 0\n</style>\n`,
  // l'auteur anime lui-même le rognage de sa barre (une classe la rogne de moitié, sur 1 s) : le rognage de l'effet n'est posé que dans une boîte qui défile
  'sticky-rogne.mjs':      `${barre('*sticky(300)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}.barre\n  clip-path: inset(0 0 0 0)\n  transition: clip-path 1s linear\n.barre.petit\n  clip-path: inset(0 50% 0 0)\n</style>\n`,
  // une barre qui se cache lentement (2 s, courbe linéaire) : la glissade de masquage est en vol longtemps
  'sticky-lent.mjs':       `${barre('*sticky(hide: true, duration: 2s, easing: linear)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  'sticky-zero.mjs':       `<div class="bandeau"></div>\n${barre('*sticky')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}.bandeau\n  height: 200px\n</style>\n`,
  'sticky-haut.mjs':       `${barre('*sticky(top: 12)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  'sticky-cache.mjs':      `${barre('*sticky(hide: true)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  // une barre centrée de largeur écrite, dans une colonne flex à écart : sa place, sa largeur
  'sticky-large.mjs':      `<div class="col">${barre('*sticky(200)')}<div class="plein"></div></div>\n<style>${BARRE}${PLEIN}.col\n  display: flex\n  flex-direction: column\n  gap: 20px\n.barre\n  box-sizing: border-box\n  max-width: 600px\n  width: 100%\n  margin: 0 auto\n</style>\n`,
  // une boîte bordée et rembourrée : le seuil est compté depuis la barre, qui commence 24 px plus bas
  'sticky-marge.mjs':      `<h3 class="titre"></h3>\n<div class="scene">${barre('*sticky(300)')}<div class="reste"></div></div>\n<div class="apres"></div>\n<style>${BARRE}${BOITE}.scene\n  padding-top: 24px\n  border: 2px solid #333\n</style>\n`,
  // la barre vit dans un composant, lui-même dans la boîte qui défile
  'sticky-encapsulee.mjs': '<h3 class="titre"></h3>\n<div class="scene"><@sticky-enfant></@sticky-enfant><div class="reste"></div></div>\n<div class="apres"></div>\n<style>' + BOITE + '</style>\n',
  'sticky-enfant.mjs':     `${barre('*sticky(200)')}\n<style>${BARRE}</style>\n`,
  // l'effet posé sur un composant : sa balise est l'hôte, en ligne par défaut
  'sticky-hote.mjs':       `<@sticky-corps *sticky(300)></@sticky-corps>\n<div class="plein"></div>\n<style>${PLEIN}</style>\n`,
  'sticky-corps.mjs':      `${barre('')}\n<style>${BARRE}</style>\n`,
  // chaque réglage visuel écrit : la durée et la courbe du glissement, le z-index, l'écart du haut
  'sticky-reglages.mjs':   `${barre('*sticky(100, duration: 1s, easing: linear, zindex: 77, top: 5)')}\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  'sticky-retrait.mjs':    `<script>\n$on = true\n</script>\n{if $on}${barre('*sticky(100)')}{end}\n<button class="t" @click={$on = !$on}>t</button>\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  // la place que la barre tient dans le flux, marges de ses enfants fusionnées à travers elle comprises
  'sticky-marges-titre.mjs':   `${entete('header', '<h1 class="t">Titre</h1>')}<style>${ENTETE}${PLEIN}.t\n  margin: 21px 0\n  line-height: 37px\n</style>\n`,
  'sticky-marges-liens.mjs':   `${entete('nav', '<ul class="liens"><li>Accueil</li><li>Projets</li></ul>')}<style>${ENTETE}${PLEIN}.liens\n  margin: 16px 0\n  padding: 0 20px\n</style>\n`,
  'sticky-marges-chaine.mjs':  `${entete('header', '<div class="zone"><h1 class="t">Titre</h1></div>')}<style>${ENTETE}${PLEIN}.zone\n  margin: 12px 0 40px\n.t\n  margin: 33px 0 5px\n  line-height: 37px\n</style>\n`,
  // ses propres marges (10 en haut, 20 en bas) et la marge haute de la suite (15), qui se fusionnent
  'sticky-marges-barre.mjs':   `${entete('header', 'texte')}<style>${ENTETE}${PLEIN}.entete\n  height: 60px\n  margin: 10px 0 20px\n.suite\n  margin-top: 15px\n</style>\n`,
  // le bandeau au-dessus a une marge basse (30) et la suite une marge haute (40) qui ne tient qu'à la barre voisine : elles se fusionnent avec celles qui sortent de la barre
  'sticky-marges-voisins.mjs': `${entete('header', '<h1 class="t">Titre</h1>')}<style>${ENTETE}${PLEIN}.ban\n  margin-bottom: 30px\n.t\n  margin: 21px 0\n  line-height: 37px\n.entete + .suite\n  margin-top: 40px\n</style>\n`,
  // une ancre loin dans la page, pour arriver sous la barre figée
  'sticky-ancre.mjs':          `${barre('*sticky(300)')}\n<div class="haut"></div>\n<h2 class="cible">Titre</h2>\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}.haut\n  height: 1500px\n.cible\n  margin: 0\n  height: 30px\n</style>\n`,
  // un document à imprimer : un bandeau, la barre, soixante lignes
  'sticky-impression.mjs':     `<div class="ban">bandeau</div>\n<header class="entete" *sticky(300)><h1 class="t">BARRE-STICKY</h1></header>\n<main class="suite">${LIGNES}</main>\n<style>${ENTETE}.suite\n  height: auto\n.t\n  margin: 0\n  font-size: 16px\n  line-height: 24px\n</style>\n`,
  // des contrôles dans une barre qui se cache : un lien, un bouton, une case à cocher, un champ de recherche, une liste de choix, un champ modifiable
  'sticky-clic.mjs':           `<header class="barre" *sticky(hide: true)><a class="lien" href="#un">Un</a><button class="bouton" type="button">Ok</button><input class="case" type="checkbox"><input class="champ" type="search"><select class="choix"><option>a</option><option>b</option></select><div class="libre" contenteditable="true">texte</div></header>\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}</style>\n`,
  // d'autres mises en page : une grille (la barre sur toute la largeur),une barre flottante (le texte coule autour), une barre décalée (position relative)
  'sticky-grille.mjs':         `<div class="ban"></div>\n<div class="g"><header class="entete" *sticky(300)>barre</header><aside class="suite">aside</aside><main class="coin">main</main></div>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}.g\n  display: grid\n  grid-template-columns: 200px 1fr\n  gap: 20px\n.g header\n  grid-column: 1 / -1\n  height: 60px\n.coin\n  height: 80px\n</style>\n`,
  'sticky-flottante.mjs':      `<div class="ban"></div>\n<div class="cadre"><header class="entete" *sticky(300)>barre</header><p class="suite">texte qui coule autour du flottant, assez long pour passer sur plusieurs lignes lorsque la largeur le permet vraiment bien bien</p></div>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}.cadre\n  overflow: hidden\n.cadre header\n  float: left\n  width: 50%\n  height: 60px\n.cadre .suite\n  height: auto\n  margin: 0\n</style>\n`,
  'sticky-decalee.mjs':        `${entete('header', 'barre')}<style>${ENTETE}${PLEIN}.entete\n  height: 60px\n  position: relative\n  top: 7px\n</style>\n`,
  // une barre en ligne (un <span> dans un paragraphe), un composant en ligne (l'hôte est en ligne par défaut) : la ligne qui les porte ne grandit pas
  'sticky-ligne.mjs':          `<div class="ban"></div>\n<p class="ligne">avant <span class="entete" *sticky(300)>barre en ligne</span> après</p>\n<main class="suite">après</main>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}</style>\n`,
  'sticky-bloc-en-ligne.mjs':  `<div class="ban"></div>\n<span class="entete" *sticky(300)><div class="bloc">barre</div></span>\n<main class="suite">après</main>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}.bloc\n  height: 60px\n</style>\n`,
  // le même hôte en ligne, dont le contenu est un simple bloc (sans flex)
  'sticky-hote-bloc.mjs':      `<div class="ban"></div>\n<@sticky-corps-bloc *sticky(300)></@sticky-corps-bloc>\n<main class="suite">après</main>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}</style>\n`,
  'sticky-corps-bloc.mjs':     `<div class="bloc">barre</div>\n<style>.bloc\n  height: 60px\n  background: #ccc\n</style>\n`,
  // deux barres dans la même page, la seconde figée plus bas que la première
  'sticky-deux.mjs':           `<header class="barre" *sticky(200)><b>A</b></header>\n<header class="barre deuxieme" *sticky(500, top: 70)><b>B</b></header>\n<div class="plein"></div>\n<style>${BARRE}${PLEIN}.deuxieme\n  background: #eee\n</style>\n`,
  // une barre sans taille (vide, 0 px de haut) et une barre qui n'est pas affichée
  'sticky-vide.mjs':           `${entete('header', '')}<style>${ENTETE}${PLEIN}</style>\n`,
  'sticky-cachee.mjs':         `${entete('header', 'barre')}<style>${ENTETE}${PLEIN}.entete\n  display: none\n</style>\n`,
  // des frères autour de la barre, pour les sélecteurs de rang
  'sticky-rang.mjs':          `<div class="z"><header class="entete" *sticky(300)>barre</header><p class="m2">deux</p><p class="m3">trois</p></div>\n<div class="plein"></div>\n<style>${ENTETE}${PLEIN}.z > :first-child\n  outline: 3px solid blue\n.z > :nth-child(odd)\n  text-indent: 7px\n</style>\n`
}

// ce que la page compte : les images d'animation en attente, les écouteurs de défilement (posés moins
// retirés), et une recherche de balise à travers les shadow roots des composants
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__defile = 0
  w.__redim = 0
  const aj = EventTarget.prototype.addEventListener
  const re = EventTarget.prototype.removeEventListener
  // un écouteur posé avec un signal d'annulation ne passe pas par removeEventListener : l'annulation le décompte
  EventTarget.prototype.addEventListener = function (t: string, ...a: any[]) {
    if (t === 'scroll') {
      w.__defile++
      const signal = a[1] && typeof a[1] === 'object' ? a[1].signal : null
      if (signal) signal.addEventListener('abort', () => { w.__defile-- }, { once: true })
    }
    if (t === 'resize' && this === w) w.__redim++
    return (aj as any).call(this, t, ...a)
  }
  EventTarget.prototype.removeEventListener = function (t: string, ...a: any[]) { if (t === 'scroll') w.__defile--; if (t === 'resize' && this === w) w.__redim--; return (re as any).call(this, t, ...a) }
  w.__trouve = (sel: string) => {
    const marche = (racine: any): any => {
      const hit = racine.querySelector(sel)
      if (hit) return hit
      for (const n of racine.querySelectorAll('*')) {
        if (n._shadow) { const h = marche(n._shadow); if (h) return h }
      }
      return null
    }
    return marche(document)
  }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit une condition jusqu'à ce qu'elle tienne, ou que le délai passe : rend la dernière valeur lue
async function jusqua<T>(lire: () => Promise<T>, bon: (v: T) => boolean, ms = 4000): Promise<T> {
  const fin = Date.now() + ms
  let v = await lire()
  while (!bon(v) && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

describe('*sticky (navigateurs réels) — seuil, tenant-lieu, boîte qui défile, hide, mouvement réduit, repos, retrait', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-sticky')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, viewport = { width: 1000, height: 800 }, mouvement: 'reduce' | 'no-preference' = 'no-preference'): Promise<T> {
        const page = await browser.newPage({ viewport, reducedMotion: mouvement })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        // le chargeur du banc ne connaît pas de manifeste (le composant enfant est défini par le même script) : son refus ne compte pas
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|\[Autoloader\].*sticky-enfant/.test(m.text())) erreurs.push(m.text()) })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(window as any).__trouve('[mjs-fx~="sticky"]'))
          const rendu = await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur de page ni de console')
          return rendu
        }
        finally {
          await page.close()
        }
      }

      // la barre telle que le navigateur la montre : son état, sa boîte, ses styles calculés
      const etat = (page: any, sel = '.barre') => page.evaluate((s: string) => {
        const b  = (window as any).__trouve(s)
        const cs = getComputedStyle(b)
        const r  = b.getBoundingClientRect()
        const sieges = Array.from(b.parentNode.querySelectorAll('[mjs-fx-seat]')).map((x: any) => x.getBoundingClientRect())
        return { on: b.getAttribute('mjs-fx-on'), cache: b.getAttribute('mjs-fx-sticky'), boite: b.hasAttribute('mjs-fx-sticky-box'), pos: cs.position, top: r.top, bottom: r.bottom, left: r.left, width: r.width, opacity: cs.opacity, clip: cs.clipPath, anim: cs.animationName, trans: cs.transitionProperty, enCours: b.getAnimations().length, de: parseFloat(b.style.getPropertyValue('--mjs-fx-sticky-from') || 'NaN'), sieges: sieges.length, siegeH: sieges[0] ? sieges[0].height : 0, siegeW: sieges[0] ? sieges[0].width : 0 }
      }, sel)
      // figée (ou rendue à sa place) et immobile : son glissement est fini
      const figee = async (page: any, oui: boolean, sel = '.barre') => jusqua(() => etat(page, sel), (e: any) => (e.on === 'sticky') === oui && e.enCours === 0)

      // le défilement : la page, ou la boîte de la scène
      const pageA = (page: any, y: number) => page.evaluate((v: number) => scrollTo(0, v), y)
      const boiteA = (page: any, y: number) => page.evaluate((v: number) => { (window as any).__trouve('.scene').scrollTop = v }, y)
      const pos = (page: any, boite = false) => page.evaluate((b: boolean) => b ? (window as any).__trouve('.scene').scrollTop : scrollY, boite)
      const defiles = (page: any) => page.evaluate(() => (window as any).__defile)
      const rafs = (page: any) => page.evaluate(() => (window as any).__raf.size)
      const redim = (page: any) => page.evaluate(() => (window as any).__redim)

      // le passage figé ne décale rien : la suite de la page, la hauteur du document et le défilement juste avant et juste après le seuil, puis au retour
      async function sansSaut(tag: string, sel = '.entete') {
        await avec(tag, async (page) => {
          const lire = () => page.evaluate(() => { const bas = (s: string) => (window as any).__trouve(s).getBoundingClientRect().top + scrollY; return { suite: bas('.suite'), plein: bas('.plein'), hauteur: document.documentElement.scrollHeight, y: scrollY } })
          const proche = (a: number, b: number, quoi: string) => assert.ok(Math.abs(a - b) < 0.05, `${quoi} : ${a} au lieu de ${b}`)
          const seuil = Math.round((await etat(page, sel)).top) + 300
          await pageA(page, seuil - 3)
          await attendre(300)
          assert.equal((await etat(page, sel)).on, null, 'à 3 px du seuil : pas figée')
          const avant = await lire()
          await pageA(page, seuil + 3)
          const e = await figee(page, true, sel)
          assert.equal(e.on, 'sticky', 'à 3 px au-delà du seuil : figée')
          assert.equal(e.sieges, 1, 'un tenant-lieu')
          const apres = await lire()
          proche(apres.suite, avant.suite, 'la suite de la page n\'a pas bougé à la figeaison')
          proche(apres.plein, avant.plein, 'le contenu plus bas non plus')
          proche(apres.hauteur, avant.hauteur, 'la page n\'a pas changé de hauteur')
          proche(apres.y, avant.y + 6, 'le défilement n\'a fait que les 6 px demandés')
          await pageA(page, seuil - 3)
          const r = await figee(page, false, sel)
          assert.equal(r.on, null, 'revenue sous le seuil : elle reprend sa place')
          assert.equal(r.sieges, 0)
          const retour = await lire()
          proche(retour.suite, avant.suite, 'au retour la suite est où elle était')
          proche(retour.hauteur, avant.hauteur, 'et la page à sa hauteur')
        })
      }

      it('la page : la barre part avec elle, se fige après 500 px en haut de l\'écran, le tenant-lieu garde la place, le défilement ne saute pas, elle reprend sa place en dessous', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          const plein = () => page.evaluate(() => (window as any).__trouve('.plein').getBoundingClientRect().top + scrollY)
          const haut = await plein()
          const hauteur = await page.evaluate(() => document.documentElement.scrollHeight)
          let e = await etat(page)
          assert.equal(e.on, null, 'au repos : pas figée')
          assert.equal(e.pos, 'static')
          assert.equal(e.sieges, 0)
          await pageA(page, 499)
          await attendre(300)
          e = await etat(page)
          assert.equal(e.on, null, 'à 499 px : pas encore figée')
          assert.equal(e.pos, 'static')
          await pageA(page, 520)
          e = await figee(page, true)
          assert.equal(e.on, 'sticky', 'à 520 px : figée')
          assert.equal(e.pos, 'fixed')
          assert.ok(Math.abs(e.top) < 0.5, `collée au haut de l'écran (${e.top})`)
          assert.equal(e.sieges, 1, 'un tenant-lieu')
          assert.equal(e.siegeH, 64, 'à la taille de la barre')
          assert.equal(await pos(page), 520, 'le défilement n\'a pas bougé de la pose du tenant-lieu')
          assert.equal(await plein(), haut, 'le contenu en dessous n\'a pas bougé')
          assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), hauteur, 'la page n\'a pas changé de hauteur')
          assert.notEqual(e.anim, 'none', 'elle revient en glissant')
          assert.ok(e.de <= -60 && e.de >= -64.5, `d'une hauteur au-dessus de la ligne du haut (${e.de})`)
          await pageA(page, 1500)
          await attendre(300)
          e = await etat(page)
          assert.equal(e.on, 'sticky', 'toujours figée plus bas')
          assert.ok(Math.abs(e.top) < 0.5)
          await pageA(page, 300)
          e = await figee(page, false)
          assert.equal(e.on, null, 'sous le seuil : elle reprend sa place')
          assert.equal(e.pos, 'static')
          assert.equal(e.sieges, 0, 'le tenant-lieu est parti')
          assert.equal(await plein(), haut)
        })
      })

      it('sans seuil : la barre posée sous un bandeau se fige quand elle touche le haut, sans saut (elle part de là où elle était)', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-zero', async (page) => {
          await pageA(page, 190)
          await attendre(300)
          assert.equal((await etat(page)).on, null, 'à 190 px : elle n\'a pas touché le haut')
          await pageA(page, 215)
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky')
          assert.ok(Math.abs(e.top) < 0.5)
          assert.ok(Math.abs(e.de) <= 20, `repartie de sa place à l'écran, pas de plus haut (${e.de})`)
        })
      })

      it('top : 12 px sous le haut de l\'écran, figée dès le départ (elle descend de sa place à celle-là)', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-haut', async (page) => {
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky', 'collée d\'emblée')
          assert.ok(Math.abs(e.top - 12) < 0.5, `à 12 px du haut (${e.top})`)
          assert.ok(Math.abs(e.de + 12) < 0.5, `elle descend de ses 12 px (${e.de})`)
          assert.equal(e.siegeH, 64)
        })
      })

      it('une boîte qui défile : figée en haut de la boîte (pas de l\'écran), découpée à son bord, reprend sa place en dessous, suit la boîte quand la page défile', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-boite', async (page) => {
          const scene = () => page.evaluate(() => { const r = (window as any).__trouve('.scene').getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
          await boiteA(page, 250)
          await attendre(300)
          assert.equal((await etat(page)).on, null, 'à 250 px : pas figée')
          await boiteA(page, 420)
          let e = await figee(page, true)
          const s = await scene()
          assert.equal(e.on, 'sticky')
          assert.equal(e.boite, true)
          assert.ok(Math.abs(e.top - s.top) < 0.5, `en haut de la boîte (${e.top} / ${s.top}), pas en haut de l'écran`)
          assert.ok(s.top > 30, 'la boîte est bien sous le titre : la barre n\'est pas à 0')
          assert.equal(await pos(page, true), 420, 'le défilement de la boîte n\'a pas sauté')
          assert.match(e.clip, /^inset\(/, 'découpée au bord de la boîte')
          // la page défile : la barre suit sa boîte
          await pageA(page, 25)
          const suit = await jusqua(async () => { const a = await etat(page); const b = await scene(); return { dy: a.top - b.top, top: b.top } }, (v: any) => Math.abs(v.dy) < 0.5 && Math.abs(v.top - 15) < 0.5)
          assert.ok(Math.abs(suit.dy) < 0.5 && Math.abs(suit.top - 15) < 0.5, `la barre suit la boîte (${JSON.stringify(suit)})`)
          await pageA(page, 0)
          await boiteA(page, 100)
          e = await figee(page, false)
          assert.equal(e.on, null, 'sous le seuil : reprend sa place')
          assert.equal(e.boite, false)
          assert.equal(e.sieges, 0)
        })
      })

      it('une boîte bordée et rembourrée : le seuil est compté depuis la barre (24 px plus bas) et se tient au pixel', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-marge', async (page) => {
          await boiteA(page, 318)
          await attendre(300)
          assert.equal((await etat(page)).on, null, 'à 318 px : pas figée (seuil 324)')
          await boiteA(page, 332)
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky', 'à 332 px : figée')
        })
      })

      it('la barre vit dans un composant de la boîte : la boîte est trouvée à travers les shadow roots', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-encapsulee', async (page) => {
          await boiteA(page, 150)
          await attendre(300)
          assert.equal((await etat(page)).on, null)
          await boiteA(page, 420)
          const e = await figee(page, true)
          const s = await page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top)
          assert.equal(e.on, 'sticky')
          assert.ok(Math.abs(e.top - s) < 0.5, `en haut de la boîte (${e.top} / ${s})`)
          assert.equal(e.boite, true)
        })
      })

      it('une barre centrée, de largeur écrite, dans une colonne à écart : le tenant-lieu a sa taille et sa place, la barre fixée garde sa largeur et sa colonne', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-large', async (page) => {
          const avant = await etat(page)
          assert.equal(avant.width, 600)
          const plein = () => page.evaluate(() => (window as any).__trouve('.plein').getBoundingClientRect().top + scrollY)
          const haut = await plein()
          await pageA(page, 400)
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky')
          assert.equal(e.width, 600, 'sa largeur')
          assert.ok(Math.abs(e.left - 200) < 0.5, `sa colonne, centrée (${e.left})`)
          assert.equal(e.siegeW, 600)
          assert.equal(e.siegeH, 64)
          assert.equal(await plein(), haut, 'l\'écart de la colonne est resté : le contenu n\'a pas bougé')
        })
      })

      it('hide : elle se cache dès qu\'on descend de plus de 8 px, revient en remontant de plus de 8 px, un va-et-vient la laisse en place, le clavier la ramène', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await pas(600)
          let e = await figee(page, true)
          assert.equal(e.cache, null, 'figée, visible')
          // un va-et-vient de moins de 8 px
          await pas(604)
          await pas(600)
          await pas(605)
          await pas(601)
          e = await etat(page)
          assert.equal(e.cache, null, 'un va-et-vient de quelques pixels ne la cache pas')
          // elle descend
          await pas(630)
          e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(e.cache, 'hidden', 'cachée en descendant')
          e = await jusqua(() => etat(page), (v: any) => v.bottom <= 0.5 && v.opacity === '0')
          assert.ok(e.bottom <= 0.5, `hors de l'écran (${e.bottom})`)
          assert.equal(e.opacity, '0', 'transparente : l\'ombre ne dépasse pas')
          // un petit retour ne la ramène pas
          await pas(626)
          assert.equal((await etat(page)).cache, 'hidden')
          // elle remonte
          await pas(600)
          e = await jusqua(() => etat(page), (v: any) => v.cache === null && v.top > -0.5 && v.opacity === '1')
          assert.equal(e.cache, null, 'revenue en remontant')
          assert.ok(Math.abs(e.top) < 0.5, `en haut de l'écran (${e.top})`)
          // cachée de nouveau, le clavier y entre : elle revient
          await pas(660)
          e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(e.cache, 'hidden')
          await page.evaluate(() => (window as any).__trouve('.lien').focus())
          e = await jusqua(() => etat(page), (v: any) => v.cache === null)
          assert.equal(e.cache, null, 'le focus clavier dans la barre cachée la fait revenir')
          // sous le seuil : plus rien de caché ni de figé
          await pageA(page, 0)
          e = await figee(page, false)
          assert.equal(e.cache, null)
          assert.equal(e.on, null)
        })
      })

      it('hide dans une boîte : la barre cachée ne dépasse pas au-dessus de la boîte (elle est découpée à son bord)', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-boite-cache', async (page) => {
          const pas = async (y: number) => { await boiteA(page, y); await attendre(120) }
          await pas(200)
          await figee(page, true)
          await pas(240)
          await pas(260)
          const e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden' && v.opacity === '0')
          assert.equal(e.cache, 'hidden')
          assert.match(e.clip, /^inset\(100%/, 'tout découpé')
          const s = await page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top)
          assert.ok(e.bottom <= s + 0.5, `au-dessus de la boîte, jamais dedans (${e.bottom} / ${s})`)
          await pas(200)
          const v = await jusqua(() => etat(page), (x: any) => x.cache === null && Math.abs(x.top - s) < 0.5)
          assert.ok(Math.abs(v.top - s) < 0.5 && v.opacity === '1', `revenue au bord de la boîte (${v.top} / ${s})`)
        })
      })

      it('« réduire les animations » : elle se fige et se cache sans glisser', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          await pageA(page, 600)
          let e = await figee(page, true)
          assert.equal(e.on, 'sticky')
          assert.equal(e.anim, 'none', 'pas de glissement à l\'arrivée')
          assert.equal(e.trans, 'none', 'ni de transition')
          await attendre(120)
          await pageA(page, 640)
          e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          // aucune attente : la barre est déjà hors de l'écran
          assert.ok(e.bottom <= 0.5, `cachée aussitôt (${e.bottom})`)
        }, { width: 1000, height: 800 }, 'reduce')
      })

      it('rien ne tourne au repos : aucun écouteur de défilement ni image en attente avant la figeaison, figée sans hide, ni après le retour ; avec hide, des écouteurs seulement pendant qu\'elle est figée', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          await attendre(300)
          const base = await defiles(page)
          assert.equal(await rafs(page), 0, 'aucune image en attente au repos')
          await pageA(page, 700)
          await figee(page, true)
          await attendre(300)
          assert.equal(await defiles(page), base, 'figée sans hide : toujours aucun écouteur de défilement')
          assert.equal(await rafs(page), 0, 'aucune image en attente')
          await pageA(page, 100)
          await figee(page, false)
          await attendre(300)
          assert.equal(await defiles(page), base)
        })
        await avec('mjs-sticky-cache', async (page) => {
          await attendre(300)
          const base = await defiles(page)
          await pageA(page, 700)
          await figee(page, true)
          await attendre(300)
          assert.ok(await defiles(page) > base, 'hide : elle écoute le défilement tant qu\'elle est figée')
          assert.equal(await rafs(page), 0, 'une fois le défilement fini, aucune image en attente')
          await pageA(page, 0)
          await figee(page, false)
          await attendre(300)
          assert.equal(await defiles(page), base, 'rendue à sa place : plus d\'écouteur')
        })
      })

      it('retrait ({if} refermé) pendant qu\'elle est figée : ni tenant-lieu, ni marque, ni variable', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-retrait', async (page) => {
          await pageA(page, 300)
          const e = await figee(page, true)
          assert.equal(e.sieges, 1)
          await page.evaluate(() => (window as any).__trouve('.t').click())
          const reste = await jusqua(() => page.evaluate(() => ({ barre: !!(window as any).__trouve('.barre'), sieges: document.querySelectorAll('[mjs-fx-seat]').length + ((window as any).__trouve('.t').getRootNode().querySelectorAll('[mjs-fx-seat]').length) })), (v: any) => !v.barre)
          assert.equal(reste.barre, false)
          assert.equal(reste.sieges, 0, 'le tenant-lieu est parti avec la barre')
          // revenue, puis retirée alors qu'elle n'est pas figée : rien non plus
          await pageA(page, 0)
          await page.evaluate(() => (window as any).__trouve('.t').click())
          await jusqua(() => page.evaluate(() => !!(window as any).__trouve('.barre')), (v: boolean) => v)
          await attendre(300)
          const b = await etat(page)
          assert.equal(b.on, null)
          assert.equal(b.sieges, 0)
        })
      })

      it('la fenêtre se redimensionne pendant qu\'elle est figée : la barre prend la largeur de sa place, une barre centrée reste centrée', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          await pageA(page, 520)
          let e = await figee(page, true)
          assert.equal(e.width, 1000)
          await page.setViewportSize({ width: 700, height: 800 })
          e = await jusqua(() => etat(page), (v: any) => v.width === 700)
          assert.equal(e.width, 700, 'la largeur suit la fenêtre')
          assert.equal(e.siegeW, 700, 'et le tenant-lieu avec elle')
          assert.equal(e.left, 0)
        })
        await avec('mjs-sticky-large', async (page) => {
          await pageA(page, 400)
          let e = await figee(page, true)
          assert.ok(Math.abs(e.left - 200) < 0.5)
          await page.setViewportSize({ width: 800, height: 800 })
          e = await jusqua(() => etat(page), (v: any) => Math.abs(v.left - 100) < 0.5)
          assert.ok(Math.abs(e.left - 100) < 0.5, `toujours centrée (${e.left})`)
          assert.equal(e.width, 600)
        })
      })

      it('le contenu au-dessus de la barre grandit après la pose : le seuil suit, la barre se fige à son nouvel endroit', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-zero', async (page) => {
          await page.evaluate(() => { (window as any).__trouve('.bandeau').style.height = '400px' })
          await attendre(300)
          await pageA(page, 300)
          await attendre(300)
          assert.equal((await etat(page)).on, null, 'à 300 px : le bandeau fait 400, la barre n\'a pas touché le haut')
          await pageA(page, 420)
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky', 'à 420 px : elle l\'a touché')
        })
      })

      it('la barre change de hauteur avant de se figer : le seuil reste celui de l\'offset', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          await page.evaluate(() => { (window as any).__trouve('.barre').style.height = '100px' })
          await attendre(300)
          await pageA(page, 480)
          await attendre(300)
          assert.equal((await etat(page)).on, null, 'à 480 px : pas encore')
          await pageA(page, 520)
          const e = await figee(page, true)
          assert.equal(e.on, 'sticky', 'à 520 px : figée, comme avec la hauteur d\'origine')
          assert.equal(e.siegeH, 100, 'le tenant-lieu a la nouvelle hauteur')
        })
      })

      it('posée sur un composant (<@carte *sticky>) : son hôte, en ligne par défaut, se fige en haut de l\'écran et laisse un tenant-lieu à sa taille', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-hote', async (page) => {
          await pageA(page, 250)
          await attendre(300)
          assert.equal((await etat(page, 'mjs-sticky-corps')).on, null, 'à 250 px : pas figé')
          await pageA(page, 400)
          let e = await figee(page, true, 'mjs-sticky-corps')
          assert.equal(e.on, 'sticky')
          assert.equal(e.pos, 'fixed')
          assert.ok(Math.abs(e.top) < 0.5, `en haut de l'écran (${e.top})`)
          assert.equal(e.sieges, 1)
          assert.ok(e.siegeH >= 60 && e.siegeH <= 70, `à la taille de la barre (${e.siegeH})`)
          assert.equal(e.width, 1000)
          await pageA(page, 100)
          e = await figee(page, false, 'mjs-sticky-corps')
          assert.equal(e.on, null)
          assert.equal(e.sieges, 0)
        })
      })

      it('hide : tant que le clavier est dans la barre (un lien focalisé), elle ne se cache pas ; le focus parti, le défilement suivant la cache', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await pas(600)
          await figee(page, true)
          await page.evaluate(() => (window as any).__trouve('.lien').focus())
          await pas(640)
          await pas(700)
          await attendre(400)
          assert.equal((await etat(page)).cache, null, 'le focus est dans la barre : elle reste visible en descendant')
          await page.evaluate(() => (document.activeElement as any)?.blur?.())
          await page.evaluate(() => (window as any).__trouve('.lien').blur())
          await pas(740)
          await pas(780)
          const e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(e.cache, 'hidden', 'le focus parti, elle se cache en descendant')
        })
      })

      it('duration, easing, zindex et top écrits : le navigateur les lit sur la barre figée (glissement de 1 s linéaire, z-index 77, à 5 px du haut)', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-reglages', async (page) => {
          await pageA(page, 300)
          await jusqua(() => etat(page), (e: any) => e.on === 'sticky')
          const c = await page.evaluate(() => { const b = (window as any).__trouve('.barre'); const cs = getComputedStyle(b); return { duree: cs.animationDuration, courbe: cs.animationTimingFunction, z: cs.zIndex, top: cs.top, transition: cs.transitionDuration } })
          assert.equal(c.duree, '1s', 'la durée du glissement')
          assert.equal(c.courbe, 'linear', 'sa courbe')
          assert.equal(c.z, '77')
          assert.equal(c.top, '5px')
          assert.match(c.transition, /^1s/, 'la même durée pour se cacher et revenir')
          const e = await figee(page, true)
          assert.ok(Math.abs(e.top - 5) < 0.5, `à 5 px du haut (${e.top})`)
        })
      })

      for (const [tag, titre, sel] of [
        ['mjs-sticky-marges-titre', 'un titre dans la barre (<header><h1>) : ses marges sortent d\'elle et font partie de sa place'],
        ['mjs-sticky-marges-liens', 'une liste de liens dans la barre (<nav><ul>) : ses marges sortent d\'elle et font partie de sa place'],
        ['mjs-sticky-marges-chaine', 'un titre dans un bloc dans la barre : les marges des deux niveaux, haute et basse, sortent de la barre'],
        ['mjs-sticky-marges-barre', 'les marges de la barre elle-même (10 en haut, 20 en bas) se fusionnent avec celle de la suite (15)'],
        ['mjs-sticky-marges-voisins', 'les marges du bandeau (30 en bas) et de la suite (40, posée par la règle du voisin « .entete + .suite ») se fusionnent avec celles qui sortent de la barre'],
        ['mjs-sticky-grille', 'une barre sur toute la largeur d\'une grille à écart'],
        ['mjs-sticky-flottante', 'une barre flottante, le texte coulant autour'],
        ['mjs-sticky-decalee', 'une barre en position relative, décalée de 7 px'],
        ['mjs-sticky-vide', 'une barre vide, sans hauteur : figée sans rien décaler'],
        ['mjs-sticky-ligne', 'une barre en ligne (un <span> dans un paragraphe) : la ligne qui la porte ne grandit pas'],
        ['mjs-sticky-bloc-en-ligne', 'un bloc dans un <span> (un élément en ligne qui porte un bloc, comme un composant sans style d\'hôte) : rien ne grandit'],
        ['mjs-sticky-hote-bloc', 'un composant dont le contenu est un simple bloc : rien ne grandit', 'mjs-sticky-corps-bloc']
      ] as Array<[string, string, string?]>) {
        it(`aucun saut de page à la figeaison ni au retour : ${titre}`, async function () {
          if (!present) return this.skip()
          await sansSaut(tag, sel)
        })
      }

      it('une barre qui n\'est pas affichée (display: none) n\'est jamais figée : ni tenant-lieu, ni marque, ni réserve d\'ancre', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cachee', async (page) => {
          for (const y of [0, 450, 900]) {
            await pageA(page, y)
            await attendre(300)
            const e = await page.evaluate(() => { const b = (window as any).__trouve('.entete'); return { on: b.getAttribute('mjs-fx-on'), pin: b.hasAttribute('mjs-fx-sticky-pin'), sieges: b.parentNode.querySelectorAll('[mjs-fx-seat]').length } })
            assert.deepEqual(e, { on: null, pin: false, sieges: 0 }, `à ${y} px : rien n'est figé`)
            assert.equal(await reserve(page), '', `à ${y} px : rien n'est réservé`)
          }
        })
      })

      it('la barre garde son rang parmi ses frères tant qu\'elle est figée : le tenant-lieu se pose juste après elle (:first-child et :nth-child la visent encore)', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-rang', async (page) => {
          const rang = () => page.evaluate(() => {
            const b = (window as any).__trouve('.entete')
            const c = getComputedStyle(b)
            const s = b.nextElementSibling
            return { rang: Array.from(b.parentNode.children).indexOf(b), contour: c.outlineStyle, retrait: c.textIndent, suivant: !!s && s.hasAttribute('mjs-fx-seat') }
          })
          const repos = await rang()
          assert.equal(repos.rang, 0)
          assert.equal(repos.contour, 'solid', 'au repos, :first-child vise la barre')
          assert.equal(repos.retrait, '7px', 'et :nth-child(odd) aussi')
          assert.equal(repos.suivant, false)
          await pageA(page, 400)
          await figee(page, true, '.entete')
          const fige = await rang()
          assert.equal(fige.rang, 0, 'figée, la barre garde son rang')
          assert.equal(fige.contour, 'solid', ':first-child vise toujours la barre')
          assert.equal(fige.retrait, '7px', ':nth-child(odd) aussi')
          assert.equal(fige.suivant, true, 'le tenant-lieu est juste après la barre')
          await pageA(page, 0)
          await figee(page, false, '.entete')
          assert.deepEqual(await rang(), repos, 'revenue à sa place : comme au repos')
        })
      })

      // un clic de souris sur un lien, un bouton ou une case à cocher laisse le focus dans la barre sans le montrer : elle se cache quand même ;
      // un champ où l'on saisit (recherche, liste de choix, champ modifiable) la retient tant qu'il a le focus
      for (const [sel, retient, quoi] of [
        ['.lien', false, 'un lien'],
        ['.bouton', false, 'un bouton'],
        ['.case', false, 'une case à cocher'],
        ['.champ', true, 'un champ de recherche'],
        ['.choix', true, 'une liste de choix'],
        ['.libre', true, 'un champ modifiable']
      ] as const) {
        it(`hide : après un clic de souris sur ${quoi} de la barre, ${retient ? 'elle reste visible tant que le champ a le focus' : 'elle se cache quand même en descendant'}`, async function () {
          if (!present) return this.skip()
          await avec('mjs-sticky-clic', async (page) => {
            const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
            await pas(600)
            await figee(page, true)
            const c = await page.evaluate((s: string) => { const r = (window as any).__trouve(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, sel)
            await page.mouse.click(c.x, c.y)
            const f = await page.evaluate((s: string) => { const el = (window as any).__trouve(s); return { dedans: (window as any).__trouve('.barre').matches(':focus-within'), visible: el.matches(':focus-visible'), actif: el.getRootNode().activeElement === el } }, sel)
            assert.equal(f.actif, true, 'le contrôle a reçu le focus au clic')
            assert.equal(f.dedans, true, 'le focus est dans la barre')
            if (!retient) assert.equal(f.visible, false, 'et il ne s\'y montre pas : c\'est un clic de souris')
            await pas(640)
            await pas(700)
            await attendre(400)
            if (retient) {
              assert.equal((await etat(page)).cache, null, 'le champ a le focus : la barre reste visible en descendant')
              await page.evaluate((s: string) => (window as any).__trouve(s).blur(), sel)
              await pas(740)
              await pas(780)
            }
            const e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
            assert.equal(e.cache, 'hidden', retient ? 'le focus parti, la descente suivante la cache' : 'la barre se cache malgré le focus laissé par le clic')
          })
        })
      }

      it('hide : une touche Tab qui amène le focus sur un lien de la barre la retient (focus visible) ; le focus parti, la descente suivante la cache', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-clic', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await page.keyboard.press('Tab')
          const f = await page.evaluate(() => { const l = (window as any).__trouve('.lien'); return { actif: l.getRootNode().activeElement === l, visible: l.matches(':focus-visible') } })
          assert.deepEqual(f, { actif: true, visible: true }, 'Tab amène le focus sur le lien, et il se montre')
          await pas(600)
          await figee(page, true)
          await pas(640)
          await pas(700)
          await attendre(400)
          assert.equal((await etat(page)).cache, null, 'le focus clavier est dans la barre : elle reste visible en descendant')
          await page.evaluate(() => (window as any).__trouve('.lien').blur())
          await pas(740)
          await pas(780)
          const e = await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(e.cache, 'hidden', 'le focus parti, elle se cache en descendant')
        })
      })

      // le conteneur qui défile (la page : <html>, ou la boîte) réserve la hauteur de la barre en scroll-padding-top tant qu'elle est figée et visible
      const reserve = (page: any, boite = false) => page.evaluate((b: boolean) => (b ? (window as any).__trouve('.scene') : document.documentElement).style.getPropertyValue('scroll-padding-top'), boite)

      it('une ancre (scrollIntoView, #titre) n\'arrive pas sous la barre figée : la page réserve sa hauteur en scroll-padding-top et rend la valeur de l\'auteur au retour', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-ancre', async (page) => {
          const cible = () => page.evaluate(() => { const c = (window as any).__trouve('.cible').getBoundingClientRect(); const b = (window as any).__trouve('.barre').getBoundingClientRect(); return { haut: c.top, basBarre: b.bottom } })
          await page.evaluate(() => { document.documentElement.style.scrollPaddingTop = '7px' })
          await pageA(page, 100)
          await attendre(300)
          assert.equal(await reserve(page), '7px', 'avant la figeaison : la valeur de l\'auteur')
          await pageA(page, 600)
          await figee(page, true)
          await page.evaluate(() => (window as any).__trouve('.cible').scrollIntoView())
          await attendre(200)
          const c = await cible()
          assert.ok(c.haut >= c.basBarre - 0.5, `l'ancre arrive sous la barre, pas derrière elle (${c.haut} / ${c.basBarre})`)
          assert.equal(await reserve(page), '64px', 'figée et visible : la page réserve la hauteur de la barre')
          await pageA(page, 0)
          await figee(page, false)
          assert.equal(await reserve(page), '7px', 'revenue à sa place : la valeur de l\'auteur est rendue')
        })
        await avec('mjs-sticky-ancre', async (page) => {
          await pageA(page, 600)
          await figee(page, true)
          assert.equal(await reserve(page), '64px')
          await pageA(page, 0)
          await figee(page, false)
          assert.equal(await reserve(page), '', 'sans valeur de l\'auteur : rien ne reste')
        })
      })

      it('la réserve d\'ancre : seulement tant que la barre est figée et visible ; cachée, au retrait de l\'effet, ou dans une boîte, elle est rendue ou posée sur la boîte', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await pas(600)
          await figee(page, true)
          assert.equal(await reserve(page), '64px', 'figée et visible')
          await pas(660)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(await reserve(page), '', 'cachée : rien n\'est réservé')
          await pas(600)
          await jusqua(() => etat(page), (v: any) => v.cache === null)
          assert.equal(await reserve(page), '64px', 'ramenée : la réserve revient')
          await pas(0)
          await figee(page, false)
          assert.equal(await reserve(page), '', 'rendue à sa place : rien ne reste')
        })
        await avec('mjs-sticky-retrait', async (page) => {
          await pageA(page, 300)
          await figee(page, true)
          assert.equal(await reserve(page), '64px')
          await page.evaluate(() => (window as any).__trouve('.t').click())
          await jusqua(() => page.evaluate(() => !(window as any).__trouve('.barre')), (v: boolean) => v)
          assert.equal(await reserve(page), '', 'le retrait de l\'effet pendant qu\'elle est figée rend la valeur')
        })
        await avec('mjs-sticky-boite', async (page) => {
          await boiteA(page, 420)
          await figee(page, true)
          assert.equal(await reserve(page, true), '64px', 'dans une boîte : la boîte réserve')
          assert.equal(await reserve(page), '', 'et la page non')
          await boiteA(page, 100)
          await figee(page, false)
          assert.equal(await reserve(page, true), '', 'revenue à sa place : la boîte est rendue')
        })
      })

      // la réserve change quatre fois (posée à la figeaison, rendue au masquage, reposée au retour, rendue sous le seuil) : le défilement ne
      // bouge que de ce qu'on lui demande. Le recalage de l'ancrage de défilement de WebKit (la page sautait de la hauteur de la barre) se voit ici
      it('la réserve d\'ancre change sans que la page saute : à la figeaison, au masquage, au retour de la barre et au retour sous le seuil, le défilement ne bouge que de ce qu\'on lui demande', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          // le navigateur peut recaler le défilement une image après le changement : la lecture attend
          const lu = async () => { await attendre(250); return pos(page) }
          await pas(600)
          await figee(page, true)
          assert.equal(await reserve(page), '64px', 'la réserve est posée')
          assert.equal(await lu(), 600, 'figée : la page est restée à 600')
          await pas(660)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(await reserve(page), '', 'la réserve est rendue')
          assert.equal(await lu(), 660, 'cachée : la page est restée à 660, pas recalée de la hauteur de la réserve')
          await pas(600)
          await jusqua(() => etat(page), (v: any) => v.cache === null)
          assert.equal(await reserve(page), '64px', 'la réserve revient')
          assert.equal(await lu(), 600, 'revenue : la page est restée à 600')
          await pas(0)
          await figee(page, false)
          assert.equal(await reserve(page), '', 'rendue à sa place : la réserve est rendue')
          assert.equal(await lu(), 0, 'et la page est en haut')
        })
        await avec('mjs-sticky-boite-cache', async (page) => {
          const pas = async (y: number) => { await boiteA(page, y); await attendre(120) }
          const lu = async () => { await attendre(250); return pos(page, true) }
          await pas(200)
          await figee(page, true)
          assert.equal(await lu(), 200, 'dans une boîte, figée : la boîte est restée à 200')
          await pas(260)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(await lu(), 260, 'cachée : à 260')
          await pas(200)
          await jusqua(() => etat(page), (v: any) => v.cache === null)
          assert.equal(await lu(), 200, 'revenue : à 200')
        })
      })

      // la réserve change aussi dans une tâche ordinaire, hors de tout rappel de défilement ou d'observateur : un réglage suivi sur place (`off.set`)
      it('la réserve d\'ancre suit un réglage changé sur place pendant que la barre est figée (top passe à 20 puis revient à 0) sans que la page saute', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          // ce que le composant compilé appelle quand une variable d'un réglage change
          const regle = (k: string, v: number) => page.evaluate(([n, x]: [string, number]) => (window as any).µ._mjs_fxSet((window as any).__trouve('.barre'), 'sticky', { [n]: x }), [k, v] as [string, number])
          await pageA(page, 600)
          await figee(page, true)
          await attendre(250)
          assert.equal(await reserve(page), '64px')
          await regle('top', 20)
          assert.equal(await jusqua(() => reserve(page), (v: string) => v === '84px'), '84px', 'top à 20 : la hauteur de la barre plus 20')
          await attendre(250)
          assert.equal(await pos(page), 600, 'la page est restée où elle était')
          await regle('top', 0)
          assert.equal(await jusqua(() => reserve(page), (v: string) => v === '64px'), '64px', 'top à 0 : la réserve diminue')
          await attendre(250)
          assert.equal(await pos(page), 600, 'une réserve qui diminue ne recale pas la page non plus')
        })
      })

      // la réserve se change avec l'ancrage de défilement coupé en ligne le temps d'une mise en page, puis rendu comme l'auteur l'avait
      it('l\'ancrage de défilement de la page est rendu comme l\'auteur l\'avait après chaque changement de la réserve : rien n\'est laissé en ligne, sa valeur et sa priorité reviennent', async function () {
        if (!present) return this.skip()
        for (const [valeur, priorite] of [['', ''], ['none', ''], ['auto', 'important']]) {
          await avec('mjs-sticky-cache', async (page) => {
            const ancrage = () => page.evaluate(() => { const s = document.documentElement.style; return s.getPropertyValue('overflow-anchor') + '/' + s.getPropertyPriority('overflow-anchor') })
            await page.evaluate(([v, p]: string[]) => { if (v) document.documentElement.style.setProperty('overflow-anchor', v, p) }, [valeur, priorite])
            const attendu = valeur + '/' + priorite
            const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
            assert.equal(await ancrage(), attendu, 'avant la figeaison : celui de l\'auteur')
            await pas(600)
            await figee(page, true)
            assert.equal(await reserve(page), '64px')
            assert.equal(await ancrage(), attendu, `figée : la réserve est posée, l'ancrage est rendu (${attendu})`)
            await pas(660)
            await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
            assert.equal(await ancrage(), attendu, 'cachée : la réserve est rendue, l\'ancrage aussi')
            await pas(600)
            await jusqua(() => etat(page), (v: any) => v.cache === null)
            assert.equal(await ancrage(), attendu, 'revenue : la réserve revient, l\'ancrage reste rendu')
            await pas(0)
            await figee(page, false)
            assert.equal(await reserve(page), '')
            assert.equal(await ancrage(), attendu, 'rendue à sa place : comme avant la figeaison')
          })
        }
        await avec('mjs-sticky-boite-cache', async (page) => {
          const ancrage = () => page.evaluate(() => (window as any).__trouve('.scene').style.getPropertyValue('overflow-anchor'))
          const pas = async (y: number) => { await boiteA(page, y); await attendre(120) }
          await pas(200)
          await figee(page, true)
          assert.equal(await reserve(page, true), '64px')
          assert.equal(await ancrage(), '', 'dans une boîte : rien n\'est laissé sur la boîte')
          await pas(260)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          assert.equal(await ancrage(), '')
          await pas(0)
          await figee(page, false)
          assert.equal(await ancrage(), '')
        })
      })

      // la page remonte sous le seuil pendant que la barre revient en glissant : la transition de retour finit à la valeur de repos, donc
      // elle survivrait à la perte de la règle qui la porte, la barre resterait décalée dans la page au-dessus de sa ligne, le repère la
      // verrait sortie, elle se figerait de nouveau, puis se rendrait, en boucle (quelques images, ou plusieurs secondes selon le navigateur)
      it('la page remonte sous le seuil avant la fin du glissement de retour : la barre reprend sa place d\'un coup, aucune transition ne la laisse décalée, et elle ne se refige pas', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await pas(600)
          await figee(page, true)
          await pas(660)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          await attendre(500)
          // un film de la barre, image par image, pendant 1,5 s
          await page.evaluate(() => {
            const w = window as any
            const b = w.__trouve('.barre')
            const debut = performance.now()
            w.__film = []
            const image = () => {
              w.__film.push({ on: b.getAttribute('mjs-fx-on'), translate: getComputedStyle(b).translate, haut: Math.round(b.getBoundingClientRect().top * 100) / 100 })
              if (performance.now() - debut < 1500) requestAnimationFrame(image)
              else w.__filmFini = true
            }
            requestAnimationFrame(image)
          })
          await pageA(page, 600)
          // elle revient en glissant : on remonte aussitôt, pendant le glissement
          await jusqua(() => etat(page), (v: any) => v.cache === null && v.enCours > 0)
          await pageA(page, 0)
          await page.waitForFunction(() => (window as any).__filmFini === true)
          const film: Array<{ on: string | null, translate: string, haut: number }> = await page.evaluate(() => (window as any).__film)
          assert.ok(film.some((f) => f.on === 'sticky' && f.translate !== 'none' && f.translate !== '0px -100%'), 'le film a vu le glissement de retour en cours')
          const rendue = film.findIndex((f) => f.on === null)
          assert.ok(rendue >= 0, 'elle a repris sa place')
          for (const [i, f] of film.slice(rendue).entries()) assert.deepEqual(f, { on: null, translate: 'none', haut: 0 }, `image ${rendue + i} : à sa place, immobile, jamais refigée`)
        })
      })

      // un film de la barre, image par image, pendant `ms` ; `geste` s'exécute dans la page, dans la même tâche que le départ du film
      const filme = (page: any, ms: number, geste: string): Promise<Array<{ on: string | null, translate: string, clip: string, haut: number }>> => page.evaluate(([g, duree]: [string, number]) => new Promise<any[]>((fin) => {
        const w = window as any
        const b = w.__trouve('.barre')
        const film: any[] = []
        const debut = performance.now()
        const image = () => {
          const cs = getComputedStyle(b)
          film.push({ on: b.getAttribute('mjs-fx-on'), translate: cs.translate, clip: cs.clipPath, haut: Math.round(b.getBoundingClientRect().top * 100) / 100 })
          if (performance.now() - debut < duree) requestAnimationFrame(image)
          else fin(film)
        }
        new Function('b', g)(b)
        requestAnimationFrame(image)
      }), [geste, ms])
      // les images où la barre a repris sa place
      const rendue = (film: Array<{ on: string | null }>) => film.findIndex((f) => f.on === null)

      // une transition de `translate` que l'auteur a posée sur sa barre, en vol au retour sous le seuil, continue : elle finit à sa valeur, elle n'est pas coupée avec les glissades de l'effet
      it('l\'auteur décale sa barre (transition de translate, 1 s) puis la page remonte sous le seuil dans la même tâche : sa transition continue, image après image, jusqu\'à sa valeur', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-auteur', async (page) => {
          await pageA(page, 600)
          await figee(page, true)
          await attendre(500)
          const film = await filme(page, 1500, 'b.classList.add("decale"); scrollTo(0, 0)')
          const i = rendue(film)
          assert.ok(i >= 0, 'elle a repris sa place')
          const valeurs = film.slice(i).map((f) => f.translate === 'none' ? 0 : parseFloat(f.translate))
          const distinctes = [...new Set(valeurs)]
          assert.ok(distinctes.length >= 10, `la transition de l'auteur glisse (${distinctes.length} valeurs : ${distinctes.slice(0, 6)} …)`)
          assert.ok(valeurs.every((v, k) => k === 0 || v >= valeurs[k - 1] - 0.01), 'elle va vers sa valeur sans reculer')
          assert.equal(valeurs[valeurs.length - 1], 40, 'et finit à sa valeur')
          assert.ok(film.slice(i).every((f) => f.on === null && f.haut === 0), 'la barre reste à sa place, jamais refigée')
        })
      })

      it('l\'auteur rogne sa barre (transition de clip-path, 1 s) puis la page remonte sous le seuil dans la même tâche : sa transition continue jusqu\'à sa valeur', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-rogne', async (page) => {
          await pageA(page, 600)
          await figee(page, true)
          await attendre(500)
          const film = await filme(page, 1500, 'b.classList.add("petit"); scrollTo(0, 0)')
          const i = rendue(film)
          assert.ok(i >= 0, 'elle a repris sa place')
          const droite = (clip: string) => { const m = /inset\(([^)]*)\)/.exec(clip); if (!m) return 0; const v = m[1].split(' '); return parseFloat(v.length === 1 ? v[0] : v[1]) }
          const valeurs = film.slice(i).map((f) => droite(f.clip))
          const distinctes = [...new Set(valeurs)]
          assert.ok(distinctes.length >= 10, `la transition de l'auteur glisse (${distinctes.length} valeurs : ${distinctes.slice(0, 6)} …)`)
          assert.ok(valeurs.every((v, k) => k === 0 || v >= valeurs[k - 1] - 0.01), 'elle va vers sa valeur sans reculer')
          assert.equal(valeurs[valeurs.length - 1], 50, 'et finit à sa valeur')
        })
      })

      // l'animation d'entrée meurt avec la règle qui la porte : revenue sous le seuil aussitôt figée, la barre est à sa place dès l'image suivante
      it('la page remonte sous le seuil pendant l\'animation d\'entrée : la barre est à sa place, immobile, jamais refigée', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          await pageA(page, 560)
          await jusqua(() => etat(page), (v: any) => v.on === 'sticky' && v.enCours > 0)
          const film = await filme(page, 1000, 'scrollTo(0, 0)')
          const i = rendue(film)
          assert.ok(i >= 0, 'elle a repris sa place')
          for (const [k, f] of film.slice(i).entries()) assert.deepEqual(f, { on: null, translate: 'none', clip: 'none', haut: 0 }, `image ${i + k} : à sa place, immobile, jamais refigée`)
        })
      })

      // dans une boîte qui défile, le rognage glisse avec la barre : le retour sous le seuil le rend aussi, sans qu'il survive à la perte de sa règle
      it('dans une boîte, la boîte remonte sous le seuil pendant la glissade de retour : la barre est à sa place, ni décalée ni rognée, jamais refigée', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-boite-cache', async (page) => {
          const pas = async (y: number) => { await boiteA(page, y); await attendre(150) }
          await pas(600)
          await figee(page, true)
          await pas(660)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          await attendre(600)
          await boiteA(page, 600)
          await jusqua(() => etat(page), (v: any) => v.cache === null && v.enCours > 0)
          const film = await filme(page, 1200, 'window.__trouve(".scene").scrollTop = 0')
          const i = rendue(film)
          assert.ok(i >= 0, 'elle a repris sa place')
          for (const [k, f] of film.slice(i).entries()) assert.deepEqual(f, { on: null, translate: 'none', clip: 'none', haut: 40 }, `image ${i + k} : à sa place sous le titre, ni décalée ni rognée, jamais refigée`)
        })
      })

      // la glissade de masquage en vol est renversée par le navigateur quand la barre revient à sa place (elle repart de son avancement vers la valeur de repos) : renversée, elle ne dit plus `-100%`
      // mais sa valeur d'un instant en pour-cent de la hauteur de la barre ; elle est coupée aussi, la barre n'a pas à la finir
      it('la page remonte sous le seuil pendant que la barre se cache lentement : la glissade renversée est coupée, la barre est à sa place d\'un coup', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-lent', async (page) => {
          await pageA(page, 600)
          await figee(page, true)
          await attendre(300)
          await pageA(page, 660)
          await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')
          await attendre(700)
          const film = await filme(page, 1500, 'scrollTo(0, 0)')
          const i = rendue(film)
          assert.ok(i >= 0, 'elle a repris sa place')
          for (const [k, f] of film.slice(i).entries()) assert.deepEqual(f, { on: null, translate: 'none', clip: 'none', haut: 0 }, `image ${i + k} : à sa place, immobile, jamais refigée`)
        })
      })

      it('deux barres figées dans la même page : une seule réserve la place des ancres, et rien ne reste quand elles sont revenues', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-deux', async (page) => {
          const figees = (n: number) => jusqua(() => page.evaluate(() => (document.querySelector('mjs-sticky-deux') as any)._shadow.querySelectorAll('[mjs-fx-sticky-pin]').length), (v: number) => v === n)
          await pageA(page, 300)
          assert.equal(await figees(1), 1, 'la première est figée')
          assert.equal(await reserve(page), '64px')
          await pageA(page, 800)
          assert.equal(await figees(2), 2, 'les deux sont figées')
          assert.equal(await reserve(page), '64px', 'une seule réserve, celle de la première')
          await pageA(page, 300)
          assert.equal(await figees(1), 1, 'la seconde est revenue')
          assert.equal(await reserve(page), '64px', 'la première réserve toujours')
          await pageA(page, 0)
          assert.equal(await figees(0), 0, 'toutes deux sont revenues')
          assert.equal(await reserve(page), '', 'rien ne reste')
        })
      })

      it('à l\'impression, la barre figée retrouve sa place dans le flux, sans habillage de glissement, et le tenant-lieu ne tient plus de place', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-impression', async (page) => {
          const lire = () => page.evaluate(() => {
            const b = (window as any).__trouve('.entete')
            const s = b.parentNode.querySelector('[mjs-fx-seat]')
            const c = getComputedStyle(b)
            const haut = (n: any) => n.getBoundingClientRect().top + scrollY
            return { pos: c.position, anim: c.animationName, opacite: c.opacity, barre: haut(b), ligne: haut((window as any).__trouve('.l')), siege: s ? getComputedStyle(s).display : null }
          })
          const repos = await lire()
          await pageA(page, 600)
          await figee(page, true, '.entete')
          const fige = await lire()
          assert.equal(fige.pos, 'fixed', 'à l\'écran, elle est fixe')
          assert.equal(fige.siege, 'block', 'et son tenant-lieu tient sa place')
          await page.emulateMedia({ media: 'print' })
          const imprime = await lire()
          assert.equal(imprime.pos, 'static', 'à l\'impression, elle est dans le flux')
          assert.equal(imprime.anim, 'none', 'sans glissement')
          assert.equal(imprime.siege, 'none', 'le tenant-lieu a disparu')
          assert.ok(Math.abs(imprime.barre - repos.barre) < 0.05, `elle est où elle était dans la page (${imprime.barre} / ${repos.barre})`)
          assert.ok(Math.abs(imprime.ligne - repos.ligne) < 0.05, `et le texte après elle aussi (${imprime.ligne} / ${repos.ligne})`)
          await page.emulateMedia({ media: null })
          assert.equal((await lire()).pos, 'fixed', 'revenue à l\'écran : fixe de nouveau')
        })
      })

      it('imprimée en PDF (Chromium), la barre figée n\'est écrite qu\'une fois, à sa place, au lieu de se répéter en haut de chaque page', async function () {
        if (!present || nom !== 'chromium') return this.skip()
        // la couche texte du PDF se lit avec pdftotext : sans lui, rien à lire
        if (spawnSync('pdftotext', ['-v']).error) return this.skip()
        await avec('mjs-sticky-impression', async (page) => {
          await pageA(page, 600)
          await figee(page, true, '.entete')
          const fichier = join(mjsTmp('effets-sticky-pdf'), 'page.pdf')
          writeFileSync(fichier, await page.pdf({ format: 'A4' }))
          const lu = spawnSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf-8' })
          assert.equal(lu.status, 0, lu.stderr)
          const pages = lu.stdout.split('\f').filter((p: string) => p.trim() !== '')
          const barres = pages.map((p: string) => (p.match(/BARRE-STICKY/g) || []).length)
          assert.ok(pages.length >= 2, `le document tient sur plusieurs pages (${pages.length})`)
          assert.deepEqual(barres, barres.map((_: number, i: number) => i === 0 ? 1 : 0), `la barre est sur la première page seulement (par page : ${barres.join(',')})`)
          const lignes = Array.from(lu.stdout.matchAll(/ligne (\d+) du document/g), (m: any) => Number(m[1]))
          assert.deepEqual(lignes, Array.from({ length: 60 }, (_, i) => i + 1), 'les soixante lignes y sont, dans l\'ordre')
        })
      })

      it('hide : le rebond d\'un défilement tactile au bout de la page ou de la boîte (la position lue dépasse le maximum puis revient) ne passe pas pour une remontée', async function () {
        if (!present) return this.skip()
        // la position lue est dictée à la page (le navigateur de bureau ne rebondit pas) ; le maximum, lui, est celui de la mise en page
        const dicter = (page: any, cible: string, y: number) => page.evaluate(([c, v]: [string, number]) => {
          const w = window as any
          const n = c === 'page' ? window : w.__trouve('.scene')
          const nom = c === 'page' ? 'scrollY' : 'scrollTop'
          w.__reel = { n, nom, d: Object.getOwnPropertyDescriptor(n, nom) }
          w.__faux = v
          Object.defineProperty(n, nom, { configurable: true, get: () => w.__faux })
          w.__rebond = (x: number) => { w.__faux = x; n.dispatchEvent(new Event('scroll')) }
        }, [cible, y] as [string, number])
        const rebond = async (page: any, y: number) => { await page.evaluate((v: number) => (window as any).__rebond(v), y); await attendre(150) }
        const rendre = (page: any) => page.evaluate(() => { const r = (window as any).__reel; if (r.d) Object.defineProperty(r.n, r.nom, r.d); else delete r.n[r.nom] })
        await avec('mjs-sticky-cache', async (page) => {
          const pas = async (y: number) => { await pageA(page, y); await attendre(120) }
          await pas(600)
          await figee(page, true)
          await pas(660)
          assert.equal((await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')).cache, 'hidden', 'cachée en descendant')
          const max = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)
          await pas(max)
          await dicter(page, 'page', max)
          await rebond(page, max + 70)
          await rebond(page, max)
          assert.equal((await etat(page)).cache, 'hidden', 'le rebond au bout de la page ne la ramène pas')
          await rendre(page)
          await pas(max - 100)
          assert.equal((await jusqua(() => etat(page), (v: any) => v.cache === null)).cache, null, 'une vraie remontée la ramène')
        })
        await avec('mjs-sticky-boite-cache', async (page) => {
          const pas = async (y: number) => { await boiteA(page, y); await attendre(120) }
          await pas(200)
          await figee(page, true)
          await pas(260)
          assert.equal((await jusqua(() => etat(page), (v: any) => v.cache === 'hidden')).cache, 'hidden', 'cachée en descendant')
          const max = await page.evaluate(() => { const s = (window as any).__trouve('.scene'); return s.scrollHeight - s.clientHeight })
          await pas(max)
          await dicter(page, 'boite', max)
          await rebond(page, max + 70)
          await rebond(page, max)
          assert.equal((await etat(page)).cache, 'hidden', 'le rebond au bout de la boîte ne la ramène pas')
          await rendre(page)
          await pas(max - 100)
          assert.equal((await jusqua(() => etat(page), (v: any) => v.cache === null)).cache, null, 'une vraie remontée la ramène')
        })
      })

      it('l\'écouteur de redimensionnement de la fenêtre ne dure que pendant que la barre est figée, et part avec le retrait de l\'effet', async function () {
        if (!present) return this.skip()
        await avec('mjs-sticky-page', async (page) => {
          await attendre(300)
          const base = await redim(page)
          await pageA(page, 700)
          await figee(page, true)
          assert.equal(await redim(page), base + 1, 'figée : un écouteur de redimensionnement')
          await pageA(page, 100)
          await figee(page, false)
          assert.equal(await redim(page), base, 'rendue à sa place : il est parti')
        })
        await avec('mjs-sticky-retrait', async (page) => {
          await attendre(300)
          const base = await redim(page)
          await pageA(page, 300)
          await figee(page, true)
          assert.equal(await redim(page), base + 1, 'figée : un écouteur de redimensionnement')
          await page.evaluate(() => (window as any).__trouve('.t').click())
          await jusqua(() => page.evaluate(() => !(window as any).__trouve('.barre')), (v: boolean) => v)
          assert.equal(await redim(page), base, 'le retrait de l\'effet pendant qu\'elle est figée le retire aussi')
        })
      })
    })
  }
})
