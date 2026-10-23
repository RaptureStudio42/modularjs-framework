// *liquid par carreaux, sous la souris, dans un Chromium et un Firefox réels : des pixels d'une capture. La zone autour
// de la souris change, tout le reste de l'image est identique à l'image au repos (la toile prend la place de l'image
// sans qu'on le voie), l'image redevient exactement celle d'avant quand la souris sort, le fantôme rouge se voit,
// `object-fit` est suivi, la bordure, le fond, l'ombre et le contour de l'image restent peints pendant la déformation,
// la toile est rognée et défilée comme l'image par ses ancêtres, une image d'une autre origine garde l'effet lisse,
// rien ne tourne au repos (toiles, contextes, images WebGL et animations comptés, avec ou sans radius), le plafond de
// contextes ne laisse aucune image morte, la console reste vide au premier survol (aucun avertissement du pilote graphique), le tampon de dessin n'est pas conservé (chaque image recouvre toute la toile) sans qu'aucune capture successive pendant le survol ne montre une image vide, hors écran aucune image n'est demandée, une seule image WebGL par image d'écran sans lecture de la mise en page, la réserve ne retient que 1 px. Sans WebGL dans le navigateur (pas de rendu logiciel), les essais sont sautés.
// MJS_FX_CAPTURES=<dossier> : les captures y sont aussi écrites en PNG.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// un PNG de w × h : `couleur(x, y)` rend [r, g, b]
function png(w: number, h: number, couleur: (x: number, y: number) => number[]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (x: Buffer) => { let c = 0xffffffff; for (const v of x) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 2
  const brut = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const c = couleur(x, y); brut[o] = c[0]; brut[o + 1] = c[1]; brut[o + 2] = c[2] }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}
const uri = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64')

// 160 × 120 : des rayures verticales noires et blanches de 8 px
const RAYURES = png(160, 120, (x) => (x >> 3) % 2 ? [255, 255, 255] : [0, 0, 0])
// 1200 × 800 : un grand rectangle blanc sur du vert sombre, réduit de plus de trois fois : ses quatre arêtes trahissent tout décalage
// ou étirement de la toile, sans dépendre de la façon dont chaque navigateur réduit une image
const ARETES  = png(1200, 800, (x, y) => x >= 300 && x < 900 && y >= 200 && y < 600 ? [255, 255, 255] : [0, 40, 0])
// 200 × 100 : un rectangle blanc sur du noir
const FORME   = png(200, 100, (x, y) => x >= 50 && x < 150 && y >= 30 && y < 70 ? [255, 255, 255] : [0, 0, 0])
// 200 × 100 : rouge jusqu'à x = 80, bleu ensuite
const DEUX    = png(200, 100, (x) => x < 80 ? [255, 0, 0] : [0, 0, 255])

const DEFAUT = 'animate: false, duration: 0ms'
// dix petites images côte à côte, chacune avec ces réglages
const DIX = (reglages: string) => Array.from({ length: 10 }, () => `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, ${reglages})>`).join('\n') + '\n<style>\n.l\n  display: inline-block\n  width: 60px\n  height: 40px\n  margin: 6px\n</style>\n'
const SOURCES: Record<string, string> = {
  'fq-plusieurs.mjs':          DIX('cells: 12'),
  'fq-plusieurs-fantome.mjs':  DIX('ghost: #f00'),
  'fq-toujours.mjs':           DIX(`cells: 12, ${DEFAUT}, on: always`),
  'fq-deco.mjs':       `<img class="l b1" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 40, ${DEFAUT})>\n<img class="l b2" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 40, ${DEFAUT})>\n<img class="l b3" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 40, ${DEFAUT})>\n<img class="l b4" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 40, ${DEFAUT})>\n<style>\n.l\n  display: inline-block\n  vertical-align: top\n  width: 100px\n  height: 60px\n  margin: 25px\n.b1\n  border: 6px solid #f0f\n  padding: 4px\n  background: #0f0\n  border-radius: 14px\n.b2\n  box-shadow: 0 0 0 10px #ff0\n.b3\n  outline: 4px solid #0ff\n  outline-offset: 3px\n.b4\n  box-shadow: 0 12px 24px rgba(0, 0, 0, .8)\n</style>\n`,
  'fq-carte.mjs':      `<div class="c"><img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})></div>\n<style>\n.c\n  width: 160px\n  height: 120px\n  margin: 40px\n  overflow: hidden\n  border-radius: 50px\n  background: #000\n.l\n  display: block\n  width: 100%\n  height: 100%\n  object-fit: cover\n</style>\n`,
  'fq-carte-relative.mjs': `<div class="c"><img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})></div>\n<style>\n.c\n  position: relative\n  width: 160px\n  height: 120px\n  margin: 40px\n  overflow: hidden\n  border-radius: 50px\n  background: #000\n.l\n  display: block\n  width: 100%\n  height: 100%\n  object-fit: cover\n</style>\n`,
  'fq-defile.mjs':     `<div class="s"><img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})><img class="m" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})></div>\n<style>\n.s\n  width: 200px\n  height: 130px\n  overflow-x: auto\n  white-space: nowrap\n  margin: 20px\n  background: #000\n.l, .m\n  display: inline-block\n  vertical-align: top\n  width: 160px\n  height: 110px\n</style>\n`,
  'fq-fraction.mjs':   `<div class="w"><img class="l" src="${uri(ARETES)}" alt="" *liquid(60, cells: 25, radius: 40, ${DEFAUT})></div>\n<style>\n.w\n  width: 83.3%\n  margin: 10.37px\n.l\n  display: block\n  width: 100%\n  background: #f0f\n</style>\n`,
  'fq-toujours-une.mjs': `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 12, on: always)>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-carreaux.mjs':   `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-boucle.mjs':     `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70)>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-lisse.mjs':      `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(40, radius: 70, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-fantome.mjs':    `<img class="l" src="${uri(FORME)}" alt="" *liquid(30, cells: 20, radius: 120, ghost: #f00, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-sans-fantome.mjs': `<img class="l" src="${uri(FORME)}" alt="" *liquid(30, cells: 20, radius: 120, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-couvre.mjs':     `<img class="l" src="${uri(DEUX)}" alt="" *liquid(60, cells: 25, radius: 25, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n  width: 100px\n  height: 100px\n  object-fit: cover\n</style>\n`,
  'fq-bord.mjs':       `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n  border: 6px solid #f0f\n  padding: 4px\n  border-radius: 14px\n  background: #0f0\n</style>\n`,
  'fq-echelle.mjs':    `<div class="c"><img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})></div>\n<style>\n.c\n  transform: scale(1.5)\n  transform-origin: 0 0\n  width: 160px\n  margin: 20px\n.l\n  display: block\n</style>\n`,
  'fq-autre.mjs':      `<img class="l" src="http://img.test/forme.png" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-divs.mjs':       `<div class="l" *liquid(60, cells: 12, ${DEFAUT})>a</div>\n<div class="l" *liquid(60, radius: 40, ${DEFAUT})>b</div>\n`,
  'fq-autres.mjs':     `<img class="l" src="http://img.test/forme.png" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})>\n<img class="l" src="http://img.test/forme2.png" alt="" *liquid(60, cells: 12, ${DEFAUT})>\n`,
  'fq-res1.mjs':       `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, resolution: 1, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-res4.mjs':       `<img class="l" src="${uri(RAYURES)}" alt="" *liquid(60, cells: 25, radius: 70, resolution: 4, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fq-cors.mjs':       `<img class="l" src="http://img.test/forme.png" crossorigin="anonymous" alt="" *liquid(60, cells: 25, radius: 70, ${DEFAUT})>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`
}

type Px = { w: number, h: number, d: number[] }

for (const nom of ['chromium', 'firefox'] as const) describe(`*liquid par carreaux, sous la souris (${nom} réel) — des pixels`, function () {
  this.timeout(180000)
  let present = false
  let script  = ''
  let browser: any = null
  let webgl   = false

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-liquide-carreaux-browser-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    // WebGL logiciel forcé (`--use-angle=swiftshader`) : sans lui, ce Chromium sans carte graphique compose la page en logiciel (gpu_compositing: disabled_software) et
    // relit chaque toile WebGL affichée, même vide (ReadPixels), ce que le pilote signale par « GPU stall due to ReadPixels » : un avertissement qui n'a rien à voir avec l'effet ;
    // avec lui SwiftShader tient lieu de carte graphique pour tout, composition comprise, et la console reste vide
    browser = nom === 'chromium' ? await playwright.chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }) : await playwright.firefox.launch()
    const page = await browser.newPage()
    webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))
    await page.close()
    if (!webgl) console.log(`  ℹ️  ce ${nom} n'a pas de WebGL (ni matériel, ni logiciel) : essais sautés`)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  // la page : fond gris ; les images de img.test viennent d'une autre origine (celle-ci annonce CORS)
  async function ouvre(tag: string, densite = 1, mesures = false, sansGl = false) {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: densite })
    const erreurs: string[] = []
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.addInitScript(() => {
      const w = window as any
      w.__d = 0
      w.__g = 0
      w.__r = 0
      const f = WebGLRenderingContext.prototype.drawArrays
      WebGLRenderingContext.prototype.drawArrays = function (this: any, ...a: any[]) { w.__d++; return (f as any).apply(this, a) }
      const c = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: any, kind: string, ...a: any[]) { if (/webgl/.test(kind)) w.__g++; return (c as any).call(this, kind, ...a) }
      const r = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__r++; return r(cb) }
    })
    // un navigateur sans WebGL : le contexte demandé ne vient pas
    if (sansGl) await page.addInitScript(() => {
      const c = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: any, kind: string, ...a: any[]) { return /webgl/.test(kind) ? null : (c as any).call(this, kind, ...a) }
    })
    // les instruments des essais du tampon de dessin, de la réserve et de la boucle : contextes et toiles créés, ce que chaque dessin recouvre (vue et ciseau), lectures de mise en page faites pendant une image d'animation, dessins par image
    if (mesures) await page.addInitScript(() => {
      const w = window as any
      w.__ctx    = []
      w.__toiles = []
      w.__couv   = []
      w.__lec    = 0
      w.__ir     = false
      w.__nd     = 0
      w.__dmax   = 0
      const c = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: any, kind: string, ...a: any[]) {
        const g = (c as any).call(this, kind, ...a)
        if (/webgl/.test(kind) && g && !w.__ctx.includes(g)) { w.__ctx.push(g); w.__toiles.push(this) }
        return g
      }
      const d = WebGLRenderingContext.prototype.drawArrays
      WebGLRenderingContext.prototype.drawArrays = function (this: any, ...a: any[]) {
        const cv = this.canvas
        const sc = this.isEnabled(this.SCISSOR_TEST) ? Array.from(this.getParameter(this.SCISSOR_BOX) as ArrayLike<number>) : [0, 0, cv.width, cv.height]
        w.__couv.push({ w: cv.width, h: cv.height, sc, vp: Array.from(this.getParameter(this.VIEWPORT) as ArrayLike<number>) })
        w.__nd++
        return (d as any).apply(this, a)
      }
      const r = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb: FrameRequestCallback) => r((t: number) => {
        w.__ir = true
        w.__nd = 0
        try { cb(t) } finally { w.__ir = false; w.__dmax = Math.max(w.__dmax, w.__nd) }
      })
      const lit = () => { if (w.__ir) w.__lec++ }
      const gb = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function (this: any) { lit(); return (gb as any).call(this) }
      const gs = window.getComputedStyle
      window.getComputedStyle = function (...a: any[]) { lit(); return (gs as any).apply(window, a) } as any
      for (const [proto, nom] of [[HTMLElement.prototype, 'offsetWidth'], [HTMLElement.prototype, 'offsetHeight'], [Element.prototype, 'clientWidth'], [Element.prototype, 'clientHeight']] as Array<[any, string]>) {
        const dsc = Object.getOwnPropertyDescriptor(proto, nom) as PropertyDescriptor
        Object.defineProperty(proto, nom, { configurable: true, get(this: any) { lit(); return (dsc.get as any).call(this) } })
      }
    })
    await page.route('http://img.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: FORME }))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#808080}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.l'), tag)
    // les images chargées
    await page.waitForFunction((t: string) => { const l = [...(document.querySelector(t) as any)._shadow.querySelectorAll('img')]; return l.every((i: any) => i.complete && i.naturalWidth > 0) }, tag)
    await page.waitForTimeout(150)
    return { page, erreurs, tag, sel: '.l', rang: 0 }
  }

  // l'image visée par boite, etat, vu et survole : le rang-ième élément de ce sélecteur
  const cible = (o: any, sel = '.l', rang = 0) => { o.sel = sel; o.rang = rang; return o }
  const boite = (o: any) => o.page.evaluate(([t, sel, rang]: any[]) => {
    const r = (document.querySelector(t) as any)._shadow.querySelectorAll(sel)[rang].getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, [o.tag, o.sel, o.rang])
  const etat = (o: any) => o.page.evaluate(([t, sel, rang]: any[]) => {
    const s = (document.querySelector(t) as any)._shadow
    const i = s.querySelectorAll(sel)[rang]
    const c = s.querySelector('canvas[mjs-fx-layer="liquid"]')
    const r = c ? c.getBoundingClientRect() : null
    return { toile: !!c, lisse: !!s.querySelector('svg[mjs-fx-liquid-svg]'), marques: i.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-liquid')), opacite: getComputedStyle(i).opacity, images: (window as any).__d, boite: r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null, rayon: c ? getComputedStyle(c).borderTopLeftRadius : '' }
  }, [o.tag, o.sel, o.rang])

  // la position du contenu de l'image dans sa boîte : poussée hors de la boîte pendant la déformation, seul le contenu est caché
  const contenu = (o: any) => o.page.evaluate(([t, sel, rang]: any[]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelectorAll(sel)[rang]).objectPosition, [o.tag, o.sel, o.rang])

  // à l'instant : toiles, filtres lisses, images cachées sous une toile, images sous un filtre, contextes WebGL ouverts, images WebGL peintes, animations demandées
  const compteurs = (o: any) => o.page.evaluate((t: string) => {
    const s = (document.querySelector(t) as any)._shadow
    const w = window as any
    return { toiles: s.querySelectorAll('canvas[mjs-fx-layer="liquid"]').length, lisses: s.querySelectorAll('svg[mjs-fx-liquid-svg]').length, cachees: s.querySelectorAll('img[mjs-fx-liquid-view]').length, filtrees: s.querySelectorAll('img[mjs-fx-liquid-on]').length, contextes: w.__g, images: w.__d, frames: w.__r }
  }, o.tag)

  // la capture de l'image (avec une marge), lue pixel par pixel
  async function vu(o: any, marge = 0, fichier = ''): Promise<Px> {
    const r = await boite(o)
    return lire(o, { x: Math.max(0, r.x - marge), y: Math.max(0, r.y - marge), width: r.width + 2 * marge, height: r.height + 2 * marge }, fichier)
  }
  async function lire(o: any, clip: { x: number, y: number, width: number, height: number }, fichier = ''): Promise<Px> {
    const buf = await o.page.screenshot({ clip })
    if (fichier && process.env.MJS_FX_CAPTURES) {
      mkdirSync(process.env.MJS_FX_CAPTURES, { recursive: true })
      writeFileSync(join(process.env.MJS_FX_CAPTURES, `${nom}-carreaux-${fichier}.png`), buf)
    }
    return o.page.evaluate(async (b64: string) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const c = cv.getContext('2d') as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      return { w: img.width, h: img.height, d: Array.from(c.getImageData(0, 0, cv.width, cv.height).data) }
    }, buf.toString('base64'))
  }
  // les pixels qui diffèrent, dans un rectangle (x0, y0) → (x1, y1) exclus ; sans rectangle : tout
  const ecart = (a: Px, b: Px, x0 = 0, y0 = 0, x1 = a.w, y1 = a.h) => {
    let n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 4
      if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) > 60) n++
    }
    return n
  }
  const pix = (p: Px, x: number, y: number) => [p.d[(y * p.w + x) * 4], p.d[(y * p.w + x) * 4 + 1], p.d[(y * p.w + x) * 4 + 2]]
  const compte = (p: Px, f: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < p.d.length; i += 4) if (f(p.d[i], p.d[i + 1], p.d[i + 2])) n++; return n }
  // la souris sur le point (px, py) de l'image : un premier pas pour entrer, puis le point
  async function survole(o: any, px: number, py: number) {
    const r = await boite(o)
    await o.page.mouse.move(r.x + px + 8, r.y + py + 8)
    await o.page.mouse.move(r.x + px, r.y + py, { steps: 3 })
    await o.page.waitForFunction((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('canvas[mjs-fx-layer="liquid"]'), o.tag)
    await o.page.waitForTimeout(200)
  }
  async function sort(o: any) {
    await o.page.mouse.move(395, 295, { steps: 3 })
    await o.page.waitForFunction((t: string) => !(document.querySelector(t) as any)._shadow.querySelector('canvas[mjs-fx-layer="liquid"]'), o.tag)
    await o.page.waitForTimeout(100)
  }

  it('carreaux sous la souris : la zone change, tout le reste est identique à l\'image au repos ; la souris sort : exactement l\'image d\'avant, rien ne reste', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-carreaux')
    try {
      const repos = await vu(o, 0, 'repos')
      assert.deepEqual(await etat(o), { toile: false, lisse: false, marques: [], opacite: '1', images: 0, boite: null, rayon: '' }, 'au repos : rien')
      await survole(o, 30, 30)
      const e = await etat(o)
      assert.ok(e.toile && !e.lisse, 'la toile, pas de filtre SVG')
      assert.equal(e.opacite, '1', 'l\'image garde son opacité : seul son contenu passe sous la toile')
      assert.match(await contenu(o), /^100000px/, 'le contenu de l\'image est poussé hors de sa boîte')
      assert.deepEqual(e.marques, ['mjs-fx-liquid-view'])
      const r = await boite(o)
      assert.ok(Math.abs(e.boite.x - r.x) < 0.5 && Math.abs(e.boite.y - r.y) < 0.5 && Math.abs(e.boite.width - r.width) < 0.5 && Math.abs(e.boite.height - r.height) < 0.5, `la toile tombe sur l'image : ${JSON.stringify(e.boite)} / ${JSON.stringify(r)}`)
      const survol = await vu(o, 0, 'survol')
      assert.ok(ecart(repos, survol, 0, 0, 80, 80) > 300, `pixels changés près de la souris : ${ecart(repos, survol, 0, 0, 80, 80)}`)
      // le bas droit est à plus de 90 px de la souris (rayon 70 + un carreau) : intact
      assert.ok(ecart(repos, survol, 110, 80, 160, 120) <= 50 * 40 * 0.01, `pixels changés loin de la souris : ${ecart(repos, survol, 110, 80, 160, 120)} / 2000`)
      assert.deepEqual((await o.page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelectorAll('svg').length, o.tag)), 0)
      await sort(o)
      assert.equal(await contenu(o), '50% 50%', 'le contenu de l\'image est revenu à sa place')
      const apres = await vu(o)
      assert.ok(ecart(repos, apres) <= 160 * 120 * 0.002, `redevenue exactement l'image d'avant : ${ecart(repos, apres)} pixels de différence`)
      assert.deepEqual(await etat(o), { toile: false, lisse: false, marques: [], opacite: '1', images: (await etat(o)).images, boite: null, rayon: '' })
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('rien ne tourne au repos : animate: false, souris immobile, puis sortie — aucune image WebGL de plus ; animate (le défaut) : une image par image d\'écran tant que la souris est là, plus aucune après', async function () {
    if (!present || !webgl) { this.skip(); return }
    const fixe = await ouvre('mjs-fq-carreaux')
    try {
      await survole(fixe, 30, 30)
      const a = (await etat(fixe)).images
      await fixe.page.waitForTimeout(400)
      assert.equal((await etat(fixe)).images, a, 'animate: false, souris immobile : des images ont été peintes')
      await sort(fixe)
      const b = (await etat(fixe)).images
      await fixe.page.waitForTimeout(400)
      assert.equal((await etat(fixe)).images, b, 'des images sont peintes après la sortie')
    } finally {
      await fixe.page.close()
    }
    const boucle = await ouvre('mjs-fq-boucle')
    try {
      await survole(boucle, 30, 30)
      const a = (await etat(boucle)).images
      await boucle.page.waitForTimeout(500)
      const b = (await etat(boucle)).images
      assert.ok(b - a >= 5, `les vagues bougent tant que la souris est là : ${b - a} images en 500 ms`)
      await sort(boucle)
      await boucle.page.waitForTimeout(200)
      const c = (await etat(boucle)).images
      await boucle.page.waitForTimeout(500)
      assert.equal((await etat(boucle)).images, c, 'la boucle ne s\'arrête pas toute seule après la sortie')
    } finally {
      await boucle.page.close()
    }
  })

  it('radius seul : une onde lisse sous la souris — la zone change, le reste est intact', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-lisse')
    try {
      const repos = await vu(o)
      await survole(o, 30, 30)
      const survol = await vu(o, 0, 'lisse')
      assert.ok(ecart(repos, survol, 0, 0, 80, 80) > 100, `pixels changés près de la souris : ${ecart(repos, survol, 0, 0, 80, 80)}`)
      assert.ok(ecart(repos, survol, 110, 80, 160, 120) <= 20, `pixels changés loin de la souris : ${ecart(repos, survol, 110, 80, 160, 120)}`)
    } finally {
      await o.page.close()
    }
  })

  it('ghost : un fantôme rouge de la forme blanche, décalé, dans la zone déformée — sans ghost, aucun rouge', async function () {
    if (!present || !webgl) { this.skip(); return }
    const rouge = (r: number, g: number, b: number) => r > 150 && g < 90 && b < 90
    const avec = await ouvre('mjs-fq-fantome')
    try {
      await survole(avec, 100, 50)
      const p = await vu(avec, 0, 'fantome')
      assert.ok(compte(p, rouge) > 150, `pixels rouges : ${compte(p, rouge)}`)
      assert.ok(compte(p, (r, g, b) => r > 230 && g > 230 && b > 230) > 300, 'la forme blanche reste lisible')
    } finally {
      await avec.page.close()
    }
    const sans = await ouvre('mjs-fq-sans-fantome')
    try {
      await survole(sans, 100, 50)
      assert.equal(compte(await vu(sans), rouge), 0, 'du rouge sans ghost')
    } finally {
      await sans.page.close()
    }
  })

  it('object-fit: cover suivi : la limite rouge / bleue de l\'image recadrée est à sa place, loin de la souris', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-couvre')
    try {
      const repos = await vu(o, 0, 'couvre-repos')
      // 200 × 100 recadrée à 100 × 100 : les x de 50 à 150 ; le rouge s'arrête à x = 80, donc à 30 px
      assert.deepEqual([pix(repos, 28, 90)[0], pix(repos, 33, 90)[2]], [255, 255], 'la limite attendue de l\'image seule')
      // la souris sur la limite rouge / bleue, en haut : c'est là que le décalage se voit
      await survole(o, 30, 10)
      const survol = await vu(o, 0, 'couvre')
      assert.ok(ecart(repos, survol, 0, 0, 60, 40) > 20, `la souris déforme la limite : ${ecart(repos, survol, 0, 0, 60, 40)} pixels changés`)
      assert.ok(ecart(repos, survol, 60, 60, 100, 100) <= 16, `loin de la souris : ${ecart(repos, survol, 60, 60, 100, 100)} pixels changés sur 1600`)
      assert.ok(pix(survol, 28, 90)[0] > 240 && pix(survol, 33, 90)[2] > 240, 'limite rouge / bleue à sa place sous la toile')
    } finally {
      await o.page.close()
    }
  })

  it('bordure, remplissage, arrondi : la toile tombe sur la boîte de contenu et prend son arrondi (celui de l\'image moins la bordure et la marge intérieure)', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-bord')
    try {
      await survole(o, 40, 40)
      const e = await etat(o)
      const r = await boite(o)
      // 6 px de bordure et 4 px de remplissage de chaque côté
      assert.ok(Math.abs(e.boite.x - (r.x + 10)) < 0.5 && Math.abs(e.boite.y - (r.y + 10)) < 0.5, `coin de la toile : ${JSON.stringify(e.boite)} / ${JSON.stringify(r)}`)
      assert.ok(Math.abs(e.boite.width - (r.width - 20)) < 0.5 && Math.abs(e.boite.height - (r.height - 20)) < 0.5, `taille de la toile : ${JSON.stringify(e.boite)}`)
      // l'arrondi de la boîte de contenu : 14 px moins 6 de bordure et 4 de marge intérieure
      assert.equal(e.rayon, '4px')
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('un ancêtre mis à l\'échelle (zoom d\'une carte au survol) : la toile tombe quand même sur l\'image, et le reste de l\'image est intact', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-echelle')
    try {
      const repos = await vu(o, 0, 'echelle-repos')
      await survole(o, 20, 20)
      const e = await etat(o)
      const r = await boite(o)
      assert.ok(Math.abs(r.width - 240) < 1, `l'image est bien grossie par l'ancêtre : ${r.width}`)
      assert.ok(Math.abs(e.boite.x - r.x) < 1 && Math.abs(e.boite.y - r.y) < 1 && Math.abs(e.boite.width - r.width) < 1 && Math.abs(e.boite.height - r.height) < 1, `la toile tombe sur l'image : ${JSON.stringify(e.boite)} / ${JSON.stringify(r)}`)
      const survol = await vu(o, 0, 'echelle')
      assert.ok(ecart(repos, survol, 0, 0, 120, 120) > 300, 'la zone change')
      assert.ok(ecart(repos, survol, 170, 130, 240, 180) <= 70 * 50 * 0.02, `loin de la souris : ${ecart(repos, survol, 170, 130, 240, 180)} pixels changés`)
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('une image d\'une autre origine : sans crossorigin elle garde l\'effet lisse d\'avant (filtre SVG, aucune toile) ; avec crossorigin et CORS annoncé, elle a la toile', async function () {
    if (!present || !webgl) { this.skip(); return }
    const a = await ouvre('mjs-fq-autre')
    try {
      assert.ok((await etat(a)).lisse, 'le filtre SVG d\'avant, posé d\'emblée')
      const r = await boite(a)
      await a.page.mouse.move(r.x + 30, r.y + 30, { steps: 3 })
      await a.page.waitForTimeout(300)
      const e = await etat(a)
      assert.ok(!e.toile && e.lisse, 'pas de toile sur une image illisible')
      // l'effet prévient, une fois, de ce qu'il fait à la place des carreaux
      assert.equal(a.erreurs.length, 1, a.erreurs.join(' | '))
      assert.match(a.erreurs[0], /\*liquid : cette image vient d'un autre site/)
    } finally {
      await a.page.close()
    }
    const b = await ouvre('mjs-fq-cors')
    try {
      await survole(b, 30, 30)
      const e = await etat(b)
      assert.ok(e.toile && !e.lisse, 'la toile, pas de filtre SVG')
      assert.deepEqual(b.erreurs, [], b.erreurs.join(' | '))
    } finally {
      await b.page.close()
    }
  })

  it('cells ou ghost sans radius, dix images : au repos ni toile, ni filtre, ni contexte, ni image WebGL, ni animation ; chaque image, la dernière aussi, se déforme à son tour au survol', async function () {
    if (!present || !webgl) { this.skip(); return }
    for (const tag of ['mjs-fq-plusieurs', 'mjs-fq-plusieurs-fantome']) {
      const o = await ouvre(tag)
      try {
        await o.page.mouse.move(395, 295)
        await o.page.waitForTimeout(500)
        const a = await compteurs(o)
        await o.page.waitForTimeout(500)
        const b = await compteurs(o)
        assert.deepEqual([b.toiles, b.lisses, b.cachees, b.filtrees, b.contextes, b.images], [0, 0, 0, 0, 0, 0], `${tag} : au repos, des toiles, des filtres, des contextes ou des images : ${JSON.stringify(b)}`)
        assert.equal(b.frames, a.frames, `${tag} : une animation tourne au repos`)
        for (const k of [0, 9]) {
          cible(o, '.l', k)
          const repos = await vu(o)
          await survole(o, 20, 15)
          const c = await compteurs(o)
          assert.equal(c.toiles, 1, `${tag} : image ${k + 1}, une seule toile pendant son survol : ${JSON.stringify(c)}`)
          assert.ok(ecart(repos, await vu(o)) > 40, `${tag} : l'image ${k + 1} ne se déforme pas au survol`)
          await sort(o)
          assert.equal((await compteurs(o)).toiles, 0, `${tag} : image ${k + 1}, la toile reste après la sortie`)
        }
        assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
      } finally {
        await o.page.close()
      }
    }
  })

  it('le plafond de contextes ne borne que les déformations simultanées : dix images actives en même temps (on: always) — huit toiles, les deux autres prennent le filtre lisse d\'avant, un seul avertissement, aucune image morte', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-toujours')
    try {
      await o.page.waitForTimeout(600)
      const c = await compteurs(o)
      assert.deepEqual([c.toiles, c.lisses], [8, 2], `huit toiles et deux filtres lisses : ${JSON.stringify(c)}`)
      assert.equal(c.cachees + c.filtrees, 10, `aucune image morte : chacune est sous une toile ou sous le filtre : ${JSON.stringify(c)}`)
      assert.ok(c.contextes <= 8, `contextes ouverts : ${c.contextes}`)
      const avis = o.erreurs.filter((e: string) => /\*liquid/.test(e))
      assert.equal(avis.length, 1, `un seul avertissement : ${JSON.stringify(avis)}`)
      assert.deepEqual(o.erreurs.filter((e: string) => !/\*liquid/.test(e)), [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('l\'image garde sa bordure, son fond, son ombre et son contour pendant la déformation : seul son contenu passe sous la toile', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-deco')
    try {
      const cas: Array<[string, string, (w: number, h: number) => number[][]]> = [
        ['.b1', 'bordure et fond', (w, h) => [[3, h / 2], [8, h / 2]]],
        ['.b2', 'ombre portée pleine', (w, h) => [[-5, h / 2], [w + 5, h / 2]]],
        ['.b3', 'contour', (w, h) => [[-5, h / 2], [w + 5, h / 2]]],
        ['.b4', 'ombre douce', (w, h) => [[w / 2, h + 8], [w / 2, h + 16]]]
      ]
      for (const [sel, nomCas, points] of cas) {
        cible(o, sel)
        await o.page.mouse.move(395, 295)
        await o.page.waitForTimeout(200)
        const r      = await boite(o)
        const repos  = await vu(o, 20)
        await survole(o, r.width / 2, r.height / 2)
        const survol = await vu(o, 20)
        assert.ok(ecart(repos, survol, 20 + 12, 20 + 12, 20 + r.width - 12, 20 + r.height - 12) > 30, `${nomCas} : le contenu ne se déforme pas`)
        for (const [x, y] of points(r.width, r.height)) {
          const avant = pix(repos, 20 + Math.round(x), 20 + Math.round(y))
          const apres = pix(survol, 20 + Math.round(x), 20 + Math.round(y))
          assert.ok(avant.every((v, k) => Math.abs(v - apres[k]) <= 3), `${nomCas} : le pixel (${Math.round(x)}, ${Math.round(y)}) passe de ${avant} à ${apres} pendant le survol`)
        }
        await sort(o)
      }
    } finally {
      await o.page.close()
    }
  })

  it('une carte qui rogne (overflow: hidden, coins arrondis), positionnée ou non : la toile est rognée comme l\'image, les coins restent ceux de la page', async function () {
    if (!present || !webgl) { this.skip(); return }
    for (const tag of ['mjs-fq-carte', 'mjs-fq-carte-relative']) {
      const o = await ouvre(tag)
      try {
        const r      = await boite(o)
        const coins  = [[3, 3], [r.width - 4, 3], [3, r.height - 4], [r.width - 4, r.height - 4]].map((c) => c.map(Math.round))
        const repos  = await vu(o)
        for (const [x, y] of coins) assert.deepEqual(pix(repos, x, y), [128, 128, 128], `${tag} : au repos, le coin (${x}, ${y}) est celui de la page`)
        await survole(o, 80, 60)
        const survol = await vu(o)
        assert.ok(ecart(repos, survol, 40, 20, 120, 100) > 200, `${tag} : la zone sous la souris ne change pas`)
        for (const [x, y] of coins) assert.deepEqual(pix(survol, x, y), [128, 128, 128], `${tag} : pendant le survol, le coin (${x}, ${y}) n'est plus celui de la page : la toile déborde du rognage arrondi`)
        assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
      } finally {
        await o.page.close()
      }
    }
  })

  it('un conteneur qui défile (overflow, non positionné) : la toile ne déborde pas du conteneur, et suit son défilement', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-defile')
    try {
      cible(o, '.m')
      const sc = await o.page.evaluate((t: string) => { const r = (document.querySelector(t) as any)._shadow.querySelector('.s').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } }, o.tag)
      const dehors = { x: sc.x + sc.width + 2, y: sc.y, width: 150, height: sc.height }
      const avant  = await lire(o, dehors)
      // la seconde image dépasse à droite du conteneur : la souris sur sa partie visible
      await survole(o, 12, 50)
      assert.ok(ecart(avant, await lire(o, dehors)) <= 10, 'hors du conteneur, rien ne doit changer : la toile dessine l\'image entière dans la page')
      await o.page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelector('.s').scrollLeft = 60 }, o.tag)
      await o.page.waitForTimeout(400)
      const suivi = await o.page.evaluate((t: string) => {
        const s = (document.querySelector(t) as any)._shadow
        return { toile: s.querySelector('canvas[mjs-fx-layer="liquid"]').getBoundingClientRect().left, image: s.querySelector('.m').getBoundingClientRect().left, defile: s.querySelector('.s').scrollLeft }
      }, o.tag)
      assert.equal(suivi.defile, 60)
      assert.ok(Math.abs(suivi.toile - suivi.image) < 1.5, `la toile suit le défilement du conteneur : toile ${suivi.toile}, image ${suivi.image}`)
      assert.ok(ecart(avant, await lire(o, dehors)) <= 10, 'après le défilement, rien ne doit non plus déborder du conteneur')
      await sort(o)
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('densité 2, boîte aux bords fractionnaires : la toile couvre toute la boîte de contenu (aucun liseré du fond de l\'image) et le contenu reste à moins de 2 pixels d\'écran de l\'image au repos', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-fraction', 2)
    try {
      const repos  = await vu(o)
      await survole(o, 6, 6)
      const survol = await vu(o)
      const fond   = (r: number, g: number, b: number) => r > 200 && g < 80 && b > 200
      assert.equal(compte(repos, fond), 0, 'au repos, le fond de l\'image est sous son contenu')
      assert.equal(compte(survol, fond), 0, 'pendant le survol, du fond de l\'image se voit : la toile ne couvre pas toute la boîte de contenu')
      // loin de la souris : les arêtes du rectangle ne bougent pas de plus de deux pixels d'écran (une texture étirée d'un pixel au plus), jamais d'un demi-écran
      const loin = ecart(repos, survol, 2 * 70, 0, repos.w, repos.h)
      assert.ok(loin <= (repos.w - 140) * repos.h * 0.015, `pixels changés loin de la souris : ${loin} sur ${(repos.w - 140) * repos.h}`)
    } finally {
      await o.page.close()
    }
  })

  it('le tampon de dessin n\'est pas conservé : chaque image recouvre toute la toile (le navigateur n\'a rien à recopier), et ce qui est affiché reste là sans nouveau dessin', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-carreaux', 1, true)
    try {
      const repos = await vu(o)
      await survole(o, 30, 30)
      const r = await boite(o)
      await o.page.mouse.move(r.x + 100, r.y + 70, { steps: 5 })
      await o.page.mouse.move(r.x + 40, r.y + 20, { steps: 5 })
      await o.page.waitForTimeout(300)
      const m = await o.page.evaluate(() => { const w = window as any; return { conserve: w.__ctx.map((g: any) => g.getContextAttributes().preserveDrawingBuffer), couv: w.__couv } })
      assert.deepEqual(m.conserve, [false], 'un seul contexte, qui ne conserve pas son tampon de dessin')
      assert.ok(m.couv.length >= 3, `des images ont été tracées : ${m.couv.length}`)
      for (const c of m.couv) {
        assert.deepEqual(c.vp, [0, 0, c.w, c.h], `la vue couvre la toile : ${JSON.stringify(c)}`)
        assert.deepEqual(c.sc, [0, 0, c.w, c.h], `l'image recouvre toute la toile, sans ciseau partiel : ${JSON.stringify(c)}`)
      }
      // animate: false et souris immobile : plus aucun dessin, la toile affichée doit rester celle du dernier (zone déformée, reste de l'image intact)
      const survol = await vu(o, 0, 'tampon')
      assert.ok(ecart(repos, survol, 0, 0, 90, 60) > 300, `pixels changés près de la souris : ${ecart(repos, survol, 0, 0, 90, 60)}`)
      assert.ok(ecart(repos, survol, 110, 80, 160, 120) <= 50 * 40 * 0.01, `pixels changés loin de la souris : ${ecart(repos, survol, 110, 80, 160, 120)} / 2000`)
    } finally {
      await o.page.close()
    }
  })

  // le tampon de dessin n'étant pas conservé, une toile qui serait affichée sans avoir été dessinée à nouveau serait vide : des captures à la suite, pendant la
  // boucle comme souris immobile, doivent toutes montrer l'image déformée près de la souris et celle du repos loin d'elle
  it('captures successives pendant le survol : aucune image vide ni noire entre deux dessins, la boucle en marche comme la souris immobile', async function () {
    if (!present || !webgl) { this.skip(); return }
    const defauts: string[] = []
    // la boucle en marche (animate) : une image dessinée à chaque image d'écran, les vagues bougent
    const o = await ouvre('mjs-fq-boucle')
    try {
      const repos = await vu(o)
      await survole(o, 30, 30)
      for (let k = 0; k < 14; k++) {
        const p    = await vu(o)
        const loin = ecart(repos, p, 110, 80, 160, 120)
        const pres = ecart(repos, p, 0, 0, 90, 60)
        if (loin > 20 || pres <= 300) defauts.push(`boucle, capture ${k} : ${loin} pixels changés loin de la souris (20 au plus), ${pres} près d'elle (plus de 300)`)
        await o.page.waitForTimeout(30)
      }
      assert.ok((await compteurs(o)).images >= 14, 'la boucle a bien dessiné pendant les captures')
    } finally {
      await o.page.close()
    }
    // souris immobile, animate: false : plus aucun dessin, la dernière image reste affichée, la même d'une capture à l'autre
    const q = await ouvre('mjs-fq-carreaux')
    try {
      const repos = await vu(q)
      await survole(q, 30, 30)
      const premiere = await vu(q)
      for (let k = 0; k < 8; k++) {
        await q.page.waitForTimeout(80)
        const p    = await vu(q)
        const loin = ecart(repos, p, 110, 80, 160, 120)
        const diff = ecart(premiere, p)
        if (loin > 20 || diff > 0) defauts.push(`souris immobile, capture ${k} : ${loin} pixels changés loin de la souris (20 au plus), ${diff} qui diffèrent de la première capture (aucun)`)
      }
    } finally {
      await q.page.close()
    }
    assert.deepEqual(defauts, [], defauts.join(' | '))
  })

  it('hors écran et au repos : aucune image demandée ; en marche : un seul dessin par image, aucune lecture de la mise en page dans la boucle', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-toujours-une', 1, true)
    try {
      await o.page.waitForFunction((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('canvas[mjs-fx-layer="liquid"]'), o.tag)
      await o.page.waitForTimeout(400)
      // en marche (les vagues bougent) : la pose a lu la mise en page une fois, la boucle ne lit plus rien et ne dessine qu'une fois par image
      await o.page.evaluate(() => { const w = window as any; w.__lec = 0; w.__dmax = 0 })
      const a = await compteurs(o)
      await o.page.waitForTimeout(700)
      const b = await compteurs(o)
      const boucle = await o.page.evaluate(() => { const w = window as any; return { lectures: w.__lec, plus: w.__dmax } })
      assert.ok(b.frames - a.frames >= 5, `la boucle tourne tant que l'image est à l'écran : ${b.frames - a.frames} images en 700 ms`)
      assert.equal(boucle.lectures, 0, 'des lectures de la mise en page (boîte, style calculé, dimensions) dans la boucle')
      assert.equal(boucle.plus, 1, 'plus d\'un dessin dans une même image')
      assert.ok(Math.abs((b.images - a.images) - (b.frames - a.frames)) <= 1, `un dessin par image demandée : ${b.images - a.images} dessins, ${b.frames - a.frames} images`)
      // hors écran : plus aucune image demandée
      await o.page.evaluate(() => { const s = document.createElement('div'); s.style.height = '3000px'; document.body.appendChild(s); window.scrollTo(0, 2000) })
      await o.page.waitForTimeout(500)
      const c = await compteurs(o)
      await o.page.waitForTimeout(600)
      assert.equal((await compteurs(o)).frames, c.frames, 'des images sont demandées pendant que l\'image est hors écran')
      // de retour à l'écran : la boucle repart
      await o.page.evaluate(() => window.scrollTo(0, 0))
      await o.page.waitForTimeout(600)
      assert.ok((await compteurs(o)).frames - c.frames >= 5, 'la boucle ne repart pas quand l\'image revient à l\'écran')
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  it('la déformation finie, le programme gardé en réserve ne retient plus la mémoire de la toile ni de l\'image (1 px), et reste utilisable à l\'entrée suivante', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-carreaux', 1, true)
    try {
      const taille = () => o.page.evaluate(() => { const c = (window as any).__toiles[0]; return [c.width, c.height] })
      await survole(o, 30, 30)
      assert.deepEqual(await taille(), [160, 120], 'pendant la déformation, la toile a la taille de l\'image')
      await sort(o)
      assert.deepEqual(await taille(), [1, 1], 'en réserve, la toile ne garde pas son tampon de dessin')
      const repos = await vu(o)
      await survole(o, 30, 30)
      assert.deepEqual(await taille(), [160, 120], 'à l\'entrée suivante, la même toile reprend la taille de l\'image')
      assert.equal((await compteurs(o)).contextes, 1, 'le même contexte et le même programme ont servi (rien n\'est recompilé)')
      assert.ok(ecart(repos, await vu(o)) > 300, 'la déformation se voit de nouveau')
    } finally {
      await o.page.close()
    }
  })

  it('la console reste vide à la première entrée de la souris et pendant que la déformation se trace : ni erreur, ni avertissement, pas même celui du pilote graphique (« GPU stall due to ReadPixels »)', async function () {
    if (!present || !webgl) { this.skip(); return }
    const o = await ouvre('mjs-fq-carreaux')
    try {
      // tous les types de message, y compris ceux que le pilote écrit (aucun filtre) ; l'écoute commence avant la première entrée
      const messages: string[] = []
      o.page.on('console', (m: any) => messages.push(`${m.type()} : ${m.text()}`))
      await survole(o, 30, 30)
      const r = await boite(o)
      await o.page.mouse.move(r.x + 70, r.y + 50, { steps: 6 })
      await o.page.mouse.move(r.x + 100, r.y + 70, { steps: 6 })
      // l'effet a tracé : des images WebGL ont été peintes, la toile est posée
      const e = await etat(o)
      assert.ok(e.toile && e.images > 0, `l'effet a tracé (toile ${e.toile}, images ${e.images})`)
      await o.page.waitForTimeout(600)
      await sort(o)
      assert.deepEqual(messages, [], `la console a reçu : ${messages.join(' | ')}`)
      assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
    } finally {
      await o.page.close()
    }
  })

  // les avertissements de l'effet, tels que la console les montre
  const dits = (o: any) => o.erreurs.filter((m: string) => /\*liquid/.test(m))
  const largeurToile = (o: any) => o.page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('canvas[mjs-fx-layer="liquid"]').width, o.tag)

  it('une balise qui n\'est pas une image : deux balises, un seul avertissement dans la console, qui dit la cause et le remède', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvre('mjs-fq-divs')
    try {
      await o.page.waitForTimeout(300)
      assert.equal((await etat(o)).lisse, true, 'le filtre lisse d\'avant')
      assert.equal(dits(o).length, 1, `un seul avertissement : ${JSON.stringify(dits(o))}`)
      assert.match(dits(o)[0], /<img>/)
      assert.match(dits(o)[0], /posez \*liquid sur une <img>/)
    } finally {
      await o.page.close()
    }
  })

  it('une image d\'un autre site sans crossorigin : deux images, un seul avertissement dans la console, qui nomme crossorigin', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvre('mjs-fq-autres')
    try {
      await o.page.waitForTimeout(300)
      assert.equal(dits(o).length, 1, `un seul avertissement : ${JSON.stringify(dits(o))}`)
      assert.match(dits(o)[0], /autre site/)
      assert.match(dits(o)[0], /crossorigin="anonymous"/)
    } finally {
      await o.page.close()
    }
  })

  it('un navigateur sans WebGL : à la première entrée de la souris, un seul avertissement dans la console (cause : WebGL), même avec deux images', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvre('mjs-fq-plusieurs', 1, false, true)
    try {
      assert.deepEqual(dits(o), [], 'rien avant l\'entrée de la souris')
      const r = await boite(o)
      await o.page.mouse.move(r.x + 10, r.y + 10, { steps: 3 })
      await o.page.waitForTimeout(300)
      await o.page.mouse.move(r.x + 80, r.y + 10, { steps: 3 })
      await o.page.waitForTimeout(300)
      assert.equal(dits(o).length, 1, `un seul avertissement : ${JSON.stringify(dits(o))}`)
      assert.match(dits(o)[0], /WebGL/)
      assert.match(dits(o)[0], /activez l'accélération matérielle/)
    } finally {
      await o.page.close()
    }
  })

  it('aucun avertissement quand la déformation par carreaux marche, ni quand l\'auteur n\'a demandé que l\'effet lisse', async function () {
    if (!present || !webgl) { this.skip(); return }
    const a = await ouvre('mjs-fq-carreaux')
    try {
      await survole(a, 30, 30)
      await sort(a)
      assert.deepEqual(dits(a), [])
    } finally {
      await a.page.close()
    }
    const b = await ouvre('mjs-fq-cors')
    try {
      await survole(b, 30, 30)
      assert.deepEqual(dits(b), [])
    } finally {
      await b.page.close()
    }
  })

  it('resolution : sur un écran de densité 2, la toile fait 1,5 fois la taille CSS par défaut, resolution: 1 la ramène à 1, resolution: 4 est bornée par l\'écran (2) ; sur un écran de densité 1 aucun réglage ne grossit la toile', async function () {
    if (!present || !webgl) { this.skip(); return }
    const lire1 = async (tag: string, densite: number) => {
      const o = await ouvre(tag, densite)
      try {
        await survole(o, 30, 30)
        return await largeurToile(o)
      } finally {
        await o.page.close()
      }
    }
    // l'image fait 160 × 120 px CSS
    assert.equal(await lire1('mjs-fq-carreaux', 2), 240, 'le défaut : 1,5 × 160')
    assert.equal(await lire1('mjs-fq-res1', 2), 160, 'resolution: 1')
    assert.equal(await lire1('mjs-fq-res4', 2), 320, 'resolution: 4, bornée par la densité 2 de l\'écran')
    assert.equal(await lire1('mjs-fq-res4', 1), 160, 'densité 1 : jamais plus que l\'écran')
  })
})
