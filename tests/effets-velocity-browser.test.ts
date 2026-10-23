// *velocity dans Chromium, Firefox et WebKit réels (une vraie mise en page et un vrai défilement sont
// nécessaires) : la balise réagit à la VITESSE du défilement (de la page, ou du conteneur qui la porte) :
// chacun des six styles déforme pendant que ça défile et revient à plat quand on s'arrête ; `strength`,
// `max`, `smooth`, `axis` changent ce qu'on voit ; une seule boucle et un seul écouteur par racine quel
// que soit le nombre de balises ; au repos ni image d'animation ni minuterie ; une balise hors de
// l'écran n'est pas écrite ; « réduire les animations » : rien ne bouge ; effets économes : bend
// retombe sur skew ; `off()` ne laisse rien (observateurs de visibilité compris) ; les réglages se suivent sur place.
// La déformation s'ajoute au style de l'auteur (filtre, taille, place, transformation, en feuille comme en ligne) ; un span ou un lien se déforme aussi.
// Le bord que bend bombe est une courbe lisse : relevé ligne par ligne sur une capture, il s'écarte d'un polynôme de degré 6 de moins de 1,35 % de la bosse (pas de facettes).
// Les défilements des tests se font à VITESSE constante (px par ms), jamais à pas fixe par image, et l'état se lit dans la page juste après le dernier pas :
// la vitesse que l'effet mesure ne dépend pas de la cadence de la machine.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { LECTURES } from './helpers/lectures-images.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const boite = (cls: string, fx: string) => `<div class="b ${cls}" ${fx}>${cls}</div>`
const STYLE = '\n:host\n  display: block\n.scene\n  box-sizing: border-box\n  width: 600px\n  height: 400px\n  overflow: auto\n.rang\n  display: flex\n  flex-wrap: wrap\n  gap: 20px\n  padding: 20px\n.b\n  box-sizing: border-box\n  width: 160px\n  height: 100px\n  background: #36c\n.cale\n  height: 400px\n.espace\n  flex: 0 0 100%\n  height: 1200px\n.large\n  width: 3000px\n  padding-left: 420px\n.fin\n  height: 1600px\n'
const scene = (boites: string, plus = '') => `<div class="scene"><div class="cale"></div><div class="rang ${plus}">${boites}</div><div class="fin"></div></div>\n<style>${STYLE}</style>\n`
const STYLES = ['skew', 'stretch', 'tilt', 'bend', 'blur', 'shift']
const SIX    = STYLES.map((s, i) => boite('c' + (i + 1), s === 'skew' ? '*velocity' : `*velocity(${s})`)).join('')

// un cadre noir de `l` × `h` px, collé à 40 px du haut d'une scène qui défile, 180 px de marge de chaque côté pour le bombement
const bord = (l: number, h: number, max: number) => `<div class="scene"><div class="b" *velocity(bend, strength: 5, max: ${max})></div><div class="loin"></div></div>\n<style>\n:host\n  display: block\n.scene\n  box-sizing: border-box\n  width: ${l + 360}px\n  height: ${h + 160}px\n  overflow: auto\n.b\n  position: sticky\n  top: 40px\n  width: ${l}px\n  height: ${h}px\n  margin: 40px 0 0 180px\n  background: #000\n.loin\n  height: 30000px\n</style>\n`

const SOURCES: Record<string, string> = {
  'vel-six.mjs':      scene(SIX),
  'vel-seule.mjs':    scene(boite('c1', '*velocity')),
  // une force à 5 et une borne à 5 : la vitesse est pleine, la déformation ne dépasse pas 5
  'vel-borne.mjs':    scene(boite('m5', '*velocity(strength: 5, max: 5)')),
  'vel-reglages.mjs': scene(boite('s1', '*velocity(strength: 1)') + boite('s3', '*velocity(strength: 3)') + boite('sd', '*velocity') + boite('s2', '*velocity(strength: 2)') + boite('sm1', '*velocity(smooth: 1)') + boite('sm05', '*velocity(smooth: .05)')),
  // la balise de l'axe x et celle de l'axe y (par défaut), dans un conteneur qui défile dans les deux sens
  'vel-axe.mjs':      scene(boite('ax', '*velocity(shift, axis: x)') + boite('ay', '*velocity(shift)'), 'large'),
  // une balise à l'écran, une autre à 1 200 px sous lui dans le conteneur
  'vel-loin.mjs':     scene(boite('c1', '*velocity') + '<div class="espace"></div>' + boite('loin', '*velocity')),
  // la seule balise est à 1 200 px sous l'écran dans le conteneur
  'vel-tout-loin.mjs': scene('<div class="espace"></div>' + boite('loin', '*velocity')),
  // le style et la force écrits par des variables : deux boutons les changent
  'vel-variable.mjs': `<script>\n$tenue = 'skew'\n$force = 1\n</script>\n` + scene(boite('c1', '*velocity($tenue, strength: $force)')) + `<button class="b1" @click={$tenue = 'blur'}>style</button>\n<button class="b2" @click={$force = 0}>force</button>\n`,
  // `max` donné par un thème posé plus haut (variable CSS de l'effet), sans rien écrire sur la balise
  'vel-theme.mjs':    `<div class="scene"><div class="cale"></div><div class="rang">${boite('c1', '*velocity(skew, strength: 5)')}${boite('c4', '*velocity(bend, strength: 5)')}</div><div class="fin"></div></div>\n<style>${STYLE}.scene\n  --mjs-velocity-max: 40\n</style>\n`,
  // les mêmes deux balises sans thème : leur max est celui par défaut (une force à 5 : la vitesse est pleine dès que ça défile un peu)
  'vel-fort.mjs':     scene(boite('c1', '*velocity(skew, strength: 5)') + boite('c4', '*velocity(bend, strength: 5)')),
  // la page défile : les balises sont dans la page
  'vel-page.mjs':     `<div class="cale"></div><div class="rang">${boite('c1', '*velocity')}${boite('c2', '*velocity(shift)')}</div><div class="fin"></div>\n<style>${STYLE}.fin\n  height: 3000px\n</style>\n`,
  // des balises qui portent déjà leur propre style (feuille) pour la propriété que leur style écrit : la déformation s'y ajoute
  'vel-propre.mjs':   `<div class="scene"><div class="cale"></div><div class="rang">${boite('f', '*velocity(blur, strength: 5)')}${boite('t', '*velocity(shift, strength: 5)')}${boite('s', '*velocity(stretch, strength: 5)')}${boite('k', '*velocity(skew, strength: 5)')}${boite('w', '*velocity(tilt, strength: 5)')}${boite('d', '*velocity(bend, strength: 5)')}</div><div class="fin"></div></div>\n<style>${STYLE}.f, .d\n  filter: sepia(1)\n.t\n  translate: 10px 0\n.s\n  scale: 1.1\n.k, .w\n  transform: rotate(5deg)\n</style>\n`,
  // le style de l'auteur écrit en ligne (il passe devant la feuille), et deux balises en ligne : un span et un lien dans un paragraphe (hors d'un flex, qui les rendrait blocs)
  'vel-enligne.mjs':  `<div class="scene"><div class="cale"></div><p class="ligne"><span class="b sp" *velocity(skew, strength: 5, max: 40)>sp</span> <a class="b li" href="#x" *velocity(skew, strength: 5, max: 40)>li</a></p><div class="rang"><div class="b e" style="transform: rotate(7deg)" *velocity(skew, strength: 5)>e</div><div class="b g" style="filter: sepia(1)" *velocity(blur, strength: 5)>g</div></div><div class="fin"></div></div>\n<style>${STYLE}.ligne\n  margin: 20px\n</style>\n`,
  'vel-bend.mjs':     scene(boite('c1', '*velocity(bend, strength: 5)') + boite('p', '*velocity(skew, strength: 5)')),
  // un cadre noir sur fond blanc, collé en haut de la scène (il reste en place quand elle défile) : son bord bombé se relève sur une capture
  'vel-bord.mjs':       bord(540, 540, 44),
  'vel-bord-grand.mjs': bord(1200, 1200, 80)
}

// ce que la page compte : les images d'animation et les minuteries en attente, les images demandées, les
// écouteurs de défilement en vie (posés en capture, passifs, moins retirés : ceux d'un suivi de défilement)
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
  w.setTimeout = (f: any, d?: number, ...a: any[]) => { const h = st(() => { w.__to.delete(h); return f(...a) }, d); w.__to.add(h); return h }
  w.clearTimeout = (h: number) => { w.__to.delete(h); return ct(h) }
  // les lectures de style calculé (une balise lit ce que l'auteur a posé quand elle se met en mouvement, jamais à chaque image)
  w.__gcs = 0
  const gc = w.getComputedStyle.bind(w)
  w.getComputedStyle = (...a: any[]) => { w.__gcs++; return gc(...a) }
  // les observateurs de visibilité en vie (observe posé, pas encore déconnecté)
  w.__io = new Set<object>()
  const ob = w.IntersectionObserver.prototype.observe
  const di = w.IntersectionObserver.prototype.disconnect
  w.IntersectionObserver.prototype.observe = function (...a: any[]) { w.__io.add(this); return ob.apply(this, a) }
  w.IntersectionObserver.prototype.disconnect = function () { w.__io.delete(this); return di.call(this) }
  // l'état de chaque balise `.b` du composant `t` (sa tenue, ce que la vitesse écrit, ce qui s'en voit), lu DANS la page
  w.__lire = (t: string) => {
    const racine = (document.querySelector(t) as any)._shadow as ShadowRoot
    const carte  = racine.querySelector('feDisplacementMap')
    return Object.fromEntries(Array.from(racine.querySelectorAll('.b')).map((b: any) => [b.className.replace('b ', ''), {
      style: b.getAttribute('mjs-fx-velocity-style'),
      axe: b.getAttribute('mjs-fx-velocity-axis'),
      marque: b.hasAttribute('mjs-fx-velocity-on'),
      v: b.style.getPropertyValue('--mjs-fx-velocity-v'),
      transform: gc(b).transform,
      scale: gc(b).scale,
      translate: gc(b).translate,
      filtre: gc(b).filter,
      affichage: gc(b).display,
      haut: Math.round(b.getBoundingClientRect().height * 10) / 10,
      attrs: b.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')),
      style_attr: b.getAttribute('style') ?? '',
      aStyle: b.hasAttribute('style'),
      carte: carte ? carte.getAttribute('scale') : null
    }]))
  }
  // fait défiler à VITESSE constante (px par ms) pendant `duree` ms : le pas de chaque image suit le temps écoulé, plafonné à 100 ms comme la
  // mesure de l'effet, donc la vitesse que l'effet voit ne dépend pas de la cadence de la machine ; l'état est lu dans la page `apres` images
  // après le dernier pas, sans aller-retour avec le test (pendant lequel la déformation retomberait) ; ces images ne sont pas comptées avec celles de l'effet
  w.__aller = (t: string, vitesse: number, duree: number, propriete: string, cible: string, apres: number) => new Promise((ok) => {
    const sc     = cible === 'page' ? w : (document.querySelector(t) as any)._shadow.querySelector('.scene')
    const lit    = () => cible === 'page' ? (propriete === 'scrollLeft' ? w.scrollX : w.scrollY) : sc[propriete]
    const pose   = (p: number) => { if (cible === 'page') w.scrollTo(propriete === 'scrollLeft' ? p : w.scrollX, propriete === 'scrollLeft' ? w.scrollY : p); else sc[propriete] = p }
    const depart = lit()
    let debut = 0
    let prec  = 0
    let fait  = 0
    let reste = apres
    const suite = () => { if (--reste > 0) ra(suite); else ok(w.__lire(t)) }
    const f = (now: number) => {
      if (!debut) debut = prec = now
      fait += vitesse * Math.min(100, now - prec)
      prec = now
      pose(depart + fait)
      if (now - debut < duree) ra(f)
      else ra(suite)
    }
    ra(f)
  })
  w.__scrollL = 0
  const ae = w.EventTarget.prototype.addEventListener
  const re = w.EventTarget.prototype.removeEventListener
  w.EventTarget.prototype.addEventListener = function (type: string, f: any, o: any) {
    if (type === 'scroll' && o && typeof o === 'object' && o.capture && o.passive) w.__scrollL++
    return ae.call(this, type, f, o)
  }
  w.EventTarget.prototype.removeEventListener = function (type: string, f: any, o: any) {
    if (type === 'scroll' && o && typeof o === 'object' && o.capture) w.__scrollL--
    return re.call(this, type, f, o)
  }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// l'écart d'un bord à sa meilleure courbe lisse : un polynôme de degré 6 ajusté aux moindres carrés (base de Tchebychev sur [-1, 1], équations normales
// résolues par élimination de Gauss avec pivot), puis la MOYENNE GLISSANTE de l'écart sur `fenetre` lignes : le bord relevé tombe sur des pixels entiers
// (un bruit de ±0,5 px que la moyenne éteint), alors qu'une facette ou une cassure d'un bord bombé est un écart qui dure sur plusieurs lignes
function ecartLisse(v: number[], fenetre: number): number {
  const n = v.length
  const m = 7
  const base = (u: number) => { const t = [1, u]; for (let k = 2; k < m; k++) t.push(2 * u * t[k - 1] - t[k - 2]); return t }
  const A    = v.map((_, i) => base(2 * i / (n - 1) - 1))
  const M    = Array.from({ length: m }, (_, r) => Array.from({ length: m + 1 }, (_, c) => A.reduce((s, a, i) => s + a[r] * (c < m ? a[c] : v[i]), 0)))
  for (let p = 0; p < m; p++) {
    let q = p
    for (let r = p + 1; r < m; r++) if (Math.abs(M[r][p]) > Math.abs(M[q][p])) q = r
    const tmp = M[p]; M[p] = M[q]; M[q] = tmp
    for (let r = p + 1; r < m; r++) {
      const f = M[r][p] / M[p][p]
      for (let c = p; c <= m; c++) M[r][c] -= f * M[p][c]
    }
  }
  const coef = new Array(m).fill(0)
  for (let p = m - 1; p >= 0; p--) {
    let s = M[p][m]
    for (let c = p + 1; c < m; c++) s -= M[p][c] * coef[c]
    coef[p] = s / M[p][p]
  }
  const res = v.map((x, i) => x - A[i].reduce((s, a, k) => s + a * coef[k], 0))
  let pire = 0
  for (let i = 0; i + fenetre <= n; i++) pire = Math.max(pire, Math.abs(res.slice(i, i + fenetre).reduce((s, r) => s + r, 0) / fenetre))
  return pire
}

describe('*velocity (navigateurs réels) — la balise réagit à la vitesse du défilement et revient à plat', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-velocity')
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

      // les écouteurs de défilement que la page porte sans rien à suivre à l'écran (le cœur en pose lui-même)
      let base = 0
      before(async function () {
        if (!present) return
        base = await avec('mjs-vel-tout-loin', (page) => page.evaluate(() => (window as any).__scrollL))
      })

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, options: { reduit?: boolean } = {}): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 700, height: 500 }, reducedMotion: options.reduit ? 'reduce' : 'no-preference' })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          await page.waitForTimeout(250)
          await page.evaluate((t: string) => {
            if (t === 'mjs-vel-page') window.scrollTo(0, 200)
            else {
              const sc = (document.querySelector(t) as any)._shadow.querySelector('.scene') as HTMLElement
              sc.scrollTop = 200
              if (t === 'mjs-vel-axe') sc.scrollLeft = 200
            }
          }, tag)
          await auRepos(page, tag)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      // l'état de chaque balise `.b`, lu dans la page (cf. __lire)
      const lire = (page: any, tag: string) => page.evaluate((t: string) => (window as any).__lire(t), tag)

      // fait défiler de `dy` px par image à 60 images par seconde pendant `n` images, soit à la VITESSE de `dy / 16.7` px par ms, la même quelle que
      // soit la cadence réelle de la machine (`propriete` : scrollTop ou scrollLeft, la page ou la scène) ; rend l'état des balises, lu dans la page
      // deux images après le dernier pas
      const rampe = (page: any, tag: string, dy: number, n: number, propriete = 'scrollTop', cible = 'scene') => page.evaluate(([t, v, d, p, c]: [string, number, number, string, string]) => (window as any).__aller(t, v, d, p, c, 2), [tag, dy / 16.7, n * 16.7, propriete, cible])

      // fait défiler la scène à la vitesse `vitesse` (px par ms) pendant `duree` ms ; l'état est lu `apres` images après le dernier pas
      const elan = (page: any, tag: string, vitesse: number, duree: number, apres = 2) => page.evaluate(([t, v, d, a]: [string, number, number, number]) => (window as any).__aller(t, v, d, 'scrollTop', 'scene', a), [tag, vitesse, duree, apres])

      // attend que plus aucune balise ne soit en mouvement (ni marque ni vitesse écrite) : le temps du retour à plat dépend de la machine ;
      // quatre images d'abord, pour que l'effet ait vu le dernier défilement
      const calme = (e: any) => e.marque === false && e.v === ''
      const auRepos = async (page: any, tag: string, ms = 30000) => {
        const fin = Date.now() + ms
        let r: any = await page.evaluate(([t, c]: [string, string]) => (window as any).__aller(t, 0, 0, 'scrollTop', c, 4), [tag, tag === 'mjs-vel-page' ? 'page' : 'scene'])
        while (!Object.values(r).every(calme) && Date.now() < fin) {
          await page.waitForTimeout(50)
          r = await lire(page, tag)
        }
        return r
      }

      // la scène revient à 200 px (les balises au milieu de l'écran) et se calme
      const reposer = async (page: any, tag: string) => {
        await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = 200 }, tag)
        await auRepos(page, tag)
      }

      const plat = (e: any) => e.marque === false && e.v === '' && e.transform === 'none' && e.scale === 'none' && e.translate === 'none' && e.filtre === 'none'
      const angle = (m: string) => Math.atan(parseFloat(/matrix\(1, ([-\d.e]+),/.exec(m)![1])) * 180 / Math.PI
      const mat2 = (m: string) => /matrix\(([^)]+)\)/.exec(m)![1].split(',').map(parseFloat)
      const mat3 = (m: string) => /matrix3d\(([^)]+)\)/.exec(m)![1].split(',').map(parseFloat)
      const deux = (v: string) => v.split(' ').map(parseFloat)
      const sinus = (deg: number) => Math.sin(deg * Math.PI / 180)
      // tout ce que la balise montre ou porte, pour la comparer avant et après le mouvement
      // (le navigateur écrit un point-virgule final dans l'attribut style dès qu'une variable y est posée puis retirée : le texte est comparé sans lui)
      const empreinte = (e: any) => JSON.stringify([e.transform, e.scale, e.translate, e.filtre, e.style_attr.replace(/;$/, ''), e.aStyle, e.marque, e.v])

      it('au repos, rien n\'est écrit : chaque balise porte sa tenue (style, axe) et rien d\'autre', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          const r = await lire(page, 'mjs-vel-six')
          assert.deepEqual(Object.values(r).map((e: any) => e.style), STYLES)
          for (const e of Object.values(r) as any[]) {
            assert.ok(plat(e), `à plat : ${JSON.stringify(e)}`)
            assert.equal(e.axe, 'y')
          }
        })
      })

      it('chaque style déforme pendant le défilement vers le bas, se creuse ou s\'inverse vers le haut, et revient à plat à l\'arrêt', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          let r: any = await rampe(page, 'mjs-vel-six', 14, 12)
          assert.ok(angle(r.c1.transform) > 0.3, `skew penche vers le bas : ${r.c1.transform}`)
          const [sx, sy] = r.c2.scale.split(' ').map(parseFloat)
          assert.ok(sx === 1 && sy > 1.005, `stretch s'étire dans le sens du défilement : ${r.c2.scale}`)
          assert.ok(/^matrix3d/.test(r.c3.transform), `tilt bascule en 3D : ${r.c3.transform}`)
          assert.ok(/^url\(/.test(r.c4.filtre) && parseFloat(r.c4.carte) < -0.005, `bend : filtre posé et carte réglée (${r.c4.filtre}, scale ${r.c4.carte})`)
          assert.ok(parseFloat(/blur\(([\d.]+)px\)/.exec(r.c5.filtre)![1]) > 0.3, `blur : ${r.c5.filtre}`)
          assert.ok(parseFloat(r.c6.translate.split(' ')[1]) > 0.5, `shift prend du retard vers le bas : ${r.c6.translate}`)
          assert.deepEqual(Object.values(r).map((e: any) => e.marque), [true, true, true, true, true, true])
          // vers le haut : la déformation à sens (skew, shift, bend) s'inverse, celle à intensité (stretch, blur) reste
          assert.ok(Object.values(await auRepos(page, 'mjs-vel-six')).every(plat), 'à plat quand on s\'arrête')
          await page.evaluate(() => { ((document.querySelector('mjs-vel-six') as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = 368 })
          await auRepos(page, 'mjs-vel-six')
          r = await rampe(page, 'mjs-vel-six', -14, 12)
          assert.ok(angle(r.c1.transform) < -0.3, `skew vers l'autre côté : ${r.c1.transform}`)
          assert.ok(parseFloat(r.c6.translate.split(' ')[1]) < -0.5, `shift prend de l'avance vers le haut : ${r.c6.translate}`)
          assert.ok(parseFloat(r.c4.carte) > 0.005, `bend se creuse : ${r.c4.carte}`)
          assert.ok(r.c2.scale.split(' ')[1] > 1 && /blur/.test(r.c5.filtre), 'stretch et blur suivent la vitesse sans le sens')
          // le bend ne tient le filtre que pendant la déformation
          const f = await auRepos(page, 'mjs-vel-six')
          assert.ok(Object.values(f).every(plat), `à plat : ${JSON.stringify(f)}`)
        })
      })

      it('max borne la déformation : à pleine vitesse, 5° au plus', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-borne', async (page) => {
          const r: any = await rampe(page, 'mjs-vel-borne', 20, 14)
          assert.ok(Math.abs(parseFloat(r.m5.v)) > 0.9, `vitesse pleine : ${r.m5.v}`)
          assert.ok(angle(r.m5.transform) <= 5.01 && angle(r.m5.transform) > 4.5, `bornée à 5° : ${angle(r.m5.transform)}`)
        })
      })

      it('strength règle la force, smooth la vitesse du retour', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-reglages', async (page) => {
          // une vitesse constante de 0.4 px par ms (un quart de la vitesse pleine) pendant 250 ms ; l'état est lu dans la page trois images après le
          // dernier pas, au même instant pour toutes les balises : smooth: 1 a déjà rendu le repos, smooth: .05 n'en a presque rien rendu
          const r: any = await elan(page, 'mjs-vel-reglages', 0.4, 250, 3)
          const v = (e: any) => Math.abs(parseFloat(e.v))
          assert.ok(v(r.s3) > 2 * v(r.s1) && v(r.s1) > 0.02, `strength: 3 réagit plus fort que strength: 1 (${r.s3.v} contre ${r.s1.v})`)
          // sans réglage, la force est celle de strength: 2 (la réaction est pleine dès un coup de molette un peu vif), pas celle de strength: 1
          assert.ok(Math.abs(v(r.sd) - v(r.s2)) < 0.005 && v(r.sd) > 1.5 * v(r.s1), `sans strength, même force que strength: 2 (${r.sd.v} contre ${r.s2.v}, et ${r.s1.v} pour strength: 1)`)
          assert.ok(plat(r.sm1), `smooth: 1 : à plat dès l'arrêt (${JSON.stringify(r.sm1)})`)
          assert.ok(!plat(r.sm05), 'smooth: .05 : encore déformée au même instant, elle revient lentement')
          assert.ok(plat((await auRepos(page, 'mjs-vel-reglages')).sm05), 'smooth: .05 : à plat à la fin')
        })
      })

      it('axis : la balise de l\'axe x ne réagit qu\'au défilement de côté, celle de l\'axe y qu\'au défilement vertical', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-axe', async (page) => {
          let r: any = await rampe(page, 'mjs-vel-axe', 14, 10, 'scrollLeft')
          assert.ok(parseFloat(r.ax.translate.split(' ')[0]) > 0.5 && r.ay.marque === false, `défilement de côté : x réagit (${r.ax.translate}), y non (${r.ay.translate})`)
          await auRepos(page, 'mjs-vel-axe')
          r = await rampe(page, 'mjs-vel-axe', 14, 10, 'scrollTop')
          assert.ok(parseFloat(r.ay.translate.split(' ')[1]) > 0.5 && r.ax.marque === false, `défilement vertical : y réagit (${r.ay.translate}), x non (${r.ax.translate})`)
        })
      })

      it('une seule boucle et un seul écouteur par racine, quel que soit le nombre de balises ; au repos rien ne tourne', async function () {
        if (!present) return this.skip()
        const un = await avec('mjs-vel-seule', (page) => page.evaluate(() => (window as any).__scrollL))
        await avec('mjs-vel-six', async (page) => {
          // un composant dans le document : l'écouteur du document et celui de sa racine d'ombre, pas un par balise
          const six = await page.evaluate(() => (window as any).__scrollL)
          assert.equal(six, base + 2, `six balises posent deux écouteurs de plus que la page nue (${six}, page nue ${base})`)
          assert.equal(six, un, `autant qu'une seule balise (${six} contre ${un})`)
          const images = await page.evaluate(() => new Promise<number[]>((ok) => {
            const sc = (document.querySelector('mjs-vel-six') as any)._shadow.querySelector('.scene')
            const vus: number[] = []
            let i = 0
            const f = () => {
              sc.scrollTop += 10
              vus.push((window as any).__raf.size)
              if (++i < 14) requestAnimationFrame(f)
              else ok(vus)
            }
            requestAnimationFrame(f)
          }))
          assert.ok(Math.max(...images) <= 1, `jamais plus d'une image d'animation en attente, six balises déformées (${images})`)
          // le mouvement fini, plus rien ne tourne : on attend le dernier tracé de l'effet (le temps dépend de la machine), puis on compte
          for (let i = 0; i < 600 && (await page.evaluate(() => (window as any).__raf.size + (window as any).__to.size)) > 0; i++) await page.waitForTimeout(50)
          const repos = await page.evaluate(() => ({ raf: (window as any).__raf.size, minuteries: (window as any).__to.size }))
          assert.equal(repos.raf, 0, 'au repos : aucune image d\'animation en attente')
          assert.equal(repos.minuteries, 0, 'au repos : aucune minuterie')
        })
        // loin de l'écran : aucun écouteur de plus ; à l'écran : ils vivent ; reparti loin : ils sont retirés
        await avec('mjs-vel-tout-loin', async (page) => {
          const ecouteurs = () => page.evaluate(() => (window as any).__scrollL)
          const place = (y: number) => page.evaluate((v: number) => { ((document.querySelector('mjs-vel-tout-loin') as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = v }, y)
          assert.equal(await ecouteurs(), base, 'balise loin de l\'écran : aucun écouteur de défilement de plus')
          // l'observateur d'intersection répond au prochain tracé : on attend le nombre voulu d'écouteurs, au plus 5 s
          const jusqua = async (voulu: number) => { for (let i = 0; i < 100 && (await ecouteurs()) !== voulu; i++) await page.waitForTimeout(50) }
          await place(1300)
          await jusqua(base + 2)
          assert.equal(await ecouteurs(), base + 2, 'à l\'écran : les écouteurs vivent')
          await place(200)
          await jusqua(base)
          assert.equal(await ecouteurs(), base, 'repartie loin : ils sont retirés')
        })
      })

      it('une balise hors de l\'écran n\'est pas écrite ; elle l\'est quand elle arrive', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-loin', async (page) => {
          const r: any = await rampe(page, 'mjs-vel-loin', 14, 12)
          assert.equal(r.c1.marque, true, 'celle de l\'écran réagit')
          assert.equal(r.loin.marque, false, 'celle qui est loin n\'est pas écrite')
          assert.equal(r.loin.v, '')
          await auRepos(page, 'mjs-vel-loin')
          // elle arrive à l'écran puis le défilement continue : elle réagit
          await page.evaluate(() => { ((document.querySelector('mjs-vel-loin') as any)._shadow.querySelector('.scene') as HTMLElement).scrollTop = 1500 })
          await auRepos(page, 'mjs-vel-loin')
          const a: any = await rampe(page, 'mjs-vel-loin', 8, 12)
          assert.equal(a.loin.marque, true, 'arrivée à l\'écran : elle réagit')
          assert.equal(a.c1.marque, false, 'et la première, partie, n\'est plus écrite')
        })
      })

      it('la page qui défile : les balises de la page réagissent à son défilement', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-page', async (page) => {
          const r: any = await rampe(page, 'mjs-vel-page', 14, 12, 'scrollTop', 'page')
          assert.ok(angle(r.c1.transform) > 0.3, `skew : ${r.c1.transform}`)
          assert.ok(parseFloat(r.c2.translate.split(' ')[1]) > 0.5, `shift : ${r.c2.translate}`)
          assert.ok(Object.values(await auRepos(page, 'mjs-vel-page')).every(plat), 'à plat à l\'arrêt')
        })
      })

      it('« réduire les animations » : rien ne bouge, aucune image demandée, aucun écouteur', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          const n0 = await page.evaluate(() => (window as any).__rafN)
          const r: any = await rampe(page, 'mjs-vel-six', 14, 12)
          assert.ok(Object.values(r).every(plat), `tout reste à plat : ${JSON.stringify(r.c1)}`)
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'aucune image demandée par l\'effet')
          assert.equal(await page.evaluate(() => (window as any).__scrollL), base, 'aucun écouteur de défilement de plus')
        }, { reduit: true })
      })

      it('effets économes : bend retombe sur skew, et son filtre est retiré', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          await page.evaluate(() => (window as any).µ._mjs_fxGoLite())
          const r: any = await rampe(page, 'mjs-vel-six', 14, 12)
          assert.equal(r.c4.style, 'skew', 'bend est devenu skew')
          assert.ok(angle(r.c4.transform) > 0.3 && r.c4.filtre === 'none', `il penche, sans filtre : ${r.c4.transform} ${r.c4.filtre}`)
          assert.equal(await page.evaluate(() => (document.querySelector('mjs-vel-six') as any)._shadow.querySelectorAll('svg[mjs-fx-velocity-svg]').length), 0, 'le filtre SVG est retiré')
        })
      })

      it('off() : rien ne reste sur la balise, ni filtre SVG, ni écouteur ; plus aucune image demandée', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          await rampe(page, 'mjs-vel-six', 14, 6)
          await page.evaluate(() => {
            const racine = (document.querySelector('mjs-vel-six') as any)._shadow as ShadowRoot
            for (const b of Array.from(racine.querySelectorAll('.b')) as any[]) b._mjs_fxOff.velocity()
          })
          const r: any = await lire(page, 'mjs-vel-six')
          for (const e of Object.values(r) as any[]) {
            assert.deepEqual(e.attrs, [], `aucune marque : ${e.attrs}`)
            assert.ok(!/--mjs-fx-velocity/.test(e.style_attr) && !/--mjs-velocity/.test(e.style_attr), `aucune variable : ${e.style_attr}`)
          }
          assert.equal(await page.evaluate(() => (document.querySelector('mjs-vel-six') as any)._shadow.querySelectorAll('svg[mjs-fx-velocity-svg]').length), 0)
          await page.waitForTimeout(300)
          const n0 = await page.evaluate(() => (window as any).__rafN)
          await rampe(page, 'mjs-vel-six', 14, 6)
          assert.equal(await page.evaluate(() => (window as any).__rafN), n0, 'plus aucune image demandée par l\'effet')
          await page.waitForTimeout(200)
          assert.equal(await page.evaluate(() => (window as any).__raf.size), 0)
        })
      })

      it('off() rend l\'observateur de visibilité de chaque balise : aucun IntersectionObserver ne reste', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          const vivants = () => page.evaluate(() => (window as any).__io.size)
          const avant   = await vivants()
          assert.ok(avant >= 6, `chacune des six balises observe sa visibilité : ${avant}`)
          await page.evaluate(() => {
            const racine = (document.querySelector('mjs-vel-six') as any)._shadow as ShadowRoot
            for (const b of Array.from(racine.querySelectorAll('.b')) as any[]) b._mjs_fxOff.velocity()
          })
          assert.equal(await vivants(), avant - 6, 'les observateurs des six balises sont rendus')
        })
      })

      it('off.set : style, strength, max, smooth, axis se suivent sur place', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-seule', async (page) => {
          const regle = (d: Record<string, unknown>) => page.evaluate((v: Record<string, unknown>) => {
            const b = (document.querySelector('mjs-vel-seule') as any)._shadow.querySelector('.c1')
            ;(window as any).µ._mjs_fxSet(b, 'velocity', v, null)
          }, d)
          await regle({ style: 'blur' })
          let r: any = await rampe(page, 'mjs-vel-seule', 14, 12)
          assert.equal(r.c1.style, 'blur')
          assert.ok(/blur\(/.test(r.c1.filtre), `style suivi : ${r.c1.filtre}`)
          // le rayon du flou vaut la vitesse bornée × max : lu avec la vitesse du même instant, il ne dépend pas de celle du geste
          const maxVu = (e: any) => parseFloat(/blur\(([\d.]+)px\)/.exec(e.filtre)![1]) / Math.abs(parseFloat(e.v))
          assert.ok(Math.abs(parseFloat(r.c1.v)) > 0.05, `la balise s'est déformée : ${r.c1.v}`)
          const avant = maxVu(r.c1)
          await reposer(page, 'mjs-vel-seule')
          await regle({ max: 3 })
          r = await rampe(page, 'mjs-vel-seule', 14, 12)
          assert.ok(Math.abs(parseFloat(r.c1.v)) > 0.05 && Math.abs(avant - 12) < 0.5 && Math.abs(maxVu(r.c1) - 3) < 0.2, `max suivi : ${r.c1.filtre} pour une vitesse de ${r.c1.v} (le flou valait ${avant} fois la vitesse avant, il doit valoir 3 fois maintenant)`)
          await reposer(page, 'mjs-vel-seule')
          await regle({ strength: 0 })
          await rampe(page, 'mjs-vel-seule', 14, 12)
          assert.ok(plat((await lire(page, 'mjs-vel-seule')).c1), 'strength: 0 : rien ne réagit')
          await reposer(page, 'mjs-vel-seule')
          await regle({ strength: 1, smooth: 1, style: 'shift', axis: 'x' })
          assert.equal((await lire(page, 'mjs-vel-seule')).c1.axe, 'x', 'axis suivi')
          // la scène défile ici de haut en bas : l'axe x ne réagit pas
          await rampe(page, 'mjs-vel-seule', 14, 12)
          assert.ok(plat((await lire(page, 'mjs-vel-seule')).c1), 'axe x : le défilement vertical ne compte plus')
          await reposer(page, 'mjs-vel-seule')
          // smooth: 1 ne garde rien après le dernier pas : le retour à un lissage normal laisse lire la déformation après le geste
          await regle({ axis: 'y', smooth: 0.15 })
          assert.ok(parseFloat((await rampe(page, 'mjs-vel-seule', 14, 12)).c1.translate.split(' ')[1]) > 0.1, 'axe y : elle réagit de nouveau')
        })
      })

      it('des réglages écrits par des variables, compilés pour de vrai : changer la variable change la balise sur place', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-variable', async (page) => {
          const clic = (b: string) => page.evaluate((c: string) => { ((document.querySelector('mjs-vel-variable') as any)._shadow.querySelector(c) as HTMLElement).click() }, b)
          let r: any = await rampe(page, 'mjs-vel-variable', 14, 12)
          assert.equal(r.c1.style, 'skew')
          assert.ok(angle(r.c1.transform) > 0.3, `skew au départ : ${r.c1.transform}`)
          await reposer(page, 'mjs-vel-variable')
          await clic('.b1')
          await page.waitForTimeout(100)
          r = await rampe(page, 'mjs-vel-variable', 14, 12)
          assert.equal(r.c1.style, 'blur', 'style suivi depuis sa variable')
          assert.ok(/blur\(/.test(r.c1.filtre) && r.c1.transform === 'none', `flou et plus de penchée : ${r.c1.filtre} ${r.c1.transform}`)
          await reposer(page, 'mjs-vel-variable')
          await clic('.b2')
          await page.waitForTimeout(100)
          await rampe(page, 'mjs-vel-variable', 14, 12)
          assert.ok(plat((await lire(page, 'mjs-vel-variable')).c1), 'strength: 0 depuis sa variable : rien ne réagit')
        })
      })

      it('un thème qui règle max plus haut est suivi par le style comme par le calcul du filtre de bend', async function () {
        if (!present) return this.skip()
        // une force à 5 et 1.2 px par ms pendant 150 ms ; dans chaque page la vitesse bornée se lit sur la balise skew (--mjs-fx-velocity-v), au même
        // instant que la carte de bend : les deux pages se comparent par déformation rapportée à la vitesse, sans dépendre de celle du geste
        const vitesse = (r: any) => Math.abs(parseFloat(r.c1.v))
        const mesure  = (r: any) => Math.abs(parseFloat(r.c4.carte)) / vitesse(r)
        const defaut  = await avec('mjs-vel-fort', async (page) => mesure(await elan(page, 'mjs-vel-fort', 1.2, 150)))
        await avec('mjs-vel-theme', async (page) => {
          const r: any = await elan(page, 'mjs-vel-theme', 1.2, 150)
          // skew : l'angle vaut la vitesse × 40° au lieu de × 12°
          assert.ok(vitesse(r) > 0.05 && Math.abs(angle(r.c1.transform) / vitesse(r) - 40) < 1, `skew au max du thème (40° à pleine vitesse, pas 12°) : ${angle(r.c1.transform)}° pour une vitesse de ${r.c1.v}`)
          // bend : la carte se règle sur le max du thème, plus de deux fois celle du max par défaut pour la même vitesse
          const theme = mesure(r)
          assert.ok(defaut > 0.05 && theme > 2.2 * defaut, `bend au max du thème : ${theme} contre ${defaut} avec le max par défaut (carte rapportée à la vitesse)`)
        })
      })

      it('off.set(max) sur bend : la carte du filtre se règle sur la nouvelle borne', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-bend', async (page) => {
          const regle = (d: Record<string, unknown>) => page.evaluate((v: Record<string, unknown>) => {
            const b = (document.querySelector('mjs-vel-bend') as any)._shadow.querySelector('.c1')
            ;(window as any).µ._mjs_fxSet(b, 'velocity', v, null)
          }, d)
          // la carte rapportée à la vitesse bornée, lue sur la balise témoin p (skew) au même instant : elle ne dépend pas de la vitesse du geste
          const mesure = (r: any) => Math.abs(parseFloat(r.c1.carte)) / Math.abs(parseFloat(r.p.v))
          const avant  = mesure(await elan(page, 'mjs-vel-bend', 1.2, 150))
          await reposer(page, 'mjs-vel-bend')
          await regle({ max: 40 })
          const apres = mesure(await elan(page, 'mjs-vel-bend', 1.2, 150))
          assert.ok(avant > 0.05 && apres > 2.2 * avant, `max: 40 donne une carte plus de deux fois plus forte que max: 12 pour la même vitesse (${apres} contre ${avant})`)
        })
      })

      // le bord bombé d'un cadre noir sur fond blanc, relevé ligne par ligne sur une capture prise en plein geste : à vitesse pleine (strength 5, un défilement
      // à 2 px par ms qui continue pendant la capture) la carte de déplacement vaut une valeur connue, lue avant et après la capture ; chaque bord (gauche et
      // droit) s'écarte de sa meilleure courbe lisse (polynôme de degré 6, écart moyenné sur 21 lignes) de moins de 1,35 % de la bosse, et le milieu sort de `max` px
      for (const [l, h, max] of [[540, 540, 44], [1200, 1200, 80]]) {
        it(`bend : le bord bombé d'un cadre de ${l} × ${h} px (max: ${max}) est une courbe lisse, sans cassure ni facette`, async function () {
          if (!present) return this.skip()
          const tag     = l === 540 ? 'mjs-vel-bord' : 'mjs-vel-bord-grand'
          const q       = 2 * max / l
          const attendu = (-1.2 * q / (1 + q)).toFixed(4)
          await avec(tag, async (page) => {
            await page.setViewportSize({ width: l + 360, height: h + 160 })
            await page.evaluate(([t]: [string]) => { (window as any).__aller(t, 2, 8000, 'scrollTop', 'scene', 0) }, [tag])
            const carte = (t: string) => (document.querySelector(t) as any)._shadow.querySelector('feDisplacementMap').getAttribute('scale')
            let bords: any = null
            for (let essai = 0; essai < 5 && !bords; essai++) {
              await page.waitForFunction(([t, a]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector('feDisplacementMap').getAttribute('scale') === a, [tag, attendu], { timeout: 30000 })
              const capture = await page.screenshot({ clip: { x: 0, y: 0, width: l + 360, height: h + 160 } })
              if (await page.evaluate(carte, tag) !== attendu) continue
              bords = await page.evaluate(async (b64: string) => {
                const img = new Image()
                img.src = 'data:image/png;base64,' + b64
                await img.decode()
                const cv = document.createElement('canvas')
                cv.width  = img.width
                cv.height = img.height
                const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
                c.drawImage(img, 0, 0)
                const d = c.getImageData(0, 0, cv.width, cv.height).data
                const gauche: number[] = []
                const droite: number[] = []
                for (let y = 0; y < cv.height; y++) {
                  let g = -1
                  let r = -1
                  for (let x = 0; x < cv.width; x++) {
                    if (d[(y * cv.width + x) * 4] >= 128) continue
                    if (g < 0) g = x
                    r = x
                  }
                  gauche.push(g)
                  droite.push(r)
                }
                return { gauche, droite }
              }, capture.toString('base64'))
            }
            assert.ok(bords, `la carte du filtre reste à ${attendu} pendant la capture`)
            const lignes = bords.gauche.map((g: number, y: number) => g >= 0 ? y : -1).filter((y: number) => y >= 0)
            const haut   = lignes[0]
            const bas    = lignes[lignes.length - 1]
            assert.ok(bas - haut + 1 > h - 4 && bas - haut + 1 < h + 4, `le cadre se relève sur ses ${h} lignes (de ${haut} à ${bas})`)
            const g      = bords.gauche.slice(haut, bas + 1)
            const d      = bords.droite.slice(haut, bas + 1)
            const milieu = Math.floor(g.length / 2)
            const sortie = Math.min(180 - g[milieu], d[milieu] - (180 + l - 1))
            const eg    = ecartLisse(g, 21)
            const ed    = ecartLisse(d, 21)
            const seuil = 0.0135 * max
            assert.ok(eg < seuil && ed < seuil, `le bord s'écarte de sa courbe lisse de ${eg.toFixed(2)} px à gauche et de ${ed.toFixed(2)} px à droite en moyenne sur 21 lignes, plus de ${seuil.toFixed(2)} px (1,35 % de la bosse de ${max} px) : des facettes`)
            assert.ok(Math.abs(sortie - max) <= 2, `le milieu du bord sort de ${sortie} px pour max: ${max}`)
          })
        })
      }

      it('le style de l\'auteur (filtre, taille, place, transformation) reste : la déformation s\'y ajoute, il est lu au début du mouvement et rendu tel quel à l\'arrêt', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-propre', async (page) => {
          const repos: any = await lire(page, 'mjs-vel-propre')
          assert.equal(repos.f.filtre, 'sepia(1)')
          assert.equal(deux(repos.t.translate)[0], 10)
          assert.equal(repos.s.scale, '1.1')
          assert.ok(Math.abs(mat2(repos.k.transform)[2] + sinus(5)) < 0.002, `la rotation de l'auteur au départ : ${repos.k.transform}`)
          const g0 = await page.evaluate(() => (window as any).__gcs)
          const r: any = await elan(page, 'mjs-vel-propre', 1.2, 150)
          const lectures = (await page.evaluate(() => (window as any).__gcs)) - g0
          // 6 balises, une dizaine d'images au moins : une lecture par balise au début du mouvement, jamais une par image
          assert.ok(lectures <= 12, `le style de l'auteur est lu au début du mouvement, pas à chaque image (${lectures} lectures)`)
          assert.ok(/sepia\(1\)/.test(r.f.filtre) && parseFloat(/blur\(([\d.]+)px\)/.exec(r.f.filtre)?.[1] ?? '0') > 3, `blur s'ajoute au filtre de l'auteur : ${r.f.filtre}`)
          const [tx, ty] = deux(r.t.translate)
          assert.ok(tx === 10 && ty > 3, `shift s'ajoute à la place de l'auteur (10px 0) : ${r.t.translate}`)
          const [sx, sy] = deux(r.s.scale)
          assert.ok(Math.abs(sx - 1.1) < 0.001 && sy > 1.1 * 1.03, `stretch s'ajoute à la taille de l'auteur (1.1) : ${r.s.scale}`)
          const k = mat2(r.k.transform)
          assert.ok(Math.abs(k[2] + sinus(5)) < 0.002 && k[1] > 0.15, `skew s'ajoute à la rotation de l'auteur (5°) : ${r.k.transform}`)
          const w = mat3(r.w.transform)
          assert.ok(Math.abs(w[1] - sinus(5)) < 0.002 && Math.abs(w[2]) < 0.001, `tilt s'ajoute à la rotation de l'auteur (5°) : ${r.w.transform}`)
          assert.ok(/sepia\(1\)/.test(r.d.filtre) && /url\(/.test(r.d.filtre) && parseFloat(r.d.carte) < -0.005, `bend s'ajoute au filtre de l'auteur : ${r.d.filtre} (carte ${r.d.carte})`)
          const fin: any = await auRepos(page, 'mjs-vel-propre')
          for (const k2 of Object.keys(repos)) assert.equal(empreinte(fin[k2]), empreinte(repos[k2]), `${k2} : rendue telle quelle à l'arrêt`)
        })
      })

      it('le style de l\'auteur écrit en ligne passe devant la feuille : la déformation s\'y ajoute quand même, et le texte de l\'attribut revient intact', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-enligne', async (page) => {
          const repos: any = await lire(page, 'mjs-vel-enligne')
          const r: any = await elan(page, 'mjs-vel-enligne', 1.2, 150)
          const e = mat2(r.e.transform)
          assert.ok(Math.abs(e[2] + sinus(7)) < 0.002 && e[1] > sinus(7) + 0.1, `skew s'ajoute à la rotation en ligne (7°) : ${r.e.transform}`)
          assert.ok(/sepia\(1\)/.test(r.g.filtre) && /blur\(/.test(r.g.filtre), `blur s'ajoute au filtre en ligne : ${r.g.filtre}`)
          const fin: any = await auRepos(page, 'mjs-vel-enligne')
          for (const k of ['e', 'g']) assert.equal(empreinte(fin[k]), empreinte(repos[k]), `${k} : rendue telle quelle à l'arrêt`)
          assert.equal(fin.e.style_attr.replace(/;$/, ''), 'transform: rotate(7deg)')
          assert.equal(fin.g.style_attr.replace(/;$/, ''), 'filter: sepia(1)')
        })
      })

      it('une balise en ligne (span, lien) se déforme comme une autre : inline-block le temps de l\'effet, son affichage revient au retrait', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-enligne', async (page) => {
          const repos: any = await lire(page, 'mjs-vel-enligne')
          assert.equal(repos.sp.affichage, 'inline-block', 'le span passe en inline-block')
          assert.equal(repos.li.affichage, 'inline-block', 'le lien passe en inline-block')
          const mouvement: any = await elan(page, 'mjs-vel-enligne', 1.2, 150)
          for (const k of ['sp', 'li']) assert.ok(mouvement[k].haut > repos[k].haut + 5, `${k} se déforme : sa hauteur passe de ${repos[k].haut} à ${mouvement[k].haut}`)
          await page.evaluate(() => { for (const b of Array.from(((document.querySelector('mjs-vel-enligne') as any)._shadow as ShadowRoot).querySelectorAll('.b')) as any[]) b._mjs_fxOff.velocity() })
          const fin: any = await lire(page, 'mjs-vel-enligne')
          assert.equal(fin.sp.affichage, 'inline', 'l\'affichage d\'origine du span revient')
          assert.equal(fin.li.affichage, 'inline', 'l\'affichage d\'origine du lien revient')
        })
      })

      it('aucun attribut style ni variable ne reste sur une balise au repos, après un mouvement ou après off() ; bend ne tient son filtre que pendant la déformation', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          let r: any = await lire(page, 'mjs-vel-six')
          for (const e of Object.values(r) as any[]) assert.equal(e.aStyle, false, `au repos : aucun attribut style (${e.style_attr})`)
          r = await elan(page, 'mjs-vel-six', 0.8, 250)
          assert.ok(/--mjs-fx-velocity-filter/.test(r.c4.style_attr), `bend porte son filtre pendant la déformation : ${r.c4.style_attr}`)
          r = await auRepos(page, 'mjs-vel-six')
          for (const e of Object.values(r) as any[]) assert.equal(e.aStyle, false, `à l'arrêt : aucun attribut style (${e.style_attr})`)
          await elan(page, 'mjs-vel-six', 0.8, 250)
          await page.evaluate(() => { for (const b of Array.from(((document.querySelector('mjs-vel-six') as any)._shadow as ShadowRoot).querySelectorAll('.b')) as any[]) b._mjs_fxOff.velocity() })
          r = await lire(page, 'mjs-vel-six')
          for (const e of Object.values(r) as any[]) assert.equal(e.aStyle, false, `après off() en plein mouvement : aucun attribut style (${e.style_attr})`)
        })
      })

      it('aucune lecture de mise en page dans les images d\'animation : le défilement se lit à son événement, le style de l\'auteur au début du défilement', async function () {
        if (!present) return this.skip()
        await avec('mjs-vel-six', async (page) => {
          await page.evaluate(LECTURES)
          // 6 px par image pendant 28 images : 168 px, toute la course de la scène (de 200 à 368 px)
          const r: any = await rampe(page, 'mjs-vel-six', 6, 28)
          const bilan = await page.evaluate(() => (window as any).__lectures)
          // la garde voit les images, et l'effet a bien déformé (sans quoi zéro lecture ne prouverait rien)
          assert.ok(bilan.images >= 10, `images d'animation vues : ${bilan.images}`)
          assert.ok(angle(r.c1.transform) > 0.3, `skew penche pendant le défilement : ${r.c1.transform}`)
          assert.equal(bilan.lectures, 0, `lectures de mise en page dans les images d'animation : ${JSON.stringify(bilan.vues)}`)
        })
      })
    })
  }
})
