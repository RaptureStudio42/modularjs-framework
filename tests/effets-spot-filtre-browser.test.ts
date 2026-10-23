// *filter(…, spot) dans Chromium et Firefox réels : ce qui se VOIT. Une image filtrée en noir et blanc montre
// ses couleurs sous la souris, une image floue y est nette ; le bord s'efface en douceur ; le double part
// après la sortie ; la zone ne dépasse pas le parent qui rogne, positionné ou non (un parent qui ne l'est
// pas l'est le temps du survol, puis rendu tel quel) ; la zone traîne derrière la souris puis la rejoint, et plus aucune image
// n'est demandée ; sans spot, rien n'est posé.

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

const svg    = (corps: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' shape-rendering='crispEdges'>${corps}</svg>`)
const ROUGE  = svg('<rect width="300" height="200" fill="#f00"/>')
// des bandes noires et blanches de 10 px : le flou les efface, la netteté les garde
const BANDES = svg('<rect width="300" height="200" fill="#fff"/>' + Array.from({ length: 15 }, (_, i) => `<rect x="${i * 20}" width="10" height="200" fill="#000"/>`).join(''))

// six cadres de 300 × 200 : zone au bord net, zone au bord doux, image floue, parent positionné qui rogne et arrondit, parent qui rogne sans être positionné, sans spot
const PAGE = `<div class="b1"><img class="a" *filter(grayscale, spot: 100, soft: 0, smooth: 1) src="${ROUGE}" alt="a"></div>\n`
  + `<div class="b2"><img class="b" *filter(grayscale, spot: 100, soft: 100, smooth: 1) src="${ROUGE}" alt="b"></div>\n`
  + `<div class="b3"><img class="c" *filter(blur: 6, spot: 100, soft: 0, smooth: 0.15) src="${BANDES}" alt="c"></div>\n`
  + `<div class="cadre"><img class="d" *filter(grayscale, spot: 100, soft: 0, smooth: 1) src="${ROUGE}" alt="d"></div>\n`
  + `<div class="rogneur"><img class="e" *filter(grayscale, spot: 100, soft: 0, smooth: 1) src="${ROUGE}" alt="e"></div>\n`
  + `<div class="b6"><img class="f" *filter(grayscale) src="${ROUGE}" alt="f"></div>\n`
  + '<style>\n.b1, .b2, .b3, .b6\n  width: 300px\n  height: 200px\n  margin: 10px\n'
  + '.cadre\n  position: relative\n  overflow: hidden\n  border-radius: 60px\n  width: 300px\n  height: 200px\n  margin: 10px\n'
  + '.rogneur\n  overflow: hidden\n  width: 300px\n  height: 200px\n  margin: 10px\n'
  + 'img\n  display: block\n  width: 300px\n  height: 200px\n</style>\n'

describe('*filter(…, spot) : ce qui se voit, dans de vrais navigateurs', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-spot-filtre-vue')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-spotf-vue.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de *filter(spot) sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 340, height: 1400 } })
        const page = await ctx.newPage()
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spotf-vue></mjs-fx-spotf-vue><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spotf-vue') as any)?._shadow?.querySelector('.f'))
        await page.waitForTimeout(500)
        return { ctx, page, erreurs }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-fx-spotf-vue') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }, sel)

      const copies = (page: any) => page.evaluate(() => (document.querySelector('mjs-fx-spotf-vue') as any)._shadow.querySelectorAll('[mjs-fx-filter-copy]').length)

      async function pixels(page: any, points: [number, number][]): Promise<number[][]> {
        const shot = await page.screenshot()
        return page.evaluate(async ([b64, pts]: [string, [number, number][]]) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width
          cv.height = img.height
          const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          return pts.map(([x, y]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
        }, [shot.toString('base64'), points])
      }

      const rouge = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60
      const gris  = (p: number[]) => Math.abs(p[0] - p[1]) < 8 && Math.abs(p[1] - p[2]) < 8 && p[0] > 20 && p[0] < 90

      it('une image en noir et blanc montre ses couleurs sous la souris, rien ailleurs ; sans souris, elle est grise partout', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page, erreurs } = await ouvrir()
        try {
          const a = await boite(page, '.a')
          const [avant] = await pixels(page, [[a.x + 150, a.y + 100]])
          assert.ok(gris(avant), `au repos, du gris : ${avant}`)
          assert.equal(await copies(page), 0, 'le double n\'existe pas au repos')
          await page.mouse.move(a.x + 100, a.y + 80, { steps: 3 })
          await page.waitForTimeout(400)
          assert.equal(await copies(page), 1, 'un seul double, pendant le survol')
          const [dedans, juste, loin, coin] = await pixels(page, [[a.x + 100, a.y + 80], [a.x + 100 + 40, a.y + 80], [a.x + 100 + 70, a.y + 80], [a.x + 290, a.y + 190]])
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
          assert.ok(rouge(juste), `à 40 px (rayon : 50), encore rouge : ${juste}`)
          assert.ok(gris(loin), `à 70 px, du gris : ${loin}`)
          assert.ok(gris(coin), `dans le coin, du gris : ${coin}`)
          await page.mouse.move(335, 1395, { steps: 2 })
          await page.waitForTimeout(600)
          assert.equal(await copies(page), 0, 'le double repart après la sortie')
          const [apres] = await pixels(page, [[a.x + 100, a.y + 80]])
          assert.ok(gris(apres), `et l'image est de nouveau grise : ${apres}`)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await ctx.close()
        }
      })

      it('le bord doux : net jusqu\'au rayon, puis la couleur s\'efface sur la largeur du bord', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const b = await boite(page, '.b')
          await page.mouse.move(b.x + 100, b.y + 100, { steps: 3 })
          await page.waitForTimeout(400)
          const [p25, p100, p160] = await pixels(page, [[b.x + 100 + 25, b.y + 100], [b.x + 100 + 100, b.y + 100], [b.x + 100 + 155, b.y + 100]])
          const teinte = (p: number[]) => p[0] - p[1]
          assert.ok(teinte(p25) > 200, `à 25 px : rouge franc (${p25})`)
          assert.ok(teinte(p100) > 60 && teinte(p100) < 190, `à 100 px, au milieu du bord (rayon 50 + 100) : entre les deux (${p100})`)
          assert.ok(teinte(p160) < 8, `à 155 px, au-delà du bord (50 + 100) : gris (${p160})`)
        }
        finally {
          await ctx.close()
        }
      })

      it('une image floue (blur: 6) est nette sous la souris, floue ailleurs', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const c = await boite(page, '.c')
          await page.mouse.move(c.x + 150, c.y + 100, { steps: 3 })
          await page.waitForTimeout(1500)
          // la bande noire de 140 à 150 et la blanche de 150 à 160 sont sous la souris ; la noire de 0 à 10 en est loin
          const [noir, blanc, loinNoir, loinBlanc] = await pixels(page, [[c.x + 145, c.y + 100], [c.x + 155, c.y + 100], [c.x + 25, c.y + 100], [c.x + 35, c.y + 100]])
          assert.ok(noir[0] < 25 && blanc[0] > 230, `sous la souris : net (${noir} / ${blanc})`)
          assert.ok(loinNoir[0] > 55 && loinBlanc[0] < 200, `ailleurs : flou (${loinNoir} / ${loinBlanc})`)
        }
        finally {
          await ctx.close()
        }
      })

      it('smooth: 0.15 : la zone traîne derrière la souris puis la rejoint ; la boucle s\'arrête, plus aucune image', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          await page.evaluate(() => {
            const w = window as any
            w.__images = 0
            const o = w.requestAnimationFrame
            w.requestAnimationFrame = (f: any) => { w.__images++; return o.call(w, f) }
          })
          const lire = () => page.evaluate(() => parseFloat((document.querySelector('mjs-fx-spotf-vue') as any)._shadow.querySelector('[mjs-fx-filter-lens]').style.getPropertyValue('translate')))
          const c = await boite(page, '.c')
          await page.mouse.move(c.x + 50, c.y + 100)
          assert.ok(Math.abs((await lire()) - 50) < 1, 'née sous la souris')
          await page.mouse.move(c.x + 250, c.y + 100)
          const tot = await lire()
          assert.ok(tot < 200, `juste après le saut de la souris, la zone traîne : ${tot}`)
          await page.waitForTimeout(1800)
          assert.ok(Math.abs((await lire()) - 250) < 0.6, 'elle a rejoint la souris')
          const avant = await page.evaluate(() => (window as any).__images)
          await page.waitForTimeout(500)
          assert.equal(await page.evaluate(() => (window as any).__images), avant, 'plus aucune image demandée une fois la souris rejointe')
        }
        finally {
          await ctx.close()
        }
      })

      it('dans un parent positionné qui rogne et arrondit : la zone ne dépasse pas l\'arrondi du parent', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const d = await boite(page, '.d')
          await page.mouse.move(d.x + 40, d.y + 40, { steps: 3 })
          await page.waitForTimeout(400)
          assert.equal(await copies(page), 1)
          // (5, 5) est hors du coin arrondi (rayon 60) mais à 49 px de la souris : dans le disque, le double l'y montrerait
          const [horsCoin, dedans] = await pixels(page, [[d.x + 5, d.y + 5], [d.x + 40, d.y + 40]])
          assert.ok(horsCoin.every((v) => v > 245), `hors du coin arrondi, le fond de la page : ${horsCoin}`)
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('dans un parent qui rogne sans être positionné : la zone se pose, sans déborder du parent, qui redevient non positionné ensuite', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const e = await boite(page, '.e')
          await page.mouse.move(e.x + 30, e.y + 100, { steps: 3 })
          await page.waitForTimeout(400)
          assert.equal(await copies(page), 1)
          // (e.x - 5) est hors du parent, à 35 px de la souris : dans le disque, le double l'y montrerait s'il débordait
          const [dedans, dehors] = await pixels(page, [[e.x + 30, e.y + 100], [e.x - 5, e.y + 100]])
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
          assert.ok(dehors.every((v) => v > 245), `hors du parent, le fond de la page : ${dehors}`)
          await page.mouse.move(335, 1395, { steps: 2 })
          await page.waitForTimeout(600)
          assert.equal(await copies(page), 0)
          const position = await page.evaluate(() => getComputedStyle((document.querySelector('mjs-fx-spotf-vue') as any)._shadow.querySelector('.rogneur')).position)
          assert.equal(position, 'static', 'le parent est rendu tel qu\'il était')
        }
        finally {
          await ctx.close()
        }
      })

      it('sans spot : aucun double, jamais, et le filtre est celui d\'avant', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const f = await boite(page, '.f')
          await page.mouse.move(f.x + 100, f.y + 80, { steps: 3 })
          await page.waitForTimeout(400)
          assert.equal(await copies(page), 0)
          const [p] = await pixels(page, [[f.x + 100, f.y + 80]])
          assert.ok(gris(p), `grise sous la souris : ${p}`)
        }
        finally {
          await ctx.close()
        }
      })
    })
  }
})
