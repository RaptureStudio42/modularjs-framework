// *pile dans Chromium, Firefox et WebKit réels (une vraie mise en page est nécessaire : happy-dom ne
// mesure rien) : les enfants de la balise se collent en haut, chacun `gap` plus bas que le précédent ;
// un panneau recouvert rapetisse (`scale`), s'assombrit (`dim`), se floute (`blur`) selon la part
// recouverte (0 → 1) cumulée sur tous les panneaux qui sont au-dessus ; `top`, `radius`, `origin` ;
// tous les réglages se suivent sur place (µ._mjs_fxSet) ; « réduire les animations » garde
// l'empilement collant et rien d'autre ; au repos ni image d'animation ni minuterie, loin de l'écran
// aucun écouteur de défilement ne travaille ; `off()` ne laisse rien ; un ancêtre en `overflow: hidden`
// qui casse `sticky` est dit une fois dans la console.
// La profondeur suit la place que le navigateur donne aux panneaux : après le padding de la zone qui défile, remontée par un `bottom` d'auteur,
// et relue dès que ce qui est au-dessus de la pile change de hauteur en plein défilement. La pile passe deux images sur un calque au chargement
// (le texte des panneaux est rastérisé comme après un défilement : la capture au repos ne change pas au premier défilement) ; la géométrie ne se relit pas
// au défilement tant que rien ne change, quelle que soit la cadence des évènements (la boîte de la pile, ou la hauteur de son contenu quand elle défile
// elle-même, dit qu'elle a changé) ; off() rend l'observateur de visibilité.
// Un `zoom` CSS posé sur la zone, sur la pile, sur la page, le corps ou l'hôte (ou un zoom qui n'est pas un nombre rond, ou une zone de taille fractionnaire) ne fausse pas la profondeur et ne fait pas relire
// la géométrie au défilement : elle reste celle que les boîtes réelles donnent.
// Le message de l'avertissement garde ses guillemets français en français et prend des guillemets droits en anglais.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { LECTURES } from './helpers/lectures-images.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// une image d'aperçu, dessinée (un dégradé) : la légende des panneaux se pose dessus
const IMAGE    = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='430'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23c97b3d'/%3E%3Cstop offset='1' stop-color='%23283a52'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='430' fill='url(%23g)'/%3E%3C/svg%3E"

// quatre panneaux de 380 px dans une scène de 500 px qui défile : 100 px de texte avant, 300 px après
const PANNEAUX = Array.from({ length: 4 }, (_, i) => `<article class="p"><h3>Panneau ${i + 1}</h3></article>`).join('')
const SCENE    = '\n:host\n  display: block\n.scene\n  box-sizing: border-box\n  height: 500px\n  overflow: auto\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n  border-radius: 10px\n.bas\n  height: 300px\n'
const scene    = (fx: string, style = SCENE) => `<div class="scene"><div class="haut"></div><section ${fx}>${PANNEAUX}</section><div class="bas"></div></div>\n<style>${style}</style>\n`
// la pile posée dans la page (la page défile), loin sous l'écran
const PAGE     = '\n:host\n  display: block\n.haut\n  height: 3000px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 600px\n'

const SOURCES: Record<string, string> = {
  'pile-base.mjs':     scene('*pile(gap: 64)'),
  'pile-nue.mjs':      scene('*pile'),
  // la pile tout en haut de sa scène : sa boîte suit le défilement comme celle d'une pile lue avant le premier rendu (tout à zéro)
  'pile-sans-haut.mjs': scene('*pile(gap: 64)', SCENE.replace('height: 100px', 'height: 0')),
  'pile-haut.mjs':     scene('*pile(gap: 40, top: 20)'),
  'pile-reglages.mjs': scene('*pile(gap: 64, scale: .1, dim: .2, blur: 3, radius: 24)'),
  'pile-centre.mjs':   scene('*pile(gap: 64, origin: center)'),
  'pile-sec.mjs':      scene('*pile(gap: 64, scale: 0)'),
  // la pile dans la page, mais enveloppée d'un `overflow: hidden` qui ne défile pas : il devient sa « zone visible » et les panneaux ne se collent plus
  'pile-cache.mjs':    `<div class="cadre"><div class="haut"></div><section class="pile" *pile(gap: 64)>${PANNEAUX}</section><div class="bas"></div></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 600px\n.cadre\n  overflow: hidden\n</style>\n`,
  // les réglages écrits par des variables : deux boutons les changent (gap puis origin)
  'pile-variable.mjs': `<script>\n$gap = 20\n$depart = 'top'\n</script>\n<div class="scene"><div class="haut"></div><section *pile(gap: $gap, origin: $depart)>${PANNEAUX}</section><div class="bas"></div></div>\n<button class="b1" @click={$gap = 90}>gap</button>\n<button class="b2" @click={$depart = 'center'}>origin</button>\n<style>${SCENE}</style>\n`,
  // les réglages visuels donnés par un thème posé plus haut (variables CSS de l'effet), sans rien écrire sur la balise
  'pile-theme.mjs':    scene('*pile(gap: 64)', SCENE + '.scene\n  --mjs-pile-scale: .2\n  --mjs-pile-dim: .4\n  --mjs-pile-radius: 33px\n'),
  'pile-page.mjs':     `<div class="haut"></div><section class="pile" *pile(gap: 50)>${PANNEAUX}</section><div class="bas"></div>\n<style>${PAGE}</style>\n`,
  // la balise de la pile elle-même en `overflow: hidden`, sans hauteur : elle ne défile pas, ses panneaux ne peuvent pas se coller
  'pile-propre.mjs':   `<div class="haut"></div><section class="pile cache" *pile(gap: 30)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 400px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 1500px\n.cache\n  overflow: hidden\n</style>\n`,
  // la balise de la pile qui défile elle-même (hauteur fixe, `overflow: auto`) : c'est sa zone visible, les panneaux se collent dans elle
  'pile-autonome.mjs': `<div class="haut"></div><section class="pile defile" *pile(gap: 64)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 300px\n.defile\n  height: 500px\n  overflow: auto\n</style>\n`,
  // la même pile qui défile elle-même, avec un `zoom` CSS posé sur sa balise (agrandie, rapetissée)
  'pile-autonome-grand.mjs':  `<div class="haut"></div><section class="pile defile" *pile(gap: 64)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 300px\n.defile\n  height: 500px\n  overflow: auto\n  zoom: 1.5\n</style>\n`,
  'pile-autonome-petit.mjs':  `<div class="haut"></div><section class="pile defile" *pile(gap: 64)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 300px\n.defile\n  height: 500px\n  overflow: auto\n  zoom: .75\n</style>\n`,
  // un zoom qui n'est pas un nombre rond (quatre tiers) : le rapport entre l'écran et la mise en page ne doit pas être arrondi à un centième
  'pile-autonome-tiers.mjs':  `<div class="haut"></div><section class="pile defile" *pile(gap: 64)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.p\n  box-sizing: border-box\n  height: 380px\n  padding: 16px\n.bas\n  height: 300px\n.defile\n  height: 500px\n  overflow: auto\n  zoom: 1.3333\n</style>\n`,
  // la pile dans une zone à part avec une bordure de 40 px et 300 px avant la pile, seule puis avec un `zoom` CSS sur la zone
  'pile-zone.mjs':        scene('*pile(gap: 64)', SCENE + '.scene\n  border: 40px solid #888\n.haut\n  height: 300px\n'),
  'pile-zone-grand.mjs':  scene('*pile(gap: 64)', SCENE + '.scene\n  border: 40px solid #888\n  zoom: 1.5\n.haut\n  height: 300px\n'),
  'pile-zone-petit.mjs':  scene('*pile(gap: 64)', SCENE + '.scene\n  border: 40px solid #888\n  zoom: .75\n.haut\n  height: 300px\n'),
  'pile-zone-tiers.mjs':  scene('*pile(gap: 64)', SCENE + '.scene\n  border: 40px solid #888\n  zoom: 1.3333\n.haut\n  height: 300px\n'),
  // une zone de taille fractionnaire (240,5 px de côté : ses `offset*` sont arrondis à l'entier), sans zoom puis sous zoom: 1.25, la pile contre son haut et son bas
  'pile-zone-fractionnaire.mjs':      scene('*pile(gap: 64)', SCENE + '.scene\n  width: 240.5px\n  height: 240.5px\n  border: 10px solid #888\n.haut\n  height: 0\n.bas\n  height: 0\n'),
  'pile-zone-fractionnaire-zoom.mjs': scene('*pile(gap: 64)', SCENE + '.scene\n  width: 240.5px\n  height: 240.5px\n  border: 10px solid #888\n  zoom: 1.25\n.haut\n  height: 0\n.bas\n  height: 0\n'),
  // la zone n'a pas de zoom, la pile elle-même en porte un : ses `gap`, `top` et `bottom` (celui du deuxième panneau), sa bordure et son padding sont dans l'unité de la pile, pas dans celle de la zone
  'pile-zone-sur-pile-grand.mjs': scene('*pile(gap: 40, top: 20)', SCENE + '.scene\n  border: 40px solid #888\n.haut\n  height: 300px\n.p:nth-child(2)\n  bottom: 30px\nsection\n  padding-top: 24px\n  border-top: 30px solid #444\n  zoom: 1.5\n'),
  'pile-zone-sur-pile-petit.mjs': scene('*pile(gap: 40, top: 20)', SCENE + '.scene\n  border: 40px solid #888\n.haut\n  height: 300px\n.p:nth-child(2)\n  bottom: 30px\nsection\n  padding-top: 24px\n  border-top: 30px solid #444\n  zoom: .75\n'),
  // la pile qui défile elle-même, avec un padding haut, dans une page qui défile aussi (100 + 504 + 400 px de haut pour 640 de fenêtre)
  'pile-autonome-marge.mjs': `<div class="haut"></div><section class="pile" *pile(gap: 30)>${PANNEAUX}</section><div class="bas"></div>\n<style>\n:host\n  display: block\n.haut\n  height: 100px\n.pile\n  height: 480px\n  overflow: auto\n  padding-top: 24px\n.p\n  box-sizing: border-box\n  height: 300px\n  padding: 16px\n.bas\n  height: 400px\n</style>\n`,
  // la zone qui défile a un padding et une bordure : les panneaux se collent après le padding, pas contre le bord de la zone
  'pile-marge.mjs':    scene('*pile(gap: 50, scale: .08)', SCENE + '.scene\n  padding: 20px 8px 14px\n  border: 6px solid #888\n'),
  // une scène sans ancrage de défilement : ce qui est au-dessus de la pile peut changer de hauteur sans que le navigateur ne rattrape le défilement
  'pile-ancre.mjs':    scene('*pile(gap: 64)', SCENE + '.scene\n  overflow-anchor: none\n'),
  // le deuxième panneau a un `bottom` d'auteur : le navigateur le colle aussi en bas de la zone, tant que la pile le permet
  'pile-bas.mjs':      scene('*pile(gap: 40)', SCENE + '.p:nth-child(2)\n  bottom: 30px\n'),
  // des panneaux arrondis qui rognent une image et sa légende (du texte clair sur un dégradé), sous un en-tête de hauteur fractionnaire
  'pile-legende.mjs':  `<div class="scene"><header class="entete"><h2>Quatre horizons</h2><p>Chaque image monte et recouvre la précédente.</p></header><section class="pile" *pile(gap: 0)>${[1, 2, 3].map((i) => `<article class="p"><img src="${IMAGE}" alt=""><div class="legende"><h3>Les ruines au soleil couchant ${i}</h3><p>La lumière dorée glisse sur les pierres.</p></div></article>`).join('')}</section><div class="fin"></div></div>\n<style>\n:host\n  display: block\n.scene\n  box-sizing: border-box\n  height: 520px\n  overflow: auto\n  padding: 0 20px\n  background: #0d1117\n.entete\n  padding: 26px 4px 18px\n  color: #f4f1ea\n  h2\n    margin: 0 0 6px\n    font: 700 28px/1.15 Georgia, serif\n  p\n    margin: 0\n    font-size: 14px\n.p\n  box-sizing: border-box\n  height: 430px\n  overflow: hidden\n  border-radius: 20px\n  background: #1b2027\n  img\n    display: block\n    width: 100%\n    height: 100%\n    object-fit: cover\n.legende\n  position: absolute\n  right: 0\n  bottom: 0\n  left: 0\n  padding: 64px 28px 24px\n  background: linear-gradient(to top, rgba(0, 0, 0, .74), rgba(0, 0, 0, 0))\n  color: #fff\n  h3\n    margin: 0 0 4px\n    font: 700 28px/1.2 Georgia, serif\n  p\n    margin: 0\n    font-size: 15px\n.fin\n  height: 400px\n</style>\n`
}

// ce que la page compte : les images d'animation et les minuteries en attente (et combien d'images ont été demandées)
const COMPTEURS = () => {
  const w = window as any
  w.__raf  = new Set()
  w.__rafN = 0
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { w.__rafN++; const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__to = new Set()
  const st = w.setTimeout.bind(w)
  const ct = w.clearTimeout.bind(w)
  w.__delais = []
  w.setTimeout = (f: any, d?: number, ...a: any[]) => { if ((d ?? 0) >= 100) w.__delais.push(d); const h = st(() => { w.__to.delete(h); return f(...a) }, d); w.__to.add(h); return h }
  w.clearTimeout = (h: number) => { w.__to.delete(h); return ct(h) }
  // les écouteurs de défilement en vie (cible, fonction, capture) ; une fois `__compter` levé, les appels que reçoivent ceux qu'on pose
  const ids = new WeakMap<object, number>()
  let n = 0
  const id = (o: any) => { if (!ids.has(o)) ids.set(o, ++n); return ids.get(o) }
  const cle = (cible: any, f: any, o: any) => `${id(cible)}|${id(f)}|${typeof o === 'boolean' ? o : !!(o && o.capture)}`
  const enveloppes = new WeakMap<object, any>()
  w.__vivants = new Set<string>()
  w.__appels  = 0
  w.__compter = false
  const ae = w.EventTarget.prototype.addEventListener
  const re = w.EventTarget.prototype.removeEventListener
  w.EventTarget.prototype.addEventListener = function (type: string, f: any, o: any) {
    if (type !== 'scroll' || typeof f !== 'function') return ae.call(this, type, f, o)
    const k = cle(this, f, o)
    w.__vivants.add(k)
    // l'outil de surveillance retire ses écouteurs par un AbortSignal, sans removeEventListener : l'annulation du signal les défait
    if (o && o.signal) o.signal.addEventListener('abort', () => { w.__vivants.delete(k) })
    if (!w.__compter) return ae.call(this, type, f, o)
    if (!enveloppes.has(f)) enveloppes.set(f, function (this: any, e: any) { w.__appels++; return f.call(this, e) })
    return ae.call(this, type, enveloppes.get(f), o)
  }
  w.EventTarget.prototype.removeEventListener = function (type: string, f: any, o: any) {
    if (type === 'scroll' && typeof f === 'function') w.__vivants.delete(cle(this, f, o))
    return re.call(this, type, (typeof f === 'function' && enveloppes.get(f)) || f, o)
  }
  // les observateurs de visibilité en vie (observe posé, pas encore déconnecté)
  w.__io = new Set<object>()
  const ob = w.IntersectionObserver.prototype.observe
  const di = w.IntersectionObserver.prototype.disconnect
  w.IntersectionObserver.prototype.observe = function (...a: any[]) { w.__io.add(this); return ob.apply(this, a) }
  w.IntersectionObserver.prototype.disconnect = function () { w.__io.delete(this); return di.call(this) }
  // les marques de mouvement (will-change) posées sur une pile : seul leur nombre compte
  w.__mouvements = 0
  const sa = w.Element.prototype.setAttribute
  w.Element.prototype.setAttribute = function (nom: string, valeur: string) {
    if (nom === 'mjs-fx-pile-moving') w.__mouvements++
    return sa.call(this, nom, valeur)
  }
}

// les profondeurs que la géométrie impose, calculées ici sans rien lire de la page : le haut de chaque
// panneau à l'écran est sa place naturelle ou, une fois collé, sa place collée ; le recouvrement du
// précédent par lui va de 0 (il touche son bas) à 1 (il est collé, `gap` plus bas) ; la profondeur
// d'un panneau est la somme des recouvrements de ceux qui sont au-dessus de lui ; `marge` est le padding haut de la zone qui défile : les
// panneaux se collent après lui, et leur place naturelle le compte aussi
function profondeurs(defile: number, gap: number, top = 0, n = 4, h = 380, haut = 100, marge = 0): number[] {
  const colle = (i: number) => marge + top + i * gap
  const place = (i: number) => Math.max(marge + haut + h * i - defile, colle(i))
  const prof: number[] = []
  let somme = 0
  prof[n - 1] = 0
  for (let k = n - 2; k >= 0; k--) {
    const c = (colle(k) + h - place(k + 1)) / Math.max(1, h - gap)
    somme += Math.min(1, Math.max(0, c))
    prof[k] = somme
  }
  return prof
}

// les profondeurs d'après les places que le navigateur a données aux panneaux (leurs hauts à l'écran) : le recouvrement de chacun par le suivant
// vaut (bas du panneau − haut du suivant) / (hauteur − gap), entre 0 et 1 ; la profondeur est leur somme du dernier au premier ;
// `h` est la hauteur commune des panneaux ou la liste des hauteurs de chacun
function depuisLesBoites(hauts: number[], h: number | number[], gap: number): number[] {
  const prof: number[] = []
  let somme = 0
  prof[hauts.length - 1] = 0
  for (let k = hauts.length - 2; k >= 0; k--) {
    const hk = Array.isArray(h) ? h[k] : h
    somme += Math.min(1, Math.max(0, (hauts[k] + hk - hauts[k + 1]) / Math.max(1, hk - gap)))
    prof[k] = somme
  }
  return prof
}

const proche = (a: number[], b: number[], tol: number, quoi: string) => {
  assert.equal(a.length, b.length, `${quoi} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`)
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${quoi} : panneau ${i} = ${v}, attendu ${b[i]} (à ${tol} près) — ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`))
}
const nombres = (l: string[]) => l.map((v) => v === '' ? 0 : parseFloat(v))

describe('*pile — le message de l\'avertissement d\'overflow', () => {
  it('le message anglais n\'a pas de guillemets français, le français garde les siens', () => {
    const en = (RUNTIME_LABELS.en as any).err.pileOverflow
    const fr = (RUNTIME_LABELS.fr as any).err.pileOverflow
    assert.ok(!/[«»]/.test(en), `message anglais : ${en}`)
    assert.ok(/«/.test(fr) && /»/.test(fr), `message français : ${fr}`)
  })
})

describe('*pile (navigateurs réels) — des panneaux collants qui se recouvrent, rapetissent, s\'assombrissent, se floutent', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-pile')
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
      async function avec<T>(tag: string, fn: (page: any, console: string[]) => Promise<T>, options: { reduit?: boolean; css?: string; sansObservateur?: boolean; sansTaille?: boolean } = {}): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 700, height: 640 }, reducedMotion: options.reduit ? 'reduce' : 'no-preference' })
        const journal: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') journal.push(m.text()) })
        try {
          await page.addInitScript(COMPTEURS)
          if (options.sansObservateur) await page.addInitScript(() => { delete (window as any).IntersectionObserver })
          if (options.sansTaille) await page.addInitScript(() => { delete (window as any).ResizeObserver })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}${options.css ?? ''}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          await page.waitForTimeout(150)
          // le cycle de chargement (les panneaux sur un calque, deux images) est fini : le repos est le repos
          await page.waitForFunction((t: string) => { const sh = (document.querySelector(t) as any)?._shadow; return !!sh && !sh.querySelector('[mjs-fx-pile-moving]') }, tag)
          return await fn(page, journal)
        }
        finally {
          await page.close()
        }
      }

      // l'état des panneaux de la scène : où ils sont à l'écran (depuis le haut de la scène), leur profondeur et ce qu'elle fait
      const lire = (page: any, tag: string) => page.evaluate((t: string) => {
        const sc   = (document.querySelector(t) as any)._shadow.querySelector('.scene') as HTMLElement
        const sec  = sc.querySelector('section') as HTMLElement
        const base = sc.getBoundingClientRect().top + sc.clientTop
        const fils = Array.from(sec.children) as HTMLElement[]
        return {
          defile: Math.round(sc.scrollTop),
          marques: sec.getAttributeNames().filter((a) => a.startsWith('mjs-fx')).sort(),
          collage: fils.map((c) => getComputedStyle(c).top),
          position: fils.map((c) => getComputedStyle(c).position),
          haut: fils.map((c) => Math.round((c.getBoundingClientRect().top - base) * 10) / 10),
          prof: fils.map((c) => c.style.getPropertyValue('--mjs-fx-pile-d')),
          dessous: fils.map((c) => c.hasAttribute('mjs-fx-pile-under')),
          echelle: fils.map((c) => getComputedStyle(c).scale),
          filtre: fils.map((c) => getComputedStyle(c).filter),
          arrondi: fils.map((c) => getComputedStyle(c).borderTopLeftRadius),
          origine: fils.map((c) => getComputedStyle(c).transformOrigin),
          styles: fils.map((c) => c.getAttribute('style') ?? ''),
          aStyle: fils.map((c) => c.hasAttribute('style')),
          attrs: fils.map((c) => c.getAttributeNames().filter((a) => a.startsWith('mjs-fx')))
        }
      }, tag)

      const defile = async (page: any, tag: string, y: number) => {
        await page.evaluate(([t, v]: [string, number]) => { ((document.querySelector(t) as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = v }, [tag, y])
        await page.waitForTimeout(200)
      }

      // les relectures de la géométrie de la pile, comptées dans `window.__relues` à la marque qu'elle pose le temps de lire la place naturelle des panneaux (elle passe alors en `position: relative`)
      const espionner = (page: any, tag: string) => page.evaluate((t: string) => {
        const w   = window as any
        const sec = (document.querySelector(t) as any)._shadow.querySelector('section') as HTMLElement
        w.__relues = 0
        new MutationObserver((liste) => { w.__relues += liste.filter((m) => m.oldValue === null).length }).observe(sec, { attributes: true, attributeFilter: ['mjs-fx-pile-read'], attributeOldValue: true })
      }, tag)

      it('au repos, rien n\'est écrit : les panneaux sont collés à top + rang × gap, sans échelle ni marque', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          const r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.position, ['sticky', 'sticky', 'sticky', 'sticky'])
          assert.deepEqual(r.collage, ['0px', '64px', '128px', '192px'])
          assert.deepEqual(r.haut, [100, 480, 860, 1240])
          assert.deepEqual(r.dessous, [false, false, false, false])
          assert.deepEqual(r.echelle, ['none', 'none', 'none', 'none'])
          assert.deepEqual(r.filtre, ['none', 'none', 'none', 'none'])
          assert.deepEqual(r.marques, ['mjs-fx'])
          // les panneaux gardent leur arrondi : aucun `radius` écrit
          assert.deepEqual(r.arrondi, ['10px', '10px', '10px', '10px'])
        })
      })

      it('le recouvrement va de 0 à 1 et se cumule : la profondeur de chaque panneau suit la géométrie, l\'échelle suit la profondeur', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          for (const y of [140, 300, 480, 800, 1100, 1420]) {
            await defile(page, 'mjs-pile-base', y)
            const r = await lire(page, 'mjs-pile-base')
            const attendu = profondeurs(y, 64)
            proche(nombres(r.prof), attendu, 0.02, `profondeur à ${y}`)
            proche(r.echelle.map((e: string) => e === 'none' ? 1 : parseFloat(e)), attendu.map((d) => 1 - 0.05 * d), 0.01, `échelle à ${y}`)
            assert.deepEqual(r.dessous, attendu.map((d) => d > 0.0005), `marque « recouvert » à ${y}`)
          }
          // collé : trois panneaux sous le dernier, chacun d'un cran de plus
          const fin = await lire(page, 'mjs-pile-base')
          proche(nombres(fin.prof), [3, 2, 1, 0], 0.001, 'tout est empilé en bas')
          // retour en haut : tout est rendu
          await defile(page, 'mjs-pile-base', 0)
          const haut = await lire(page, 'mjs-pile-base')
          assert.deepEqual(haut.dessous, [false, false, false, false])
          assert.deepEqual(haut.echelle, ['none', 'none', 'none', 'none'])
          assert.deepEqual(haut.prof, ['', '', '', ''].map(() => '0'))
        })
      })

      it('gap : sans gap les panneaux se recouvrent entièrement au même endroit ; top : ils se collent plus bas', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-nue', async (page) => {
          await defile(page, 'mjs-pile-nue', 1100)
          const r = await lire(page, 'mjs-pile-nue')
          assert.deepEqual(r.collage, ['0px', '0px', '0px', '0px'])
          proche(nombres(r.prof), profondeurs(1100, 0), 0.02, 'sans gap')
          assert.ok(r.haut.slice(0, 3).every((v: number) => v === 0), `trois panneaux collés au même endroit : ${r.haut}`)
        })
        await avec('mjs-pile-haut', async (page) => {
          await defile(page, 'mjs-pile-haut', 1100)
          const r = await lire(page, 'mjs-pile-haut')
          assert.deepEqual(r.collage, ['20px', '60px', '100px', '140px'])
          proche(nombres(r.prof), profondeurs(1100, 40, 20), 0.02, 'avec top')
        })
      })

      it('dim, blur, radius, scale : un panneau recouvert perd en lumière, se floute, l\'arrondi est posé, l\'échelle suit scale', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-reglages', async (page) => {
          await defile(page, 'mjs-pile-reglages', 1100)
          const r = await lire(page, 'mjs-pile-reglages')
          const d = nombres(r.prof)
          proche(d, [3, 2, 1, 0], 0.01, 'profondeurs')
          proche(r.echelle.slice(0, 3).map((e: string) => parseFloat(e)), [0.7, 0.8, 0.9], 0.01, 'scale: .1')
          // la lumière : brightness(1 - dim × d) ; le flou : blur(blur × d px)
          proche(r.filtre.slice(0, 3).map((f: string) => parseFloat(/brightness\(([\d.]+)\)/.exec(f)![1])), [0.4, 0.6, 0.8], 0.01, 'dim: .2')
          proche(r.filtre.slice(0, 3).map((f: string) => parseFloat(/blur\(([\d.]+)px\)/.exec(f)![1])), [9, 6, 3], 0.01, 'blur: 3')
          assert.equal(r.filtre[3], 'none', 'le dernier panneau n\'est jamais recouvert')
          assert.deepEqual(r.arrondi, ['24px', '24px', '24px', '24px'])
          assert.ok(r.marques.includes('mjs-fx-pile-dim') && r.marques.includes('mjs-fx-pile-blur') && r.marques.includes('mjs-fx-pile-radius'), `marques ${r.marques}`)
        })
      })

      it('origin: center : le panneau rapetisse vers son milieu, et le recouvrement ne se déforme pas (mêmes profondeurs qu\'avec top)', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          await defile(page, 'mjs-pile-base', 480)
          const ref = await lire(page, 'mjs-pile-base')
          assert.ok(ref.origine.every((o: string) => /^[\d.]+px 0px$/.test(o)), `origine en haut : ${ref.origine}`)
          await avec('mjs-pile-centre', async (page2) => {
            await defile(page2, 'mjs-pile-centre', 480)
            const r = await lire(page2, 'mjs-pile-centre')
            assert.ok(r.origine.every((o: string) => /^[\d.]+px 190px$/.test(o)), `origine au milieu : ${r.origine}`)
            proche(nombres(r.prof), nombres(ref.prof), 0.02, 'mêmes profondeurs')
            await defile(page2, 'mjs-pile-centre', 1100)
            proche(nombres((await lire(page2, 'mjs-pile-centre')).prof), [3, 2, 1, 0], 0.02, 'empilé')
          })
        })
      })

      it('« réduire les animations » : l\'empilement collant reste, rien ne rapetissit ni ne se floute, aucun écouteur', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-reglages', async (page) => {
          const n0 = await page.evaluate(() => (window as any).__rafN)
          await defile(page, 'mjs-pile-reglages', 1100)
          const r = await lire(page, 'mjs-pile-reglages')
          assert.deepEqual(r.position, ['sticky', 'sticky', 'sticky', 'sticky'])
          assert.deepEqual(r.echelle, ['none', 'none', 'none', 'none'])
          assert.deepEqual(r.filtre, ['none', 'none', 'none', 'none'])
          assert.deepEqual(r.dessous, [false, false, false, false])
          assert.deepEqual(r.prof, ['', '', '', ''])
          assert.ok(!r.marques.includes('mjs-fx-pile-moving'), 'will-change jamais posé')
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'aucune image demandée par le défilement')
        }, { reduit: true })
      })

      it('au repos ni image d\'animation ni minuterie ; loin de l\'écran le défilement ne coûte aucune image', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-page', async (page) => {
          const compte = () => page.evaluate(() => ({ raf: (window as any).__raf.size, minuteries: (window as any).__to.size, demandees: (window as any).__rafN }))
          await page.waitForTimeout(400)
          const repos = await compte()
          assert.equal(repos.raf, 0, 'aucune image en attente au repos')
          assert.equal(repos.minuteries, 0, 'aucune minuterie au repos')
          // la page défile loin de la pile (à 3 000 px) : l'effet ne demande aucune image
          for (const y of [100, 300, 600, 900]) {
            await page.evaluate((v: number) => window.scrollTo(0, v), y)
            await page.waitForTimeout(120)
          }
          assert.equal((await compte()).demandees, repos.demandees, 'loin de l\'écran : aucune image demandée')
          // près d'elle, elle travaille ; le mouvement fini, plus rien ne reste en attente
          await page.evaluate(() => window.scrollTo(0, 3400))
          await page.waitForTimeout(250)
          const pres = await compte()
          assert.ok(pres.demandees > repos.demandees, 'près de la pile : des images demandées')
          const marques = await page.evaluate(() => (document.querySelector('mjs-pile-page') as any)._shadow.querySelector('section').getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')))
          await page.waitForTimeout(500)
          const fini = await compte()
          assert.equal(fini.raf, 0, 'le mouvement fini : aucune image en attente')
          assert.equal(fini.minuteries, 0, 'le mouvement fini : aucune minuterie en attente')
          const apres = await page.evaluate(() => (document.querySelector('mjs-pile-page') as any)._shadow.querySelector('section').getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')))
          assert.ok(!apres.includes('mjs-fx-pile-moving'), `will-change rendu au repos (avant : ${marques})`)
          // sortie en bas de la pile puis retour loin au-dessus : quand elle revient près de l'écran, tout est relu
          await page.evaluate(() => window.scrollTo(0, 4700))
          await page.waitForTimeout(300)
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(300)
          await page.evaluate(() => window.scrollTo(0, 2900))
          await page.waitForTimeout(300)
          const retour = await page.evaluate(() => Array.from((document.querySelector('mjs-pile-page') as any)._shadow.querySelector('section').children).map((c: any) => c.style.getPropertyValue('--mjs-fx-pile-d')))
          assert.deepEqual(retour.map((v: string) => parseFloat(v)), [0, 0, 0, 0], 'revenue près de l\'écran par le haut : relue à zéro')
        })
      })

      it('off() : rien ne reste sur la balise ni sur les panneaux, le défilement ne fait plus rien', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-reglages', async (page) => {
          await defile(page, 'mjs-pile-reglages', 1100)
          const n0 = await page.evaluate(() => {
            const sec = (document.querySelector('mjs-pile-reglages') as any)._shadow.querySelector('section')
            sec._mjs_fxOff.pile()
            return (window as any).__rafN
          })
          const r = await lire(page, 'mjs-pile-reglages')
          assert.deepEqual(r.marques, [], 'plus aucune marque sur la balise')
          assert.deepEqual(r.styles, ['', '', '', ''], 'plus aucune variable sur les panneaux')
          assert.deepEqual(r.attrs, [[], [], [], []], 'plus aucune marque sur les panneaux')
          assert.deepEqual(r.position, ['static', 'static', 'static', 'static'])
          assert.deepEqual(r.echelle, ['none', 'none', 'none', 'none'])
          await defile(page, 'mjs-pile-reglages', 0)
          await defile(page, 'mjs-pile-reglages', 900)
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'plus aucune image demandée')
        })
      })

      it('off.set : gap, top, scale, dim, blur, radius, origin se suivent sur place ; tout à zéro rend les panneaux', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          const regle = (d: Record<string, unknown>) => page.evaluate((v: Record<string, unknown>) => {
            const sec = (document.querySelector('mjs-pile-base') as any)._shadow.querySelector('section')
            ;(window as any).µ._mjs_fxSet(sec, 'pile', v, null)
          }, d)
          await defile(page, 'mjs-pile-base', 1100)
          // le moteur n'écrit les variables CSS des réglages qu'à la pose et dans µ._mjs_fxSet : l'écriture passe par lui
          await regle({ gap: 100 })
          await page.waitForTimeout(250)
          let r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.collage, ['0px', '100px', '200px', '300px'], 'gap suivi')
          proche(nombres(r.prof), profondeurs(1100, 100), 0.02, 'profondeurs avec gap: 100')
          await regle({ top: 30 })
          await page.waitForTimeout(250)
          r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.collage, ['30px', '130px', '230px', '330px'], 'top suivi')
          proche(nombres(r.prof), profondeurs(1100, 100, 30), 0.02, 'profondeurs avec top: 30')
          await regle({ scale: 0.1, gap: 64, top: 0 })
          await page.waitForTimeout(250)
          r = await lire(page, 'mjs-pile-base')
          proche(r.echelle.slice(0, 3).map((e: string) => parseFloat(e)), [0.7, 0.8, 0.9], 0.01, 'scale suivi')
          await regle({ dim: 0.25, blur: 2 })
          await page.waitForTimeout(250)
          r = await lire(page, 'mjs-pile-base')
          proche(r.filtre.slice(0, 3).map((f: string) => parseFloat(/brightness\(([\d.]+)\)/.exec(f)![1])), [0.25, 0.5, 0.75], 0.01, 'dim suivi')
          proche(r.filtre.slice(0, 3).map((f: string) => parseFloat(/blur\(([\d.]+)px\)/.exec(f)![1])), [6, 4, 2], 0.01, 'blur suivi')
          await regle({ radius: 30 })
          await page.waitForTimeout(100)
          r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.arrondi, ['30px', '30px', '30px', '30px'], 'radius posé')
          await regle({ radius: undefined })
          await page.waitForTimeout(100)
          r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.arrondi, ['10px', '10px', '10px', '10px'], 'radius retiré : l\'arrondi des panneaux revient')
          await regle({ origin: 'center' })
          await page.waitForTimeout(250)
          r = await lire(page, 'mjs-pile-base')
          assert.ok(r.origine.every((o: string) => /^[\d.]+px 190px$/.test(o)), `origin suivi : ${r.origine}`)
          proche(nombres(r.prof), [3, 2, 1, 0], 0.02, 'profondeurs après origin')
          // plus rien à calculer : les panneaux sont rendus, l'écouteur est parti
          await regle({ scale: 0, dim: 0, blur: 0 })
          await page.waitForTimeout(250)
          r = await lire(page, 'mjs-pile-base')
          assert.deepEqual(r.dessous, [false, false, false, false])
          assert.deepEqual(r.echelle, ['none', 'none', 'none', 'none'])
          assert.deepEqual(r.filtre, ['none', 'none', 'none', 'none'])
          const n0 = await page.evaluate(() => (window as any).__rafN)
          await defile(page, 'mjs-pile-base', 300)
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'sans rien à calculer : aucune image demandée par le défilement')
          // et ça repart quand un réglage le redemande
          await regle({ scale: 0.05 })
          await defile(page, 'mjs-pile-base', 800)
          proche(nombres((await lire(page, 'mjs-pile-base')).prof), profondeurs(800, 64), 0.02, 'reparti')
        })
      })

      it('un panneau ajouté ou retiré est pris : il reçoit son rang, le recouvrement le compte', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          await page.evaluate(() => {
            const sec = (document.querySelector('mjs-pile-base') as any)._shadow.querySelector('section')
            sec.removeChild(sec.lastElementChild)
          })
          await page.waitForTimeout(150)
          await defile(page, 'mjs-pile-base', 1100)
          const r = await lire(page, 'mjs-pile-base')
          assert.equal(r.haut.length, 3)
          proche(nombres(r.prof), [2, 1, 0], 0.01, 'trois panneaux : deux recouvrements')
        })
      })

      it('un ancêtre en overflow: hidden casse sticky : la console le dit, une fois', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-cache', async (page, journal) => {
          for (const y of [300, 900]) {
            await page.evaluate((v: number) => window.scrollTo(0, v), y)
            await page.waitForTimeout(200)
          }
          const dits = journal.filter((m) => /\*pile/.test(m) && /overflow/.test(m))
          assert.equal(dits.length, 1, `un seul avertissement : ${JSON.stringify(journal)}`)
          assert.match(dits[0], /Retirez-le|overflow: clip/)
        })
        // une scène qui défile vraiment est la zone visible légitime : rien à dire
        await avec('mjs-pile-base', async (page, journal) => {
          await defile(page, 'mjs-pile-base', 300)
          assert.deepEqual(journal.filter((m) => /\*pile/.test(m)), [], 'aucun avertissement sur une scène qui défile')
        })
      })

      it('des réglages écrits par des variables, compilés pour de vrai : changer la variable change la pile sur place', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-variable', async (page) => {
          const clic = (b: string) => page.evaluate((c: string) => { ((document.querySelector('mjs-pile-variable') as any)._shadow.querySelector(c) as HTMLElement).click() }, b)
          let r = await lire(page, 'mjs-pile-variable')
          assert.deepEqual(r.collage, ['0px', '20px', '40px', '60px'], 'gap: $gap posé')
          await clic('.b1')
          await page.waitForTimeout(200)
          r = await lire(page, 'mjs-pile-variable')
          assert.deepEqual(r.collage, ['0px', '90px', '180px', '270px'], 'gap suivi depuis sa variable')
          await clic('.b2')
          await page.waitForTimeout(200)
          await defile(page, 'mjs-pile-variable', 1100)
          r = await lire(page, 'mjs-pile-variable')
          assert.ok(r.origine.every((o: string) => /^[\d.]+px 190px$/.test(o)), `origin suivi depuis sa variable : ${r.origine}`)
          proche(nombres(r.prof), profondeurs(1100, 90), 0.02, 'profondeurs avec le gap changé')
        })
      })

      it('la page entière en overflow caché (racine et corps) casse sticky et se dit ; le corps seul passe à la fenêtre et ne casse rien', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-page', async (page, journal) => {
          await page.evaluate(() => window.scrollTo(0, 3000))
          await page.waitForTimeout(300)
          const dits = journal.filter((m) => /\*pile/.test(m) && /overflow/.test(m))
          assert.equal(dits.length, 1, `un seul avertissement : ${JSON.stringify(journal)}`)
          assert.match(dits[0], /<body>/)
        }, { css: 'html,body{overflow-x:hidden}' })
        await avec('mjs-pile-page', async (page, journal) => {
          await page.evaluate(() => window.scrollTo(0, 3000))
          await page.waitForTimeout(300)
          assert.deepEqual(journal.filter((m) => /\*pile/.test(m)), [], 'le corps seul : son overflow passe à la fenêtre, rien à dire')
        }, { css: 'body{overflow-x:hidden}' })
      })

      it('un thème qui règle l\'effet plus haut (scale, dim, radius) est suivi par le calcul comme par le style', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-theme', async (page) => {
          await defile(page, 'mjs-pile-theme', 1100)
          const r = await lire(page, 'mjs-pile-theme')
          proche(nombres(r.prof), [3, 2, 1, 0], 0.01, 'profondeurs')
          proche(r.echelle.slice(0, 3).map((e: string) => parseFloat(e)), [0.4, 0.6, 0.8], 0.01, 'scale du thème')
          proche(r.filtre.slice(0, 3).map((f: string) => parseFloat(/brightness\(([\d.]+)\)/.exec(f)![1])), [0, 0.2, 0.6], 0.01, 'dim du thème')
          assert.deepEqual(r.arrondi, ['33px', '33px', '33px', '33px'], 'radius du thème')
        })
      })

      it('un overflow sur la balise de la pile elle-même casse sticky : la console le dit une fois, rien ne rapetissit, aucune image n\'est demandée', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-propre', async (page, journal) => {
          const n0 = await page.evaluate(() => (window as any).__rafN)
          for (const y of [300, 700, 1100, 1400]) {
            await page.evaluate((v: number) => window.scrollTo(0, v), y)
            await page.waitForTimeout(200)
          }
          const r = await page.evaluate(() => Array.from((document.querySelector('mjs-pile-propre') as any)._shadow.querySelector('section').children).map((c: any) => ({ d: c.style.getPropertyValue('--mjs-fx-pile-d'), echelle: getComputedStyle(c).scale })))
          assert.deepEqual(r.map((x: any) => x.echelle), ['none', 'none', 'none', 'none'], 'aucun panneau rapetissé alors que rien ne se colle')
          assert.deepEqual(r.map((x: any) => x.d), ['', '', '', ''], 'aucune profondeur écrite')
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'rien à calculer : aucune image demandée par le défilement')
          const dits = journal.filter((m) => /\*pile/.test(m) && /overflow/.test(m))
          assert.equal(dits.length, 1, `un seul avertissement : ${JSON.stringify(journal)}`)
          assert.match(dits[0], /<section>/)
        })
      })

      it('la balise de la pile qui défile elle-même est sa zone visible : les panneaux se collent et se recouvrent dans elle, sans avertissement', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome', async (page, journal) => {
          const lecture = (y: number) => page.evaluate(async (v: number) => {
            const sec = (document.querySelector('mjs-pile-autonome') as any)._shadow.querySelector('section') as HTMLElement
            sec.scrollTop = v
            await new Promise((ok) => setTimeout(ok, 250))
            return Array.from(sec.children).map((c: any) => c.style.getPropertyValue('--mjs-fx-pile-d'))
          }, y)
          proche(nombres(await lecture(600)), profondeurs(600, 64, 0, 4, 380, 0), 0.02, 'à 600')
          proche(nombres(await lecture(1000)), [3, 2, 1, 0], 0.02, 'tout empilé')
          assert.deepEqual(journal.filter((m) => /\*pile/.test(m)), [], 'aucun avertissement : la pile défile')
        })
      })

      it('les écouteurs de défilement sont posés quand la pile est près de l\'écran et tous retirés par off()', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-page', async (page) => {
          const vivants = () => page.evaluate(() => (window as any).__vivants.size)
          const base = await vivants()
          await page.evaluate(() => window.scrollTo(0, 3400))
          await page.waitForTimeout(300)
          assert.ok((await vivants()) > base, 'près de la pile : ses écouteurs de défilement sont posés')
          await page.evaluate(() => { (document.querySelector('mjs-pile-page') as any)._shadow.querySelector('section')._mjs_fxOff.pile() })
          assert.equal(await vivants(), base, 'après off() : aucun écouteur de défilement ne reste')
        })
      })

      it('un défilement de la page appelle l\'écouteur de la pile une seule fois', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-page', async (page) => {
          await page.evaluate(() => { (window as any).__compter = true })
          await page.evaluate(() => window.scrollTo(0, 3400))
          await page.waitForTimeout(300)
          const avant = await page.evaluate(() => (window as any).__appels)
          await page.evaluate(() => window.scrollTo(0, 3500))
          await page.waitForTimeout(300)
          assert.equal((await page.evaluate(() => (window as any).__appels)) - avant, 1, 'un seul appel pour un défilement de la page')
        })
      })

      it('off() en plein mouvement rend tout, la marque de will-change comprise', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-reglages', async (page) => {
          // d'abord le repos : la marque posée par la première lecture a disparu
          for (let i = 0; i < 200 && (await page.evaluate(() => (document.querySelector('mjs-pile-reglages') as any)._shadow.querySelector('section').hasAttribute('mjs-fx-pile-moving'))); i++) await page.waitForTimeout(50)
          // le retrait a lieu dès que la marque de mouvement paraît (observateur de mutations : aucune course avec la minuterie qui la retire,
          // quelle que soit la cadence de la machine) ; au plus 1 200 images d'attente, puis l'échec le dit
          const r = await page.evaluate(() => new Promise<{ vue: boolean; marques: string[] }>((ok) => {
            const sc  = (document.querySelector('mjs-pile-reglages') as any)._shadow.querySelector('.scene') as HTMLElement
            const sec = sc.querySelector('section') as any
            let fini  = false
            const mo  = new MutationObserver(() => {
              if (!sec.hasAttribute('mjs-fx-pile-moving')) return
              fini = true
              mo.disconnect()
              sec._mjs_fxOff.pile()
              ok({ vue: true, marques: sec.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')) })
            })
            mo.observe(sec, { attributes: true })
            let n = 0
            const garde = () => {
              if (fini) return
              if (++n < 1200) return requestAnimationFrame(garde)
              mo.disconnect()
              ok({ vue: false, marques: [] })
            }
            requestAnimationFrame(garde)
            sc.scrollTop = 1100
          }))
          assert.ok(r.vue, 'la marque de mouvement est venue')
          assert.deepEqual(r.marques, [], 'en plein mouvement : plus aucune marque sur la balise, will-change compris')
        })
      })
      it('off() ne laisse aucun attribut style sur les panneaux qui n\'en avaient pas, ni sur un panneau retiré de la pile avant', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-reglages', async (page) => {
          await page.evaluate(() => {
            const sec = (document.querySelector('mjs-pile-reglages') as any)._shadow.querySelector('section')
            ;(window as any).__parti = sec.lastElementChild
            sec.removeChild(sec.lastElementChild)
          })
          await page.waitForTimeout(150)
          assert.equal(await page.evaluate(() => (window as any).__parti.hasAttribute('style')), false, 'le panneau retiré de la pile n\'a plus d\'attribut style')
          await defile(page, 'mjs-pile-reglages', 800)
          await page.evaluate(() => { (document.querySelector('mjs-pile-reglages') as any)._shadow.querySelector('section')._mjs_fxOff.pile() })
          const r = await lire(page, 'mjs-pile-reglages')
          assert.deepEqual(r.aStyle, [false, false, false], 'aucun attribut style sur les panneaux après off()')
        })
      })

      it('aucune lecture de mise en page dans les images d\'animation : la géométrie se lit à l\'arrivée, au redimensionnement et au début d\'un défilement', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          await page.evaluate(LECTURES)
          for (let y = 140; y <= 1420; y += 80) {
            await page.evaluate((v: number) => { ((document.querySelector('mjs-pile-base') as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = v }, y)
            await page.waitForTimeout(40)
          }
          await page.waitForTimeout(250)
          const bilan = await page.evaluate(() => (window as any).__lectures)
          // la garde voit les images, et la pile est bien empilée (sans quoi zéro lecture ne prouverait rien)
          assert.ok(bilan.images >= 8, `images d'animation vues : ${bilan.images}`)
          proche(nombres((await lire(page, 'mjs-pile-base')).prof), [3, 2, 1, 0], 0.001, 'tout est empilé en bas')
          assert.equal(bilan.lectures, 0, `lectures de mise en page dans les images d'animation : ${JSON.stringify(bilan.vues)}`)
        })
      })

      it('la pile posée dans la page, elle aussi, ne lit rien dans les images d\'animation', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-page', async (page) => {
          await page.evaluate(LECTURES)
          for (let y = 2900; y <= 4300; y += 100) {
            await page.evaluate((v: number) => window.scrollTo(0, v), y)
            await page.waitForTimeout(40)
          }
          await page.waitForTimeout(250)
          const bilan = await page.evaluate(() => (window as any).__lectures)
          assert.ok(bilan.images >= 8, `images d'animation vues : ${bilan.images}`)
          const prof = await page.evaluate(() => Array.from((document.querySelector('mjs-pile-page') as any)._shadow.querySelector('section').children).map((c: any) => c.style.getPropertyValue('--mjs-fx-pile-d')))
          assert.ok(nombres(prof)[0] > 1, `la pile s'est empilée : ${JSON.stringify(prof)}`)
          assert.equal(bilan.lectures, 0, `lectures de mise en page dans les images d'animation : ${JSON.stringify(bilan.vues)}`)
        })
      })

      it('will-change ne vit que pendant le mouvement : posé sur les panneaux pendant le défilement, rendu au repos', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          const volonte = () => page.evaluate(() => Array.from((document.querySelector('mjs-pile-base') as any)._shadow.querySelectorAll('section > *')).map((c: any) => getComputedStyle(c).willChange))
          assert.deepEqual(await volonte(), ['auto', 'auto', 'auto', 'auto'], 'au repos, aucun will-change')
          // deux images après le défilement : l'effet a écrit, la marque de mouvement est posée
          await page.evaluate(() => new Promise<void>((ok) => {
            ((document.querySelector('mjs-pile-base') as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = 800
            requestAnimationFrame(() => requestAnimationFrame(() => ok()))
          }))
          assert.deepEqual(await volonte(), ['scale', 'scale', 'scale', 'scale'], 'pendant le mouvement, will-change: scale')
          await page.waitForTimeout(700)
          assert.deepEqual(await volonte(), ['auto', 'auto', 'auto', 'auto'], 'le mouvement fini, will-change est rendu')
        })
      })

      it('au chargement, la pile se pose sur un calque deux images seulement : la marque de mouvement est posée une fois et rendue sans minuterie ; la pose à zéro n\'arme pas celle de will-change', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          await page.waitForTimeout(400)
          assert.equal(await page.evaluate(() => (window as any).__mouvements), 1, 'posée une seule fois, par le cycle de chargement : la pose à zéro n\'y ajoute rien')
          assert.deepEqual(await page.evaluate(() => (window as any).__delais), [], 'aucune minuterie de plus de 100 ms armée au chargement (celle qui rend will-change)')
          await defile(page, 'mjs-pile-base', 800)
          assert.ok((await page.evaluate(() => (window as any).__mouvements)) > 1, 'un défilement pose la marque (la sonde voit bien ce qu\'elle doit voir)')
        })
      })

      it('la géométrie ne se relit pas au défilement quand rien ne change : ni dans une série d\'évènements d\'un souffle, ni après un temps de calme', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          await espionner(page, 'mjs-pile-base')
          // ce que la pile lit en arrivant ne compte pas
          await page.waitForTimeout(400)
          await page.evaluate(() => { (window as any).__relues = 0 })
          // trente évènements de défilement d'un même souffle
          const salve = () => page.evaluate(() => new Promise<number>((ok) => {
            const sc = (document.querySelector('mjs-pile-base') as any)._shadow.querySelector('.scene') as HTMLElement
            for (let i = 0; i < 30; i++) sc.dispatchEvent(new Event('scroll'))
            setTimeout(() => ok((window as any).__relues), 0)
          }))
          assert.equal(await salve(), 0, 'trente évènements : aucune relecture')
          await page.waitForTimeout(300)
          assert.equal(await salve(), 0, 'après un temps de calme, la série suivante ne relit pas non plus : rien n\'a changé')
        })
      })

      it('à cadence lente (un évènement toutes les 200 ms), le défilement ne relance pas la lecture de la géométrie à chaque évènement : la pile dans une zone à part, celle qui défile elle-même, celle de la page', async function () {
        if (!present) return this.skip()
        for (const [tag, zone] of [['mjs-pile-base', '.scene'], ['mjs-pile-autonome-marge', 'section'], ['mjs-pile-page', 'page']]) {
          await avec(tag, async (page) => {
            const cdp = nom === 'chromium' ? await page.context().newCDPSession(page) : null
            if (cdp) await cdp.send('Performance.enable')
            const mises = async () => cdp ? (await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'LayoutCount').value as number : 0
            // la pile de la page est loin sous l'écran : la page descend jusqu'à elle d'abord
            await page.evaluate((z: string) => { if (z === 'page') window.scrollTo(0, 2700) }, zone)
            await page.waitForTimeout(600)
            await espionner(page, tag)
            await page.waitForTimeout(400)
            await page.evaluate(() => { (window as any).__relues = 0 })
            const avant = await mises()
            // dix pas de 30 px, 200 ms entre deux : chaque évènement vient après plus de 150 ms de calme
            for (let k = 0; k < 10; k++) {
              await page.evaluate(([t, z]: string[]) => {
                if (z === 'page') window.scrollBy(0, 30)
                else ((document.querySelector(t) as any)._shadow.querySelector(z) as HTMLElement).scrollTop += 30
              }, [tag, zone])
              await page.waitForTimeout(200)
            }
            assert.equal(await page.evaluate(() => (window as any).__relues), 0, `${tag} : aucune relecture en dix évènements espacés de 200 ms`)
            // aucune mise en page : le défilement ne force rien (la pile lit la boîte que le défilement vient déjà de mettre en page) ; une mise en page
            // forcée un évènement sur deux en ferait cinq
            if (cdp) {
              const forcees = (await mises()) - avant
              assert.equal(forcees, 0, `${tag} : aucune mise en page forcée en dix évènements (${forcees})`)
            }
          })
        }
      })

      it('off() rend l\'observateur de visibilité : aucun IntersectionObserver ne reste de la pile', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page) => {
          const vivants = () => page.evaluate(() => (window as any).__io.size)
          const avant   = await vivants()
          assert.ok(avant >= 1, `la pile observe sa visibilité : ${avant}`)
          await page.evaluate(() => { (document.querySelector('mjs-pile-base') as any)._shadow.querySelector('section')._mjs_fxOff.pile() })
          assert.equal(await vivants(), avant - 1, 'l\'observateur de la pile est rendu')
        })
      })

      it('la zone qui défile a un padding : les panneaux se collent après lui, et la profondeur suit la place que le navigateur leur donne', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-marge', async (page) => {
          for (const y of [140, 300, 460, 620, 800, 960, 1100]) {
            await defile(page, 'mjs-pile-marge', y)
            const r = await lire(page, 'mjs-pile-marge')
            proche(nombres(r.prof), profondeurs(r.defile, 50, 0, 4, 380, 100, 20), 0.02, `profondeur à ${r.defile}`)
          }
          // les trois premiers sont collés : à 20 px (le padding) + 50 px par rang, ce que suppose le calcul (le dernier est déjà poussé vers le haut par le bas de la pile)
          const fin = await lire(page, 'mjs-pile-marge')
          assert.deepEqual(fin.haut.slice(0, 3), [20, 70, 120], 'les panneaux collés après le padding de la zone')
          proche(nombres(fin.prof), [3, 2, 1, 0], 0.001, 'tout est empilé')
        })
      })

      it('un panneau qui a un bottom d\'auteur : la profondeur suit la place que le navigateur lui donne, collé en bas de la zone puis en haut', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-bas', async (page) => {
          let remonte = false
          for (const y of [0, 5, 40, 100, 200, 300, 400, 500, 600, 800, 1000, 1100]) {
            await defile(page, 'mjs-pile-bas', y)
            const r = await lire(page, 'mjs-pile-bas')
            proche(nombres(r.prof), depuisLesBoites(r.haut, 380, 40), 0.03, `profondeur à ${r.defile}`)
            remonte = remonte || r.haut[1] < 100 + 380 - r.defile - 1
          }
          assert.ok(remonte, 'le bottom remonte bien le deuxième panneau (sinon la scène ne prouve rien)')
        })
      })

      it('le rendu au repos ne change pas au premier défilement : la légende des panneaux est rastérisée de la même façon avant et après un aller-retour', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-legende', async (page) => {
          const clip = { x: 0, y: 0, width: 700, height: 520 }
          const avant = await page.screenshot({ clip })
          // un aller-retour de défilement, puis le repos (will-change est rendu)
          await page.evaluate(() => new Promise<void>((ok) => {
            const sc = (document.querySelector('mjs-pile-legende') as any)._shadow.querySelector('.scene') as HTMLElement
            let k = 0
            const pas = () => {
              sc.scrollTop = k < 10 ? k * 30 : Math.max(0, (20 - k) * 30)
              if (++k < 21) return requestAnimationFrame(pas)
              ok()
            }
            requestAnimationFrame(pas)
          }))
          await page.waitForFunction(() => !(document.querySelector('mjs-pile-legende') as any)._shadow.querySelector('[mjs-fx-pile-moving]'))
          await page.waitForTimeout(300)
          const apres = await page.screenshot({ clip })
          assert.ok(avant.equals(apres), 'la capture au repos a changé après le premier défilement')
        })
      })

      it('un navigateur sans IntersectionObserver : l\'arrivée est annoncée avant le premier rendu, la pile n\'en conclut rien (aucun avertissement) et calcule dès le premier défilement', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-base', async (page, journal) => {
          await defile(page, 'mjs-pile-base', 1100)
          proche(nombres((await lire(page, 'mjs-pile-base')).prof), profondeurs(1100, 64), 0.02, 'profondeurs sans observateur')
          assert.deepEqual(journal.filter((m) => /\*pile/.test(m)), [], 'aucun avertissement : la zone défile bel et bien')
        }, { sansObservateur: true })
      })

      it('une géométrie lue avant le premier rendu (sans IntersectionObserver ni ResizeObserver, la scène encore cachée) est relue au premier défilement, même quand la boîte de la pile semble à sa place', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-sans-haut', async (page) => {
          await page.evaluate(() => { ((document.querySelector('mjs-pile-sans-haut') as any).style.display = 'block') })
          await defile(page, 'mjs-pile-sans-haut', 250)
          proche(nombres((await lire(page, 'mjs-pile-sans-haut')).prof), profondeurs(250, 64, 0, 4, 380, 0), 0.02, 'profondeurs après un premier rendu tardif')
        }, { sansObservateur: true, sansTaille: true, css: 'mjs-pile-sans-haut{display:none}' })
      })

      it('ce qui est au-dessus de la pile change de hauteur en plein défilement (une image qui se charge) : la profondeur suit tout de suite, sans attendre la série suivante', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-ancre', async (page) => {
          // une série de 50 images de 12 px ; à la cinquième, 300 px de plus au-dessus de la pile
          await page.evaluate(() => new Promise<void>((ok) => {
            const sh = (document.querySelector('mjs-pile-ancre') as any)._shadow
            const sc = sh.querySelector('.scene') as HTMLElement
            let k = 0
            const pas = () => {
              sc.scrollTop += 12
              if (++k === 5) (sh.querySelector('.haut') as HTMLElement).style.height = '400px'
              if (k < 50) return requestAnimationFrame(pas)
              requestAnimationFrame(() => requestAnimationFrame(() => ok()))
            }
            requestAnimationFrame(pas)
          }))
          const r = await lire(page, 'mjs-pile-ancre')
          proche(nombres(r.prof), profondeurs(r.defile, 64, 0, 4, 380, 400), 0.02, `profondeur à ${r.defile}, la pile ayant été descendue de 300 px`)
        })
      })

      it('une pile qui défile elle-même ne relit pas sa géométrie au défilement quand rien ne change : sa boîte ne bouge pas quand c\'est son contenu qui défile', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          await espionner(page, 'mjs-pile-autonome-marge')
          // ce que la pile lit en arrivant ne compte pas
          await page.waitForTimeout(400)
          await page.evaluate(() => { (window as any).__relues = 0 })
          // quarante évènements d'un même souffle, la pile défilant de 6 px à chacun
          const salve = () => page.evaluate(() => new Promise<number>((ok) => {
            const sec = (document.querySelector('mjs-pile-autonome-marge') as any)._shadow.querySelector('section') as HTMLElement
            for (let i = 0; i < 40; i++) {
              sec.scrollTop += 6
              sec.dispatchEvent(new Event('scroll'))
            }
            setTimeout(() => ok((window as any).__relues), 0)
          }))
          assert.equal(await salve(), 0, 'quarante évènements : aucune relecture')
          await page.waitForTimeout(300)
          assert.equal(await salve(), 0, 'après un temps de calme, la série suivante ne relit pas non plus')
        })
      })

      it('une pile qui défile elle-même garde la profondeur exacte tout au long d\'une série qui change de sens, quand ce qui est au-dessus d\'elle change de hauteur et quand la page défile autour', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          // la géométrie est lue au premier évènement, à 420 px ; les suivants, sans calme, remontent, descendent, passent par 0 : la place des panneaux
          // ne dépend ni de ce défilement-là, ni de la place de la pile dans la page ; au quatrième pas 300 px de plus au-dessus d'elle, au huitième la page défile
          const pas = await page.evaluate(() => new Promise<any[]>((ok) => {
            const sh     = (document.querySelector('mjs-pile-autonome-marge') as any)._shadow
            const sec    = sh.querySelector('section') as HTMLElement
            const haut   = sh.querySelector('.haut') as HTMLElement
            const cibles = [420, 300, 150, 0, 80, 260, 480, 640, 700, 520, 330, 210]
            const lus: any[] = []
            const suite = (k: number) => {
              if (k === cibles.length) return ok(lus)
              if (k === 3) haut.style.height = '400px'
              if (k === 7) window.scrollTo(0, 200)
              sec.scrollTop = cibles[k]
              sec.dispatchEvent(new Event('scroll'))
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const base = sec.getBoundingClientRect().top + sec.clientTop
                const fils = Array.from(sec.children) as HTMLElement[]
                lus.push({ defile: Math.round(sec.scrollTop), haut: fils.map((c) => Math.round((c.getBoundingClientRect().top - base) * 10) / 10), prof: fils.map((c) => c.style.getPropertyValue('--mjs-fx-pile-d')) })
                suite(k + 1)
              }))
            }
            suite(0)
          }))
          assert.equal(pas.length, 12)
          assert.ok(pas.some((p) => nombres(p.prof)[0] > 0.2 && nombres(p.prof)[0] < 2.8), 'des profondeurs entre deux états (sinon la scène ne prouve rien)')
          pas.forEach((p) => proche(nombres(p.prof), depuisLesBoites(p.haut, 300, 30), 0.02, `profondeur à ${p.defile}`))
        })
      })

      // une série continue de trente pas de 6 px sur la pile qui défile elle-même (deux images entre deux pas), à partir de 200 px ; au cinquième pas, le changement
      // de hauteur demandé : la profondeur est lue à la fin, avec les places et les hauteurs réelles des panneaux
      const serieQuiChange = async (page: any, changement: string) => {
        await espionner(page, 'mjs-pile-autonome-marge')
        await page.evaluate(() => { ((document.querySelector('mjs-pile-autonome-marge') as any)._shadow.querySelector('section') as HTMLElement).scrollTop = 200 })
        await page.waitForTimeout(600)
        await page.evaluate(() => { (window as any).__relues = 0 })
        return page.evaluate((ch: string) => new Promise<any>((ok) => {
          const sec = (document.querySelector('mjs-pile-autonome-marge') as any)._shadow.querySelector('section') as HTMLElement
          const pan = (i: number) => sec.children[i] as HTMLElement
          const CHANGEMENTS: Record<string, () => void> = {
            grandit: () => { pan(0).style.height = '420px' },
            retrecit: () => { pan(0).style.height = '150px' },
            compense: () => { pan(0).style.height = '420px'; pan(1).style.height = '180px' }
          }
          let k = 0
          const pas = () => {
            sec.scrollTop += 6
            if (++k === 5) CHANGEMENTS[ch]()
            if (k < 30) return requestAnimationFrame(() => requestAnimationFrame(pas))
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const base = sec.getBoundingClientRect().top + sec.clientTop
              const fils = Array.from(sec.children) as HTMLElement[]
              ok({
                defile: Math.round(sec.scrollTop),
                haut: fils.map((c) => Math.round((c.getBoundingClientRect().top - base) * 10) / 10),
                hauteurs: fils.map((c) => c.offsetHeight),
                prof: fils.map((c) => c.style.getPropertyValue('--mjs-fx-pile-d')),
                relues: (window as any).__relues
              })
            }))
          }
          pas()
        }), changement)
      }

      it('une pile qui défile elle-même voit un de ses panneaux grandir en plein défilement (une image qui se charge dans le panneau) : la profondeur suit tout de suite, par une seule relecture', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          const fin = await serieQuiChange(page, 'grandit')
          assert.equal(fin.hauteurs[0], 420, 'le premier panneau a bien grandi')
          assert.ok(nombres(fin.prof)[0] > 0.2 && nombres(fin.prof)[0] < 2.8, `une profondeur entre deux états (sinon la scène ne prouve rien) : ${fin.prof}`)
          proche(nombres(fin.prof), depuisLesBoites(fin.haut, fin.hauteurs, 30), 0.02, `profondeur à ${fin.defile}, le premier panneau ayant grandi de 120 px`)
          assert.equal(fin.relues, 1, 'une seule relecture, quand la hauteur change')
        })
      })

      it('une pile qui défile elle-même voit un de ses panneaux rétrécir en plein défilement : la profondeur suit tout de suite, par une seule relecture', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          const fin = await serieQuiChange(page, 'retrecit')
          assert.equal(fin.hauteurs[0], 150, 'le premier panneau a bien rétréci')
          assert.ok(nombres(fin.prof)[0] > 0.2 && nombres(fin.prof)[0] < 2.8, `une profondeur entre deux états (sinon la scène ne prouve rien) : ${fin.prof}`)
          proche(nombres(fin.prof), depuisLesBoites(fin.haut, fin.hauteurs, 30), 0.02, `profondeur à ${fin.defile}, le premier panneau ayant rétréci de 150 px`)
          assert.equal(fin.relues, 1, 'une seule relecture, quand la hauteur change')
        })
      })

      it('deux panneaux qui changent de hauteur en sens contraire de la même quantité (la hauteur du contenu ne bouge pas) : la profondeur suit tout de suite', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          const fin = await serieQuiChange(page, 'compense')
          assert.deepEqual(fin.hauteurs.slice(0, 2), [420, 180], 'le premier panneau a grandi de 120 px, le deuxième a rétréci d\'autant')
          proche(nombres(fin.prof), depuisLesBoites(fin.haut, fin.hauteurs, 30), 0.02, `profondeur à ${fin.defile}, la hauteur du contenu étant la même`)
          assert.equal(fin.relues, 1, 'une seule relecture, quand les hauteurs changent')
        })
      })

      it('sans ResizeObserver, la hauteur du contenu suffit : un panneau qui grandit, puis un autre qui rétrécit, en plein défilement, sont vus tout de suite', async function () {
        if (!present) return this.skip()
        for (const [changement, hauteur] of [['grandit', 420], ['retrecit', 150]] as const) {
          await avec('mjs-pile-autonome-marge', async (page) => {
            const fin = await serieQuiChange(page, changement)
            assert.equal(fin.hauteurs[0], hauteur, `le premier panneau a changé de hauteur (${changement})`)
            proche(nombres(fin.prof), depuisLesBoites(fin.haut, fin.hauteurs, 30), 0.02, `profondeur à ${fin.defile} (${changement})`)
            assert.equal(fin.relues, 1, `une seule relecture (${changement})`)
          }, { sansTaille: true })
        }
      })

      it('une pile qui défile elle-même ne relit pas sa géométrie quand rien ne change, même quand l\'image d\'animation écrit entre deux évènements, en descendant puis en remontant', async function () {
        if (!present) return this.skip()
        await avec('mjs-pile-autonome-marge', async (page) => {
          await espionner(page, 'mjs-pile-autonome-marge')
          // ce que la pile lit en arrivant ne compte pas
          await page.waitForTimeout(400)
          await page.evaluate(() => { (window as any).__relues = 0 })
          // trente pas de 12 px, deux images entre deux pas : la pile écrit ses profondeurs et ses échelles entre deux évènements (descente, puis remontée)
          const serie = (sens: number) => page.evaluate((s: number) => new Promise<any>((ok) => {
            const w   = window as any
            const sec = w.document.querySelector('mjs-pile-autonome-marge')._shadow.querySelector('section') as HTMLElement
            let k = 0
            const pas = () => {
              sec.scrollTop += 12 * s
              if (++k < 30) return requestAnimationFrame(() => requestAnimationFrame(pas))
              requestAnimationFrame(() => requestAnimationFrame(() => ok({ relues: w.__relues, prof: (sec.children[0] as HTMLElement).style.getPropertyValue('--mjs-fx-pile-d'), defile: sec.scrollTop })))
            }
            pas()
          }), sens)
          const descente = await serie(1)
          assert.ok(parseFloat(descente.prof) > 0, `la pile écrit bien ses profondeurs pendant la série (sinon la scène ne prouve rien) : ${descente.prof}`)
          assert.equal(descente.relues, 0, 'trente pas en descendant : aucune relecture')
          await page.waitForTimeout(300)
          const remontee = await serie(-1)
          assert.equal(remontee.defile, 0, 'la série est revenue en haut')
          assert.equal(remontee.relues, 0, 'trente pas en remontant, après un temps de calme : aucune relecture')
        })
      })

      // un `zoom` CSS posé sur la balise de la pile, sur son hôte ou sur un ancêtre : le défilement et les boîtes ne sont pas dans la même unité,
      // la profondeur doit pourtant rester celle de la même pile sans zoom, à la même part de sa course, et celle que les boîtes réelles donnent
      const ZOOMS: Record<string, string> = {
        'sur la balise': '',
        'sur l\'hôte':  'mjs-pile-autonome{zoom:ZOOM}',
        'sur un ancêtre': 'body{zoom:ZOOM}'
      }
      const PARTS = [0, 0.2, 0.4, 0.6, 0.8, 1]
      // onze positions pour les scènes où un `bottom`, un padding ou une bordure ne comptent que sur une part de la course
      const PARTS_FINES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
      const profondeursZoom = (page: any, tag: string, gap: number, parts = PARTS) => page.evaluate(async ([t, gap, parts]: [string, number, number[]]) => {
        const w   = window as any
        const sec = w.document.querySelector(t)._shadow.querySelector('section') as HTMLElement
        const pause = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 120))))
        const sortie: any[] = []
        // ce qui défile : une scène à part, la pile elle-même, ou la page
        const zone = (sec.closest('.scene') as HTMLElement | null) || (getComputedStyle(sec).overflowY === 'auto' ? sec : null)
        const racine = w.document.scrollingElement as HTMLElement
        const max  = zone ? zone.scrollHeight - zone.clientHeight : racine.scrollHeight - racine.clientHeight
        for (const part of parts) {
          if (zone) zone.scrollTop = Math.round(max * part)
          else w.scrollTo(0, Math.round(max * part))
          await pause()
          const fils  = Array.from(sec.children) as HTMLElement[]
          const hauts = fils.map((c) => c.getBoundingClientRect().top)
          const hs    = fils.map((c) => c.getBoundingClientRect().height / (parseFloat(getComputedStyle(c).scale) || 1))
          // les boîtes sont lues dans l'unité de l'écran : le `gap` aussi
          const g = gap * (hs[0] / fils[0].offsetHeight)
          let somme = 0
          const reel: number[] = []
          reel[fils.length - 1] = 0
          for (let k = fils.length - 2; k >= 0; k--) {
            somme += Math.min(1, Math.max(0, (hauts[k] + hs[k] - hauts[k + 1]) / Math.max(1, hs[k] - g)))
            reel[k] = somme
          }
          sortie.push({ part, ecrit: fils.map((c) => parseFloat(c.style.getPropertyValue('--mjs-fx-pile-d')) || 0), reel })
        }
        return sortie
      }, [tag, gap, parts])

      // le zoom de quatre tiers n'est pas un nombre rond : le rapport entre l'écran et la mise en page, arrondi au centième, prédit mal où la boîte de la pile doit être
      // après un long défilement et la géométrie était relue à chaque série de défilements ; la zone à part comme la pile qui défile elle-même ne relisent rien
      const NOMS: Record<number, string> = { 1.5: 'grand', 0.75: 'petit', 1.3333: 'tiers' }
      for (const zoom of [1.5, 0.75, 1.3333]) {
        it(`une pile dans une zone à part qui porte un zoom: ${zoom} : la profondeur est celle de la même pile sans zoom et celle des boîtes réelles, à plusieurs positions de défilement`, async function () {
          if (!present) return this.skip()
          const sans = await avec('mjs-pile-zone', (page) => profondeursZoom(page, 'mjs-pile-zone', 64))
          const tag  = `mjs-pile-zone-${NOMS[zoom]}`
          const avecZoom = await avec(tag, async (page) => {
            await espionner(page, tag)
            const r = await profondeursZoom(page, tag, 64)
            const relues = await page.evaluate(() => (window as any).__relues)
            // le défilement seul ne relit pas la géométrie : la boîte de la pile reste où le défilement la met, mesurée dans l'unité de l'écran
            assert.equal(relues, 0, 'cinq positions de défilement, rien n\'a changé : aucune relecture de la géométrie')
            return r
          })
          assert.ok(sans[3].ecrit[0] > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${JSON.stringify(sans[3])}`)
          sans.forEach((s: any, i: number) => {
            proche(avecZoom[i].ecrit, avecZoom[i].reel, 0.005, `part ${s.part} du défilement, écrit contre boîtes réelles (sans zoom : écrit ${JSON.stringify(s.ecrit)}, réel ${JSON.stringify(s.reel)})`)
            proche(avecZoom[i].ecrit, s.ecrit, 0.005, `part ${s.part} du défilement, écrit sous zoom contre sans zoom`)
          })
        })
        for (const [lieu, regle] of Object.entries(ZOOMS)) {
          it(`une pile qui défile elle-même sous zoom: ${zoom} ${lieu} : la profondeur est celle de la même pile sans zoom et celle des boîtes réelles, à plusieurs positions de défilement`, async function () {
            if (!present) return this.skip()
            const sans = await avec('mjs-pile-autonome', (page) => profondeursZoom(page, 'mjs-pile-autonome', 64))
            const tag = lieu === 'sur la balise' ? `mjs-pile-autonome-${NOMS[zoom]}` : 'mjs-pile-autonome'
            const avecZoom = await avec(tag, async (page) => {
              await espionner(page, tag)
              const r = await profondeursZoom(page, tag, 64)
              const relues = await page.evaluate(() => (window as any).__relues)
              assert.equal(relues, 0, 'cinq positions de défilement, rien n\'a changé : aucune relecture de la géométrie')
              return r
            }, { css: regle.replace('ZOOM', String(zoom)) })
            assert.ok(sans[3].ecrit[0] > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${JSON.stringify(sans[3])}`)
            sans.forEach((s: any, i: number) => {
              proche(avecZoom[i].ecrit, avecZoom[i].reel, 0.005, `part ${s.part} du défilement, écrit contre boîtes réelles (sans zoom : écrit ${JSON.stringify(s.ecrit)}, réel ${JSON.stringify(s.reel)})`)
              proche(avecZoom[i].ecrit, s.ecrit, 0.005, `part ${s.part} du défilement, écrit sous zoom contre sans zoom`)
            })
          })
        }
      }

      // la taille de mise en page d'une zone (`offset*`) est un entier : pour une zone de taille fractionnaire le rapport écran / mise en page n'est pas exactement celui du zoom (1,002 sans zoom, 1,252 à 1,25) ;
      // il reste celui du zoom, et la boîte de la pile prédite par le défilement ne s'écarte pas de la boîte réelle au point de relire la géométrie
      for (const [nom, titre] of [['mjs-pile-zone-fractionnaire', 'sans zoom'], ['mjs-pile-zone-fractionnaire-zoom', 'sous zoom: 1.25']]) {
        it(`une pile dans une zone de taille fractionnaire ${titre} : la profondeur est celle des boîtes réelles et le défilement ne relit pas la géométrie`, async function () {
          if (!present) return this.skip()
          const r = await avec(nom, async (page) => {
            await espionner(page, nom)
            const prof = await profondeursZoom(page, nom, 64, PARTS_FINES)
            const relues = await page.evaluate(() => (window as any).__relues)
            assert.equal(relues, 0, 'onze positions de défilement, rien n\'a changé : aucune relecture de la géométrie')
            return prof
          })
          assert.ok(Math.max(...r.map((s: any) => s.reel[0])) > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${JSON.stringify(r)}`)
          r.forEach((s: any) => proche(s.ecrit, s.reel, 0.005, `part ${s.part} du défilement, écrit contre boîtes réelles`))
        })
      }

      // un zoom posé sur la pile elle-même, ou sur la page, le corps ou l'hôte d'une pile qui n'a pas de zone à part : la zone (ou la fenêtre) garde son unité, la pile et
      // ses panneaux prennent la leur, et le `gap` (ainsi que `top` et `bottom`) de la feuille est écrit dans cette unité-là ; la profondeur est celle que les boîtes réelles donnent
      const ZOOMS_PAGE: Record<string, string> = {
        'sur la page': 'html{zoom:ZOOM}',
        'sur le corps': 'body{zoom:ZOOM}',
        'sur l\'hôte': 'mjs-pile-page{zoom:ZOOM}'
      }
      for (const zoom of [1.5, 0.75]) {
        it(`une pile qui porte elle-même un zoom: ${zoom}, dans une zone qui n'en a pas : la profondeur est celle des boîtes réelles, à plusieurs positions de défilement`, async function () {
          if (!present) return this.skip()
          const tag = zoom > 1 ? 'mjs-pile-zone-sur-pile-grand' : 'mjs-pile-zone-sur-pile-petit'
          const r = await avec(tag, (page) => profondeursZoom(page, tag, 40, PARTS_FINES))
          assert.ok(Math.max(...r.map((s: any) => s.reel[0])) > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${JSON.stringify(r)}`)
          r.forEach((s: any) => proche(s.ecrit, s.reel, 0.005, `part ${s.part} du défilement, écrit contre boîtes réelles`))
        })
        for (const [lieu, regle] of Object.entries(ZOOMS_PAGE)) {
          it(`une pile dans la page sous zoom: ${zoom} ${lieu} : la profondeur est celle des boîtes réelles, à plusieurs positions de défilement`, async function () {
            if (!present) return this.skip()
            const r = await avec('mjs-pile-page', (page) => profondeursZoom(page, 'mjs-pile-page', 50), { css: regle.replace('ZOOM', String(zoom)) })
            assert.ok(Math.max(...r.map((s: any) => s.reel[0])) > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${JSON.stringify(r)}`)
            r.forEach((s: any) => proche(s.ecrit, s.reel, 0.005, `part ${s.part} du défilement, écrit contre boîtes réelles`))
          })
        }
      }

      // un changement de la boîte de la pile qui ne change ni la taille d'un panneau, ni la place de la boîte, ni la hauteur du contenu d'une pile qui
      // défile elle-même (padding, `gap` du conteneur, marge d'un panneau) : l'écart entre la profondeur écrite et celle que les boîtes réelles donnent
      const CHANGEMENTS: Record<string, string> = {
        padding: 'sec.style.paddingTop = "70px"',
        gap:     'sec.style.display = "flex"; sec.style.flexDirection = "column"; sec.style.gap = "30px"; Array.from(sec.children).forEach(function(c) { c.style.flexShrink = "0" })',
        marge:   'sec.children[1].style.marginTop = "60px"',
        bordure: 'sec.style.borderTop = "40px solid #888"'
      }
      const ecartApres = (page: any, tag: string, changement: string, defilement: number, gap: number, avantLeChangement: boolean) => page.evaluate(([t, code, y, gap, avant]: [string, string, number, number, boolean]) => new Promise<any>((ok) => {
        const w    = window as any
        const sec  = w.document.querySelector(t)._shadow.querySelector('section') as HTMLElement
        const sc   = w.document.querySelector(t)._shadow.querySelector('.scene') as HTMLElement | null
        const zone = sc || (getComputedStyle(sec).overflowY === 'auto' ? sec : null)
        const va   = () => { if (zone) zone.scrollTop = y; else w.scrollTo(0, y) }
        const mesure = () => {
          const fils = Array.from(sec.children) as HTMLElement[]
          const hauts = fils.map((c) => c.getBoundingClientRect().top)
          const hs    = fils.map((c) => c.getBoundingClientRect().height / (parseFloat(getComputedStyle(c).scale) || 1))
          let somme = 0
          const attendu: number[] = []
          attendu[fils.length - 1] = 0
          for (let k = fils.length - 2; k >= 0; k--) {
            somme += Math.min(1, Math.max(0, (hauts[k] + hs[k] - hauts[k + 1]) / Math.max(1, hs[k] - gap)))
            attendu[k] = somme
          }
          const ecrit = fils.map((c) => parseFloat(c.style.getPropertyValue('--mjs-fx-pile-d')) || 0)
          return { ecart: Math.max(...ecrit.map((v, i) => Math.abs(v - attendu[i]))), ecrit, attendu }
        }
        const fin = () => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => ok(mesure()), 250)))
        if (avant) {
          // le changement a lieu au repos, après un premier défilement
          va()
          setTimeout(() => { new Function('sec', code)(sec); fin() }, 300)
        }
        else {
          new Function('sec', code)(sec)
          setTimeout(() => { va(); fin() }, 300)
        }
      }), [tag, CHANGEMENTS[changement], defilement, gap, avantLeChangement])

      for (const [tag, y, gap] of [['mjs-pile-base', 600, 64], ['mjs-pile-page', 3500, 50], ['mjs-pile-autonome', 500, 64]] as const) {
        for (const changement of Object.keys(CHANGEMENTS)) {
          it(`${tag} : ${changement} posé sur la pile ou un panneau (ni taille de panneau, ni place de la boîte) : la profondeur suit la boîte réelle, au repos puis au défilement suivant`, async function () {
            if (!present) return this.skip()
            await avec(tag, async (page) => {
              const repos = await ecartApres(page, tag, changement, y, gap, true)
              assert.ok(repos.ecrit[0] > 0.2, `la scène recouvre bien (sinon elle ne prouve rien) : ${repos.ecrit}`)
              // une pile qui défile elle-même ne change ni de boîte ni de taille de panneau : seule la hauteur de son contenu bouge, vue au défilement suivant
              if (tag !== 'mjs-pile-autonome' || changement === 'padding' || changement === 'bordure') assert.ok(repos.ecart <= 0.02, `au repos, écart ${repos.ecart} : ${JSON.stringify(repos)}`)
            })
            await avec(tag, async (page) => {
              const suivant = await ecartApres(page, tag, changement, y, gap, false)
              assert.ok(suivant.ecrit[0] > 0.2, `la scène recouvre bien : ${suivant.ecrit}`)
              assert.ok(suivant.ecart <= 0.02, `après le défilement suivant, écart ${suivant.ecart} : ${JSON.stringify(suivant)}`)
            })
            // sans ResizeObserver, le défilement suivant suffit à le voir
            await avec(tag, async (page) => {
              const suivant = await ecartApres(page, tag, changement, y, gap, false)
              assert.ok(suivant.ecart <= 0.02, `sans ResizeObserver, écart ${suivant.ecart} : ${JSON.stringify(suivant)}`)
            }, { sansTaille: true })
          })
        }
      }
    })
  }
})
