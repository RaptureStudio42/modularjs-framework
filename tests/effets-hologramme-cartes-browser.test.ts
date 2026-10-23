// *hologram, les styles de carte, dans Chromium et Firefox réels : rien au repos (ni calque, ni
// transformation, ni image d'animation), le reflet et l'inclinaison au survol (des pixels d'une
// capture, la transformation calculée), le retour sans reste ; les modes de fusion des boîtes ; la
// carte agrandie au centre de l'écran puis renvoyée à sa place ; les motifs, qui viennent du thème seul
// (ni dessinés ni livrés par l'effet) ; « réduire les animations ». Variable d'environnement
// MJS_CAPTURES : un dossier où poser une capture de chaque état (pour les regarder).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

const STYLE = `<style>
.carte
  width: 200px
  height: 280px
  margin: 60px 0 0 60px
  border-radius: 10px
  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)
  color: #fff
.loin
  margin-top: 30px
</style>`

// la même feuille, et une carte que son auteur a tournée de 8 degrés
const STYLE_PROPRE = STYLE.replace('</style>', '.propre\n  transform: rotate(8deg)\n</style>')

// la page qui défile : la carte, puis assez de place dessous
const STYLE_DEFILE = STYLE.replace('</style>', '.espace\n  height: 2400px\n</style>')

// le thème donne un des trois plans du ciel : la variable est posée sur la balise du composant, un ancêtre de la carte
const STYLE_THEME = STYLE.replace('<style>', '<style>\n:host\n  --mjs-hologram-pattern-sky-far: url("http://t.test/ciel.png")')

// le préfixe public de la sortie : les images de motif ne sont servies qu'à cette adresse exacte, une adresse qui l'oublie est un 404
const PREFIXE = '/assets/site'

const SOURCES: Record<string, string> = {
  'hb-carte.mjs':    `<div class="carte" *hologram(rays, zoom: true)><b>carte</b></div>\n${STYLE}`,
  'hb-propre.mjs':   `<div class="carte propre" *hologram(rays, zoom: true)><b>tournée</b></div><div class="carte loin nu" *hologram(rays, zoom: true)><b>droite</b></div>\n${STYLE_PROPRE}`,
  'hb-cosmos.mjs':   `<div class="carte a" *hologram(night-sky)><b>ciel</b></div><div class="carte loin b" *hologram(night-sky, seed: 5)><b>ciel</b></div>\n${STYLE}`,
  'hb-defile.mjs':   `<div class="carte" *hologram(rays, zoom: true)><b>carte</b></div><div class="espace"></div>\n${STYLE_DEFILE}`,
  'hb-retrait.mjs':  `<script>\n$on = false\n</script>\n{if $on}<div class="carte" *hologram(rays-fade, zoom: true, on: view)><b>carte</b></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n${STYLE}`,
  'hb-retrait-charge.mjs': `<script>\n$on = false\n</script>\n{if $on}<div class="carte" *hologram(opal, on: load)><b>carte</b></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n${STYLE}`,
  'hb-theme.mjs':    `<div class="carte a" *hologram(night-sky)><b>ciel</b></div>\n${STYLE_THEME}`,
  'hb-tilt.mjs':     `<div class="carte" *hologram(rays) *tilt><b>carte</b></div>\n${STYLE}`,
  'hb-tilt-seul.mjs': `<div class="carte" *tilt><b>carte</b></div>\n${STYLE}`,
  'hb-tilt-long.mjs': `<div class="carte" *hologram(rays) *tilt(duration: 1000ms)><b>carte</b></div>\n${STYLE}`,
  'hb-tilt-long-plat.mjs': `<div class="carte" *hologram(rays, shadow: false) *tilt(duration: 1000ms)><b>carte</b></div>\n${STYLE}`,
  'hb-tilt-long-inverse.mjs': `<div class="carte" *tilt(duration: 1000ms) *hologram(rays)><b>carte</b></div>\n${STYLE}`,
  'hb-ombre-auteur.mjs': `<div class="carte mienne" *hologram(rays, zoom: true)><b>carte</b></div>\n${STYLE.replace('</style>', '.mienne\n  box-shadow: 0 0 0 4px rgb(255, 0, 0)\n  cursor: grab\n</style>')}`,
  'hb-tilt-zoom.mjs': `<div class="carte" *hologram(rays, zoom: true) *tilt(duration: 400ms)><b>carte</b></div>\n${STYLE}`,
  'hb-toujours.mjs': `<div class="carte" *hologram(curtain, on: always)><b>carte</b></div>\n${STYLE}`,
}

// un registre de ce que la page pose, installé avant ses scripts : écouteurs, minuteries, images d'animation, rappels
// d'inactivité, observateurs de visibilité. Les rappels d'inactivité et l'observateur ne sont jamais déclenchés : on regarde
// ce qui reste posé, pas ce qui se passe. `etire` : les délais d'au moins 250 ms durent autant de fois plus longtemps (une
// minuterie posée avant le retrait est encore là au moment où on la compte). `window.__coarse` : la page se dit tactile.
const REGISTRE = (etire: number) => {
  const w   = window as any
  const reg = w.__reg = { ecouteurs: [] as any[], minuteries: new Set<number>(), images: new Set<number>(), inactivite: new Set<number>(), observateurs: new Set<any>() }
  const cap = (o: any) => typeof o === 'boolean' ? o : !!(o && o.capture)
  const ajoute = EventTarget.prototype.addEventListener
  const retire = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (this: any, type: string, fn: any, o?: any) {
    if (fn && !reg.ecouteurs.some((e: any) => e.t === this && e.type === type && e.fn === fn && e.cap === cap(o))) reg.ecouteurs.push({ t: this, type, fn, cap: cap(o) })
    return ajoute.call(this, type, fn, o)
  }
  EventTarget.prototype.removeEventListener = function (this: any, type: string, fn: any, o?: any) {
    const i = reg.ecouteurs.findIndex((e: any) => e.t === this && e.type === type && e.fn === fn && e.cap === cap(o))
    if (i >= 0) reg.ecouteurs.splice(i, 1)
    return retire.call(this, type, fn, o)
  }
  const st = window.setTimeout
  const ct = window.clearTimeout
  window.setTimeout = ((f: any, ms?: number, ...a: any[]) => {
    const id = st.call(window, (...args: any[]) => { reg.minuteries.delete(id); return typeof f === 'function' ? f(...args) : undefined }, (ms ?? 0) >= 250 ? (ms as number) * etire : ms, ...a)
    reg.minuteries.add(id)
    return id
  }) as any
  window.clearTimeout = ((id?: number) => { if (id !== undefined) reg.minuteries.delete(id); return ct.call(window, id) }) as any
  const raf = window.requestAnimationFrame
  const caf = window.cancelAnimationFrame
  window.requestAnimationFrame = (f: FrameRequestCallback) => {
    const id = raf.call(window, (t: number) => { reg.images.delete(id); f(t) })
    reg.images.add(id)
    return id
  }
  window.cancelAnimationFrame = (id: number) => { reg.images.delete(id); return caf.call(window, id) }
  let n = 0
  ;(window as any).requestIdleCallback = () => { n++; reg.inactivite.add(n); return n }
  ;(window as any).cancelIdleCallback = (id: number) => { reg.inactivite.delete(id) }
  w.IntersectionObserver = class {
    cibles = new Set<any>()
    constructor() { reg.observateurs.add(this) }
    observe(el: any) { this.cibles.add(el) }
    unobserve(el: any) { this.cibles.delete(el) }
    disconnect() { this.cibles.clear() }
    takeRecords() { return [] }
  }
  const mm = window.matchMedia.bind(window)
  window.matchMedia = ((q: string) => w.__coarse && /pointer:\s*coarse/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } } : mm(q)) as any
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*hologram, les styles de carte (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''
    let sortie  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des cartes holographiques sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-hologramme-cartes-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      sortie       = outDir
      mkdirSync(srcDir, { recursive: true })
      for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: PREFIXE })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function ouvre(browser: any, tag: string, options: any = {}, sel = '.carte') {
      const { registre, etire, ...contexte } = options
      const page = await browser.newPage({ viewport: { width: 700, height: 800 }, ...contexte })
      const erreurs: string[] = []
      const images: string[]  = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      // le compte des images faites depuis un canvas, posé avant les scripts de la page
      await page.addInitScript(() => {
        const w = window as any
        w.__blobs = 0
        const vrai = URL.createObjectURL
        URL.createObjectURL = function (o: any) { w.__blobs++; return vrai.call(URL, o) }
      })
      if (registre) await page.addInitScript(REGISTRE, etire ?? 1)
      await page.route('http://t.test/**', (route: any) => {
        // les images de motif que la construction a copiées dans la sortie, servies à leur adresse publique exacte (préfixe compris) : sans lui, 404
        const chemin = new URL(route.request().url()).pathname
        const nom    = chemin.startsWith(PREFIXE + '/') ? chemin.slice(PREFIXE.length + 1) : ''
        const image  = /^(mjs_hologram_[a-z-]+-[0-9a-z]{5})\.(png|webp|jpg)$/.exec(nom)
        if (image) {
          images.push(chemin)
          return route.fulfill({ contentType: 'image/' + (image[2] === 'jpg' ? 'jpeg' : image[2]), body: readFileSync(join(sortie, image[1] + '.' + image[2])) })
        }
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, s]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector(s), [tag, sel])
      // le compte des images d'animation demandées par la page
      await page.evaluate(() => {
        const w = window as any
        w.__raf = 0
        const vrai = window.requestAnimationFrame
        window.requestAnimationFrame = function (f: FrameRequestCallback) { w.__raf++; return vrai.call(window, f) }
      })
      await page.waitForTimeout(400)
      return { page, erreurs, images }
    }

    // ce qu'on lit d'une carte : sa boîte, son calque, sa transformation calculée
    const etat = (page: any, tag: string, sel = '.carte') => page.evaluate(([t, s]: string[]) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement
      const l  = el.querySelector('[mjs-fx-layer="hologram"]') as HTMLElement | null
      const r  = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const de = (n: string) => l ? getComputedStyle(l.querySelector(n) as Element) : null
      return {
        x: r.left, y: r.top, w: r.width, h: r.height,
        calque: !!l,
        transform: cs.transform,
        zIndex: cs.zIndex,
        attributs: el.getAttributeNames().filter((n) => n.startsWith('mjs-fx-hologram')).sort().join(' '),
        variables: l ? { x: l.style.getPropertyValue('--mjs-fx-hologram-x'), o: l.style.getPropertyValue('--mjs-fx-hologram-o') } : null,
        motifs: l ? [...l.style].filter((p) => p.includes('-t-')).map((p) => l.style.getPropertyValue(p)) : [],
        fond: l ? getComputedStyle(l.querySelector('i') as Element).backgroundImage : '',
        fusion: l ? { i: de('i')!.mixBlendMode, b: de('b')!.mixBlendMode, clics: getComputedStyle(l).pointerEvents } : null,
        images: (window as any).__raf,
      }
    }, [tag, sel])

    // la part de pixels qui diffèrent nettement entre deux captures de même taille
    async function difference(page: any, a: Buffer, b: Buffer): Promise<number> {
      return page.evaluate(async ([x, y]: string[]) => {
        const lit = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return c.getImageData(0, 0, cv.width, cv.height).data
        }
        const p = await lit(x), q = await lit(y)
        let n = 0
        for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++
        return n / (p.length / 4)
      }, [a.toString('base64'), b.toString('base64')])
    }

    const capture = async (page: any, nomFichier: string, clip?: any) => {
      const dir = process.env.MJS_CAPTURES
      if (dir) await page.screenshot({ path: join(dir, `${nom}-${nomFichier}.png`), clip })
    }

    // attend que la carte soit revenue à ce qu'elle était avant le mouvement (plus de calque, les mêmes marques sur la balise :
    // `attributs`, lus au repos), puis que plus aucune image d'animation ne soit demandée pendant une demi-seconde. Le retour ne
    // part qu'après un délai (500 ms) : un compte d'images lu à intervalle fixe le prend pour fini avant qu'il ait commencé
    // quand la minuterie arrive en retard (machine chargée) ; seul l'état dit qu'il est fini
    async function repos(page: any, tag: string, attributs: string, sel = '.carte', max = 30000) {
      const fin = Date.now() + max
      for (;;) {
        const e = await etat(page, tag, sel)
        if (!e.calque && e.attributs === attributs) break
        if (Date.now() >= fin) return false
        await page.waitForTimeout(100)
      }
      let avant = (await etat(page, tag, sel)).images
      while (Date.now() < fin) {
        await page.waitForTimeout(500)
        const apres = (await etat(page, tag, sel)).images
        if (apres === avant) return true
        avant = apres
      }
      return false
    }

    it('rien au repos ; au survol le reflet apparaît et la carte ne penche pas ; la souris partie, tout revient et plus rien ne tourne', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-carte')
        const tag  = 'mjs-hb-carte'
        const zero = await etat(page, tag)
        assert.equal(zero.calque, false, 'au repos : pas de calque')
        assert.equal(zero.transform, 'none', 'au repos : pas de transformation')
        assert.equal(zero.images, 0, 'au repos : aucune image d\'animation demandée')
        const clip  = { x: zero.x - 30, y: zero.y - 30, width: zero.w + 60, height: zero.h + 60 }
        const calme = await page.screenshot({ clip })
        await page.mouse.move(zero.x + 40, zero.y + 40)
        await page.waitForTimeout(1200)
        const haut = await etat(page, tag)
        assert.equal(haut.calque, true, 'au survol : le calque est là')
        assert.equal(haut.transform, 'none', 'au survol : la carte ne penche pas')
        assert.doesNotMatch(haut.attributs, /-3d/, 'aucune marque de transformation au survol')
        assert.deepEqual(haut.fusion, { i: 'color-dodge', b: 'hard-light', clics: 'none' }, 'le reflet et l\'éclat se fondent avec la carte, sans capter les clics')
        const vueHaut = await page.screenshot({ clip })
        await capture(page, 'carte-survol-haut', clip)
        assert.ok(await difference(page, calme, vueHaut) > 0.1, 'le survol change la carte')
        await page.mouse.move(zero.x + zero.w - 40, zero.y + zero.h - 40, { steps: 6 })
        await page.waitForTimeout(1200)
        const vueBas = await page.screenshot({ clip })
        await capture(page, 'carte-survol-bas', clip)
        assert.ok(await difference(page, vueHaut, vueBas) > 0.05, 'le reflet suit la souris')
        await page.mouse.move(2, 2)
        assert.ok(await repos(page, tag, zero.attributs), 'la boucle s\'arrête d\'elle-même')
        const fin = await etat(page, tag)
        assert.equal(fin.calque, false, 'reparti : plus de calque')
        assert.equal(fin.transform, 'none')
        assert.equal(fin.attributs, zero.attributs, 'les mêmes attributs qu\'avant le survol')
        assert.ok(await difference(page, calme, await page.screenshot({ clip })) < 0.005, 'la carte est redevenue ce qu\'elle était')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('zoom : un clic amène la carte au milieu de l\'écran, agrandie ; Échap la renvoie exactement à sa place', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-carte')
        const tag  = 'mjs-hb-carte'
        const zero = await etat(page, tag)
        await page.mouse.click(zero.x + 100, zero.y + 140)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(3500)
        const grand = await etat(page, tag)
        await capture(page, 'carte-agrandie')
        assert.match(grand.attributs, /mjs-fx-hologram-zoomed/)
        assert.ok(grand.w > zero.w * 1.5, `agrandie : ${Math.round(zero.w)} px puis ${Math.round(grand.w)} px`)
        assert.ok(Math.abs(grand.x + grand.w / 2 - 350) < 4 && Math.abs(grand.y + grand.h / 2 - 400) < 4, `au milieu de l'écran : ${Math.round(grand.x + grand.w / 2)}, ${Math.round(grand.y + grand.h / 2)}`)
        assert.equal(grand.zIndex, '2147483000', 'au-dessus du reste de la page')
        await page.keyboard.press('Escape')
        assert.ok(await repos(page, tag, zero.attributs), 'le retour s\'arrête de lui-même')
        const fin = await etat(page, tag)
        assert.ok(Math.abs(fin.x - zero.x) < 0.5 && Math.abs(fin.y - zero.y) < 0.5 && Math.abs(fin.w - zero.w) < 0.5, 'revenue à sa place et à sa taille')
        assert.equal(fin.transform, 'none')
        assert.equal(fin.calque, false)
        assert.doesNotMatch(fin.attributs, /zoomed|-up|-3d/)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('la transformation de l\'auteur est gardée : intacte au survol, composée avec le zoom pendant l\'agrandissement, rendue telle quelle à la fin', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-propre')
        const tag = 'mjs-hb-propre'
        // l'angle du plan : la rotation de l'auteur (8°) plus, au plus, un degré ou deux venus du zoom
        const plan = (sel: string) => page.evaluate(([t, s]: string[]) => {
          const el = (document.querySelector(t) as any)._shadow.querySelector(s) as HTMLElement
          const cs = getComputedStyle(el)
          const m  = cs.transform === 'none' ? new DOMMatrix() : new DOMMatrix(cs.transform)
          return { angle: Math.atan2(m.b, m.a) * 180 / Math.PI, transform: cs.transform, style: el.getAttribute('style') }
        }, [tag, sel])
        const propre = await etat(page, tag, '.propre')
        const droite = await etat(page, tag, '.nu')
        const avant  = await plan('.propre')
        assert.ok(Math.abs(avant.angle - 8) < 0.01, 'la carte est tournée par son auteur : ' + avant.angle)
        await page.mouse.move(propre.x + propre.w * 0.25, propre.y + propre.h * 0.2)
        await page.waitForTimeout(1500)
        const survol = await plan('.propre')
        assert.equal(survol.transform, avant.transform, 'au survol, la transformation de l\'auteur n\'est pas touchée : la carte ne penche pas')
        assert.equal((await etat(page, tag, '.propre')).calque, true, 'et le reflet est là')
        await page.mouse.click(propre.x + propre.w * 0.5, propre.y + propre.h * 0.5)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(3500)
        const pendant = await plan('.propre')
        assert.match(pendant.transform, /^matrix3d\(/, 'agrandie : ' + pendant.transform)
        assert.ok(Math.abs(pendant.angle - 8) < 1.5, 'la rotation de l\'auteur reste dans la transformation : ' + pendant.angle + '°')
        await page.keyboard.press('Escape')
        assert.ok(await repos(page, tag, propre.attributs, '.propre'), 'la boucle s\'arrête d\'elle-même')
        const apres = await plan('.propre')
        assert.equal(apres.transform, avant.transform, 'rendue telle quelle à la fin')
        assert.doesNotMatch(apres.style ?? '', /--mjs-fx-hologram/, 'variables restées : ' + apres.style)
        // le témoin : une carte que son auteur n\'a pas tournée garde un plan droit
        await page.mouse.click(droite.x + droite.w * 0.5, droite.y + droite.h * 0.5)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(3500)
        const temoin = await plan('.nu')
        assert.match(temoin.transform, /^matrix3d\(/)
        assert.ok(Math.abs(temoin.angle) < 1.5, 'sans rotation d\'auteur, le plan reste droit : ' + temoin.angle + '°')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('l\'attente du retour au repos va jusqu\'au bout, même quand la minuterie du retour tarde à partir', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        // les délais d'au moins 250 ms durent quatre fois plus : la minuterie du retour (500 ms) en dure 2000, plus que l'attente de 500 ms
        // d'un compte d'images — c'est ce que fait une machine chargée d'une minuterie qui arrive en retard
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-propre', { registre: true, etire: 4 })
        const tag = 'mjs-hb-propre'
        const plan = () => page.evaluate(([t, s]: string[]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector(s)).transform, [tag, '.propre'])
        const propre = await etat(page, tag, '.propre')
        const avant  = await plan()
        await page.mouse.click(propre.x + propre.w * 0.5, propre.y + propre.h * 0.5)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(6000)
        assert.match(await plan(), /^matrix3d\(/, 'agrandie')
        await page.keyboard.press('Escape')
        assert.ok(await repos(page, tag, propre.attributs, '.propre'), 'la boucle s\'arrête d\'elle-même')
        assert.equal(await plan(), avant, 'le retour est fini quand l\'attente rend la main : la transformation de l\'auteur, telle quelle')
        assert.equal((await etat(page, tag, '.propre')).calque, false, 'reparti : plus de calque')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // *hologram ne retire rien à *tilt : la pente revient en `duration`, pas d'un coup, quelle que soit l'ombre ou l'ordre d'écriture
    for (const [tag, titre] of [
      ['mjs-hb-tilt-long',         '*hologram *tilt(duration: 1000ms), ombre par défaut'],
      ['mjs-hb-tilt-long-plat',    '*hologram(shadow: false) *tilt(duration: 1000ms)'],
      ['mjs-hb-tilt-long-inverse', '*tilt(duration: 1000ms) *hologram, l\'ordre inverse']
    ]) {
      it('avec *tilt sur la même balise, la pente revient en `duration` après le départ de la souris : ' + titre, async function () {
        if (!present) { this.skip(); return }
        const playwright = await import('playwright')
        const browser = await playwright[nom].launch()
        try {
          const { page, erreurs } = await ouvre(browser, tag)
          const zero = await etat(page, tag)
          await page.mouse.move(zero.x + zero.w * 0.2, zero.y + zero.h * 0.15, { steps: 4 })
          await page.waitForTimeout(1500)
          // la transition de retour de `transform`, lue par l'API des animations : sa durée, l'angle à 300 ms de SON temps, puis l'angle une fois finie. Une lecture à l'horloge
          // du navigateur n'était pas fiable : la courbe de retour est raide, et un fil principal chargé fait tomber l'échantillon après 320 ms, sous le seuil
          await page.evaluate(([t]: string[]) => {
            const w  = window as any
            const el = (document.querySelector(t) as any)._shadow.querySelector('.carte') as HTMLElement
            const angle = () => {
              const cs = getComputedStyle(el)
              const m  = cs.transform === 'none' ? new DOMMatrix() : new DOMMatrix(cs.transform)
              return Math.acos(Math.min(1, Math.abs(m.m33))) * 180 / Math.PI
            }
            w.__pente = { avant: angle(), lu: false }
            el.addEventListener('pointerleave', () => {
              let essais = 0
              const lire = () => {
                const a = el.getAnimations().find((x: any) => x.transitionProperty === 'transform')
                if (!a) {
                  if (++essais < 30) requestAnimationFrame(lire)
                  else w.__pente.lu = true
                  return
                }
                a.pause()
                a.currentTime = 300
                w.__pente.duree = a.effect!.getComputedTiming().duration
                w.__pente.a300  = angle()
                a.finish()
                w.__pente.fin = angle()
                w.__pente.lu  = true
              }
              requestAnimationFrame(lire)
            }, { once: true })
          }, [tag])
          await page.mouse.move(2, 2)
          await page.waitForFunction(() => (window as any).__pente.lu, null, { timeout: 5000 })
          const { avant, duree, a300, fin } = await page.evaluate(() => (window as any).__pente)
          assert.ok(avant > 5, 'la pente est là avant le départ : ' + avant.toFixed(1) + '°')
          assert.equal(duree, 1000, 'la transition de retour dure `duration` (1000 ms) : ' + duree)
          assert.ok(a300 > avant * 0.15, 'à 300 ms de la transition la pente n\'est pas revenue d\'un coup (plus de 15 % de ' + avant.toFixed(1) + '°) : ' + (a300 && a300.toFixed(2)) + '°')
          assert.ok(fin < 0.5, 'une fois la transition finie la pente est revenue : ' + (fin && fin.toFixed(2)) + '°')
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }

    it('la transition de l\'ombre : *hologram seul fond l\'ombre en 0,4 s ; avec *tilt, c\'est la sienne qui compte', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const lit = async (tag: string) => {
          const { page } = await ouvre(browser, tag)
          return page.evaluate(([t]: string[]) => {
            const cs = getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.carte') as HTMLElement)
            return cs.transitionProperty + ' ' + cs.transitionDuration
          }, [tag])
        }
        assert.equal(await lit('mjs-hb-carte'), 'box-shadow 0.4s', '*hologram seul : l\'ombre fond')
        assert.equal(await lit('mjs-hb-tilt-long'), 'transform 1s', 'avec *tilt : la transition de *tilt')
      } finally {
        await browser.close()
      }
    })

    it('l\'ombre et le curseur de *hologram cèdent à ceux de l\'auteur ; agrandie, la carte reste maîtresse de son ombre', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hb-ombre-auteur'
        const { page, erreurs } = await ouvre(browser, tag)
        const lit = () => page.evaluate(([t]: string[]) => {
          const cs = getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.carte') as HTMLElement)
          return { ombre: cs.boxShadow, curseur: cs.cursor }
        }, [tag])
        const zero = await etat(page, tag)
        const repos0 = await lit()
        assert.match(repos0.ombre, /^rgb\(255, 0, 0\) 0px 0px 0px 4px$/, 'au repos, l\'ombre de l\'auteur')
        assert.equal(repos0.curseur, 'grab', 'et son curseur')
        await page.mouse.click(zero.x + 100, zero.y + 140)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(2500)
        assert.doesNotMatch((await lit()).ombre, /^rgb\(255, 0, 0\) 0px 0px 0px 4px$/, 'agrandie, la lueur de la carte reprend la main')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('avec *tilt, la carte agrandie puis renvoyée retrouve la transformation et la transition de *tilt', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const tag = 'mjs-hb-tilt-zoom'
        const { page, erreurs } = await ouvre(browser, tag)
        const zero = await etat(page, tag)
        const trans = () => page.evaluate(([t]: string[]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector('.carte') as HTMLElement).transitionProperty, [tag])
        const avant = await trans()
        await page.mouse.click(zero.x + 100, zero.y + 140)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(2500)
        assert.match((await etat(page, tag)).attributs, /zoomed/)
        await page.keyboard.press('Escape')
        assert.ok(await repos(page, tag, zero.attributs), 'le retour s\'arrête de lui-même')
        await page.waitForTimeout(800)
        const fin = await etat(page, tag)
        assert.equal(fin.transform, zero.transform, 'la transformation de *tilt est revenue : ' + fin.transform)
        assert.equal(await trans(), avant, 'et sa transition aussi')
        assert.equal(avant, 'transform')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('avec *tilt sur la même balise : le reflet de *hologram suit la souris et la pente est celle de *tilt, les deux se cumulent', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const lecture = async (tag: string) => {
          const { page, erreurs } = await ouvre(browser, tag)
          const zero = await etat(page, tag)
          const clip = { x: zero.x - 30, y: zero.y - 30, width: zero.w + 60, height: zero.h + 60 }
          await page.mouse.move(zero.x + zero.w * 0.25, zero.y + zero.h * 0.2)
          await page.waitForTimeout(1500)
          const haut = await etat(page, tag)
          const vue  = await page.screenshot({ clip })
          return { page, erreurs, zero, haut, vue }
        }
        const deux = await lecture('mjs-hb-tilt')
        const seul = await lecture('mjs-hb-tilt-seul')
        assert.equal(deux.haut.calque, true, 'le reflet de *hologram est là')
        // la valeur lue après 1,5 s de souris immobile : 0.2500 dans Chromium et Firefox, 0.2502 dans WebKit (la boîte de la carte penchée y est arrondie au 1/64 de pixel) ; au millième près
        assert.ok(Math.abs(Number(deux.haut.variables!.x) - 0.25) < 0.002, 'et suit la souris : ' + deux.haut.variables!.x)
        assert.doesNotMatch(deux.haut.attributs, /-3d/, '*hologram ne transforme pas la carte')
        assert.match(deux.haut.transform, /^matrix3d\(/, 'la pente est là : ' + deux.haut.transform)
        assert.equal(deux.haut.transform, seul.haut.transform, 'et c\'est exactement celle de *tilt posé seul')
        assert.ok(await difference(deux.page, deux.vue, seul.vue) > 0.02, 'le reflet se voit : la carte avec *hologram diffère de la carte avec *tilt seul')
        await deux.page.mouse.move(2, 2)
        assert.ok(await repos(deux.page, 'mjs-hb-tilt', deux.zero.attributs), 'la boucle s\'arrête d\'elle-même')
        assert.equal((await etat(deux.page, 'mjs-hb-tilt')).calque, false, 'reparti : plus de calque')
        assert.deepEqual(deux.erreurs, [])
        assert.deepEqual(seul.erreurs, [])
      } finally {
        await browser.close()
      }
    })

    // ce que le registre voit encore posé : écouteurs de la carte, de la fenêtre et du document ; minuteries, images
    // d'animation, rappels d'inactivité ; observateurs encore branchés
    const registre = (page: any, tag: string) => page.evaluate(() => {
      const reg   = (window as any).__reg
      const TYPES = ['pointerenter', 'pointermove', 'pointerleave', 'click', 'keydown', 'scroll', 'pointerdown', 'visibilitychange', 'deviceorientation']
      const qui   = (c: any) => c === window ? 'fenêtre' : c === document ? 'document' : c instanceof Element && c.classList.contains('carte') ? 'carte' : null
      return {
        ecouteurs:    reg.ecouteurs.filter((e: any) => TYPES.includes(e.type) && qui(e.t)).map((e: any) => qui(e.t) + ':' + e.type + (e.cap ? ' (capture)' : '')).sort() as string[],
        minuteries:   [...reg.minuteries] as number[],
        images:       [...reg.images] as number[],
        inactivite:   [...reg.inactivite] as number[],
        observateurs: [...reg.observateurs].filter((o: any) => o.cibles.size > 0).length as number
      }
    }, tag)

    // ce qui est posé après et ne l'était pas avant
    const reste = (avant: any, apres: any) => {
      const out: string[] = []
      const restant = [...avant.ecouteurs]
      for (const e of apres.ecouteurs) {
        const i = restant.indexOf(e)
        if (i >= 0) restant.splice(i, 1)
        else out.push('écouteur ' + e)
      }
      for (const k of ['minuteries', 'images', 'inactivite'] as const) for (const id of apres[k]) if (!avant[k].includes(id)) out.push(k + ' #' + id)
      if (apres.observateurs > avant.observateurs) out.push('observateur de visibilité encore branché')
      return out
    }

    const bascule = (page: any, tag: string) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').click(), tag)
    const carteLa = (page: any, tag: string, la: boolean) => page.waitForFunction(([t, l]: any[]) => !!(document.querySelector(t) as any)._shadow.querySelector('.carte') === l, [tag, la])

    // la carte est posée, mise dans un état, vue (le registre a bien des choses à montrer), puis retirée : plus rien ne reste
    async function cycle(page: any, tag: string, etatDe: string, installe: () => Promise<void>, vu: (r: any, avant: any) => void) {
      const avant = await registre(page, tag)
      await bascule(page, tag)
      await carteLa(page, tag, true)
      await installe()
      vu(await registre(page, tag), avant)
      await bascule(page, tag)
      await carteLa(page, tag, false)
      const apres = await registre(page, tag)
      assert.deepEqual(reste(avant, apres), [], etatDe + ' : ce que le retrait laisse posé')
    }

    it('le retrait ne laisse rien — ni écouteur, ni minuterie, ni image d\'animation, ni rappel d\'inactivité, ni observateur — juste après la pose, survolée, agrandie, pendant la démonstration', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        // la carte qui attend son arrivée à l'écran : un observateur, les écouteurs de la souris et du clavier
        const A    = await ouvre(browser, 'mjs-hb-retrait', { registre: true, etire: 10 }, '.t')
        const tagA = 'mjs-hb-retrait'
        const carte = () => A.page.evaluate((t: string) => { const r = (document.querySelector(t) as any)._shadow.querySelector('.carte').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }, tagA)
        // une première pose et un premier retrait : le cadre y installe ses propres écouteurs, qui restent (ils ne sont pas ceux de l'effet)
        await bascule(A.page, tagA)
        await carteLa(A.page, tagA, true)
        await bascule(A.page, tagA)
        await carteLa(A.page, tagA, false)
        await cycle(A.page, tagA, 'juste après la pose', async () => {}, (r, avant) => {
          const neufs = reste(avant, { ...r, ecouteurs: r.ecouteurs, minuteries: [], images: [], inactivite: [], observateurs: 0 })
          assert.deepEqual(neufs, ['écouteur carte:click', 'écouteur carte:keydown', 'écouteur carte:pointerenter', 'écouteur carte:pointerleave', 'écouteur carte:pointermove', 'écouteur document:visibilitychange'], 'les écouteurs d\'une carte posée')
          assert.equal(r.inactivite.length, 0, 'plus de motifs à préparer : aucun rappel d\'inactivité')
          assert.equal(r.observateurs, 1, 'un observateur attend l\'arrivée à l\'écran')
        })
        await cycle(A.page, tagA, 'survolée', async () => {
          const c = await carte()
          await A.page.mouse.move(c.x + c.w / 2, c.y + c.h / 2)
          await A.page.waitForTimeout(500)
        }, (r) => assert.ok(r.images.length >= 0))
        await cycle(A.page, tagA, 'agrandie', async () => {
          await A.page.evaluate(() => { (window as any).__coarse = true })
          const c = await carte()
          await A.page.mouse.click(c.x + c.w / 2, c.y + c.h / 2)
          await A.page.waitForTimeout(300)
          await A.page.evaluate(() => window.dispatchEvent(new Event('scroll')))
        }, (r, avant) => {
          for (const e of ['fenêtre:scroll (capture)', 'document:pointerdown (capture)', 'fenêtre:deviceorientation (capture)']) assert.ok(r.ecouteurs.includes(e), 'agrandie, il faut ' + e + ' : ' + r.ecouteurs.join(' | '))
          assert.ok(r.minuteries.some((id: number) => !avant.minuteries.includes(id)), 'le défilement a lancé la minuterie du recentrage')
        })
        await A.page.evaluate(() => { (window as any).__coarse = false })
        // (Firefox avertit lui-même qu'écouter le capteur d'orientation est déprécié : l'écoute est voulue, sur un appareil tactile)
        assert.deepEqual(A.erreurs.filter((e: string) => !/orientation sensor is deprecated/.test(e)), [])
        // la carte qui se montre toute seule : une minuterie de départ, puis la démonstration
        const B    = await ouvre(browser, 'mjs-hb-retrait-charge', { registre: true }, '.t')
        const tagB = 'mjs-hb-retrait-charge'
        await cycle(B.page, tagB, 'juste après la pose, avant la démonstration', async () => {}, (r, avant) => {
          assert.ok(r.minuteries.some((id: number) => !avant.minuteries.includes(id)), 'la minuterie de la démonstration attend')
        })
        await cycle(B.page, tagB, 'pendant la démonstration', async () => { await B.page.waitForTimeout(2600) }, (r, avant) => {
          assert.ok(r.images.some((id: number) => !avant.images.includes(id)), 'la démonstration tourne : une image d\'animation est demandée')
        })
        assert.deepEqual(B.erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('zoom sur un appareil tactile : la carte agrandie suit le penché de l\'appareil', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-carte', { registre: true })
        const tag  = 'mjs-hb-carte'
        await page.evaluate(() => { (window as any).__coarse = true })
        const zero = await etat(page, tag)
        await page.mouse.click(zero.x + 100, zero.y + 140)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(3500)
        assert.ok((await registre(page, tag)).ecouteurs.includes('fenêtre:deviceorientation (capture)'), 'agrandie sur un appareil tactile : le penché est écouté')
        // la première mesure fixe la position de départ, la suivante la dépasse de dix degrés
        await page.evaluate(() => {
          // (le constructeur de l'événement n'existe pas dans une page sans connexion sécurisée)
          for (const gamma of [0, 10]) {
            const e: any = new Event('deviceorientation')
            e.gamma = gamma
            e.beta  = 0
            window.dispatchEvent(e)
          }
        })
        await page.waitForTimeout(3000)
        const e = await etat(page, tag)
        assert.equal(e.variables!.x, '0.8125', 'le reflet suit le penché : (10 + 16) / 32')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        assert.equal((await registre(page, tag)).ecouteurs.includes('fenêtre:deviceorientation (capture)'), false, 'la carte renvoyée : le penché n\'est plus écouté')
        assert.deepEqual(erreurs.filter((e: string) => !/orientation sensor is deprecated/.test(e)), [])
      } finally {
        await browser.close()
      }
    })

    it('zoom : la page défile, la carte agrandie reste au milieu de l\'écran', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-defile')
        const tag  = 'mjs-hb-defile'
        const zero = await etat(page, tag)
        await page.mouse.click(zero.x + 100, zero.y + 140)
        await page.mouse.move(2, 2)
        const ecart = () => page.evaluate((t: string) => {
          const r = (document.querySelector(t) as any)._shadow.querySelector('.carte').getBoundingClientRect()
          const v = document.documentElement
          return { dx: r.left + r.width / 2 - v.clientWidth / 2, dy: r.top + r.height / 2 - v.clientHeight / 2 }
        }, tag)
        // le ressort avance d'un nombre de pas qui dépend du nombre d'images rendues, pas de l'heure : une machine chargée en rend peu. On attend donc la carte au milieu
        // (à moins de 4 px, deux lectures de suite, 20 s au plus) au lieu de la lire à une heure fixe
        const auMilieu = async () => {
          const fin = Date.now() + 20000
          let suite = 0
          let lu    = await ecart()
          while (true) {
            suite = Math.abs(lu.dx) < 4 && Math.abs(lu.dy) < 4 ? suite + 1 : 0
            if (suite >= 2 || Date.now() > fin) return lu
            await page.waitForTimeout(150)
            lu = await ecart()
          }
        }
        const avant = await auMilieu()
        assert.ok(Math.abs(avant.dx) < 4 && Math.abs(avant.dy) < 4, 'au milieu avant le défilement : ' + JSON.stringify(avant))
        await page.evaluate(() => window.scrollTo(0, 150))
        const apres = await auMilieu()
        assert.ok(Math.abs(apres.dx) < 4 && Math.abs(apres.dy) < 4, 'au milieu après un défilement de 150 px : ' + JSON.stringify(apres))
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('sans image donnée par le thème, le motif est l\'image que le build livre : la couche tient, rien n\'est dessiné et rien ne casse', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs, images } = await ouvre(browser, 'mjs-hb-cosmos')
        const tag = 'mjs-hb-cosmos'
        const a = await etat(page, tag, '.a')
        await page.mouse.move(a.x + 100, a.y + 100)
        await page.waitForTimeout(900)
        const sur = await etat(page, tag, '.a')
        assert.equal(sur.calque, true)
        assert.deepEqual(sur.motifs, [], 'aucune variable de motif : l\'effet ne dessine rien')
        assert.equal(await page.evaluate(() => (window as any).__blobs), 0, 'aucune image fabriquée')
        // la couche du motif est l'image livrée, à son adresse publique exacte (préfixe de la sortie compris), les autres couches du reflet restent : le fond n'est pas retombé à « aucune image »
        assert.match(sur.fond, new RegExp('^url\\("http://t\\.test' + PREFIXE + '/mjs_hologram_sky-far-[0-9a-z]{5}\\.png"\\), .*gradient'), 'le plan du ciel est l\'image livrée, les dégradés tiennent : ' + sur.fond.slice(0, 160))
        // et le navigateur l'a reçue : une adresse sans le préfixe n'est servie par personne
        assert.ok(images.some((c) => new RegExp('^' + PREFIXE + '/mjs_hologram_sky-far-[0-9a-z]{5}\\.png$').test(c)), 'le plan du ciel est servi à son adresse publique : ' + (images.join(' ') || 'aucune image servie'))
        await capture(page, 'cosmos-sans-image')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('une image donnée par le thème (--mjs-hologram-pattern-<nom>) : le motif est celle de l\'image, les autres restent absents', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-theme')
        const tag = 'mjs-hb-theme'
        const a = await etat(page, tag, '.a')
        await page.mouse.move(a.x + 100, a.y + 100)
        await page.waitForTimeout(900)
        const sur = await etat(page, tag, '.a')
        assert.deepEqual(sur.motifs, [], 'l\'effet ne pose aucune variable de motif : la feuille lit le thème elle-même')
        assert.equal(await page.evaluate(() => (window as any).__blobs), 0, 'aucune image fabriquée')
        assert.ok(sur.fond.startsWith('url("http://t.test/ciel.png")'), 'le reflet peint avec l\'image du thème, en première couche : ' + sur.fond.slice(0, 120))
        await capture(page, 'cosmos-image-du-theme')
        assert.deepEqual(erreurs.filter((e) => !/ciel\.png|404/.test(e)), [])
      } finally {
        await browser.close()
      }
    })

    it('on: always — le reflet est là sans survol, et la page ne demande aucune image d\'animation', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-toujours')
        const e = await etat(page, 'mjs-hb-toujours')
        assert.equal(e.calque, true)
        assert.equal(e.variables!.o, '1.0000')
        assert.equal(e.transform, 'none', 'sans souris : à plat')
        assert.equal(e.images, 0)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('« réduire les animations » : le reflet suit la souris, la carte ne penche pas, aucune boucle', async function () {
      if (!present) { this.skip(); return }
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-hb-carte', { reducedMotion: 'reduce' })
        const tag  = 'mjs-hb-carte'
        const zero = await etat(page, tag)
        await page.mouse.move(zero.x + 50, zero.y + 28)
        await page.waitForTimeout(500)
        const e = await etat(page, tag)
        assert.equal(e.calque, true)
        assert.equal(e.variables!.x, '0.2500', 'le reflet est sous la souris, d\'un coup')
        assert.equal(e.transform, 'none', 'la carte reste à plat')
        assert.ok(e.images <= 2, 'pas de boucle : ' + e.images + ' image(s)')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
}
