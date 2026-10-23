// *filter(…, spot) dans Chromium et Firefox réels : le double non filtré a l'apparence de l'image d'origine (`object-fit`, arrondi, bordure…
// même quand une règle de l'auteur ne vise l'image que par son parent : `.cadre > img`), et il suit un mouvement de la balise lancé par
// `element.animate()` ou par une transition qui part en cours de survol, sans interroger les animations à chaque image : celui du cœur
// (`µ._mjs_animate`) la souris immobile, celui de l'auteur dès le mouvement suivant de la souris. Souris immobile, rien ne tourne : ni
// minuterie, ni relevé des animations, ni image demandée.

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

const svg   = (corps: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' shape-rendering='crispEdges'>${corps}</svg>`)
const ROUGE = svg('<rect width="300" height="200" fill="#f00"/>')

const FX = '*filter(grayscale, spot: 120, soft: 0, smooth: 1)'

// les minuteries vivantes, les relevés d'animations et les images demandées, comptés dans la page dès le départ
const COMPTEUR = `(function() {
  var vivantes = new Set();
  var si = window.setInterval;
  var ci = window.clearInterval;
  window.setInterval = function() { var id = si.apply(window, arguments); vivantes.add(id); return id; };
  window.clearInterval = function(id) { vivantes.delete(id); return ci.call(window, id); };
  window.__c = { releves: 0, images: 0, vivantes: function() { return vivantes.size; } };
  var ga = Element.prototype.getAnimations;
  Element.prototype.getAnimations = function() { window.__c.releves++; return ga.apply(this, arguments); };
  var raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function(f) { window.__c.images++; return raf.call(window, f); };
})();`

// deux scènes de 300 × 100 sur fond blanc : une image rognée (`cover`), arrondie et bordurée par des règles qui la visent par son parent ; une image qu'on anime
const PAGE = `<div class="cadre"><img class="ph" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="anim"><img class="pa" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + '<style>\n.cadre, .anim\n  position: relative\n  width: 300px\n  height: 100px\n  margin: 10px\n  background: #fff\n'
  + '.cadre > img\n  display: block\n  box-sizing: border-box\n  width: 300px\n  height: 100px\n  object-fit: cover\n  object-position: 20% 30%\n  border-radius: 40px\n  border: 2px solid #0a0\n'
  + '.anim > img\n  display: block\n  width: 300px\n  height: 100px\n</style>\n'

async function construire(nom: string, source: string): Promise<string> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('*filter(…, spot) : l\'apparence du double et le suivi d\'un mouvement lancé par animate()', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-suivi', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test du suivi sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir(init = '') {
        const ctx  = await browser.newContext({ viewport: { width: 400, height: 400 } })
        if (init) await ctx.addInitScript(init)
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-suivi></mjs-fx-spot-suivi><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-suivi') as any)?._shadow?.querySelector('.pa'))
        await page.waitForTimeout(600)
        return { ctx, page }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const b = (document.querySelector('mjs-fx-spot-suivi') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, sel)

      // l'écart de place entre le double et l'image, à l'écran (0 : le double est exactement sur elle), et le chemin que l'image a fait depuis x0
      const ecart = (page: any, sel: string, x0: number) => page.evaluate(([s, x]: [string, number]) => {
        const sh = (document.querySelector('mjs-fx-spot-suivi') as any)._shadow
        const i = sh.querySelector(s).getBoundingClientRect()
        const c = sh.querySelector('[mjs-fx-filter-copy]')
        if (!c) return { ecart: null, chemin: Math.abs(i.left - x) }
        const d = c.getBoundingClientRect()
        return { ecart: Math.max(Math.abs(d.left - i.left), Math.abs(d.top - i.top), Math.abs(d.width - i.width), Math.abs(d.height - i.height)), chemin: Math.abs(i.left - x) }
      }, [sel, x0])

      // le double suit : son retard sur l'image reste une petite part du chemin qu'elle a fait (un double qui ne suit pas a pris tout le chemin de retard)
      const suit = (vus: Array<{ ecart: number | null, chemin: number }>) => vus.every((v) => v.ecart !== null && v.ecart <= 0.3 * v.chemin + 1.5)
      const resume = (vus: Array<{ ecart: number | null, chemin: number }>) => vus.map((v) => (v.ecart === null ? 'aucun double' : v.ecart.toFixed(1) + '/' + v.chemin.toFixed(1))).join(', ')

      async function pixel(page: any, x: number, y: number) {
        const shot = (await page.screenshot()).toString('base64')
        return page.evaluate(async ({ data, px, py }: any) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + data
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d') as CanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          return Array.from(g.getImageData(Math.round(px), Math.round(py), 1, 1).data).slice(0, 3)
        }, { data: shot, px: x, py: y })
      }

      const sans = async (page: any, ctx: any) => { await page.close(); await ctx.close() }

      it('le double a l\'apparence de l\'image (object-fit, object-position, arrondi, bordure) même quand les règles la visent par son parent', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boite(page, '.ph')
          await page.mouse.move(b.x + 20, b.y + 20, { steps: 5 })
          await page.waitForTimeout(700)
          const r = await page.evaluate(() => {
            const sh = (document.querySelector('mjs-fx-spot-suivi') as any)._shadow
            const lire = (n: Element) => { const c = getComputedStyle(n); return { fit: c.objectFit, pos: c.objectPosition, rayon: c.borderTopLeftRadius, rayonBas: c.borderBottomRightRadius, bord: c.borderTopWidth + ' ' + c.borderTopColor } }
            return { image: lire(sh.querySelector('.ph')), double: lire(sh.querySelector('[mjs-fx-filter-copy]')) }
          })
          assert.deepEqual(r.double, r.image, 'le double a le style calculé de l\'image')
          assert.equal(r.image.fit, 'cover')
          assert.equal(r.image.rayon, '40px')
          // l'arrondi se voit : le coin que l'arrondi enlève reste le fond de la page (le double carré le recouvrirait de rouge)
          const coin = await pixel(page, b.x + 2, b.y + 2)
          assert.ok(Math.min(...coin) >= 250, 'dans le coin que l\'arrondi enlève, le fond reste blanc : ' + coin)
        }
        finally {
          await sans(page, ctx)
        }
      })

      for (const [titre, mode] of [['lancé par l\'auteur (element.animate), dès le mouvement suivant de la souris', 'auteur'], ['lancé par le cœur (µ._mjs_animate), la souris immobile', 'cœur']] as const) {
        it(`un mouvement ${titre}, est suivi par le double`, async function () {
          if (!present) return this.skip()
          const { ctx, page } = await ouvrir()
          try {
            const b = await boite(page, '.pa')
            await page.mouse.move(b.x + 250, b.y + 50, { steps: 5 })
            await page.waitForTimeout(700)
            await page.evaluate((m: string) => {
              const i = (document.querySelector('mjs-fx-spot-suivi') as any)._shadow.querySelector('.pa')
              const frames = [{ transform: 'translateX(0px)' }, { transform: 'translateX(120px)' }]
              const opts = { duration: 1000, fill: 'forwards' as const }
              ;(window as any).__anim = m === 'cœur' ? (window as any).µ._mjs_animate(i, frames, opts) : i.animate(frames, opts)
            }, mode)
            // ce que le script de l'auteur lance ne s'annonce par rien : le mouvement suivant de la souris le trouve
            if (mode === 'auteur') await page.mouse.move(b.x + 251, b.y + 51)
            const vus: Array<{ ecart: number | null, chemin: number }> = []
            for (const t of [250, 250, 250]) {
              await page.waitForTimeout(t)
              vus.push(await ecart(page, '.pa', b.x))
            }
            assert.ok(suit(vus), 'le double suit l\'image pendant le mouvement (écart/chemin) : ' + resume(vus))
          }
          finally {
            await sans(page, ctx)
          }
        })
      }

      it('la souris immobile sur l\'image : aucune minuterie vivante, aucun relevé des animations, aucune image demandée', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir(COMPTEUR)
        try {
          const b = await boite(page, '.pa')
          await page.mouse.move(b.x + 250, b.y + 50, { steps: 5 })
          await page.waitForTimeout(800)
          const lire = () => page.evaluate(() => {
            const w = window as any
            return { releves: w.__c.releves, images: w.__c.images, vivantes: w.__c.vivantes(), double: !!(document.querySelector('mjs-fx-spot-suivi') as any)._shadow.querySelector('[mjs-fx-filter-copy]') }
          })
          const a0 = await lire()
          assert.ok(a0.double, 'la souris est sur l\'image : le double est posé')
          await page.waitForTimeout(1500)
          const a1 = await lire()
          assert.equal(a1.vivantes, 0, 'aucune minuterie vivante pendant le survol')
          assert.equal(a1.releves - a0.releves, 0, 'aucun relevé des animations en 1,5 s de souris immobile : ' + (a1.releves - a0.releves))
          assert.equal(a1.images - a0.images, 0, 'aucune image demandée en 1,5 s de souris immobile : ' + (a1.images - a0.images))
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('une transition qui part en cours de survol (après les deux images de l\'entrée) est suivie jusqu\'au bout', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boite(page, '.pa')
          await page.mouse.move(b.x + 250, b.y + 50, { steps: 5 })
          await page.waitForTimeout(700)
          await page.evaluate(() => {
            const i = (document.querySelector('mjs-fx-spot-suivi') as any)._shadow.querySelector('.pa')
            i.style.transition = 'transform 1s linear'
            void getComputedStyle(i).transform
            i.style.transform = 'translateX(120px)'
          })
          const vus: Array<{ ecart: number | null, chemin: number }> = []
          for (const t of [300, 300, 300]) {
            await page.waitForTimeout(t)
            vus.push(await ecart(page, '.pa', b.x))
          }
          assert.ok(suit(vus), 'le double suit l\'image pendant la transition (écart/chemin) : ' + resume(vus))
        }
        finally {
          await sans(page, ctx)
        }
      })
    })
  }
})
