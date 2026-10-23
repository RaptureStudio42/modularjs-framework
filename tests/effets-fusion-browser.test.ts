// *blend dans Chromium, Firefox et WebKit (Safari) réels : des pixels d'une capture. multiply assombrit,
// screen éclaircit, difference avec du blanc inverse ; la balise sans calque (mix-blend-mode) ; les
// trois formes du calque — couleur, dégradé, seconde image — sur une <img> (filtre SVG) ET sur une
// <div> à fond d'image (calque) : le résultat diffère des deux sources ; une image d'une autre origine ;
// les 16 modes sur une <img> (un filtre SVG invalide rend la balise invisible : on le voit au
// blanc de la page) ; le fondu au survol ; le retrait sans reste ; le centre de chaque balise de la
// page d'essai ; les écritures verticales, une cellule de tableau, une taille fractionnaire, une
// opacité qui change, une balise cachée puis montrée, un masque de coins redimensionné, un <svg>
// arrondi en ligne, une densité d'écran de 2.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG de w × h : `couleur(x, y)` rend [r, g, b] ; `uni` : d'une seule couleur, 8 × 8
function uni(r: number, g: number, b: number): Buffer { return png(8, 8, () => [r, g, b]) }
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

const GRIS  = uri(uni(180, 180, 180))
const ROUGE = uri(uni(255, 0, 0))
const BLEU  = uri(uni(0, 0, 255))
// 16 × 8 : rouge à gauche, bleu à droite (deux fois plus large que haute)
const MOITIES = uri(png(16, 8, (x) => x < 8 ? [255, 0, 0] : [0, 0, 255]))
// 8 × 8 : rouge à gauche, bleu à droite (la tuile d'une mosaïque)
const TUILE   = uri(png(8, 8, (x) => x < 4 ? [255, 0, 0] : [0, 0, 255]))
// 16 × 8 : blanc à gauche, noir à droite (une arête nette pour voir la frange du décalage des couleurs)
const BN      = uri(png(16, 8, (x) => x < 8 ? [255, 255, 255] : [0, 0, 0]))
const MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']

const BALISES = [
  '<div class="m" *blend(multiply, color: #808080)></div>',
  '<div class="s" *blend(screen, color: #808080)></div>',
  '<div class="d" *blend(difference, color: #ffffff)></div>',
  '<div class="nu" *blend(difference)></div>',
  `<img class="im" src="${GRIS}" alt="" *blend(multiply, color: #808080)>`,
  `<img class="is" src="${GRIS}" alt="" *blend(screen, color: #808080)>`,
  `<img class="id" src="${GRIS}" alt="" *blend(difference, color: #ffffff)>`,
  `<img class="ii" src="${ROUGE}" alt="" *blend(screen, image: '${BLEU}')>`,
  `<div class="di" *blend(screen, image: '${BLEU}')></div>`,
  `<img class="ix" src="${ROUGE}" alt="" *blend(screen, image: 'http://autre.test/bleu.png')>`,
  `<img class="ig" src="${ROUGE}" alt="" *blend(screen, colors: [#0000ff, #0000ff])>`,
  `<div class="dg" *blend(screen, colors: [#0000ff, #0000ff])></div>`,
  `<img class="ih" src="${GRIS}" alt="" *blend(multiply, color: #808080, on: hover, duration: 150ms)>`,
  `<img class="ir" src="${GRIS}" alt="" *blend(multiply, color: #808080, opacity: 0.5)>`,
  `<img class="ga" src="${GRIS}" alt="" *blend(normal, colors: [#000000, #ffffff], angle: 90)>`,
  `<div class="gd" *blend(normal, colors: [#000000, #ffffff], angle: 90)></div>`,
  `<img class="cv" src="${GRIS}" alt="" *blend(normal, image: '${MOITIES}', fit: cover)>`,
  `<div class="cd" *blend(normal, image: '${MOITIES}', fit: cover)></div>`,
  `<img class="ct" src="${GRIS}" alt="" *blend(normal, image: '${MOITIES}', fit: contain)>`,
  `<div class="cu" *blend(normal, image: '${MOITIES}', fit: contain)></div>`,
  `<img class="cl" src="${GRIS}" alt="" *blend(normal, image: '${MOITIES}', fit: contain, position: left)>`,
  `<div class="cm" *blend(normal, image: '${MOITIES}', fit: contain, position: left)></div>`,
  `<img class="rp" src="${GRIS}" alt="" *blend(normal, image: '${TUILE}', fit: repeat)>`,
  `<div class="rq" *blend(normal, image: '${TUILE}', fit: repeat)></div>`,
  `<img class="st" src="${GRIS}" alt="" *blend(normal, image: '${TUILE}', fit: stretch)>`,
  `<img class="fc" src="${GRIS}" alt="" *filter(invert) *blend(multiply, color: #808080)>`,
  `<img class="cc" src="${BN}" alt="" *chromatic(on: always, gap: 20) *blend(multiply, color: #808080)>`,
  `<img class="cx" src="${BN}" alt="" *blend(multiply, color: #808080) *chromatic(on: always, gap: 20)>`,
  `<img class="lq" src="${GRIS}" alt="" *liquid(on: always, strength: 10, rest: 1) *blend(multiply, color: #808080)>`,
  `<img class="lx" src="${GRIS}" alt="" *blend(multiply, color: #808080) *liquid(on: always, strength: 10, rest: 1)>`,
  `<img class="tr" src="${GRIS}" alt="" *chromatic(on: always, gap: 20) *liquid(on: always, strength: 10, rest: 1) *blend(multiply, color: #808080)>`,
  '<div class="us" *blend(screen, color: #808080, order: under)>███</div>',
  '<div class="ub" *blend(multiply, color: #808080, order: under)></div>',
  '<div class="uc" *blend(screen, color: #808080, order: under)><b>███</b></div>',
  '<div class="ug" *blend(screen, colors: [#808080, #808080], order: under)>███</div>',
  ...MODES.map((m) => `<img class="mo-${m}" src="${GRIS}" alt="" *blend(${m}, color: #3366cc)>`)
]

// order: under au bord de la boîte (coins arrondis, ombre, enfant qui déborde) ; un parent à filtre
const BORDS = [
  '<div class="ra" *blend(multiply, color: #808080, order: under)>x</div>',
  '<div class="sh" *blend(multiply, color: #ff0000, order: under)></div>',
  '<div class="ab" *blend(multiply, color: #ff0000, order: under)><i></i></div>',
  `<div class="pc" *chromatic(on: always, gap: 20)><img class="ec" src="${BN}" alt="" *blend(multiply, color: #808080)></div>`,
  '<div class="pl" *liquid(on: always, strength: 10, rest: 1)><div class="el" *blend(screen, color: #808080, order: under)>x</div></div>',
  '<p class="lg">Avant <span class="sp" *blend(multiply, color: #808080, order: under)>MMMMMM</span> après</p>',
  '<svg class="sv" width="100" height="60" *blend(multiply, color: #ff0000)><rect width="100" height="60" fill="#b4b4b4"></rect></svg>',
  `<img class="pa" src="${GRIS}" alt="" *blend(multiply, color: #ff0000)>`,
  `<img class="fr" src="${GRIS}" alt="" *blend(multiply, color: #ff0000)>`,
  '<svg class="vb" viewBox="0 0 24 24" width="100" height="60" *blend(multiply, color: #ff0000)><rect width="24" height="24" fill="#b4b4b4"></rect></svg>',
  `<p class="ligne"><img class="il" src="${GRIS}" alt="" *blend(multiply, color: #ff0000)></p>`,
  '<div class="gr" *blend(multiply, color: #ff0000, order: under)></div>',
  '<div class="pi" *blend(multiply, color: #ff0000, order: under)></div>'
]

// la justesse du calque : écritures verticales, cellule de tableau, taille fractionnaire (dans une grille à pistes entières :
// la position reste entière), balise cachée
// (display: none) puis montrée, <svg> arrondi en ligne, <img> arrondie que l'on redimensionne
const JUSTESSE = [
  '<div class="ev" *blend(multiply, color: #ff0000, order: under)></div>',
  '<div class="es" *blend(multiply, color: #ff0000, order: under)></div>',
  '<div class="el" *blend(multiply, color: #ff0000, order: under)></div>',
  '<div class="tw"><div class="tc" *blend(multiply, color: #ff0000, order: under)></div></div>',
  '<div class="fr"><div class="fs" *blend(multiply, color: #ff0000, order: under)></div><div class="fq" *blend(multiply, color: #ff0000, order: under)></div></div>',
  '<p class="ls">Avant <span class="hs" *blend(multiply, color: #ff0000, order: under)>MMMMMM</span> après</p>',
  '<p class="ln">T <svg class="si" width="100" height="60" *blend(multiply, color: #ff0000)><rect width="100" height="60" fill="#b4b4b4"></rect></svg> fin</p>',
  `<img class="rz" src="${GRIS}" alt="" *blend(multiply, color: #ff0000)>`
]

const SOURCES: Record<string, string> = {
  'fb-csp.mjs': '<img class="cs" src="/gris.png" alt="" *blend(multiply, color: #ff0000)>\n<style>\nimg\n  display: block\n  width: 100px\n  height: 60px\n  border-radius: 20px\n</style>\n',
  'fb-bords.mjs': BORDS.join('\n') + '\n<style>\ndiv\n  position: relative\n  width: 100px\n  height: 60px\n  margin: 0 0 40px 20px\n  color: #b4b4b4\n.ra\n  border-radius: 30px\n  background: #b4b4b4\n.sh\n  background: #ffffff\n  box-shadow: 14px 14px 0 #0000ff\n.ab\n  background: #ffffff\n  i\n    position: absolute\n    left: 100%\n    top: 0\n    width: 60px\n    height: 20px\n    background: #00ff00\n.pc, .pl\n  height: auto\n.el\n  margin: 0\nimg\n  display: block\n  width: 100px\n  height: 40px\n  margin: 0 0 20px 20px\n.lg\n  margin: 0 0 20px 20px\n  font: 24px/32px sans-serif\n  color: #b4b4b4\n.sp\n  background: #b4b4b4\n.sv\n  display: block\n  margin: 0 0 20px 20px\n  transform: scale(.5)\n  transform-origin: 0 0\n.fr\n  width: 100.5px\n  border-radius: 10px\n.vb\n  display: block\n  margin: 0 0 20px 20px\n.ligne\n  margin: 0 0 20px 20px\n  .il\n    display: inline\n    border-radius: 20px\n.gr\n  width: 400px\n  height: 200px\n  background: #b4b4b4\n  border-radius: 20px\n.pi\n  background: #b4b4b4\n  border-radius: 9999px\n</style>\n',
  'fb-page.mjs': BALISES.join('\n') + `\n<style>\ndiv, img\n  display: block\n  width: 100px\n  height: 40px\n  margin: 0 0 2px\n.m, .s, .d, .nu, .gd, .cd, .cu, .cm, .rq\n  background: #b4b4b4\n.us, .uc, .ug\n  color: #404040\n  font: 36px/40px sans-serif\n  overflow: hidden\n.ub\n  background: #b4b4b4\n.di\n  background: url('${ROUGE}') center / 100% 100%\n.dg\n  background: url('${ROUGE}') center / 100% 100%\n</style>\n`,
  'fb-retrait.mjs': `<script>\n$on = true\n</script>\n{if $on}<img class="r1" src="${GRIS}" alt="" *blend(multiply, color: #808080)>{end}\n{if $on}<div class="r2" *blend(screen, color: #0000ff)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\nimg, div\n  width: 100px\n  height: 40px\n</style>\n`,
  'fb-justesse.mjs': JUSTESSE.join('\n') + '\n<style>\ndiv, img\n  display: block\n  margin: 0 0 20px 20px\n.ev, .es, .el\n  width: 60px\n  height: 120px\n  background: #b4b4b4\n.ev\n  writing-mode: vertical-rl\n.es\n  writing-mode: sideways-rl\n.el\n  writing-mode: sideways-lr\n.tw\n  display: table\n.tc\n  display: table-cell\n  width: 91px\n  height: 27px\n  background: #b4b4b4\n  writing-mode: vertical-rl\n.fr\n  display: grid\n  grid-template-columns: 120px 120px\n  grid-template-rows: 80px\n.fs, .fq\n  width: 100.4px\n  height: 60.6px\n  margin: 0\n  background: #b4b4b4\n.fq\n  border-radius: 10px\n.ls, .ln\n  margin: 0 0 20px 20px\n.ls\n  font: 24px/32px sans-serif\n  color: #b4b4b4\n.hs\n  display: none\n  background: #b4b4b4\n.si\n  background: #b4b4b4\n  border-radius: 20px\n.rz\n  width: 100px\n  height: 60px\n  border-radius: 20px\n</style>\n',
  'fb-opacite.mjs': `<script>\n$op = 1\n</script>\n<img class="oi" src="${GRIS}" alt="" *blend(screen, color: #0000ff, opacity: $op)>\n<img class="pi" src="${GRIS}" alt="" *blend(screen, color: #0000ff, opacity: 0.5)>\n<div class="ob" *blend(multiply, color: #0000ff, order: under, opacity: $op)></div>\n<div class="pb" *blend(multiply, color: #0000ff, order: under, opacity: 0.5)></div>\n<div class="om" *blend(difference, opacity: $op)></div>\n<div class="pm" *blend(difference, opacity: 0.5)></div>\n<div class="ol" *blend(multiply, color: #0000ff, opacity: $op)></div>\n<div class="pl" *blend(multiply, color: #0000ff, opacity: 0.5)></div>\n<button class="t" @click={$op = 0.5}>t</button>\n<style>\nimg, div\n  display: block\n  width: 100px\n  height: 30px\n  margin: 0 0 10px 20px\n.ob, .om, .ol, .pb, .pm, .pl\n  background: #b4b4b4\n</style>\n`
}

// la page d'essai : le centre de chaque balise tel que Chromium le rend (le rendu de référence). Une
// balise blanche, c'est un filtre que le navigateur n'a pas su appliquer. Absents : les balises dont le
// centre tombe sur une arête (cadrages, mosaïque, franges), mesurées ailleurs
const CENTRES: Record<string, number[]> = {
  m: [90, 90, 90], s: [218, 218, 218], d: [75, 75, 75], nu: [75, 75, 75],
  im: [90, 90, 90], is: [218, 218, 218], id: [75, 75, 75],
  ii: [255, 0, 255], di: [255, 0, 255], ig: [255, 0, 255], dg: [255, 0, 255],
  ih: [180, 180, 180], ir: [135, 135, 135], ga: [129, 129, 129], gd: [128, 128, 128],
  cl: [0, 0, 255], cm: [0, 0, 255], fc: [38, 38, 38], lq: [90, 90, 90], lx: [90, 90, 90], tr: [90, 90, 90],
  us: [160, 160, 160], ub: [90, 90, 90], uc: [160, 160, 160], ug: [160, 160, 160],
  'mo-normal': [51, 102, 204], 'mo-multiply': [36, 72, 144], 'mo-screen': [195, 210, 240], 'mo-overlay': [135, 165, 225],
  'mo-darken': [51, 102, 180], 'mo-lighten': [180, 180, 204], 'mo-color-dodge': [225, 255, 255], 'mo-color-burn': [0, 68, 161],
  'mo-hard-light': [72, 144, 225], 'mo-soft-light': [148, 169, 201], 'mo-difference': [129, 78, 24], 'mo-exclusion': [159, 138, 96],
  'mo-hue': [180, 180, 180], 'mo-saturation': [180, 180, 180], 'mo-color': [147, 183, 255], 'mo-luminosity': [98, 98, 98]
}

type Echantillon = { r: number, g: number, b: number }

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*blend (${nom} réel) — des pixels`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-browser-' + nom)
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
    })

    after(async () => { await terminateSharedWorkerPool() })

    // `dpr` : la densité de l'écran (deviceScaleFactor) ; `init` : un script lancé avant ceux de la page
    async function ouvre(browser: any, tag: string, classe: string, opts: { dpr?: number, init?: string } = {}) {
      const page = await browser.newPage({ viewport: { width: 300, height: 1500 }, deviceScaleFactor: opts.dpr || 1 })
      const erreurs: string[] = []
      if (opts.init) await page.addInitScript(opts.init)
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      // une image d'une AUTRE origine, sans aucun en-tête CORS
      await page.route('http://autre.test/**', (route: any) => route.fulfill({ contentType: 'image/png', body: uni(0, 0, 255) }))
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
      await page.waitForFunction((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete), tag)
      await page.waitForTimeout(500)
      return { page, erreurs }
    }

    // la couleur moyenne (hors d'une marge de 8 px) de chaque balise demandée, par une capture
    // `classe:a:b` : seulement la bande de a à b (en parts de la largeur), sans marge
    async function vu(page: any, tag: string, classes: string[]): Promise<Record<string, Echantillon>> {
      const rects = await page.evaluate(([t, cs]: [string, string[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        return cs.map((spec) => {
          const [c, a, b] = spec.split(':')
          const r = sh.querySelector('.' + c).getBoundingClientRect()
          if (a === undefined) return { c: spec, x: r.left + 8, y: r.top + 8, w: r.width - 16, h: r.height - 16 }
          return { c: spec, x: r.left + r.width * +a, y: r.top + 8, w: r.width * (+b - +a), h: r.height - 16 }
        })
      }, [tag, classes])
      const png = await page.screenshot({ fullPage: true })
      return page.evaluate(async ([b64, rs]: [string, any[]]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const out: Record<string, any> = {}
        for (const r of rs) {
          const d = c.getImageData(Math.round(r.x), Math.round(r.y), Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h))).data
          let R = 0, G = 0, B = 0
          const n = d.length / 4
          for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2] }
          out[r.c] = { r: Math.round(R / n), g: Math.round(G / n), b: Math.round(B / n) }
        }
        return out
      }, [png.toString('base64'), rects])
    }

    const proche = (a: Echantillon, r: number, g: number, b: number, tol = 12) =>
      Math.abs(a.r - r) <= tol && Math.abs(a.g - g) <= tol && Math.abs(a.b - b) <= tol

    async function essai(fn: (page: any, erreurs: string[]) => Promise<void>, classe = 'm') {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-fb-page', classe)
        await fn(page, erreurs)
      } finally {
        await browser.close()
      }
    }

    it('multiply assombrit, screen éclaircit, difference avec du blanc inverse — sur une <div> (calque) et sur une <img> (filtre SVG)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['m', 's', 'd', 'im', 'is', 'id'])
        // gris source 180 ; multiply par 128 → 90 ; screen par 128 → 217 ; difference avec 255 → 75
        assert.ok(proche(v.m, 90, 90, 90), `multiply div : ${JSON.stringify(v.m)}`)
        assert.ok(proche(v.s, 217, 217, 217), `screen div : ${JSON.stringify(v.s)}`)
        assert.ok(proche(v.d, 75, 75, 75), `difference div : ${JSON.stringify(v.d)}`)
        assert.ok(proche(v.im, 90, 90, 90), `multiply img : ${JSON.stringify(v.im)}`)
        assert.ok(proche(v.is, 217, 217, 217), `screen img : ${JSON.stringify(v.is)}`)
        assert.ok(proche(v.id, 75, 75, 75), `difference img : ${JSON.stringify(v.id)}`)
      })
    })

    it('sans couleur : la balise se fond avec la page derrière elle (difference d\'un gris 180 sur du blanc → 75)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['nu'])
        assert.ok(proche(v.nu, 75, 75, 75), `usage 1 : ${JSON.stringify(v.nu)}`)
      })
    })

    it('deux images fusionnées (rouge + bleu en screen → magenta) sur une <img> ET sur une <div> à fond d\'image : ni l\'une ni l\'autre des sources', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['ii', 'di'])
        assert.ok(proche(v.ii, 255, 0, 255), `<img> : ${JSON.stringify(v.ii)}`)
        assert.ok(proche(v.di, 255, 0, 255), `<div> : ${JSON.stringify(v.di)}`)
      })
    })

    it('un dégradé (bleu uni, deux arrêts) fondu en screen avec du rouge → magenta, sur <img> et sur <div>', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['ig', 'dg'])
        assert.ok(proche(v.ig, 255, 0, 255), `<img> : ${JSON.stringify(v.ig)}`)
        assert.ok(proche(v.dg, 255, 0, 255), `<div> : ${JSON.stringify(v.dg)}`)
      })
    })

    it('une seconde image d\'une AUTRE origine, sans en-tête CORS, sur une <img> : ce qui arrive est mesuré', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page, erreurs) => {
        const v = await vu(page, 'mjs-fb-page', ['ix'])
        // la balise reste visible (jamais blanche) ; magenta si l'image distante est lue, rouge sinon
        assert.ok(!proche(v.ix, 255, 255, 255, 5), `la balise est devenue invisible : ${JSON.stringify(v.ix)} ${erreurs.join('|')}`)
        console.log(`    ℹ️  ${nom} : image d'une autre origine sur <img> → ${JSON.stringify(v.ix)}`)
      })
    })

    it('un dégradé à 90 degrés (noir → blanc) : sombre à gauche, clair à droite, pareil sur une <img> (filtre) et sur une <div> (calque)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['ga:0:0.2', 'ga:0.8:1', 'gd:0:0.2', 'gd:0.8:1'])
        assert.ok(v['ga:0:0.2'].r < 70 && v['ga:0.8:1'].r > 185, `<img> : ${JSON.stringify([v['ga:0:0.2'], v['ga:0.8:1']])}`)
        assert.ok(v['gd:0:0.2'].r < 70 && v['gd:0.8:1'].r > 185, `<div> : ${JSON.stringify([v['gd:0:0.2'], v['gd:0.8:1']])}`)
        assert.ok(Math.abs(v['ga:0:0.2'].r - v['gd:0:0.2'].r) < 20 && Math.abs(v['ga:0.8:1'].r - v['gd:0.8:1'].r) < 20, 'le filtre et le calque donnent le même dégradé')
      })
    })

    it('fit sur une image 2:1 dans une boîte 100 × 40 (2,5:1) : cover remplit, contain laisse des marges, position: left colle à gauche, stretch étire, repeat répète — <img> et <div>', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const bord = ['cv:0:0.04', 'cd:0:0.04', 'ct:0:0.04', 'cu:0:0.04', 'cl:0.96:1', 'cm:0.96:1', 'cl:0:0.04', 'cm:0:0.04', 'rp:0:0.2', 'rq:0:0.2', 'st:0:0.2']
        const v = await vu(page, 'mjs-fb-page', bord)
        const rouge = (c: Echantillon) => c.r > 240 && c.b < 15
        const gris  = (c: Echantillon) => proche(c, 180, 180, 180, 8)
        assert.ok(rouge(v['cv:0:0.04']), `cover img, bord gauche : ${JSON.stringify(v['cv:0:0.04'])}`)
        assert.ok(rouge(v['cd:0:0.04']), `cover div, bord gauche : ${JSON.stringify(v['cd:0:0.04'])}`)
        assert.ok(gris(v['ct:0:0.04']), `contain img centré, marge à gauche : ${JSON.stringify(v['ct:0:0.04'])}`)
        assert.ok(gris(v['cu:0:0.04']), `contain div centré, marge à gauche : ${JSON.stringify(v['cu:0:0.04'])}`)
        assert.ok(rouge(v['cl:0:0.04']) && gris(v['cl:0.96:1']), `contain img, position left : ${JSON.stringify([v['cl:0:0.04'], v['cl:0.96:1']])}`)
        assert.ok(rouge(v['cm:0:0.04']) && gris(v['cm:0.96:1']), `contain div, position left : ${JSON.stringify([v['cm:0:0.04'], v['cm:0.96:1']])}`)
        const mosaique = (c: Echantillon) => c.r > 80 && c.b > 80
        assert.ok(mosaique(v['rp:0:0.2']), `repeat img, plusieurs tuiles dans les 20 % de gauche : ${JSON.stringify(v['rp:0:0.2'])}`)
        assert.ok(mosaique(v['rq:0:0.2']), `repeat div : ${JSON.stringify(v['rq:0:0.2'])}`)
        assert.ok(rouge(v['st:0:0.2']), `stretch img : ${JSON.stringify(v['st:0:0.2'])}`)
      })
    })

    it('*filter + *blend sur la même <img> : les deux passent (invert 180 → 75, puis multiply par 128 → 38)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['fc'])
        assert.ok(proche(v.fc, 38, 38, 38, 10), `filter + blend : ${JSON.stringify(v.fc)}`)
      })
    })

    it('*chromatic, *liquid et *blend sur la même <img> : les trois se cumulent, dans les deux ordres d\'écriture', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page, erreurs) => {
        const filtres = await page.evaluate(() => {
          const sh: any = (document.querySelector('mjs-fb-page') as any)._shadow
          const f = (c: string) => getComputedStyle(sh.querySelector('.' + c)).filter
          return { cc: f('cc'), cx: f('cx'), lq: f('lq'), lx: f('lx'), tr: f('tr') }
        })
        for (const c of ['cc', 'cx']) assert.ok(filtres[c].includes('mjs-fx-chromatic') && filtres[c].includes('mjs-fx-blend'), `${c} : ${filtres[c]}`)
        for (const c of ['lq', 'lx']) assert.ok(filtres[c].includes('mjs-fx-liquid') && filtres[c].includes('mjs-fx-blend'), `${c} : ${filtres[c]}`)
        for (const k of ['chromatic', 'liquid', 'blend']) assert.ok(filtres.tr.includes('mjs-fx-' + k), `trois effets, ${k} : ${filtres.tr}`)
        const v = await vu(page, 'mjs-fb-page', ['cc:0.22:0.28', 'cc:0.37:0.45', 'cx:0.22:0.28', 'cx:0.37:0.45', 'lq', 'lx'])
        // le blanc multiplié par 128 → 128 : le blend agit ; la frange à gauche de l'arête : cyan × 128 = (0, 128, 128) : le décalage agit
        for (const c of ['cc', 'cx']) {
          const blanc = v[c + ':0.22:0.28']
          // dans Safari, de deux filtres enchaînés, le premier arrive décalé d'une douzaine de pixels dans le second
          // (le même décalage se voit avec *liquid, jamais avec *blend seul) : les franges de *chromatic n'y sont pas
          // au même endroit et le bleu mord déjà sur la zone blanche, seuls le rouge et le vert se comparent. Le calque
          // de *blend, lui, est exact : toute la boîte est multipliée par le gris
          if (nom === 'webkit') assert.ok(proche({ r: blanc.r, g: blanc.g, b: 128 }, 128, 128, 128, 14), `${c} : le blanc multiplié par le gris (rouge et vert) : ${JSON.stringify(blanc)}`)
          else {
            assert.ok(proche(blanc, 128, 128, 128, 14), `${c} : le blanc multiplié par le gris : ${JSON.stringify(blanc)}`)
            assert.ok(proche(v[c + ':0.37:0.45'], 0, 128, 128, 24), `${c} : la frange cyan multipliée : ${JSON.stringify(v[c + ':0.37:0.45'])}`)
          }
        }
        // le gris 180 multiplié par 128 → 90 : le blend agit aussi sous la déformation
        assert.ok(proche(v.lq, 90, 90, 90, 14), `liquid + blend : ${JSON.stringify(v.lq)}`)
        assert.ok(proche(v.lx, 90, 90, 90, 14), `blend + liquid : ${JSON.stringify(v.lx)}`)
        assert.deepEqual(erreurs.filter((e) => e.includes('*blend')), [], 'aucun avertissement de *blend')
      })
    })

    it('order: under sur une balise à contenu : le fond et le texte nu sont fondus par-dessus le calque (pas de calque qui remplace le fond)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['us:0.05:0.5', 'ub', 'uc:0.05:0.5', 'ug:0.05:0.5'])
        // texte #404040 en screen par-dessus le calque 128 → 160 (le texte nu non fondu resterait à 64)
        assert.ok(proche(v['us:0.05:0.5'], 160, 160, 160, 14), `texte nu : ${JSON.stringify(v['us:0.05:0.5'])}`)
        assert.ok(proche(v['uc:0.05:0.5'], 160, 160, 160, 14), `texte dans un enfant : ${JSON.stringify(v['uc:0.05:0.5'])}`)
        assert.ok(proche(v['ug:0.05:0.5'], 160, 160, 160, 14), `texte nu, dégradé : ${JSON.stringify(v['ug:0.05:0.5'])}`)
        // le fond #b4b4b4 en multiply par-dessus le calque 128 → 90 (le calque seul le remplacerait par 128)
        assert.ok(proche(v.ub, 90, 90, 90, 14), `fond : ${JSON.stringify(v.ub)}`)
      })
    })

    // la couleur d'un pixel, `classe:dx:dy` : à dx, dy du coin haut gauche de la balise ; la capture se lit
    // dans `lecteur` (une page sans politique de sécurité quand celle de l'essai refuse les images data:)
    async function points(page: any, tag: string, specs: string[], lecteur: any = page, dpr = 1): Promise<Record<string, Echantillon>> {
      const xy = await page.evaluate(([t, ss]: [string, string[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        return ss.map((spec) => {
          const [c, dx, dy] = spec.split(':')
          const r = sh.querySelector('.' + c).getBoundingClientRect()
          return { c: spec, x: Math.round(r.left + +dx), y: Math.round(r.top + +dy) }
        })
      }, [tag, specs])
      const png = await page.screenshot({ fullPage: true })
      return lecteur.evaluate(async ([b64, ps, k]: [string, any[], number]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const out: Record<string, any> = {}
        for (const p of ps) {
          const d = c.getImageData(p.x * k, p.y * k, 1, 1).data
          out[p.c] = { r: d[0], g: d[1], b: d[2] }
        }
        return out
      }, [png.toString('base64'), xy, dpr])
    }

    // une page de composant ouverte dans un navigateur neuf, refermé après `fn`
    async function avec(tag: string, classe: string, fn: (page: any, erreurs: string[]) => Promise<void>, opts: { dpr?: number, init?: string } = {}) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page, erreurs } = await ouvre(browser, tag, classe, opts)
        await fn(page, erreurs)
      } finally {
        await browser.close()
      }
    }

    it('order: under au bord de la boîte : le calque suit les coins arrondis, une ombre et un enfant qui débordent restent tels quels', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page } = await ouvre(browser, 'mjs-fb-bords', 'el')
        const v = await points(page, 'mjs-fb-bords', ['ra:2:2', 'ra:50:30', 'sh:50:30', 'sh:107:40', 'sh:107:5', 'ab:130:10', 'ab:130:40'])
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        assert.ok(proche(v['ra:2:2'], 255, 255, 255, 14), 'coin arrondi : la page, pas le calque — ' + dit('ra:2:2'))
        assert.ok(proche(v['ra:50:30'], 90, 90, 90, 14), 'dedans : le fond fondu (180 × 128) — ' + dit('ra:50:30'))
        assert.ok(proche(v['sh:50:30'], 255, 0, 0, 14), 'dedans : blanc × rouge — ' + dit('sh:50:30'))
        if (nom === 'webkit') {
          // Safari borne le calque à la boîte de référence, qui englobe ce qui déborde : l'ombre bleue est fondue
          // avec le calque rouge (multiply : noir), et le calque couvre le carré qui englobe l'ombre
          assert.ok(proche(v['sh:107:40'], 0, 0, 0, 14), 'Safari : l\'ombre est fondue avec le calque — ' + dit('sh:107:40'))
          assert.ok(proche(v['ab:130:10'], 0, 0, 0, 14), 'Safari : l\'enfant qui déborde est fondu avec le calque — ' + dit('ab:130:10'))
          return
        }
        assert.ok(proche(v['sh:107:40'], 0, 0, 255, 14), 'l\'ombre hors de la boîte reste bleue — ' + dit('sh:107:40'))
        assert.ok(proche(v['sh:107:5'], 255, 255, 255, 14), 'hors de la boîte et de l\'ombre : la page — ' + dit('sh:107:5'))
        assert.ok(proche(v['ab:130:10'], 0, 255, 0, 14), 'l\'enfant qui déborde reste vert — ' + dit('ab:130:10'))
        assert.ok(proche(v['ab:130:40'], 255, 255, 255, 14), 'sous l\'enfant, hors de la boîte : la page — ' + dit('ab:130:40'))
      } finally {
        await browser.close()
      }
    })

    it('un enfant *blend dans un parent *chromatic ou *liquid ne reprend pas le filtre du parent (variable héritée)', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page } = await ouvre(browser, 'mjs-fb-bords', 'el')
        const f = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fb-bords') as any)._shadow
          const de = (q: string) => getComputedStyle(sh.querySelector(q)).filter
          return { pc: de('.pc'), ec: de('.ec'), pl: de('.pl'), el: de('.el') }
        })
        assert.match(f.pc, /mjs-fx-chromatic/, 'le parent garde son filtre : ' + f.pc)
        assert.match(f.pl, /mjs-fx-liquid/, 'le parent garde son filtre : ' + f.pl)
        assert.match(f.ec, /^url\("?#mjs-fx-blend-\d+"?\)$/, 'l\'image : son filtre seul — ' + f.ec)
        assert.match(f.el, /^url\("?#mjs-fx-blend-\d+"?\)$/, 'la balise à contenu : son filtre seul — ' + f.el)
      } finally {
        await browser.close()
      }
    })

    it('le calque suit la balise dans les cas difficiles : en ligne, <svg> réduit, marge intérieure ajoutée, taille fractionnaire', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page } = await ouvre(browser, 'mjs-fb-bords', 'fr')
        // une marge intérieure ajoutée après coup : la boîte grandit, le calque suit
        await page.evaluate(() => { ((document.querySelector('mjs-fb-bords') as any)._shadow.querySelector('.pa') as any).style.padding = '0 0 0 30px' })
        await page.waitForTimeout(300)
        const v = await points(page, 'mjs-fb-bords', ['sp:20:16', 'sv:45:25', 'pa:120:20', 'fr:99:20', 'fr:50:39'])
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        assert.ok(proche(v['fr:99:20'], 180, 0, 0, 14), 'taille fractionnaire : la dernière colonne entière est fondue, sans couture — ' + dit('fr:99:20'))
        assert.ok(proche(v['fr:50:39'], 180, 0, 0, 14), 'taille fractionnaire : la dernière ligne aussi — ' + dit('fr:50:39'))
        assert.ok(proche(v['sp:20:16'], 90, 90, 90, 14), 'une balise en ligne : son fond fondu (180 × 128) — ' + dit('sp:20:16'))
        assert.ok(proche(v['sv:45:25'], 180, 0, 0, 14), 'le coin du <svg> réduit est fondu — ' + dit('sv:45:25'))
        assert.ok(proche(v['pa:120:20'], 180, 0, 0, 14), 'l\'image décalée par la marge est fondue jusqu\'au bout — ' + dit('pa:120:20'))
      } finally {
        await browser.close()
      }
    })

    it('le calque couvre la boîte et suit les coins comme CSS : <svg viewBox>, <img> en ligne, grande boîte, pilule', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page } = await ouvre(browser, 'mjs-fb-bords', 'pi')
        const v = await points(page, 'mjs-fb-bords', ['vb:95:55', 'il:2:2', 'il:50:30', 'gr:3:3', 'gr:20:1', 'gr:1:20', 'gr:200:100', 'pi:10:8', 'pi:2:2', 'pi:50:30'])
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        // un <svg viewBox="0 0 24 24"> de 100 × 60 : son coin bas droit (hors du dessin, transparent) a le calque
        assert.ok(proche(v['vb:95:55'], 255, 0, 0, 14), '<svg viewBox> : le calque couvre toute la boîte CSS — ' + dit('vb:95:55'))
        assert.ok(proche(v['il:2:2'], 255, 255, 255, 14), '<img> en ligne arrondie : le coin reste à la page — ' + dit('il:2:2'))
        assert.ok(proche(v['il:50:30'], 180, 0, 0, 14), '<img> en ligne : le milieu est fondu — ' + dit('il:50:30'))
        // une boîte de 400 × 200, rayon 20 px : l'arc reste un arc de 20 px (pas étiré)
        assert.ok(proche(v['gr:3:3'], 255, 255, 255, 14), 'grande boîte : dehors l\'arc — ' + dit('gr:3:3'))
        assert.ok(proche(v['gr:20:1'], 180, 0, 0, 20), 'grande boîte : le bord haut juste après l\'arc est fondu — ' + dit('gr:20:1'))
        assert.ok(proche(v['gr:1:20'], 180, 0, 0, 20), 'grande boîte : le bord gauche juste après l\'arc est fondu — ' + dit('gr:1:20'))
        assert.ok(proche(v['gr:200:100'], 180, 0, 0, 14), 'grande boîte : le milieu — ' + dit('gr:200:100'))
        // une pilule (9999px sur 100 × 60) : CSS réduit les rayons ensemble, des bouts en demi-cercle de 30 px
        assert.ok(proche(v['pi:10:8'], 180, 0, 0, 20), 'pilule : (10, 8) est dans le demi-cercle — ' + dit('pi:10:8'))
        assert.ok(proche(v['pi:2:2'], 255, 255, 255, 14), 'pilule : le coin reste à la page — ' + dit('pi:2:2'))
        assert.ok(proche(v['pi:50:30'], 180, 0, 0, 14), 'pilule : le milieu — ' + dit('pi:50:30'))
      } finally {
        await browser.close()
      }
    })

    it('une politique de sécurité qui refuse les images data: : la teinte reste (coins carrés), un avertissement le dit', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 300, height: 400 } })
        const dits: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'warning') dits.push(m.text()) })
        await page.route('http://t.test/**', (route: any) => {
          const url = route.request().url()
          if (url === 'http://t.test/gris.png') return route.fulfill({ contentType: 'image/png', body: uni(180, 180, 180) })
          if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({
            contentType: 'text/html',
            headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'" },
            body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fb-csp></mjs-fb-csp><script>${script}</script></body></html>`
          })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fb-csp') as any)?._shadow?.querySelector('.cs'))
        await page.waitForTimeout(800)
        const v = await points(page, 'mjs-fb-csp', ['cs:50:30'], await browser.newPage())
        assert.ok(proche(v['cs:50:30'], 180, 0, 0, 14), 'l\'image arrondie reste teintée : ' + JSON.stringify(v['cs:50:30']))
        const mes = dits.filter((t) => t.includes('*blend') && t.includes('img-src'))
        assert.equal(mes.length, 1, 'un seul avertissement : ' + JSON.stringify(dits))
        assert.match(mes[0], /Ajoutez|ajoutez|autorisez|Autorisez/, 'au vouvoiement')
      } finally {
        await browser.close()
      }
    })

    it('opacity: 0.5 — un multiply à moitié : entre la source (180) et le plein effet (90)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', ['ir'])
        assert.ok(proche(v.ir, 135, 135, 135, 14), `opacity 0.5 : ${JSON.stringify(v.ir)}`)
      })
    })

    it('les 16 modes sur une <img> : aucune balise ne devient invisible (un filtre SVG invalide la rend blanche)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fb-page', MODES.map((m) => 'mo-' + m))
        const rendu: string[] = []
        for (const m of MODES) {
          const c = v['mo-' + m]
          rendu.push(`${m} ${c.r},${c.g},${c.b}`)
          assert.ok(!proche(c, 255, 255, 255, 3), `${m} : balise blanche ou invisible (${JSON.stringify(c)})`)
        }
        // normal : le calque #3366cc couvre tout ; multiply le mélange au gris 180
        assert.ok(proche(v['mo-normal'], 0x33, 0x66, 0xcc, 6), `normal : ${JSON.stringify(v['mo-normal'])}`)
        assert.ok(proche(v['mo-multiply'], Math.round(180 * 0x33 / 255), Math.round(180 * 0x66 / 255), Math.round(180 * 0xcc / 255), 8), `multiply : ${JSON.stringify(v['mo-multiply'])}`)
        const autres = MODES.filter((m) => m !== 'normal' && !proche(v['mo-' + m], v['mo-normal'].r, v['mo-normal'].g, v['mo-normal'].b, 4))
        assert.ok(autres.length >= 14, `modes qui diffèrent de normal : ${autres.length} / 15 — ${rendu.join(' ; ')}`)
        console.log(`    ℹ️  ${nom} : ${rendu.join(' ; ')}`)
      })
    })

    it('on: hover sur une <img> : le fondu va au plein effet quand la souris est dessus, et revient', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await vu(page, 'mjs-fb-page', ['ih'])
        assert.ok(proche(avant.ih, 180, 180, 180), `au repos : ${JSON.stringify(avant.ih)}`)
        const r = await page.evaluate(() => { const b = (document.querySelector('mjs-fb-page') as any)._shadow.querySelector('.ih').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
        await page.mouse.move(r.x, r.y)
        await page.waitForTimeout(500)
        const dessus = await vu(page, 'mjs-fb-page', ['ih'])
        assert.ok(proche(dessus.ih, 90, 90, 90), `au survol : ${JSON.stringify(dessus.ih)}`)
        await page.mouse.move(250, 5)
        await page.waitForTimeout(500)
        const apres = await vu(page, 'mjs-fb-page', ['ih'])
        assert.ok(proche(apres.ih, 180, 180, 180), `après le survol : ${JSON.stringify(apres.ih)}`)
      })
    })

    it('le retrait de l\'effet ne laisse rien : ni filtre, ni calque, ni marque, ni variable', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page } = await ouvre(browser, 'mjs-fb-retrait', 'r1')
        const dedans = await page.evaluate(() => { const sh = (document.querySelector('mjs-fb-retrait') as any)._shadow; return { svg: sh.querySelectorAll('svg[mjs-fx-blend-svg]').length, calque: sh.querySelectorAll('[mjs-fx-layer="blend"]').length } })
        assert.deepEqual(dedans, { svg: 1, calque: 1 })
        await page.evaluate(() => (document.querySelector('mjs-fb-retrait') as any)._shadow.querySelector('.t').click())
        await page.waitForFunction(() => !(document.querySelector('mjs-fb-retrait') as any)._shadow.querySelector('.r1'))
        await page.waitForTimeout(100)
        const reste = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fb-retrait') as any)._shadow
          return { svg: sh.querySelectorAll('svg[mjs-fx-blend-svg]').length, calque: sh.querySelectorAll('[mjs-fx-layer]').length, marques: sh.querySelectorAll('[mjs-fx-blend-use],[mjs-fx]').length }
        })
        assert.deepEqual(reste, { svg: 0, calque: 0, marques: 0 })
      } finally {
        await browser.close()
      }
    })

    it('la page d\'essai : chaque balise a au centre ce que Chromium rend — jamais une balise blanche, WebKit compris', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const classes = Object.keys(CENTRES)
        const v = await points(page, 'mjs-fb-page', classes.map((c) => c + ':50:20'))
        const ecarts: string[] = []
        let pire = 0
        for (const c of classes) {
          const [r, g, b] = CENTRES[c]
          const e = v[c + ':50:20']
          pire = Math.max(pire, Math.abs(e.r - r), Math.abs(e.g - g), Math.abs(e.b - b))
          if (!proche(e, r, g, b, 14)) ecarts.push(`${c} ${e.r},${e.g},${e.b} au lieu de ${r},${g},${b}`)
        }
        assert.deepEqual(ecarts, [], 'balises qui ne rendent pas ce que Chromium rend')
        // les balises dont le centre tombe sur une arête : seulement relevées (Chromium : cv 106,0,149 ; cd 111,0,143 ; ct 100,0,155 ; cu 111,0,143 ; st 116,0,139)
        const aretes = ['cv', 'cd', 'ct', 'cu', 'st', 'rp', 'rq', 'cc', 'cx', 'ix']
        const w = await points(page, 'mjs-fb-page', aretes.map((c) => c + ':50:20'))
        console.log(`    ℹ️  ${nom} : ${classes.length} centres, écart le plus grand avec Chromium ${pire} niveaux ; sur une arête — ${aretes.map((c) => `${c} ${w[c + ':50:20'].r},${w[c + ':50:20'].g},${w[c + ':50:20'].b}`).join(' ; ')}`)
      })
    })

    it('writing-mode vertical-rl, sideways-rl et sideways-lr : la boîte 60 × 120 est teintée de bout en bout', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        const specs: string[] = []
        for (const c of ['ev', 'es', 'el']) for (const [x, y] of [[3, 3], [56, 3], [3, 116], [56, 116], [30, 60], [30, 100], [45, 20]]) specs.push(`${c}:${x}:${y}`)
        const v = await points(page, 'mjs-fb-justesse', specs)
        const ecarts = specs.filter((k) => !proche(v[k], 180, 0, 0, 14)).map((k) => `${k} ${v[k].r},${v[k].g},${v[k].b}`)
        assert.deepEqual(ecarts, [], 'points de la boîte qui ne sont pas fondus (180, 0, 0)')
      })
    })

    it('une cellule de tableau en écriture verticale (display: table-cell) : la boîte 91 × 27 est teintée de bout en bout, puis une fois redimensionnée', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        const specs = ['tc:3:3', 'tc:87:3', 'tc:3:23', 'tc:87:23', 'tc:45:13', 'tc:80:13', 'tc:60:20']
        const v = await points(page, 'mjs-fb-justesse', specs)
        const ecarts = specs.filter((k) => !proche(v[k], 180, 0, 0, 14)).map((k) => `${k} ${v[k].r},${v[k].g},${v[k].b}`)
        assert.deepEqual(ecarts, [], 'points de la cellule qui ne sont pas fondus (180, 0, 0)')
        // la cellule change de taille : Firefox donne alors sa taille dans l'écriture du tableau, pas dans la sienne
        await page.evaluate(() => { const c = (document.querySelector('mjs-fb-justesse') as any)._shadow.querySelector('.tc'); c.style.width = '81px'; c.style.height = '33px' })
        await page.waitForTimeout(500)
        const apres = ['tc:3:3', 'tc:77:3', 'tc:3:29', 'tc:77:29', 'tc:40:16']
        const w = await points(page, 'mjs-fb-justesse', apres)
        const encore = apres.filter((k) => !proche(w[k], 180, 0, 0, 14)).map((k) => `${k} ${w[k].r},${w[k].g},${w[k].b}`)
        assert.deepEqual(encore, [], 'points de la cellule redimensionnée (81 × 33) qui ne sont pas fondus (180, 0, 0)')
      })
    })

    it('une taille fractionnaire (100,4 × 60,6) : le calque est calé sur les pixels entiers que la boîte peint — dernière ligne et dernière colonne fondues, rien au-delà', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        const specs = ['fs:50:60', 'fs:99:30', 'fs:100:30', 'fs:50:61', 'fq:99:30', 'fq:100:30', 'fq:50:60', 'fq:30:60']
        const v = await points(page, 'mjs-fb-justesse', specs)
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        for (const k of ['fs:50:60', 'fs:99:30', 'fq:99:30']) assert.ok(proche(v[k], 180, 0, 0, 14), 'la boîte est fondue jusqu\'au bout — ' + dit(k))
        assert.ok(proche(v['fs:50:61'], 255, 255, 255, 14), 'rien sous la boîte — ' + dit('fs:50:61'))
        // Safari borne le calque à la boîte de référence, arrondie vers l'extérieur : une colonne de plus
        if (nom !== 'webkit') {
          assert.ok(proche(v['fs:100:30'], 255, 255, 255, 14), 'rien à droite de la boîte — ' + dit('fs:100:30'))
          assert.ok(proche(v['fq:100:30'], 255, 255, 255, 14), 'rien à droite de la boîte arrondie — ' + dit('fq:100:30'))
        }
        // Chromium rogne le masque des coins à la région du filtre, fractionnaire : sa dernière ligne reste à moitié fondue
        if (nom !== 'chromium') for (const k of ['fq:50:60', 'fq:30:60']) assert.ok(proche(v[k], 180, 0, 0, 14), 'la dernière ligne de la boîte arrondie — ' + dit(k))
      })
    })

    it('opacity: $op suit la variable sur place : un filtre (<img>, order: under), la balise sans couleur et le calque rejoignent leur jumelle fixe à 0,5', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-opacite', 't', async (page) => {
        const specs = ['oi', 'pi', 'ob', 'pb', 'om', 'pm', 'ol', 'pl'].map((c) => c + ':50:15')
        const avant = await points(page, 'mjs-fb-opacite', specs)
        assert.ok(proche(avant['oi:50:15'], 180, 180, 255, 10), `à 1, l'<img> a tout l'effet : ${JSON.stringify(avant['oi:50:15'])}`)
        assert.ok(proche(avant['pi:50:15'], 180, 180, 217, 10), `la jumelle fixe à 0,5 : ${JSON.stringify(avant['pi:50:15'])}`)
        await page.evaluate(() => (document.querySelector('mjs-fb-opacite') as any)._shadow.querySelector('.t').click())
        await page.waitForTimeout(1000)
        const apres = await points(page, 'mjs-fb-opacite', specs)
        const ecarts: string[] = []
        for (const [d, f] of [['oi', 'pi'], ['ob', 'pb'], ['om', 'pm'], ['ol', 'pl']]) {
          const a = apres[d + ':50:15']
          const j = apres[f + ':50:15']
          if (!proche(a, j.r, j.g, j.b, 8)) ecarts.push(`${d} ${a.r},${a.g},${a.b} au lieu de ${j.r},${j.g},${j.b}`)
        }
        assert.deepEqual(ecarts, [], 'balises qui n\'ont pas suivi $op')
      })
    })

    it('une balise en ligne cachée (display: none) puis montrée : le calque couvre toute sa région', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        const largeur = await page.evaluate(() => {
          const s = (document.querySelector('mjs-fb-justesse') as any)._shadow.querySelector('.hs')
          s.style.display = 'inline'
          return s.getBoundingClientRect().width
        })
        await page.waitForTimeout(700)
        assert.ok(largeur > 110, `la balise est plus large que le calque de repli (${largeur})`)
        const specs = ['hs:5:14', `hs:${Math.round(largeur / 2)}:14`, `hs:${Math.round(largeur - 6)}:14`]
        const v = await points(page, 'mjs-fb-justesse', specs)
        const ecarts = specs.filter((k) => !proche(v[k], 180, 0, 0, 14)).map((k) => `${k} ${v[k].r},${v[k].g},${v[k].b}`)
        assert.deepEqual(ecarts, [], 'points de la balise qui ne sont pas fondus (180, 0, 0)')
      })
    })

    it('au repos, aucune observation de visibilité n\'est posée ; une balise cachée en attend une, rendue dès qu\'elle est montrée', async function () {
      if (!present) { this.skip(); return }
      const init = 'window.__io = 0; const O = window.IntersectionObserver; window.IntersectionObserver = class extends O { observe(el) { if (el.hasAttribute("mjs-fx-blend-use")) { this.mien = true; window.__io++ } return super.observe(el) } disconnect() { if (this.mien) { this.mien = false; window.__io-- } return super.disconnect() } }'
      await avec('mjs-fb-retrait', 'r1', async (page) => {
        assert.equal(await page.evaluate(() => (window as any).__io), 0, 'rien n\'est observé quand toutes les balises sont visibles')
      }, { init })
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        assert.equal(await page.evaluate(() => (window as any).__io), 1, 'la balise cachée est seule observée')
        await page.evaluate(() => { ((document.querySelector('mjs-fb-justesse') as any)._shadow.querySelector('.hs') as any).style.display = 'inline' })
        await page.waitForTimeout(700)
        assert.equal(await page.evaluate(() => (window as any).__io), 0, 'montrée, elle n\'est plus observée')
      }, { init })
    })

    it('une <img> arrondie que l\'on redimensionne : le masque des coins suit la nouvelle taille', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        await page.evaluate(() => { const i = (document.querySelector('mjs-fb-justesse') as any)._shadow.querySelector('.rz'); i.style.width = '200px'; i.style.height = '120px' })
        await page.waitForTimeout(500)
        const v = await points(page, 'mjs-fb-justesse', ['rz:5:12', 'rz:100:60', 'rz:2:2', 'rz:197:117'])
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        // un rayon de 20 px : (5, 12) est dans l'arc ; un masque resté à 100 × 60 puis étiré à 200 × 120 le coupe
        assert.ok(proche(v['rz:5:12'], 180, 0, 0, 14), 'dans l\'arc de 20 px : fondu — ' + dit('rz:5:12'))
        assert.ok(proche(v['rz:100:60'], 180, 0, 0, 14), 'le milieu — ' + dit('rz:100:60'))
        assert.ok(proche(v['rz:2:2'], 255, 255, 255, 14), 'le coin haut gauche reste à la page — ' + dit('rz:2:2'))
        assert.ok(proche(v['rz:197:117'], 255, 255, 255, 14), 'le coin bas droit reste à la page — ' + dit('rz:197:117'))
      })
    })

    it('un <svg> arrondi en ligne : le coin reste à la page, le milieu est fondu', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-justesse', 'rz', async (page) => {
        const v = await points(page, 'mjs-fb-justesse', ['si:2:2', 'si:97:57', 'si:50:30', 'si:8:30', 'si:92:30'])
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        assert.ok(proche(v['si:2:2'], 255, 255, 255, 14), 'le coin haut gauche reste à la page — ' + dit('si:2:2'))
        assert.ok(proche(v['si:97:57'], 255, 255, 255, 14), 'le coin bas droit reste à la page — ' + dit('si:97:57'))
        for (const k of ['si:50:30', 'si:8:30', 'si:92:30']) assert.ok(proche(v[k], 180, 0, 0, 14), 'dans la boîte : fondu — ' + dit(k))
      })
    })

    it('une densité d\'écran de 2 : les coins arrondis, la pilule et la grande boîte tiennent, l\'arc reste net', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-bords', 'pi', async (page) => {
        const v = await points(page, 'mjs-fb-bords', ['gr:3:3', 'gr:20:1', 'gr:1:20', 'gr:200:100', 'pi:12:10', 'pi:2:2', 'pi:50:30', 'ra:2:2', 'ra:50:30'], page, 2)
        const dit = (k: string) => `${k} : ${JSON.stringify(v[k])}`
        assert.ok(proche(v['gr:3:3'], 255, 255, 255, 14), 'dehors l\'arc — ' + dit('gr:3:3'))
        assert.ok(proche(v['gr:20:1'], 180, 0, 0, 20), 'le bord haut juste après l\'arc — ' + dit('gr:20:1'))
        assert.ok(proche(v['gr:1:20'], 180, 0, 0, 20), 'le bord gauche juste après l\'arc — ' + dit('gr:1:20'))
        assert.ok(proche(v['gr:200:100'], 180, 0, 0, 14), 'le milieu — ' + dit('gr:200:100'))
        assert.ok(proche(v['pi:12:10'], 180, 0, 0, 20), 'pilule : dans le demi-cercle — ' + dit('pi:12:10'))
        assert.ok(proche(v['pi:2:2'], 255, 255, 255, 14), 'pilule : le coin reste à la page — ' + dit('pi:2:2'))
        assert.ok(proche(v['pi:50:30'], 180, 0, 0, 14), 'pilule : le milieu — ' + dit('pi:50:30'))
        assert.ok(proche(v['ra:2:2'], 255, 255, 255, 14), 'coin arrondi : la page — ' + dit('ra:2:2'))
        assert.ok(proche(v['ra:50:30'], 90, 90, 90, 14), 'dedans : le fond fondu — ' + dit('ra:50:30'))
        // le masque des coins est tramé à la densité de l'écran : 400 × 200 px CSS → 800 × 400 pixels d'écran
        const masque = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fb-bords') as any)._shadow
          const id = /#([\w-]+)/.exec(getComputedStyle(sh.querySelector('.gr')).filter)![1]
          return decodeURIComponent(sh.querySelector('#' + id + ' feImage').getAttribute('href').replace('data:image/svg+xml,', ''))
        })
        assert.match(masque, /width="800" height="400"/, 'le masque n\'est pas tramé à la densité de l\'écran : ' + masque.slice(0, 120))
        // l'arc du coin haut gauche de la grande boîte, lu pixel d'écran par pixel d'écran sur la diagonale :
        // trame du masque à la densité de l'écran, la bande de pixels à moitié fondus reste étroite
        const o = await page.evaluate(() => { const b = (document.querySelector('mjs-fb-bords') as any)._shadow.querySelector('.gr').getBoundingClientRect(); return { x: b.left, y: b.top } })
        const png = await page.screenshot({ fullPage: true })
        const bande = await page.evaluate(async ([b64, x0, y0]: [string, number, number]) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d') as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          let n = 0
          for (let i = 0; i < 40; i++) { const g = c.getImageData(x0 + i, y0 + i, 1, 1).data[1]; if (g > 38 && g < 217) n++ }
          return n
        }, [png.toString('base64'), Math.round(o.x * 2), Math.round(o.y * 2)])
        console.log(`    ℹ️  ${nom} : bande de l'arc à densité 2 → ${bande} pixels à moitié fondus`)
        assert.ok(bande <= 3, `l'arc est flou : ${bande} pixels à moitié fondus sur la diagonale`)
      }, { dpr: 2 })
    })
  })
}
