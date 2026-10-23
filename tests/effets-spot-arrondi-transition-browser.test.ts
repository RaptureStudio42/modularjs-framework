// *spotlight en production dans Chromium, Firefox et WebKit réels : l'arrondi de la balise change PENDANT le survol, par une transition de
// `border-radius` de la balise elle-même (une carte qui passe de 12 à 40 px sous la souris). La lumière du halo est rognée à la balise par un `clip-path`
// dont l'arrondi est lu sur le style calculé : lu à l'entrée de la souris, il valait encore l'arrondi de départ, et la lumière sortait du nouveau coin.
// - À mi-course d'une transition (figée à 50 %) et une fois finie, aucun pixel n'est éclairé hors de l'arc du moment, dans les quatre coins : arrondis
//   en pixels, en pourcentages et elliptiques (`10% / 20%`), halo sans retard, halo avec retard (`smooth`), voile (`where: veil`, qui suit l'arrondi de la balise
//   tout seul : le garde). Un arrondi déjà changé à l'entrée de la souris reste juste.
// - Un arrondi changé par la règle `:hover` SANS transition : Firefox applique `:hover` après l'événement d'entrée de la souris, l'arrondi lu à ce moment est encore
//   celui d'avant le survol. Il est relu une fois à l'image qui suit : l'entrée coûte une image demandée et une lecture du style, et le halo n'est redessiné que si
//   l'arrondi a changé.
// - Cette relecture est SEULE à redessiner le halo quand le mouvement de l'entrée n'arrive jamais à la balise (un écouteur de capture sur la fenêtre l'arrête) ; avec un seul
//   mouvement réel, l'image du mouvement écrit aussi la dernière position avec l'arrondi relu, et les deux se couvrent. Six entrées de suite : un mutant qui ne redessine qu'une
//   fois sur deux en laisse trois fautives.
// - La lumière toujours allumée avec un retard, dont la souris rentre pendant qu'elle glisse encore vers le centre : Firefox et WebKit annoncent la transition avant
//   la première image de la boucle de la lumière, qui n'est pas encore reposée.
// - Le suivi ne vit que le temps du changement : rien au repos (ni image demandée, ni lecture, ni écouteur de transition), par mouvement de la souris aucune lecture du
//   style ni des animations et au plus une image demandée par image affichée (celle qui écrit la dernière position du halo),
//   une image demandée par image affichée pendant la transition (une seule boucle, avec sa lecture du style, sa lecture des animations et son écriture), arrêté avec
//   la transition de l'arrondi (non avec une autre transition de la balise), débranché à la sortie de la souris et au retrait de l'effet, et jamais mis en route par la
//   transition d'un enfant de la balise.
// Chaque attente est une condition (la pose est finie, la transition est finie, la lumière est allumée, n images ont été affichées), de sorte que la charge de la machine
// ne change pas le verdict ; le seul intervalle fixe est celui de 50 ms entre deux captures de `mesureAllumee`, qui s'arrête dès que la lumière est allumée (100 tours au plus).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// des cartes blanches sur une page blanche, éclairées en rouge opaque sur 400 px : dans une carte tout ce qui est rouge est éclairé, hors de l'arc d'un coin rien ne doit l'être
const HALO     = '*spotlight(where: fill, color: #f00, fill: 1, size: 400)'
const RETARD   = '*spotlight(where: fill, color: #f00, fill: 1, size: 400, smooth: .3)'
const VOILE    = '*spotlight(where: veil, color: #f00, fill: 1, size: 100)'
const DEFAUT   = '*spotlight(color: #f00, fill: 1, size: 400)'
// toujours allumé, avec un retard lent : la lumière met près de six secondes à rentrer au centre
const TOUJOURS = '*spotlight(where: fill, on: always, color: #f00, fill: 1, size: 400, smooth: .02)'
const carte    = (classe: string, fx: string, contenu = '') => `<div class="carte ${classe}" ${fx}>${contenu}</div>\n`
const STYLE    = `
<style>
:host
  display: block
.carte
  box-sizing: border-box
  position: relative
  width: 265px
  height: 130px
  margin: 20px
  background: #fff
  border-radius: 12px
.longue
  transition: border-radius 20s linear
  &:hover
    border-radius: 40px
.courte
  transition: border-radius .3s linear
  &:hover
    border-radius: 40px
.pct
  border-radius: 10% / 20%
  transition: border-radius 20s linear
  &:hover
    border-radius: 35% / 45%
.posee
  transition: border-radius .1s linear
  &.pris
    border-radius: 40px
.enfant
  .pastille
    display: block
    width: 40px
    height: 40px
    background: #00f
    border-radius: 0
    transition: border-radius .6s linear
  &:hover .pastille
    border-radius: 50%
.deux
  transition: border-radius .3s linear, background-color 20s linear
  &:hover
    border-radius: 40px
    background-color: #eef
.sans, .sansretard, .sansdefaut
  &:hover
    border-radius: 40px
.toujours
  transition: border-radius .3s linear
  &:hover
    border-radius: 40px
</style>
`
const POSES: Record<string, string> = {
  halo:    carte('longue', HALO) + carte('courte', HALO) + carte('pct', HALO) + carte('posee', HALO) + carte('enfant', HALO, '<span class="pastille"></span>') + STYLE,
  retard:  carte('longue', RETARD) + STYLE,
  voile:   carte('longue', VOILE) + STYLE,
  defaut:  carte('longue', DEFAUT) + STYLE,
  fond:    carte('deux', HALO) + STYLE,
  // `where` tenu par une variable : le changer défait l'effet puis le repose, la balise et la souris restent
  reglage: `<script>\n$w = 'fill'\n</script>\n` + carte('longue', '*spotlight(where: $w, color: #f00, fill: 1, size: 400)') + `<button class="bascule" @click={$w = 'both'}>b</button>\n` + STYLE,
  sans:    carte('sans', HALO) + carte('sansretard', RETARD) + carte('sansdefaut', DEFAUT) + STYLE,
  rentree: carte('toujours', TOUJOURS) + STYLE
}

const CARTE = (tag: string, classe: string) => `document.querySelector('${tag}')._shadow.querySelector('.${classe}')`

// les transitions d'arrondi de la carte : figées à mi-course, ou menées à leur fin
const FIGE  = (tag: string, classe: string) => `(() => { const t = ${CARTE(tag, classe)}.getAnimations().filter((a) => /radius/.test(a.transitionProperty)); t.forEach((a) => { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime / 2 }); return t.length })()`
const FINIT = (tag: string, classe: string) => `(() => { const t = ${CARTE(tag, classe)}.getAnimations().filter((a) => /radius/.test(a.transitionProperty)); t.forEach((a) => a.finish()); return t.length })()`
const EN_COURS = (tag: string, classe: string) => `${CARTE(tag, classe)}.getAnimations().some((a) => /radius/.test(a.transitionProperty))`
// l'arrondi de la carte vaut `px` et plus aucune transition d'arrondi ne court
const ARRONDI_FINI = (tag: string, classe: string, px: number) => `(getComputedStyle(${CARTE(tag, classe)}).borderTopLeftRadius === '${px}px' && !${EN_COURS(tag, classe)})`
// la lumière est promue (elle est allumée, ou glisse encore) tant que la balise porte cet attribut
const PROMUE = (tag: string, classe: string) => `${CARTE(tag, classe)}.hasAttribute('mjs-fx-live')`

// la boîte de la carte et ses quatre arrondis du moment (rayon horizontal, rayon vertical), en px ; les pourcentages se comptent sur la boîte
const BOITE = (tag: string, classe: string) => `(() => {
  const c = ${CARTE(tag, classe)}
  const r = c.getBoundingClientRect()
  const s = getComputedStyle(c)
  const lire = (v, m) => v.endsWith('%') ? parseFloat(v) * m / 100 : parseFloat(v)
  const rayons = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => { const v = s['border' + k + 'Radius'].split(' '); return [lire(v[0], r.width), lire(v[1] || v[0], r.height)] })
  return { x: r.left, y: r.top, w: r.width, h: r.height, rayons }
})()`

// les pixels éclairés (un canal sous 250 sur la page blanche) de chaque coin, hors de l'arc d'au moins MARGE px : le lissage du bord de l'arc (un pixel au plus) n'est pas compté ;
// `anneau` compte les pixels éclairés dans la marge, à titre d'information
const MARGE = 1.5
const ANALYSE = (b64: string, boite: any) => `(async ([b64, b, marge]) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = img.height
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const coins = [['hg', 0, 0], ['hd', 1, 0], ['bd', 1, 1], ['bg', 0, 1]]
  const sortie = coins.map(([nom, droite, bas], i) => {
    const [rx, ry] = b.rayons[i]
    const x0 = Math.round(droite ? b.x + b.w - rx : b.x)
    const y0 = Math.round(bas ? b.y + b.h - ry : b.y)
    const cx = droite ? b.x + b.w - rx : b.x + rx
    const cy = bas ? b.y + b.h - ry : b.y + ry
    const w = Math.ceil(rx), h = Math.ceil(ry)
    const d = w && h ? g.getImageData(x0, y0, w, h).data : []
    let hors = 0, anneau = 0, max = 0
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) {
      const dx = x0 + k + 0.5 - cx, dy = y0 + j + 0.5 - cy
      if (dx * dx / (rx * rx) + dy * dy / (ry * ry) <= 1) continue
      const p = (j * w + k) * 4
      const niveau = 255 - Math.min(d[p], d[p + 1], d[p + 2])
      if (niveau < 6) continue
      if (dx * dx / ((rx + marge) * (rx + marge)) + dy * dy / ((ry + marge) * (ry + marge)) > 1) { hors++; max = Math.max(max, niveau) }
      else anneau++
    }
    return { coin: nom, rx: +rx.toFixed(1), ry: +ry.toFixed(1), hors, anneau, max }
  })
  const c = g.getImageData(Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2), 1, 1).data
  const e = g.getImageData(Math.round(b.x + 10), Math.round(b.y + b.h / 2), 1, 1).data
  return { coins: sortie, centre: [c[0], c[1], c[2]], bord: [e[0], e[1], e[2]] }
})(${JSON.stringify([b64, boite, MARGE])})`

// les sondes, posées avant la page : images demandées, lectures (style calculé, animations, boîtes), écritures des images clés et écouteurs de transition vivants ;
// `images` compte les images AFFICHÉES depuis la remise à zéro, par une boucle à part qui appelle le vrai `requestAnimationFrame` (la sonde ne la compte pas)
const SONDE = `(() => {
  const S = window.__sonde = { actif: false, raf: 0, style: 0, anim: 0, boite: 0, ecrit: 0, vivants: 0, images: 0, gen: 0 }
  const raf = window.requestAnimationFrame.bind(window)
  S.vraiRaf = raf
  window.requestAnimationFrame = (cb) => { if (S.actif) S.raf++; return raf(cb) }
  const gcs = window.getComputedStyle.bind(window)
  window.getComputedStyle = function() { if (S.actif) S.style++; return gcs.apply(window, arguments) }
  const ga = Element.prototype.getAnimations
  Element.prototype.getAnimations = function() { if (S.actif) S.anim++; return ga.apply(this, arguments) }
  const gb = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function() { if (S.actif) S.boite++; return gb.apply(this, arguments) }
  const sk = KeyframeEffect.prototype.setKeyframes
  KeyframeEffect.prototype.setKeyframes = function() { if (S.actif) S.ecrit++; return sk.apply(this, arguments) }
  for (const k of ['clientWidth', 'clientHeight', 'clientLeft', 'clientTop', 'offsetWidth', 'offsetHeight']) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, k)
    if (d && d.get) Object.defineProperty(Element.prototype, k, { configurable: true, get() { if (S.actif) S.boite++; return d.get.call(this) } })
  }
  const vivants = new WeakMap()
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function(type, fn, o) {
    if (/^transition/.test(type)) { let s = vivants.get(this); if (!s) vivants.set(this, s = new Set()); if (!s.has(type + fn)) { s.add(type + fn); S.vivants++ } }
    return ajoute.call(this, type, fn, o)
  }
  EventTarget.prototype.removeEventListener = function(type, fn, o) {
    if (/^transition/.test(type)) { const s = vivants.get(this); if (s && s.delete(type + fn)) S.vivants-- }
    return retire.call(this, type, fn, o)
  }
})()`
const RAZ  = '(() => { const S = window.__sonde; S.raf = S.style = S.anim = S.boite = S.ecrit = S.images = 0; S.actif = true; const g = ++S.gen; const c = () => { if (!S.actif || S.gen !== g) return; S.images++; S.vraiRaf(c) }; S.vraiRaf(c) })()'
const LIRE = '(() => { const S = window.__sonde; S.actif = false; return { raf: S.raf, style: S.style, anim: S.anim, boite: S.boite, ecrit: S.ecrit, images: S.images, vivants: S.vivants } })()'

// l'état de la carte quand la lumière ne s'allume pas : le survol, les attributs de l'effet, les deux pseudo-éléments et les animations de la carte (de quoi dire pourquoi)
const ETAT = (tag: string, classe: string) => `(() => {
  const c = ${CARTE(tag, classe)}
  const a = getComputedStyle(c, '::after')
  const b = getComputedStyle(c, '::before')
  return JSON.stringify({
    survol: c.matches(':hover'),
    attributs: c.getAttributeNames().filter((n) => /^mjs-fx/.test(n)),
    apres: [a.opacity, a.translate, a.clipPath, a.width, a.display],
    avant: [b.opacity, b.display],
    animations: c.getAnimations({ subtree: true }).map((x) => [x.constructor.name, x.transitionProperty || x.animationName || '', x.playState, (x.effect && x.effect.pseudoElement) || '']),
    rayon: getComputedStyle(c).borderTopLeftRadius
  })
})()`

const rouge = (p: number[]) => p[0] > 200 && p[1] < 190
const vu    = (l: any, cles: string[]) => cles.map((k) => l[k])

describe('*spotlight : la lumière du halo suit l\'arrondi de la balise quand il change pendant le survol', function () {
  this.timeout(1800000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [nom, source] of Object.entries(POSES)) {
      const root   = mjsTmp('spotlight-arrondi-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'h-' + nom + '.mjs'), source)
      // un seul fichier (le manifeste) : la pose est celle d'une application de production
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], nom)
      scripts[nom] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      async function ouvre(pose: string) {
        const tag      = 'mjs-h-' + pose
        const contexte = await browser.newContext({ viewport: { width: 320, height: 960 } })
        const page     = await contexte.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
        await page.addInitScript(SONDE)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts[pose]}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`!!document.querySelector('${tag}')?._shadow?.querySelector('.carte')?.hasAttribute('mjs-fx')`, null, { timeout: 60000, polling: 50 })
        // trois images affichées : la pose est finie (hors fenêtre de sonde, qui ne compte que depuis sa remise à zéro)
        await page.evaluate('new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => fin(0)))))')
        const boite   = (classe: string): Promise<any> => page.evaluate(BOITE(tag, classe))
        const entre   = async (classe: string) => {
          const b = await boite(classe)
          await page.mouse.move(b.x - 10, b.y + b.h / 2)
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 4 })
          return b
        }
        // trois images affichées (hors fenêtre de sonde : la sonde compterait ces demandes)
        const images  = () => page.evaluate('new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => fin(0)))))')
        // une condition de la page, attendue à intervalle fixe (jamais par requestAnimationFrame, que la sonde compterait)
        const jusqua  = (condition: string) => page.waitForFunction(condition, null, { timeout: 120000, polling: 50 })
        // ce que la page fait pendant n images affichées : la sonde remise à zéro, `pendant` fait, puis lue
        const fenetre = async (n: number, pendant?: () => Promise<void>): Promise<any> => {
          await page.evaluate(RAZ)
          if (pendant) await pendant()
          await page.waitForFunction(`window.__sonde.images >= ${n}`, null, { timeout: 180000, polling: 50 })
          return page.evaluate(LIRE)
        }
        // la page est au repos : une fenêtre de dix images affichées sans une image demandée, ni une lecture, ni une écriture (la fenêtre où la dernière boucle s'arrête
        // porte encore sa dernière écriture : on attend la suivante) ; sans repos au bout de soixante fenêtres, une boucle n'a pas de fin
        const auRepos = async () => {
          let l: any
          for (let i = 0; i < 60; i++) {
            l = await fenetre(10)
            if (vu(l, ['raf', 'style', 'anim', 'ecrit']).every((n) => n === 0)) return l
          }
          assert.fail('la page ne revient pas au repos : ' + JSON.stringify(l))
        }
        // les pixels éclairés hors de l'arc du moment dans les quatre coins de la carte
        const mesure  = async (classe: string) => {
          const b    = await boite(classe)
          const shot = (await page.screenshot()).toString('base64')
          const res  = await page.evaluate(ANALYSE(shot, b))
          return { b, ...res }
        }
        // la mesure faite une fois la lumière allumée (son fondu dure 0,3 s et se compte en images affichées) : on remesure tant que le point lu n'est pas rouge ;
        // le rouge n'est qu'une condition de la mesure, les pixels hors de l'arc se comptent ensuite sur cette capture-là
        const mesureAllumee = async (classe: string, lu: 'centre' | 'bord' = 'centre') => {
          let m = await mesure(classe)
          for (let i = 0; i < 100 && !rouge(m[lu]); i++) {
            await page.waitForTimeout(50)
            m = await mesure(classe)
          }
          if (!rouge(m[lu])) {
            const message = `la lumière ne s'allume pas (${lu} : ${m[lu]}) : ` + await page.evaluate(ETAT(tag, classe))
            console.log('  ℹ️  ' + message)
            assert.fail(message)
          }
          return m
        }
        const hors    = (m: any) => m.coins.map((c: any) => `${c.coin} : ${c.hors} pixels éclairés hors d'un arc de ${c.rx} × ${c.ry} (jusqu'à ${c.max} niveaux, ${c.anneau} dans la marge)`).join(' | ')
        return { page, contexte, erreurs, tag, boite, entre, images, jusqua, fenetre, auRepos, mesure, mesureAllumee, hors }
      }

      // la carte à mi-course (50 %, figée) puis finie : la lumière ne sort d'aucun coin, ni à l'un ni à l'autre moment
      const miCourseEtFin = (titre: string, pose: string, classe: string, attendu: { mi: number[], fin: number[] }, lu: 'centre' | 'bord' = 'centre') => {
        it(titre, async function () {
          if (!browser) { this.skip(); return }
          const { page, contexte, erreurs, tag, entre, jusqua, images, mesureAllumee, hors } = await ouvre(pose)
          try {
            await entre(classe)
            await jusqua(EN_COURS(tag, classe))
            assert.ok((await page.evaluate(FIGE(tag, classe)) as number) >= 1, 'des transitions d\'arrondi à figer')
            await images()
            const mi = await mesureAllumee(classe, lu)
            assert.deepEqual(mi.coins.map((c: any) => [Math.round(c.rx), Math.round(c.ry)]), [0, 1, 2, 3].map(() => attendu.mi), 'l\'arrondi du moment est celui de la mi-course : ' + hors(mi))
            assert.ok(rouge(mi[lu]), 'la lumière est allumée (' + lu + ') : ' + mi[lu])
            assert.deepEqual(mi.coins.map((c: any) => c.hors), [0, 0, 0, 0], 'à mi-course : ' + hors(mi))
            await page.evaluate(FINIT(tag, classe))
            await images()
            const fin = await mesureAllumee(classe, lu)
            assert.deepEqual(fin.coins.map((c: any) => [Math.round(c.rx), Math.round(c.ry)]), [0, 1, 2, 3].map(() => attendu.fin), 'l\'arrondi final : ' + hors(fin))
            assert.ok(rouge(fin[lu]), 'la lumière est toujours allumée (' + lu + ') : ' + fin[lu])
            assert.deepEqual(fin.coins.map((c: any) => c.hors), [0, 0, 0, 0], 'après la transition : ' + hors(fin))
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }

      miCourseEtFin('halo : une carte qui passe de 12 à 40 px sous la souris — à mi-course (26 px) et à la fin (40 px), la lumière ne sort d\'aucun coin', 'halo', 'longue', { mi: [26, 26], fin: [40, 40] })
      miCourseEtFin('halo : arrondis en pourcentages et elliptiques (10% / 20% → 35% / 45%) — la lumière suit l\'arc de chaque coin', 'halo', 'pct', { mi: [60, 42], fin: [93, 59] })
      miCourseEtFin('halo avec retard (smooth) : une carte qui passe de 12 à 40 px — la lumière ne sort d\'aucun coin', 'retard', 'longue', { mi: [26, 26], fin: [40, 40] })
      miCourseEtFin('halo et liseré (l\'écriture par défaut) : une carte qui passe de 12 à 40 px — la lumière ne sort d\'aucun coin', 'defaut', 'longue', { mi: [26, 26], fin: [40, 40] })
      miCourseEtFin('voile : une carte qui passe de 12 à 40 px — le calque suit l\'arrondi tout seul, rien ne sort d\'aucun coin (le garde)', 'voile', 'longue', { mi: [26, 26], fin: [40, 40] }, 'bord')

      it('halo : une transition de 0,3 s menée en temps réel — une fois finie, la lumière ne sort d\'aucun coin', async function () {
        if (!browser) { this.skip(); return }
        const { contexte, erreurs, tag, entre, jusqua, images, mesureAllumee, hors } = await ouvre('halo')
        try {
          await entre('courte')
          await jusqua(ARRONDI_FINI(tag, 'courte', 40))
          await images()
          const fin = await mesureAllumee('courte')
          assert.deepEqual(fin.coins.map((c: any) => Math.round(c.rx)), [40, 40, 40, 40], 'l\'arrondi final de la carte : ' + hors(fin))
          assert.ok(rouge(fin.centre), 'la lumière est allumée : ' + fin.centre)
          assert.deepEqual(fin.coins.map((c: any) => c.hors), [0, 0, 0, 0], 'après la transition : ' + hors(fin))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      for (const [titre, classe] of [
        ['halo', 'sans'],
        ['halo avec retard (smooth)', 'sansretard'],
        ['halo et liseré (l\'écriture par défaut)', 'sansdefaut']
      ] as const) {
        it(`${titre} : la règle :hover change l'arrondi (12 → 40 px) SANS transition — la lumière ne sort d'aucun coin, même dans le navigateur qui applique :hover après l'entrée`, async function () {
          if (!browser) { this.skip(); return }
          const { contexte, erreurs, tag, entre, jusqua, images, mesureAllumee, hors } = await ouvre('sans')
          try {
            await entre(classe)
            await jusqua(`getComputedStyle(${CARTE(tag, classe)}).borderTopLeftRadius === '40px'`)
            await images()
            const m = await mesureAllumee(classe)
            assert.deepEqual(m.coins.map((c: any) => Math.round(c.rx)), [40, 40, 40, 40], 'l\'arrondi de la carte : ' + hors(m))
            assert.ok(rouge(m.centre), 'la lumière est allumée : ' + m.centre)
            assert.deepEqual(m.coins.map((c: any) => c.hors), [0, 0, 0, 0], hors(m))
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }

      // la règle :hover change l'arrondi SANS transition, Firefox l'applique après l'événement d'entrée : l'arrondi lu à l'entrée est celui d'avant le survol, l'image qui suit le relit.
      // Six entrées de suite, chacune par UN SEUL mouvement de la souris ; `avale` : le mouvement de l'entrée n'arrive jamais à la balise (écouteur de capture sur la fenêtre), la relecture
      // de l'image qui suit est seule à poser l'arrondi juste
      for (const [avale, quand] of [[false, 'un seul mouvement à l\'entrée'], [true, 'le mouvement de l\'entrée n\'arrive pas à la balise']] as const) {
        for (const [titre, classe] of [
          ['halo', 'sans'],
          ['halo avec retard (smooth)', 'sansretard'],
          ['halo et liseré (l\'écriture par défaut)', 'sansdefaut']
        ] as const) {
          it(`${titre} : ${quand}, six entrées de suite — la lumière ne sort d'aucun coin une fois l'arrondi changé par :hover`, async function () {
            if (!browser) { this.skip(); return }
            const { page, contexte, erreurs, tag, boite, jusqua, images, mesureAllumee, hors } = await ouvre('sans')
            try {
              if (avale) await page.evaluate(`window.addEventListener('pointermove', (e) => e.stopImmediatePropagation(), true)`)
              const b = await boite(classe)
              for (let i = 1; i <= 6; i++) {
                // dehors, la lumière éteinte et défaite
                await page.mouse.move(b.x - 10, b.y + b.h / 2)
                await jusqua(`!${PROMUE(tag, classe)} && !${CARTE(tag, classe)}.matches(':hover')`)
                // UN SEUL mouvement de la souris, de dehors à l'intérieur
                await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
                await jusqua(`getComputedStyle(${CARTE(tag, classe)}).borderTopLeftRadius === '40px'`)
                await images()
                const m = await mesureAllumee(classe)
                assert.deepEqual(m.coins.map((c: any) => Math.round(c.rx)), [40, 40, 40, 40], `entrée ${i} : l'arrondi de la carte : ` + hors(m))
                assert.deepEqual(m.coins.map((c: any) => c.hors), [0, 0, 0, 0], `entrée ${i} : ` + hors(m))
              }
              assert.deepEqual(erreurs, [])
            }
            finally {
              await contexte.close()
            }
          })
        }
      }

      it('halo toujours allumé avec un retard : la souris rentre pendant que la lumière glisse encore vers le centre — la lumière ne sort d\'aucun coin, et la boucle a une fin', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, boite, entre, jusqua, images, auRepos, mesureAllumee, hors } = await ouvre('rentree')
        try {
          const b = await boite('toujours')
          // la lumière suit la souris vers le coin haut gauche, la carte est à 40 px
          await entre('toujours')
          await page.mouse.move(b.x + 25, b.y + 25, { steps: 2 })
          await jusqua(ARRONDI_FINI(tag, 'toujours', 40))
          // la souris sort : l'arrondi revient à 12 px, la lumière rentre au centre en glissant (près de six secondes)
          await page.mouse.move(b.x - 10, b.y + b.h / 2, { steps: 2 })
          await jusqua(ARRONDI_FINI(tag, 'toujours', 12))
          assert.ok(await page.evaluate(PROMUE(tag, 'toujours')), 'la lumière glisse encore vers le centre (elle est encore promue) quand la souris rentre')
          // la souris rentre avant l'arrivée de la lumière : la transition de l'arrondi repart
          await entre('toujours')
          await jusqua(ARRONDI_FINI(tag, 'toujours', 40))
          await images()
          const m = await mesureAllumee('toujours')
          assert.deepEqual(m.coins.map((c: any) => Math.round(c.rx)), [40, 40, 40, 40], 'l\'arrondi de la carte : ' + hors(m))
          assert.ok(rouge(m.centre), 'la lumière est allumée : ' + m.centre)
          assert.deepEqual(m.coins.map((c: any) => c.hors), [0, 0, 0, 0], hors(m))
          // la lumière finit de glisser, puis plus rien ne tourne : ni la boucle de la lumière, ni celle de l'arrondi
          const l = await auRepos()
          assert.deepEqual(vu(l, ['raf', 'style', 'anim', 'ecrit']), [0, 0, 0, 0], 'au repos : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('halo : l\'arrondi est déjà changé à l\'entrée de la souris (classe posée, souris dehors) — la lumière ne sort d\'aucun coin (le garde)', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, entre, jusqua, images, mesureAllumee, hors } = await ouvre('halo')
        try {
          await page.evaluate(`${CARTE(tag, 'posee')}.classList.add('pris')`)
          await jusqua(ARRONDI_FINI(tag, 'posee', 40))
          await entre('posee')
          await images()
          const m = await mesureAllumee('posee')
          assert.deepEqual(m.coins.map((c: any) => Math.round(c.rx)), [40, 40, 40, 40], 'l\'arrondi de la carte : ' + hors(m))
          assert.ok(rouge(m.centre), 'la lumière est allumée : ' + m.centre)
          assert.deepEqual(m.coins.map((c: any) => c.hors), [0, 0, 0, 0], hors(m))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('la transition de border-radius d\'un ENFANT de la balise ne met rien en route : une seule image demandée (celle de l\'entrée), aucune lecture des animations', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, boite, entre, jusqua, fenetre } = await ouvre('halo')
        try {
          const b = await boite('enfant')
          // l'événement de la transition de l'enfant monte jusqu'à la carte : c'est lui que le suivi ne doit pas prendre pour le sien
          await page.evaluate(`window.__vus = []; window.__moves = 0; ${CARTE(tag, 'enfant')}.addEventListener('transitionrun', (e) => window.__vus.push(e.target.className + ' ' + e.propertyName)); ${CARTE(tag, 'enfant')}.addEventListener('pointermove', () => window.__moves++)`)
          const pastille = `getComputedStyle(${CARTE(tag, 'enfant')}.querySelector('.pastille')).borderTopLeftRadius`
          // la fenêtre court de l'entrée de la souris à la fin de la transition de l'enfant (0,6 s)
          const l = await fenetre(10, async () => {
            await entre('enfant')
            await jusqua(`window.__vus.length > 0 && ${pastille} === '50%'`)
          })
          const vus = await page.evaluate('window.__vus') as string[]
          assert.ok(vus.some((v) => /^pastille border-.*radius$/.test(v)), 'la transition de l\'enfant a bien été annoncée à la carte : ' + JSON.stringify(vus))
          assert.equal(b.rayons[0][0], 12, 'la carte garde son arrondi')
          const moves = await page.evaluate('window.__moves') as number
          assert.ok(l.raf <= 1 + moves, 'une image demandée pour l\'entrée de la souris et une par mouvement au plus (celle qui écrit le halo), aucune pour la transition d\'un enfant : ' + JSON.stringify(l) + ' ' + moves)
          assert.equal(l.anim, 0, 'aucune lecture des animations : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('l\'entrée de la souris coûte une image demandée et une relecture de l\'arrondi, et ne redessine pas le halo quand l\'arrondi n\'a pas changé', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, boite, jusqua, fenetre } = await ouvre('halo')
        try {
          // une carte déjà à 40 px : le survol n'y change rien
          await page.evaluate(`${CARTE(tag, 'posee')}.classList.add('pris')`)
          await jusqua(ARRONDI_FINI(tag, 'posee', 40))
          const b = await boite('posee')
          await page.evaluate(`window.__moves = 0; ${CARTE(tag, 'posee')}.addEventListener('pointermove', () => window.__moves++)`)
          const l = await fenetre(10, async () => {
            await page.mouse.move(b.x - 10, b.y + b.h / 2)
            await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
          })
          const moves = await page.evaluate('window.__moves') as number
          assert.ok(moves >= 1, 'la souris est entrée dans la carte')
          assert.deepEqual(vu(l, ['style', 'anim']), [2, 0], 'deux lectures du style (celle de l\'entrée, celle de l\'image suivante), aucune lecture des animations : ' + JSON.stringify(l))
          assert.ok(l.ecrit >= 1 && l.ecrit <= moves, 'une écriture au plus par mouvement de la souris (les mouvements d\'une même image en partagent une), aucune pour la relecture de l\'arrondi : ' + JSON.stringify(l))
          assert.equal(l.raf, 1 + l.ecrit, 'une image demandée pour la relecture de l\'arrondi, une par écriture des images clés du halo : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('un réglage qui relance l\'effet en pleine transition, la souris dessus, défait aussi ce qui est en attente : plus d\'image demandée, plus d\'écouteur', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, entre, jusqua, fenetre } = await ouvre('reglage')
        try {
          await entre('longue')
          await jusqua(EN_COURS(tag, 'longue'))
          // l'effet est défait puis reposé, la balise et la souris restent là ; la transition de l'arrondi (20 s) court toujours
          await page.evaluate(`document.querySelector('${tag}')._shadow.querySelector('.bascule').click()`)
          await jusqua(`!${CARTE(tag, 'longue')}.hasAttribute('mjs-fx-spot-where')`)
          const l = await fenetre(20)
          assert.ok(await page.evaluate(EN_COURS(tag, 'longue')), 'la transition de l\'arrondi court toujours')
          assert.deepEqual(vu(l, ['raf', 'ecrit', 'vivants']), [0, 0, 0], 'l\'effet défait ne demande plus d\'image et n\'écoute plus : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('une autre transition de la balise (son fond, 20 s) ne prolonge pas le suivi : la boucle s\'arrête avec la transition de l\'arrondi', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, entre, jusqua, images, fenetre } = await ouvre('fond')
        try {
          const fond = `${CARTE(tag, 'deux')}.getAnimations().some((a) => /background/.test(a.transitionProperty))`
          await entre('deux')
          // la transition de l'arrondi (0,3 s) est finie, celle du fond (20 s) court encore
          await jusqua(`${ARRONDI_FINI(tag, 'deux', 40)} && ${fond}`)
          await images()
          const l = await fenetre(20)
          assert.ok(await page.evaluate(fond), 'la transition du fond court toujours')
          assert.deepEqual(vu(l, ['raf', 'style', 'anim', 'ecrit']), [0, 0, 0, 0], 'seule la transition de l\'arrondi est suivie : ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })

      it('le suivi ne vit que le temps du changement : rien au repos, rien de plus par mouvement, une image par image affichée pendant la transition, arrêté avec elle, débranché à la sortie et au retrait', async function () {
        if (!browser) { this.skip(); return }
        const { page, contexte, erreurs, tag, entre, boite, jusqua, images, fenetre } = await ouvre('halo')
        try {
          const b = await boite('courte')
          // au repos : ni image demandée, ni lecture, ni écriture, ni écouteur de transition
          let l = await fenetre(20)
          assert.deepEqual(vu(l, ['raf', 'style', 'anim', 'boite', 'ecrit', 'vivants']), [0, 0, 0, 0, 0, 0], 'au repos : ' + JSON.stringify(l))
          // l'entrée de la souris : la transition de 0,3 s court, puis plus rien ne tourne
          await entre('courte')
          await jusqua(ARRONDI_FINI(tag, 'courte', 40))
          await images()
          l = await fenetre(20)
          assert.deepEqual(vu(l, ['raf', 'style', 'anim', 'boite', 'ecrit']), [0, 0, 0, 0, 0], 'souris immobile, la transition finie : rien ne tourne ' + JSON.stringify(l))
          // par mouvement de la souris : aucune lecture du style ni des animations ; une image demandée au plus par image affichée, qui écrit la dernière position (une écriture par image demandée)
          l = await fenetre(10, async () => { for (let i = 0; i < 30; i++) await page.mouse.move(b.x + 30 + i * 6, b.y + 30 + (i % 5) * 12, { steps: 1 }) })
          assert.deepEqual(vu(l, ['style', 'anim']), [0, 0], 'trente mouvements : ni lecture du style, ni des animations ' + JSON.stringify(l))
          assert.ok(l.raf >= 1 && l.raf <= l.images + 1 && l.ecrit === l.raf, 'trente mouvements : une image demandée par image affichée au plus, une écriture par image demandée ' + JSON.stringify(l))
          // la sortie : une fois le halo éteint, plus rien n'écoute
          await page.mouse.move(b.x - 10, b.y + b.h / 2, { steps: 2 })
          await jusqua(`!${PROMUE(tag, 'courte')}`)
          l = await fenetre(20)
          assert.deepEqual(vu(l, ['raf', 'style', 'anim', 'boite', 'ecrit', 'vivants']), [0, 0, 0, 0, 0, 0], 'après la sortie : rien ne tourne, rien n\'écoute ' + JSON.stringify(l))
          // pendant le changement (une transition lente) : une image demandée par image affichée, avec sa lecture du style, sa lecture des animations et son écriture, sans
          // lecture de boîte ; un seul écouteur. La sortie en plein changement : la transition court encore mais la lumière est éteinte, le suivi s'arrête avec elle
          const lente = await boite('longue')
          await entre('longue')
          await jusqua(EN_COURS(tag, 'longue'))
          l = await fenetre(30)
          assert.equal(l.vivants, 1, 'un seul écouteur de transition : ' + JSON.stringify(l))
          for (const cle of ['raf', 'style', 'anim', 'ecrit']) assert.ok(Math.abs(l[cle] - l.images) <= 3, `pendant la transition, ${cle} : une par image affichée, ni plus (une seule boucle) ni moins (le suivi tourne) : ` + JSON.stringify(l))
          assert.equal(l.boite, 0, 'aucune lecture de boîte pendant la transition : ' + JSON.stringify(l))
          // la transition est avancée de moitié : celle du retour, qui part de là, dure encore une dizaine de secondes
          await page.evaluate(FIGE(tag, 'longue'))
          await page.mouse.move(lente.x - 10, lente.y + lente.h / 2, { steps: 2 })
          await jusqua(`!${PROMUE(tag, 'longue')}`)
          assert.ok(await page.evaluate(EN_COURS(tag, 'longue')), 'la transition du retour court encore')
          l = await fenetre(20)
          assert.deepEqual(vu(l, ['raf', 'vivants']), [0, 0], 'sortie en plein changement : la lumière éteinte, le suivi est arrêté et débranché ' + JSON.stringify(l))
          // le retrait en plein changement : une transition lente en cours, le composant part
          await entre('longue')
          await jusqua(EN_COURS(tag, 'longue'))
          await page.evaluate(`document.querySelector('${tag}').remove()`)
          l = await fenetre(20)
          assert.deepEqual(vu(l, ['raf', 'vivants']), [0, 0], 'après le retrait de l\'effet, en pleine transition : rien ne tourne, rien n\'écoute ' + JSON.stringify(l))
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })
    })
  }
})
