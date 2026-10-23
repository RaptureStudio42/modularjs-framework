// *travel dans Chromium (et Firefox, WebKit s'ils sont là) : une vraie mise en page est nécessaire, happy-dom ne
// mesure rien. La balise quitte sa place au fil du défilement et prend celle de sa destination (position, taille),
// sur la page comme dans un conteneur qui défile, plusieurs destinations dans l'ordre ; rotate, spin, arc, size,
// zone, fade, easing, « réduire les animations » ; une destination absente est signalée une fois ; tous les réglages
// tenus par une variable se suivent sans reposer l'effet ; le retrait rend le style ; rien ne tourne au repos.
// WebKit n'est présent que s'il est installé (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const ICI = dirname(fileURLToPath(import.meta.url))

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// la page de référence (1000 x 800) : la balise (100 x 100, centre 150 / 750) tout en haut, la destination
// (200 x 200, centre 600 / 2400) plus bas — sans lissage, avec une courbe droite : une position de défilement donne
// une place exacte. Au milieu de l'écran (400) : l'étape va du défilement 350 au défilement 2000
const STYLE  = '\n.t\n  width: 100px\n  height: 100px\n  margin: 700px 0 0 100px\n  background: #c33\n.vide\n  height: 1500px\n.d\n  width: 200px\n  height: 200px\n  margin-left: 500px\n  background: #3c3\n.fin\n  height: 900px\n'
const CADRE  = '\n.cadre\n  height: 500px\n  overflow: auto\n'
const ETAPES = '\n.t\n  width: 100px\n  height: 100px\n  margin: 700px 0 0 100px\n  background: #c33\n.s1\n  height: 350px\n.s2\n  height: 650px\n.s3\n  height: 700px\n.e1, .e2, .e3\n  width: 100px\n  height: 100px\n  background: #3c3\n.e1\n  margin-left: 500px\n.e2\n  margin-left: 300px\n.e3\n  margin-left: 600px\n.fin\n  height: 1000px\n'
const LONG   = STYLE.replace('height: 900px', 'height: 2600px')
// la balise tout en haut (centre 150 / 150), dans la moitié haute de l'écran : sans `zone`, son étape commence quand même au défilement 0
const HAUT        = STYLE.replace('margin: 700px 0 0 100px', 'margin: 100px 0 0 100px')
const ETAPES_HAUT = ETAPES.replace('margin: 700px 0 0 100px', 'margin: 20px 0 0 100px')
// la balise très loin sous l'écran (centre 150 / 3050), sa destination plus bas encore (centre 600 / 4700)
const LOIN   = STYLE.replace('margin: 700px 0 0 100px', 'margin: 3000px 0 0 100px')
// le voyage très long (balise 750, destination 4900) : un saut au milieu tombe à plus d'un écran de l'une comme de l'autre
const TRES_LONG = STYLE.replace('height: 1500px', 'height: 4000px')
// la destination juste sous la balise, toutes deux dans la moitié haute de l'écran (centres 150 / 350)
const PROCHE     = STYLE.replace('margin: 700px 0 0 100px', 'margin: 100px 0 0 100px').replace('height: 1500px', 'height: 50px').replace('height: 900px', 'height: 2500px')
// la balise cachée (display: none) à la pose
const MASQUE     = STYLE + '.t\n  display: none\n'
// la destination est ajoutée plus tard, hors du flux : le document ne change pas de taille
const TARD   = STYLE + '.tard\n  position: absolute\n  left: 700px\n  top: 1900px\n  width: 200px\n  height: 200px\n  background: #36c\n'
// des balises dont l'auteur a écrit un transform qui déplace leur centre (ou non), sept façons de voyager vers la même destination
const DECALAGE = ['.rangee', '  position: relative', '  height: 160px', '  margin-top: 600px', '.a, .b, .c, .dd, .e, .f, .g', '  position: absolute', '  top: 20px', '  width: 100px', '  height: 100px', '  background: #c33',
  '.a', '  left: 20px', '  transform: translateX(60px)', '.b', '  left: 180px', '  transform: rotate(30deg)', '.c', '  left: 340px', '  transform: scale(1.5)', '.dd', '  left: 540px', '  top: 70px', '  transform: translate(-50%, -50%)',
  '.e', '  left: 700px', '.f', '  left: 820px', '  transform: translateX(60px)', '.g', '  left: 460px', '  transform: translateX(60px)',
  '.vide', '  height: 1400px', '.d', '  width: 300px', '  height: 200px', '  margin-left: 50%', '  background: #3c3', '.fin', '  height: 1500px'].join('\n') + '\n'
// un conteneur qui ne défile qu'à l'horizontale (rien à défiler en hauteur) autour de la balise
const GLISSEUR = ['.avant', '  height: 600px', '.glisseur', '  width: 600px', '  height: 200px', '  overflow-x: auto', '.large', '  width: 1500px', '  height: 150px', '.t', '  width: 100px', '  height: 100px', '  margin: 20px 0 0 40px', '  background: #c33',
  '.vide', '  height: 1400px', '.d', '  width: 300px', '  height: 200px', '  margin-left: 700px', '  background: #3c3', '.fin', '  height: 1500px'].join('\n') + '\n'
// le composant parent porte la destination, son enfant porte la balise
const PARENT = '\n.vide\n  height: 1500px\n.d\n  width: 200px\n  height: 200px\n  margin-left: 500px\n  background: #3c3\n.fin\n  height: 900px\n'
const ENFANT = '\n.t\n  width: 100px\n  height: 100px\n  margin: 700px 0 0 100px\n  background: #c33\n'
const BOUTONS = '<button class="b-rotate" @click={$rotate = 90}>r</button><button class="b-arc" @click={$arc = 100}>a</button><button class="b-size" @click={$size = false}>s</button><button class="b-fade" @click={$fade = true}>f</button><button class="b-spin" @click={$spin = 60}>p</button><button class="b-zone" @click={$zone = \'80% 20%\'}>z</button><button class="b-to" @click={$to = \'.d2\'}>t</button>'

const SOURCES: Record<string, string> = {
  // la balise, sa destination, la page qui défile
  'travel-page.mjs':     `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // les valeurs par défaut (lissage 0.12, courbe ease-in-out) et un défilement qui laisse de la place loin après le voyage
  'travel-lisse.mjs':    `<div class="page"><div class="t" *travel('.d')></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${LONG}</style>\n`,
  // dans un conteneur qui défile, dans le shadow root du composant : l'écran est le conteneur (500 de haut, milieu à 250)
  'travel-cadre.mjs':    `<div class="cadre"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}${CADRE}</style>\n`,
  // un conteneur en overflow caché qui défile par script : le premier défilement l'adopte
  'travel-cache.mjs':    `<div class="cadre"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}${CADRE.replace('auto', 'hidden')}</style>\n`,
  // trois destinations, dans l'ordre
  'travel-etapes.mjs':   `<div class="page"><div class="t" *travel('.e1, .e2, .e3', easing: linear, smooth: 0)></div><div class="s1"></div><div class="e1"></div><div class="s2"></div><div class="e2"></div><div class="s3"></div><div class="e3"></div><div class="fin"></div></div>\n<style>${ETAPES}</style>\n`,
  // une destination absente, puis une bonne
  'travel-manque.mjs':   `<div class="page"><div class="t" *travel('.absent, .d, :::', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // la rotation à plat sur tout le voyage
  'travel-rotate.mjs':   `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, rotate: 90)></div><div class="vide"></div><div class="d"></div><div class="ref"></div><div class="fin"></div></div>\n<style>${STYLE}.ref\n  position: absolute\n  width: 100px\n  height: 60px\n  left: 100px\n  top: 100px\n  background: #36c\n</style>\n`,
  // la rotation autour de l'axe vertical, composée avec celle à plat ; une référence écrite en transform
  'travel-spin.mjs':     `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, rotate: 40, spin: 70, size: false)></div><div class="vide"></div><div class="d"></div><div class="ref"></div><div class="fin"></div></div>\n<style>${STYLE}.t\n  height: 60px\n.ref\n  position: absolute\n  width: 100px\n  height: 60px\n  left: 100px\n  top: 720px\n  background: #36c\n</style>\n`,
  // la bosse du chemin
  'travel-arc.mjs':      `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, arc: 100, size: false)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // la taille de la destination refusée : seulement la place
  'travel-taille.mjs':   `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, size: false)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // la bande de l'écran : l'étape commence quand la place de départ est à 80 %, finit quand celle d'arrivée est à 20 %
  'travel-zone.mjs':     `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, zone: '80% 20%')></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // la destination cachée tant que la balise n'y est pas arrivée
  'travel-fondu.mjs':    `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0, fade: true)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // une courbe qui dépasse : la balise dépasse sa destination sans y rester
  'travel-courbe.mjs':   `<div class="page"><div class="t" *travel('.d', easing: cubic-bezier(.34, 1.56, .64, 1), smooth: 0, size: false)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`,
  // tous les réglages tenus par une variable
  'travel-vivant.mjs':   `<div class="page"><div class="t" *travel(to: $to, easing: linear, smooth: 0, rotate: $rotate, arc: $arc, size: $size, fade: $fade, spin: $spin, zone: $zone)></div><div class="vide"></div><div class="d"></div><div class="d2"></div><div class="fin"></div>${BOUTONS}</div>\n<script>\n$to     = '.d'\n$rotate = 0\n$arc    = 0\n$size   = true\n$fade   = false\n$spin   = 0\n$zone   = '50% 50%'\n</script>\n<style>${STYLE}.d2\n  width: 100px\n  height: 100px\n  margin: 300px 0 0 800px\n  background: #36c\n</style>\n`,
  // le retrait : un bloc {if} refermé ; la balise porte un style de l'auteur (le seul inline du fichier : c'est ce que le retrait doit garder)
  'travel-retrait.mjs':  `<div class="page">{if $on}<div class="t" style="opacity: .9" *travel('.d', easing: linear, smooth: 0, fade: true, rotate: 30)></div>{end}<div class="vide"></div><div class="d"></div><div class="fin"></div><button class="b-on" @click={$on = !$on}>t</button></div>\n<script>\n$on = true\n</script>\n<style>${STYLE}</style>\n`,
  // la balise dans la moitié haute de l'écran, sans `zone` : à 0 de défilement elle est sur sa place
  'travel-haut.mjs':     `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${HAUT}</style>\n`,
  // trois étapes avec rotate et arc, la balise tout en haut, sans `zone`
  'travel-haut-etapes.mjs': `<div class="page"><div class="t" *travel('.e1, .e2, .e3', easing: linear, smooth: 0, rotate: 360, arc: 80)></div><div class="s1"></div><div class="e1"></div><div class="s2"></div><div class="e2"></div><div class="s3"></div><div class="e3"></div><div class="fin"></div></div>\n<style>${ETAPES_HAUT}</style>\n`,
  // sept balises voyagent vers la même destination, leur transform (écrit par l'auteur) déplace ou non leur centre
  'travel-decalage.mjs': `<div class="rangee"><div class="a" *travel('.d', easing: linear, smooth: 0)></div><div class="b" *travel('.d', easing: linear, smooth: 0)></div><div class="c" *travel('.d', easing: linear, smooth: 0)></div><div class="dd" *travel('.d', easing: linear, smooth: 0)></div><div class="e" *travel('.d', easing: linear, smooth: 0)></div><div class="f" *travel('.d', easing: linear, smooth: 0, rotate: 90)></div><div class="g" *travel('.d', easing: linear, smooth: 0, rotate: 40, spin: 70)></div></div><div class="vide"></div><div class="d"></div><div class="fin"></div>\n<style>${DECALAGE}</style>\n`,
  // un conteneur qui ne défile qu'à l'horizontale autour de la balise
  'travel-glisseur.mjs': `<div class="avant"></div><div class="glisseur"><div class="large"><div class="t" *travel('.d', easing: linear, smooth: 0)></div></div></div><div class="vide"></div><div class="d"></div><div class="fin"></div>\n<style>${GLISSEUR}</style>\n`,
  // la destination vit dans le composant parent, la balise dans l'enfant
  'travel-parent.mjs':   `<div class="page"><mjs-travel-enfant></mjs-travel-enfant><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${PARENT}</style>\n`,
  'travel-enfant.mjs':   `<div class="t" *travel('.d', easing: linear, smooth: 0)></div>\n<style>${ENFANT}</style>\n`,
  // la balise et sa destination à plus d'un écran ; un bouton retire l'effet (ce que la page porte sans lui)
  'travel-loin.mjs':     `<div class="page">{if $on}<div class="t" *travel('.d', easing: linear, smooth: 0)></div>{end}<div class="vide"></div><div class="d"></div><div class="fin"></div><button class="b-on" @click={$on = !$on}>t</button></div>\n<script>\n$on = true\n</script>\n<style>${LOIN}</style>\n`,
  // la destination n'existe pas à la pose, un bouton l'ajoute hors du flux
  'travel-tard.mjs':     `<div class="page"><div class="t" *travel('.tard', easing: linear, smooth: 0)></div><div class="vide"></div>{if $tard}<div class="tard"></div>{end}<div class="fin"></div><button class="b-tard" @click={$tard = true}>t</button></div>\n<script>\n$tard = false\n</script>\n<style>${TARD}</style>\n`,
  // un très long voyage avec le lissage par défaut
  'travel-tres-long.mjs': `<div class="page"><div class="t" *travel('.d', easing: linear)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${TRES_LONG}</style>\n`,
  // la destination déjà au milieu de l'écran quand la page est en haut
  'travel-proche.mjs':   `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${PROCHE}</style>\n`,
  // la balise cachée à la pose, montrée ensuite par le test
  'travel-masque.mjs':   `<div class="page"><div class="t" *travel('.d', easing: linear, smooth: 0)></div><div class="vide"></div><div class="d"></div><div class="fin"></div></div>\n<style>${MASQUE}</style>\n`,
  // la courbe et le lissage tenus par une variable
  'travel-courbes.mjs':  `<div class="page"><div class="t" *travel('.d', easing: $courbe, smooth: $lissage)></div><div class="vide"></div><div class="d"></div><div class="fin"></div><button class="b-courbe" @click={$courbe = 'ease-in'}>c</button><button class="b-lisse" @click={$lissage = 0.8}>l</button></div>\n<script>\n$courbe  = 'linear'\n$lissage = 0\n</script>\n<style>${STYLE}</style>\n`,
  // le retrait en plein mouvement (lissage long), avec une balise en ligne à côté
  'travel-retrait-lisse.mjs': `<div class="page">{if $on}<div class="t" *travel('.d', easing: linear, smooth: 1)></div><span class="in" *travel('.d', easing: linear, smooth: 1)></span>{end}<div class="vide"></div><div class="d"></div><div class="fin"></div><button class="b-on" @click={$on = !$on}>t</button></div>\n<script>\n$on = true\n</script>\n<style>${STYLE}.in\n  width: 40px\n  height: 40px\n  background: #36c\n</style>\n`
}

// ce que la page compte : les images d'animation en attente, les minuteries d'intervalle vivantes
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__iv = new Set()
  const si = w.setInterval.bind(w)
  const ci = w.clearInterval.bind(w)
  w.setInterval = (f: any, d: number, ...a: any[]) => { const h = si(f, d, ...a); w.__iv.add(h); return h }
  w.clearInterval = (h: number) => { w.__iv.delete(h); return ci(h) }
}

// les écouteurs de défilement et les observateurs de taille vivants : posés par l'effet, ils doivent partir avec lui
const SURVEILLE = () => {
  const w = window as any
  w.__sc = []
  const cap = (o: any) => typeof o === 'boolean' ? o : !!(o && o.capture)
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (this: any, type: string, f: any, o?: any) {
    if (type === 'scroll' && f) w.__sc.push([this, f, cap(o)])
    return ajoute.call(this, type, f, o)
  } as any
  EventTarget.prototype.removeEventListener = function (this: any, type: string, f: any, o?: any) {
    if (type === 'scroll') {
      const i = w.__sc.findIndex((e: any) => e[0] === this && e[1] === f && e[2] === cap(o))
      if (i >= 0) w.__sc.splice(i, 1)
    }
    return retire.call(this, type, f, o)
  } as any
  w.__ro = new Set()
  const observe    = w.ResizeObserver.prototype.observe
  const deconnecte = w.ResizeObserver.prototype.disconnect
  w.ResizeObserver.prototype.observe    = function (this: any, ...a: any[]) { w.__ro.add(this); return observe.apply(this, a) }
  w.ResizeObserver.prototype.disconnect = function (this: any) { w.__ro.delete(this); return deconnecte.call(this) }
}

// ce que l'effet lit et écrit pendant un défilement : la position de la page lue PENDANT le traitement d'un évènement de défilement, comptée
// par évènement (`__sy` : évènement -> nombre de lectures ; `window.event` désigne l'évènement en cours de traitement, et rien hors de lui —
// un observateur qui répond entre deux évènements ne compte pas), les lectures de mise en page faites DANS une image d'animation (`__lect`),
// les écritures de style (`__ecrit` : [propriété, numéro de l'image d'animation, 0 hors d'une image])
const LECTURES = [
  '(() => { const w = window; w.__sy = new Map(); w.__img = 0; w.__lect = []; w.__ecrit = []; let dedans = 0; const r0 = w.requestAnimationFrame;',
  '  w.requestAnimationFrame = function(f) { return r0.call(w, function(t) { dedans++; w.__img++; try { return f(t) } finally { dedans-- } }) };',
  '  const compte = (cible, nom) => { const d = Object.getOwnPropertyDescriptor(cible, nom); if (!d || !d.get) return;',
  '    Object.defineProperty(cible, nom, { configurable: true, enumerable: d.enumerable, set: d.set, get() { const ev = w.event; if (nom === "scrollY" && ev && ev.type === "scroll") w.__sy.set(ev, (w.__sy.get(ev) || 0) + 1); if (dedans) w.__lect.push(nom); return d.get.call(this) } }) };',
  '  for (const n of ["scrollTop", "scrollLeft", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight", "clientTop", "clientLeft"]) compte(Element.prototype, n);',
  '  for (const n of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]) compte(HTMLElement.prototype, n);',
  '  for (const n of ["pageYOffset", "pageXOffset", "scrollY", "scrollX"]) compte(w, n);',
  '  for (const n of ["getBoundingClientRect", "getClientRects"]) { const o = Element.prototype[n]; Element.prototype[n] = function() { if (dedans) w.__lect.push(n); return o.apply(this, arguments) } }',
  '  const g = w.getComputedStyle; w.getComputedStyle = function() { if (dedans) w.__lect.push("getComputedStyle"); return g.apply(w, arguments) };',
  '  const sp = CSSStyleDeclaration.prototype; const set = sp.setProperty; const rem = sp.removeProperty;',
  '  sp.setProperty = function(n, v, p) { w.__ecrit.push([n, dedans ? w.__img : 0]); return set.call(this, n, v, p) };',
  '  sp.removeProperty = function(n) { w.__ecrit.push([n, dedans ? w.__img : 0]); return rem.call(this, n) } })()'
].join('\n')

type Boite = { x: number, y: number, w: number, h: number }

// la courbe CSS cubic-bezier(x1, y1, x2, y2) : l'ordonnée pour une abscisse x, résolue par dichotomie
const bezierY = (x: number, x1: number, y1: number, x2: number, y2: number): number => {
  const at = (t: number, p: number, q: number) => 3 * p * t * (1 - t) * (1 - t) + 3 * q * t * t * (1 - t) + t * t * t
  let a = 0
  let b = 1
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    if (at(m, x1, x2) < x) a = m
    else b = m
  }
  return at((a + b) / 2, y1, y2)
}

describe('*travel (navigateurs réels) — la balise voyage d\'une place à l\'autre au fil du défilement', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-travel')
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

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute (avec ce que la console a dit), la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any, console: string[]) => Promise<T>, options: { reduit?: boolean, surveille?: boolean, lectures?: boolean, dedans?: string } = {}): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        const dit: string[] = []
        try {
          if (options.reduit) await page.emulateMedia({ reducedMotion: 'reduce' })
          page.on('console', (m: any) => dit.push(m.text()))
          await page.addInitScript(COMPTEURS)
          if (options.surveille) await page.addInitScript(SURVEILLE)
          if (options.lectures) await page.addInitScript(LECTURES)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          // `dedans` : la balise vit dans le composant enfant de celui-là
          await page.waitForFunction(([t, d]: [string, string]) => { const racine = (document.querySelector(t) as any)?._shadow; return !!(d ? racine?.querySelector(d)?._shadow : racine)?.querySelector('[mjs-fx]') }, [tag, options.dedans ?? ''])
          // le premier avis du ResizeObserver (les boîtes relues une fois la mise en page faite)
          await page.waitForTimeout(150)
          return await fn(page, dit)
        }
        finally {
          await page.close()
        }
      }

      // la boîte d'un élément du composant : son centre et sa taille, dans l'espace du défilement (la page, ou le conteneur `.cadre`)
      const boite = (page: any, tag: string, sel: string): Promise<Boite> => page.evaluate(([t, s]: [string, string]) => {
        const sh = (document.querySelector(t) as any)._shadow
        const b  = sh.querySelector(s).getBoundingClientRect()
        const c  = sh.querySelector('.cadre')
        const r  = c ? c.getBoundingClientRect() : { left: -scrollX, top: -scrollY }
        const dx = c ? c.scrollLeft - c.clientLeft : 0
        const dy = c ? c.scrollTop - c.clientTop : 0
        return { x: b.left - r.left + dx + b.width / 2, y: b.top - r.top + dy + b.height / 2, w: b.width, h: b.height }
      }, [tag, sel])

      // défile (la page, ou le conteneur) et laisse passer deux images : l'effet y a répondu ; puis un instant de plus,
      // l'observateur qui réveille l'effet venu de loin répond au tour d'après
      const defile = async (page: any, tag: string, y: number): Promise<void> => {
        await page.evaluate(([t, v]: [string, number]) => {
          const c = (document.querySelector(t) as any)._shadow.querySelector('.cadre')
          if (c) c.scrollTop = v
          else window.scrollTo(0, v)
          return new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())))
        }, [tag, y])
        await page.waitForTimeout(40)
      }

      const style = (page: any, tag: string, sel: string, prop: string): Promise<string> => page.evaluate(([t, s, p]: [string, string, string]) => (document.querySelector(t) as any)._shadow.querySelector(s).style.getPropertyValue(p), [tag, sel, prop])
      const calcule = (page: any, tag: string, sel: string, prop: string): Promise<string> => page.evaluate(([t, s, p]: [string, string, string]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector(s)).getPropertyValue(p), [tag, sel, prop])

      const proche = (a: number, b: number, quoi: string, tol = 1.5) => assert.ok(Math.abs(a - b) <= tol, `${quoi} : ${a.toFixed(2)} attendu ${b.toFixed(2)} (à ${tol} près)`)
      const sur = (a: Boite, b: Boite, quoi: string, tol = 1.5) => {
        proche(a.x, b.x, `${quoi} — x`, tol)
        proche(a.y, b.y, `${quoi} — y`, tol)
      }

      // ----- la page qui défile -----

      it('au repos la balise est sur sa place (rien d\'écrit) ; au milieu de l\'étape, à mi-chemin ; au bout, sur la destination, à sa taille', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-page', async (page) => {
          const tag = 'mjs-travel-page'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.x, depart.y, depart.w, depart.h], [150, 750, 100, 100], 'la mise en page de l\'essai')
          assert.deepEqual([but.x, but.y, but.w, but.h], [600, 2400, 200, 200], 'la mise en page de l\'essai')
          await defile(page, tag, 350)
          sur(await boite(page, tag, '.t'), depart, 'défilement 350 : la place de départ est au milieu de l\'écran, la balise n\'a pas bougé')
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'rien d\'écrit au point de départ')
          await defile(page, tag, 1175)
          const mi = await boite(page, tag, '.t')
          sur(mi, { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'au milieu de l\'étape : à mi-chemin')
          proche(mi.w, 150, 'au milieu de l\'étape : la taille est à mi-chemin (100 → 200)', 1)
          await defile(page, tag, 2000)
          const fin = await boite(page, tag, '.t')
          sur(fin, but, 'au bout : sur la destination')
          proche(fin.w, 200, 'au bout : la largeur de la destination', 1)
          proche(fin.h, 200, 'au bout : la hauteur de la destination', 1)
          await defile(page, tag, 2600)
          sur(await boite(page, tag, '.t'), but, 'plus bas : elle reste posée sur la destination')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'on remonte : elle revient')
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'revenue : plus rien d\'écrit')
          assert.equal(await style(page, tag, '.t', 'scale'), '', 'revenue : plus rien d\'écrit')
        })
      })

      it('un conteneur qui défile, dans le shadow root du composant : c\'est lui qui compte (le milieu du conteneur, pas de l\'écran)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-cadre', async (page) => {
          const tag = 'mjs-travel-cadre'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          // le conteneur fait 500 de haut : son milieu est à 250, l'étape va du défilement 500 au défilement 2150
          await defile(page, tag, 500)
          sur(await boite(page, tag, '.t'), depart, 'défilement 500 : au départ')
          await defile(page, tag, 1325)
          sur(await boite(page, tag, '.t'), { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'au milieu de l\'étape')
          await defile(page, tag, 2150)
          const fin = await boite(page, tag, '.t')
          sur(fin, but, 'au bout : sur la destination')
          proche(fin.w, 200, 'au bout : la largeur de la destination', 1)
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'on remonte : elle revient')
        })
      })

      it('un conteneur en overflow caché que le script fait défiler : son premier défilement l\'adopte', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-cache', async (page) => {
          const tag = 'mjs-travel-cache'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          await defile(page, tag, 2150)
          sur(await boite(page, tag, '.t'), but, 'sur la destination, un conteneur caché adopté au premier défilement')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'on remonte : elle revient')
        })
      })

      it('plusieurs destinations : elle passe par chacune, dans l\'ordre, et reste sur la dernière', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-etapes', async (page) => {
          const tag = 'mjs-travel-etapes'
          const e1 = await boite(page, tag, '.e1')
          const e2 = await boite(page, tag, '.e2')
          const e3 = await boite(page, tag, '.e3')
          assert.deepEqual([e1.x, e1.y, e2.x, e2.y, e3.x, e3.y], [550, 1200, 350, 1950, 650, 2750], 'la mise en page de l\'essai')
          // au milieu de l'écran (400) : étapes 350 → 800 (e1), 800 → 1550 (e2), 1550 → 2350 (e3)
          await defile(page, tag, 800)
          sur(await boite(page, tag, '.t'), e1, 'défilement 800 : sur la première')
          await defile(page, tag, 1175)
          sur(await boite(page, tag, '.t'), { x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2, w: 0, h: 0 }, 'entre la première et la deuxième : à mi-chemin')
          await defile(page, tag, 1550)
          sur(await boite(page, tag, '.t'), e2, 'défilement 1550 : sur la deuxième')
          await defile(page, tag, 2350)
          sur(await boite(page, tag, '.t'), e3, 'défilement 2350 : sur la troisième')
          await defile(page, tag, 3000)
          sur(await boite(page, tag, '.t'), e3, 'plus bas : reste sur la dernière')
          await defile(page, tag, 1000)
          sur(await boite(page, tag, '.t'), { x: e1.x + (e2.x - e1.x) * (200 / 750), y: e1.y + (e2.y - e1.y) * (200 / 750), w: 0, h: 0 }, 'on remonte : elle repasse par le même chemin')
        })
      })

      it('une destination introuvable ou illisible : un seul avertissement, son étape est sautée, les autres marchent', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-manque', async (page, dit) => {
          const tag = 'mjs-travel-manque'
          const but = await boite(page, tag, '.d')
          await defile(page, tag, 2000)
          sur(await boite(page, tag, '.t'), but, 'la bonne destination est atteinte malgré les deux mauvaises')
          // la destination change de taille : les boîtes sont relues, rien n'est dit une seconde fois
          await page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelector('.d').style.height = '210px' }, tag)
          await page.waitForTimeout(150)
          await defile(page, tag, 0)
          await defile(page, tag, 2000)
          const avis = dit.filter((m) => /\*travel/.test(m))
          assert.equal(avis.filter((m) => m.includes('« .absent »')).length, 1, `.absent signalée une fois — ${JSON.stringify(avis)}`)
          assert.equal(avis.filter((m) => m.includes('« ::: »')).length, 1, `le sélecteur illisible signalé une fois — ${JSON.stringify(avis)}`)
          assert.equal(avis.length, 2, 'rien d\'autre')
        })
      })

      // ----- les réglages -----

      it('rotate : la rotation à plat se fait sur tout le voyage (la moitié au milieu, le tout au bout)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-rotate', async (page) => {
          const tag = 'mjs-travel-rotate'
          await defile(page, tag, 1175)
          assert.equal(await calcule(page, tag, '.t', 'rotate'), '45deg')
          await defile(page, tag, 2000)
          assert.equal(await calcule(page, tag, '.t', 'rotate'), '90deg')
          await defile(page, tag, 0)
          assert.equal(await calcule(page, tag, '.t', 'rotate'), 'none', 'revenue : plus de rotation')
        })
      })

      it('spin : la rotation autour de l\'axe vertical se compose avec celle à plat — mêmes boîtes qu\'un `rotate() rotateY()` écrit en transform', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-spin', async (page) => {
          const tag = 'mjs-travel-spin'
          // la balise fait ici 60 de haut : le voyage va du défilement (départ - 400) à (arrivée - 400)
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          const debut  = depart.y - 400
          const fin    = but.y - 400
          for (const f of [0.5, 1, 0.25]) {
            const pos = debut + f * (fin - debut)
            await defile(page, tag, pos)
            const vu  = await boite(page, tag, '.t')
            // la référence : une boîte de même taille et de même centre, tournée par `transform`
            const ref = await page.evaluate(([t, a, b, cx, cy]: [string, number, number, number, number]) => {
              const r = (document.querySelector(t) as any)._shadow.querySelector('.ref')
              r.style.width  = '100px'
              r.style.height = '60px'
              r.style.left   = (cx - 50) + 'px'
              r.style.top    = (cy - 30) + 'px'
              r.style.transform = `rotate(${a}deg) rotateY(${b}deg)`
              const g = r.getBoundingClientRect()
              return { w: g.width, h: g.height }
            }, [tag, 40 * f, 70 * f, vu.x, vu.y])
            proche(vu.w, ref.w, `à ${f * 100} % du voyage : la largeur de la boîte tournée`, 0.6)
            proche(vu.h, ref.h, `à ${f * 100} % du voyage : la hauteur de la boîte tournée`, 0.6)
          }
          // la propriété écrite est bien un axe et un angle
          await defile(page, tag, fin)
          assert.match(await style(page, tag, '.t', 'rotate'), /^-?[\d.]+ -?[\d.]+ -?[\d.]+ [\d.]+deg$/)
        })
      })

      it('arc : le chemin bombe de 100 px, à droite d\'un voyage qui descend ; droit au départ et à l\'arrivée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-arc', async (page) => {
          const tag = 'mjs-travel-arc'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          const dx = but.x - depart.x
          const dy = but.y - depart.y
          const len = Math.sqrt(dx * dx + dy * dy)
          await defile(page, tag, 1175)
          const mi = await boite(page, tag, '.t')
          sur(mi, { x: (depart.x + but.x) / 2 + 100 * dy / len, y: (depart.y + but.y) / 2 - 100 * dx / len, w: 0, h: 0 }, 'au milieu : la bosse est de 100 px, perpendiculaire, vers la droite de l\'écran')
          assert.ok(mi.x > (depart.x + but.x) / 2, 'vers la droite')
          await defile(page, tag, 2000)
          sur(await boite(page, tag, '.t'), but, 'à l\'arrivée la bosse est retombée')
        })
      })

      it('size: false : la balise garde sa taille, elle ne prend que la place', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-taille', async (page) => {
          const tag = 'mjs-travel-taille'
          const but = await boite(page, tag, '.d')
          await defile(page, tag, 2000)
          const fin = await boite(page, tag, '.t')
          sur(fin, but, 'sur la destination')
          assert.deepEqual([Math.round(fin.w), Math.round(fin.h)], [100, 100], 'sa taille d\'origine')
          assert.equal(await style(page, tag, '.t', 'scale'), '', 'scale jamais écrit')
        })
      })

      it('zone: « 80% 20% » : l\'étape commence quand la place de départ est à 80 % de l\'écran, finit quand celle d\'arrivée est à 20 %', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-zone', async (page) => {
          const tag = 'mjs-travel-zone'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          // 750 - 0.8 x 800 = 110 ; 2400 - 0.2 x 800 = 2240
          await defile(page, tag, 110)
          sur(await boite(page, tag, '.t'), depart, 'défilement 110 : la place de départ est à 80 % de l\'écran, elle n\'a pas bougé')
          await defile(page, tag, 1175)
          sur(await boite(page, tag, '.t'), { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'au milieu de la course (110 → 2240 : 1175)')
          await defile(page, tag, 2240)
          sur(await boite(page, tag, '.t'), but, 'défilement 2240 : sur la destination')
        })
      })

      it('fade : la destination est cachée tant que la balise n\'y est pas arrivée, et se montre à son arrivée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-fondu', async (page) => {
          const tag = 'mjs-travel-fondu'
          assert.equal(await style(page, tag, '.d', 'visibility'), 'hidden', 'cachée au départ')
          await defile(page, tag, 1175)
          assert.equal(await style(page, tag, '.d', 'visibility'), 'hidden', 'cachée en route')
          await defile(page, tag, 2000)
          assert.equal(await style(page, tag, '.d', 'visibility'), '', 'montrée à l\'arrivée')
          await defile(page, tag, 1175)
          assert.equal(await style(page, tag, '.d', 'visibility'), 'hidden', 'cachée de nouveau quand la balise repart')
        })
      })

      it('easing : une courbe qui dépasse (cubic-bezier à 1,56) dépasse la destination sans s\'y arrêter', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-courbe', async (page) => {
          const tag = 'mjs-travel-courbe'
          const but = await boite(page, tag, '.d')
          // une courbe à ordonnée 1,56 dépasse 1 vers les trois quarts de l'étape
          let plusBas = 0
          for (const pos of [1400, 1500, 1600, 1700]) {
            await defile(page, tag, pos)
            plusBas = Math.max(plusBas, (await boite(page, tag, '.t')).y)
          }
          assert.ok(plusBas > but.y + 5, `la balise a dépassé la destination (${plusBas.toFixed(1)} > ${but.y})`)
          await defile(page, tag, 2000)
          sur(await boite(page, tag, '.t'), but, 'à la fin elle est sur la destination')
        })
      })

      it('« réduire les animations » : ni rotation ni lissage, la balise saute d\'une place à l\'autre à mi-chemin', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-rotate', async (page) => {
          const tag = 'mjs-travel-rotate'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          await defile(page, tag, 1000)
          sur(await boite(page, tag, '.t'), depart, 'avant le milieu de l\'étape : sur sa place')
          await defile(page, tag, 1400)
          sur(await boite(page, tag, '.t'), but, 'après le milieu : d\'un coup sur la destination')
          assert.equal(await calcule(page, tag, '.t', 'rotate'), 'none', 'aucune rotation')
        }, { reduit: true })
      })

      // ----- les réglages tenus par une variable -----

      async function clic(page: any, tag: string, bouton: string) {
        await page.evaluate(([t, b]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector(b).click(), [tag, bouton])
        await page.waitForTimeout(120)
      }

      it('tous les réglages tenus par une variable se suivent sans reposer l\'effet (rotate, arc, size, spin, fade, zone, to)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-vivant', async (page) => {
          const tag = 'mjs-travel-vivant'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          await page.evaluate((t: string) => { (window as any).__off = ((document.querySelector(t) as any)._shadow.querySelector('.t') as any)._mjs_fxOff.travel }, tag)
          await defile(page, tag, 2000)
          sur(await boite(page, tag, '.t'), but, 'départ : sur la destination')
          await clic(page, tag, '.b-rotate')
          assert.equal(await calcule(page, tag, '.t', 'rotate'), '90deg', 'rotate suivi sur place')
          await clic(page, tag, '.b-spin')
          assert.match(await style(page, tag, '.t', 'rotate'), /^-?[\d.]+ -?[\d.]+ -?[\d.]+ [\d.]+deg$/, 'spin suivi sur place : un axe et un angle')
          await clic(page, tag, '.b-size')
          assert.equal(await style(page, tag, '.t', 'scale'), '', 'size: false : l\'échelle est rendue')
          await clic(page, tag, '.b-fade')
          await defile(page, tag, 1175)
          assert.equal(await style(page, tag, '.d', 'visibility'), 'hidden', 'fade suivi sur place : la destination se cache')
          // arc : la bosse apparaît à mi-course
          const sans = await boite(page, tag, '.t')
          await clic(page, tag, '.b-arc')
          const avec100 = await boite(page, tag, '.t')
          assert.ok(Math.abs(avec100.x - sans.x) > 50, `arc suivi sur place : la balise s'écarte (${sans.x.toFixed(1)} → ${avec100.x.toFixed(1)})`)
          // zone : les bornes de l'étape changent (80 % → 20 % : l'étape finit à 2240)
          await clic(page, tag, '.b-zone')
          await defile(page, tag, 2000)
          const loin = await boite(page, tag, '.t')
          assert.ok(Math.abs(loin.y - but.y) > 20, 'zone suivie sur place : la balise n\'est plus sur la destination à 2000')
          // to : une autre destination
          await clic(page, tag, '.b-to')
          await defile(page, tag, 3000)
          const d2 = await boite(page, tag, '.d2')
          proche((await boite(page, tag, '.t')).x, d2.x, 'to suivi : la balise va vers la nouvelle destination', 2)
          const meme = await page.evaluate((t: string) => (window as any).__off === ((document.querySelector(t) as any)._shadow.querySelector('.t') as any)._mjs_fxOff.travel, tag)
          assert.ok(meme, 'le même effet, jamais reposé')
          assert.ok(depart.x > 0)
        })
      })

      // ----- le retrait, le repos -----

      it('le retrait ({if} refermé) rend tout : style d\'origine, destination visible, balise du moteur', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-retrait', async (page) => {
          const tag = 'mjs-travel-retrait'
          const avant = await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').getAttribute('style'), tag)
          assert.match(avant ?? '', /^opacity:\s*0?\.9;?$/, 'le style posé par l\'auteur avant l\'effet, tel quel')
          await defile(page, tag, 1175)
          const enVol = await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').getAttribute('style'), tag)
          assert.match(enVol, /translate: /, 'en vol, la balise est déplacée')
          assert.match(enVol, /opacity: 0\.9/, 'le style de l\'auteur est gardé')
          assert.equal(await style(page, tag, '.d', 'visibility'), 'hidden')
          await page.evaluate((t: string) => { (window as any).__ancienne = (document.querySelector(t) as any)._shadow.querySelector('.t') }, tag)
          await clic(page, tag, '.b-on')
          assert.equal(await style(page, tag, '.d', 'visibility'), '', 'la destination est rendue visible')
          const rendue = await page.evaluate(() => (window as any).__ancienne.getAttribute('style'))
          assert.ok(!/translate|scale|rotate|will-change/.test(rendue ?? ''), `la balise retirée est rendue sans rien de l'effet (${rendue})`)
          assert.match(rendue ?? '', /opacity: 0\.9/, 'le style de l\'auteur est resté')
          // la balise neuve est posée là où le défilement en est (en vol), puis revient à sa place quand on remonte
          await clic(page, tag, '.b-on')
          const neuve = await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').getAttribute('style'), tag)
          assert.match(neuve ?? '', /translate: /, 'la balise neuve est en vol, comme le défilement le veut')
          await defile(page, tag, 0)
          const repos = await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').getAttribute('style'), tag)
          assert.ok(!/translate|scale|rotate|will-change/.test(repos ?? ''), `revenue à sa place, rien en route (${repos})`)
          assert.equal(await page.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.t') as any)._mjs_fxOff?.travel ? 1 : 0, tag), 1, 'l\'effet est reposé sur la balise neuve')
        })
      })

      it('le retrait défait tout : écouteurs de défilement et observateurs de taille rendus, sans fuite après plusieurs allers-retours', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-retrait', async (page) => {
          const tag    = 'mjs-travel-retrait'
          const compte = () => page.evaluate(() => ({ ecouteurs: (window as any).__sc.length, observateurs: (window as any).__ro.size }))
          const pose   = await compte()
          await clic(page, tag, '.b-on')
          const retire = await compte()
          assert.ok(retire.ecouteurs < pose.ecouteurs, `les écouteurs de défilement partent avec l'effet (${JSON.stringify(pose)} → ${JSON.stringify(retire)})`)
          assert.ok(retire.observateurs < pose.observateurs, `l'observateur de taille part avec l'effet (${JSON.stringify(pose)} → ${JSON.stringify(retire)})`)
          for (let i = 0; i < 3; i++) {
            await clic(page, tag, '.b-on')
            await clic(page, tag, '.b-on')
          }
          assert.deepEqual(await compte(), retire, 'après trois allers-retours, rien n\'a fui')
          await clic(page, tag, '.b-on')
          assert.deepEqual(await compte(), pose, 'reposé : exactement ce que la première pose avait')
        }, { surveille: true })
      })

      it('rien ne tourne au repos : pas d\'image d\'animation, pas de minuterie ; la boucle part avec le défilement, s\'arrête d\'elle-même, `will-change` seulement pendant le mouvement', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-lisse', async (page) => {
          const tag = 'mjs-travel-lisse'
          const etat = () => page.evaluate((t: string) => ({ raf: (window as any).__raf.size, minuteries: (window as any).__iv.size, wc: getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.t')).willChange }), tag)
          assert.deepEqual(await etat(), { raf: 0, minuteries: 0, wc: 'auto' }, 'au repos, après la pose')
          // un coup de défilement : la boucle part
          await page.evaluate(() => window.scrollTo(0, 1200))
          await page.waitForTimeout(60)
          const enRoute = await etat()
          assert.ok(enRoute.raf >= 1, `une image d'animation attend en route (${JSON.stringify(enRoute)})`)
          assert.match(enRoute.wc, /translate/, 'will-change posé pendant le mouvement')
          assert.equal(enRoute.minuteries, 0)
          await page.waitForFunction(() => (window as any).__raf.size === 0, null, { timeout: 5000 })
          assert.deepEqual(await etat(), { raf: 0, minuteries: 0, wc: 'auto' }, 'arrivée : plus rien, will-change retiré')
          // la valeur lissée a rejoint la cible : la balise est à la place que le défilement dit
          const v = await boite(page, tag, '.t')
          const t = (1200 + 400 - 750) / (2400 - 750)
          // la courbe ease-in-out du CSS (0.42, 0, 0.58, 1), résolue par dichotomie
          const bez = (u: number, p: number, q: number) => 3 * p * u * (1 - u) * (1 - u) + 3 * q * u * u * (1 - u) + u * u * u
          let a = 0
          let b = 1
          for (let i = 0; i < 40; i++) {
            const m = (a + b) / 2
            if (bez(m, 0.42, 0.58) < t) a = m
            else b = m
          }
          const k = bez((a + b) / 2, 0, 1)
          proche(v.y, 750 + (2400 - 750) * k, 'rejoint la cible', 4)
          // loin après le voyage (plus d'un écran) : aucune boucle, la balise attend sur sa place, loin de tout regard
          await page.evaluate(() => window.scrollTo(0, 3500))
          await page.waitForFunction((t: string) => !(document.querySelector(t) as any)._shadow.querySelector('.t').style.getPropertyValue('translate'), tag, { timeout: 5000 })
          assert.deepEqual(await etat(), { raf: 0, minuteries: 0, wc: 'auto' }, 'hors écran : aucune boucle')
          proche((await boite(page, tag, '.t')).y, 750, 'hors écran : sur sa place de départ', 1.5)
          // un défilement qui ne change rien ne fait rien
          await page.evaluate(() => window.scrollTo(0, 3510))
          await page.waitForTimeout(60)
          assert.equal((await etat()).raf, 0)
          // de retour tout en haut, personne n'écoute et la balise est sur sa place : rien n'a été à rattraper
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(100)
          proche((await boite(page, tag, '.t')).y, 750, 'revenue en haut : sur sa place', 1.5)
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'revenue en haut : rien d\'écrit')
        })
      })

      // ----- la balise part de sa place, un transform de l'auteur, un conteneur horizontal, un composant parent -----

      it('sans `zone`, une balise dans la moitié haute de l\'écran est sur sa place à 0 de défilement : le voyage commence quand on défile', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-haut', async (page) => {
          const tag = 'mjs-travel-haut'
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'à 0 de défilement : aucun déplacement écrit')
          assert.equal(await style(page, tag, '.t', 'scale'), '', 'à 0 de défilement : aucune échelle écrite')
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.x, depart.y, but.x, but.y], [150, 150, 600, 1800], 'la mise en page de l\'essai')
          // l'étape va du défilement 0 (et non d'un défilement négatif) à celui où la destination est au milieu de l'écran : 1800 - 400
          await defile(page, tag, 700)
          sur(await boite(page, tag, '.t'), { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'au milieu de la course (0 → 1400) : à mi-chemin')
          await defile(page, tag, 1400)
          sur(await boite(page, tag, '.t'), but, 'au bout : sur la destination')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'on remonte : elle revient')
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'revenue : plus rien d\'écrit')
        })
      })

      it('trois étapes avec rotate et arc, la balise en haut de page et sans `zone` : à 0 de défilement ni déplacement ni rotation, puis la rotation suit l\'avancée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-haut-etapes', async (page) => {
          const tag = 'mjs-travel-haut-etapes'
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'à 0 de défilement : aucun déplacement écrit')
          assert.equal(await style(page, tag, '.t', 'rotate'), '', 'à 0 de défilement : aucune rotation écrite')
          const depart = await boite(page, tag, '.t')
          assert.equal(depart.y, 70, 'la mise en page de l\'essai')
          // la première étape va du défilement 0 au défilement 120 (e1 au milieu de l'écran) : à 60, la moitié de la première étape,
          // soit un sixième des 360 degrés (trois étapes)
          await defile(page, tag, 60)
          assert.equal(await calcule(page, tag, '.t', 'rotate'), '60deg', 'à la moitié de la première étape : 60 degrés')
          const e1 = await boite(page, tag, '.e1')
          await defile(page, tag, 120)
          sur(await boite(page, tag, '.t'), e1, 'au défilement 120 : sur la première destination')
        })
      })

      it('un `transform` de l\'auteur qui déplace la balise (translateX, translate en pourcentage), seul ou avec rotate et spin : elle arrive pile sur la destination, et passe à mi-chemin par le milieu', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-decalage', async (page) => {
          const tag = 'mjs-travel-decalage'
          const noms = ['a', 'b', 'c', 'dd', 'e', 'f', 'g']
          const but  = await boite(page, tag, '.d')
          const repos: Record<string, Boite> = {}
          for (const k of noms) repos[k] = await boite(page, tag, '.' + k)
          assert.deepEqual([but.x, but.y, repos.a.y], [650, 2260, 670], 'la mise en page de l\'essai')
          // toutes ont le même centre au repos (670) : l'étape va du défilement 270 à 1860 (la destination au milieu de l'écran)
          await defile(page, tag, 1860)
          for (const k of noms) sur(await boite(page, tag, '.' + k), but, `balise ${k} : sur la destination`)
          await defile(page, tag, 1065)
          for (const k of noms) sur(await boite(page, tag, '.' + k), { x: (repos[k].x + but.x) / 2, y: (repos[k].y + but.y) / 2, w: 0, h: 0 }, `balise ${k} : à mi-chemin`)
          await defile(page, tag, 0)
          for (const k of noms) sur(await boite(page, tag, '.' + k), repos[k], `balise ${k} : revenue à sa place`)
        })
      })

      it('un conteneur qui ne défile qu\'à l\'horizontale autour de la balise ne détourne pas le suivi de la page : elle arrive sur la destination', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-glisseur', async (page) => {
          const tag = 'mjs-travel-glisseur'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.glisseur') as any).scrollLeft = 60 }, tag)
          await page.waitForTimeout(150)
          const decalee = await boite(page, tag, '.t')
          sur(decalee, { x: depart.x - 60, y: depart.y, w: 0, h: 0 }, 'le glisseur a décalé la balise de 60 px, rien d\'autre')
          await defile(page, tag, but.y - 400)
          sur(await boite(page, tag, '.t'), but, 'la page défile : la balise arrive sur la destination malgré le glissement horizontal')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), decalee, 'on remonte : elle revient à la place que le glisseur lui a donnée')
        })
      })

      it('une destination qui vit dans le shadow root du composant parent est trouvée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-parent', async (page, dit) => {
          const tag = 'mjs-travel-parent'
          // la balise est dans l'enfant, la destination dans le parent : leurs boîtes en coordonnées de page
          const lit = (sel: string, enfant: boolean): Promise<Boite> => page.evaluate(([t, s, e]: [string, string, boolean]) => {
            const racine = (document.querySelector(t) as any)._shadow
            const b = (e ? racine.querySelector('mjs-travel-enfant')._shadow : racine).querySelector(s).getBoundingClientRect()
            return { x: b.left + scrollX + b.width / 2, y: b.top + scrollY + b.height / 2, w: b.width, h: b.height }
          }, [tag, sel, enfant])
          const depart = await lit('.t', true)
          const but    = await lit('.d', false)
          assert.ok(depart.y > 450, `la balise est dans la moitié basse de l'écran (${depart.y})`)
          await defile(page, tag, but.y - 400)
          sur(await lit('.t', true), but, 'la balise de l\'enfant est sur la destination du parent')
          await defile(page, tag, 0)
          sur(await lit('.t', true), depart, 'on remonte : elle revient')
          assert.equal(dit.filter((m) => /\*travel/.test(m)).length, 0, 'aucun avertissement : la destination est trouvée')
        }, { dedans: 'mjs-travel-enfant' })
      })

      it('loin de l\'écran la balise n\'écoute rien ; les écouteurs viennent quand le voyage approche, repartent avec lui, et une secousse de défilement la repose juste', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-loin', async (page) => {
          const tag    = 'mjs-travel-loin'
          const compte = () => page.evaluate(() => ({ ecouteurs: (window as any).__sc.length, observateurs: (window as any).__ro.size }))
          const loin = await compte()
          await clic(page, tag, '.b-on')
          const sans = await compte()
          assert.deepEqual(loin, sans, 'au chargement, la balise et sa destination sont à plus d\'un écran : l\'effet ne tient aucun écouteur ni observateur')
          await clic(page, tag, '.b-on')
          assert.deepEqual(await compte(), sans, 'reposé, toujours loin : toujours rien')
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.y, but.y], [3050, 4700], 'la mise en page de l\'essai')
          // la place de la balise arrive à l'écran : les écouteurs et l'observateur de taille se posent
          await page.evaluate(() => window.scrollTo(0, 2800))
          await page.waitForFunction((n: number) => (window as any).__sc.length > n, sans.ecouteurs, { timeout: 5000 })
          const pres = await compte()
          assert.ok(pres.ecouteurs > sans.ecouteurs, `les écouteurs de défilement sont posés (${JSON.stringify(sans)} → ${JSON.stringify(pres)})`)
          assert.ok(pres.observateurs > sans.observateurs, `l'observateur de taille est posé (${JSON.stringify(sans)} → ${JSON.stringify(pres)})`)
          // de nouveau loin : tout est rendu
          await defile(page, tag, 0)
          await page.waitForFunction((n: number) => (window as any).__sc.length === n, sans.ecouteurs, { timeout: 5000 })
          assert.deepEqual(await compte(), sans, 'de nouveau loin : rien ne reste')
          // une secousse qui tombe dans le voyage depuis le haut (la destination apparaît) : la balise est posée où le défilement la veut
          await page.evaluate((y: number) => window.scrollTo(0, y), but.y - 400)
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('.t').style.getPropertyValue('translate'), tag, { timeout: 5000 })
          await page.waitForTimeout(100)
          sur(await boite(page, tag, '.t'), but, 'réveillée par un saut : sur la destination')
          await defile(page, tag, 0)
          await page.waitForFunction((n: number) => (window as any).__sc.length === n, sans.ecouteurs, { timeout: 5000 })
          sur(await boite(page, tag, '.t'), depart, 'repartie loin : revenue sur sa place')
          assert.deepEqual(await compte(), sans, 'et de nouveau rien')
        }, { surveille: true })
      })

      it('une destination absente à la pose, ajoutée plus tard hors du flux, est trouvée au défilement suivant (un seul avertissement)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-tard', async (page, dit) => {
          const tag = 'mjs-travel-tard'
          const depart = await boite(page, tag, '.t')
          assert.equal(dit.filter((m) => /\*travel/.test(m)).length, 1, 'absente à la pose : un avertissement')
          await clic(page, tag, '.b-tard')
          const but = await boite(page, tag, '.tard')
          // le document n'a pas changé de taille et l'écran reste près de la balise (l'observateur de visibilité ne dit rien) :
          // seul le défilement suivant peut découvrir la destination ; l'étape part à 350, 50 px plus loin elle est à 4 % du chemin
          await defile(page, tag, 400)
          proche((await boite(page, tag, '.t')).y, depart.y + (but.y - depart.y) * (800 - depart.y) / (but.y - depart.y), 'découverte dès le premier défilement : la balise est partie', 2)
          await defile(page, tag, but.y - 400)
          sur(await boite(page, tag, '.t'), but, 'la destination ajoutée est atteinte')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'on remonte : elle revient')
          assert.equal(dit.filter((m) => /\*travel/.test(m)).length, 1, 'rien n\'est dit une seconde fois')
        })
      })

      it('easing et smooth tenus par une variable se suivent sur place : la courbe change, le lissage met la boucle en route', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-courbes', async (page) => {
          const tag = 'mjs-travel-courbes'
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          await defile(page, tag, 1175)
          const droite = await boite(page, tag, '.t')
          sur(droite, { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'courbe droite : à mi-chemin')
          // la même position de défilement, une autre courbe : un autre point du chemin, sans reposer l'effet
          await clic(page, tag, '.b-courbe')
          const lente = await boite(page, tag, '.t')
          proche(lente.y, depart.y + (but.y - depart.y) * bezierY(0.5, 0.42, 0, 1, 1), 'ease-in suivi sur place : la balise est au point de la courbe ease-in', 3)
          assert.ok(droite.y - lente.y > 100, `la balise a reculé sur son chemin (${droite.y.toFixed(1)} → ${lente.y.toFixed(1)})`)
          // sans lissage aucune image d'animation ; avec, un défilement lance la boucle
          const images = () => page.evaluate(() => (window as any).__raf.size)
          await defile(page, tag, 1300)
          assert.equal(await images(), 0, 'sans lissage : aucune image d\'animation')
          await clic(page, tag, '.b-lisse')
          await page.evaluate(() => window.scrollTo(0, 1500))
          await page.waitForTimeout(60)
          assert.ok((await images()) >= 1, 'avec le lissage suivi sur place : la boucle est en route')
        })
      })

      it('le retrait en plein mouvement rend will-change et le style d\'origine ; une balise en ligne retrouve son display', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-retrait-lisse', async (page) => {
          const tag = 'mjs-travel-retrait-lisse'
          const lit = (sel: string) => page.evaluate(([t, s]: [string, string]) => {
            const e = (document.querySelector(t) as any)._shadow.querySelector(s)
            ;(window as any)['__' + s] = e
            return { style: e.getAttribute('style') ?? '', display: getComputedStyle(e).display }
          }, [tag, sel])
          assert.equal((await lit('.in')).display, 'inline-block', 'la balise en ligne devient inline-block tant que l\'effet vit')
          await page.evaluate(() => window.scrollTo(0, 1200))
          await page.waitForTimeout(60)
          assert.match((await lit('.t')).style, /will-change/, 'en route : will-change posé')
          await clic(page, tag, '.b-on')
          const apres = await page.evaluate(() => ({ t: (window as any)['__.t'].getAttribute('style') ?? '', en: (window as any)['__.in'].getAttribute('style') ?? '' }))
          assert.ok(!/will-change|translate|scale|rotate/.test(apres.t), `la balise retirée en plein mouvement est rendue sans rien de l'effet (${apres.t})`)
          assert.ok(!/display/.test(apres.en), `la balise en ligne retrouve son display (${apres.en})`)
        })
      })

      it('un saut au milieu d\'un très long voyage, loin de la balise comme de sa destination : le mouvement n\'est pas coupé, la balise vient se mettre où le défilement la veut', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-tres-long', async (page) => {
          const tag    = 'mjs-travel-tres-long'
          const images = () => page.evaluate(() => (window as any).__raf.size)
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.y, but.y], [750, 4900], 'la mise en page de l\'essai')
          // l'étape va du défilement 350 à 4500 : à 2700, au milieu de l'écran (3100), ni la place de départ ni la destination ne sont près de l'écran
          await page.evaluate(() => window.scrollTo(0, 2700))
          await page.waitForTimeout(60)
          assert.ok((await images()) >= 1, 'le mouvement est en route, l\'observateur de visibilité ne le coupe pas')
          await page.waitForFunction(() => (window as any).__raf.size === 0, null, { timeout: 8000 })
          proche((await boite(page, tag, '.t')).y, 3100, 'au milieu de l\'écran, là où le défilement la veut', 2)
          await defile(page, tag, 4500)
          await page.waitForFunction(() => (window as any).__raf.size === 0, null, { timeout: 8000 })
          sur(await boite(page, tag, '.t'), but, 'plus bas : sur la destination')
        })
      })

      it('la destination déjà au milieu de l\'écran quand la page est en haut : la balise reste sur sa place à 0 de défilement, elle rejoint la destination dès le premier défilement', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-proche', async (page) => {
          const tag = 'mjs-travel-proche'
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'à 0 de défilement : sur sa place, rien d\'écrit')
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.x, depart.y, but.x, but.y], [150, 150, 600, 350], 'la mise en page de l\'essai')
          await defile(page, tag, 5)
          sur(await boite(page, tag, '.t'), but, 'dès le premier défilement : sur la destination')
          await defile(page, tag, 0)
          sur(await boite(page, tag, '.t'), depart, 'de retour en haut : sur sa place')
          assert.equal(await style(page, tag, '.t', 'translate'), '', 'de retour en haut : rien d\'écrit')
        })
      })

      it('une balise cachée (display: none) à la pose, montrée ensuite : ses boîtes sont lues à ce moment-là et elle voyage', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-masque', async (page) => {
          const tag = 'mjs-travel-masque'
          await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.t') as any).style.display = 'block' }, tag)
          await page.waitForTimeout(150)
          const depart = await boite(page, tag, '.t')
          const but    = await boite(page, tag, '.d')
          assert.deepEqual([depart.x, depart.y], [150, 750], 'la mise en page de l\'essai')
          await defile(page, tag, 1175)
          sur(await boite(page, tag, '.t'), { x: (depart.x + but.x) / 2, y: (depart.y + but.y) / 2, w: 0, h: 0 }, 'montrée, elle voyage : à mi-chemin')
          await defile(page, tag, 2000)
          sur(await boite(page, tag, '.t'), but, 'sur la destination')
        })
      })

      it('défilement de la page : la position se lit au plus une fois par évènement de défilement, rien ne se lit dans une image d\'animation, seuls translate, scale, rotate et will-change s\'écrivent — au plus une fois par image', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-travel-lisse', async (page) => {
          const tag = 'mjs-travel-lisse'
          await page.evaluate(() => {
            const w = window as any
            w.__ev = 0
            w.__sy = new Map()
            w.__lect = []
            w.__ecrit = []
            window.addEventListener('scroll', () => { w.__ev++ })
          })
          // la balise écoute quand une racine porte son écouteur en capture (état observable, pas un délai) : les évènements qui suivent sont tous les siens
          await page.waitForFunction(() => (window as any).__sc.some((e: any) => e[2]), undefined, { timeout: 15000 })
          // le voyage va du défilement 350 à 2000 : on y marche par pas de 100, chaque pas laisse passer deux images
          for (let y = 500; y <= 1900; y += 100) {
            await page.evaluate((v: number) => { window.scrollTo(0, v); return new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))) }, y)
          }
          await page.waitForFunction(() => (window as any).__raf.size === 0, null, { timeout: 8000 })
          const r = await page.evaluate(() => { const w = window as any; return { ev: w.__ev, lues: [...w.__sy.values()] as number[], lect: w.__lect, ecrit: w.__ecrit } })
          assert.ok(r.ev >= 10, `la page a défilé : ${r.ev} évènements`)
          // la garde n'est pas muette : la balise a bien lu la position pendant des évènements de défilement
          assert.ok(r.lues.length >= 10, `la balise a lu la position pendant ${r.lues.length} évènements sur ${r.ev}`)
          // le même évènement de la page ne se traite qu'une fois (la racine le reçoit en capture, la fenêtre n'a pas d'écouteur de plus) : au plus une lecture par évènement
          assert.ok(Math.max(...r.lues) <= 1, `la position de défilement est lue ${Math.max(...r.lues)} fois dans un même évènement (lectures par évènement : ${r.lues.join(', ')})`)
          assert.deepEqual(r.lect, [], `lectures dans les images d'animation : ${r.lect.join(', ')}`)
          const noms = [...new Set<string>(r.ecrit.map((e: any) => e[0]))].sort()
          assert.ok(noms.length > 0 && noms.every((n) => ['translate', 'scale', 'rotate', 'will-change'].includes(n)), `propriétés écrites : ${noms.join(', ')}`)
          const vues = new Set<string>()
          for (const [n, img] of r.ecrit as [string, number][]) {
            if (!img) continue
            assert.ok(!vues.has(n + '@' + img), `${n} écrit deux fois dans la même image d'animation`)
            vues.add(n + '@' + img)
          }
          assert.equal(await style(page, tag, '.t', 'will-change'), '', 'le voyage fini : will-change rendu')
        }, { lectures: true, surveille: true })
      })

      it('le fichier de l\'effet ne pose ni minuterie ni intervalle', () => {
        const src = readFileSync(join(ICI, '../src/runtime/mjs_fx_travel.ts'), 'utf-8')
        assert.ok(!/setTimeout|setInterval/.test(src))
        assert.ok(!/\.(top|left|width|height)\s*=[^=]/.test(src), 'jamais top/left/width/height par image')
      })
    })
  }
})
