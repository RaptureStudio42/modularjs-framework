// *spotlight (halo) dans Chromium et Firefox réels : la lumière est rognée à l'arrondi de la balise, quelle qu'en soit l'écriture : un cercle
// (`50%`), des rayons différents d'un coin à l'autre et d'un axe à l'autre (`60px 20px 40px 10px / 30px 50px 20px 40px`), des pourcentages
// qui ne valent pas la même chose en largeur et en hauteur (`25% 10%`). Les coins que l'arrondi enlève gardent le fond de la page ; dedans, la
// lumière est rouge.

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

const FX = '*spotlight(where: fill, color: #f00, fill: 1, size: 400)'

// trois balises sur fond blanc, rouges de la souris jusqu'aux coins : sans rognage, les coins enlevés par l'arrondi seraient rouges
const PAGE = `<div class="cercle" ${FX}></div>\n`
  + `<div class="ellipses" ${FX}></div>\n`
  + `<div class="pourcents" ${FX}></div>\n`
  + '<style>\ndiv\n  margin: 20px\n  background: #fff\n'
  + '.cercle\n  width: 160px\n  height: 160px\n  border-radius: 50%\n'
  + '.ellipses\n  width: 240px\n  height: 120px\n  border-radius: 60px 20px 40px 10px / 30px 50px 20px 40px\n'
  + '.pourcents\n  width: 200px\n  height: 100px\n  border-radius: 25% 10%\n</style>\n'

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

describe('*spotlight : la lumière du halo est rognée à l\'arrondi de la balise, sous toutes ses écritures', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire('fx-spot-arrondi', PAGE)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de l'arrondi sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 400, height: 640 } })
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-arrondi></mjs-fx-spot-arrondi><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-arrondi') as any)?._shadow?.querySelector('.pourcents'))
        await page.waitForTimeout(600)
        return { ctx, page }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const b = (document.querySelector('mjs-fx-spot-arrondi') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height }
      }, sel)

      async function pixels(page: any, points: Array<[number, number]>) {
        const shot = (await page.screenshot()).toString('base64')
        return page.evaluate(async ({ data, pts }: any) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + data
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d') as CanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          return pts.map(([x, y]: number[]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
        }, { data: shot, pts: points })
      }

      const rouge = (p: number[]) => p[0] > 200 && p[1] < 190
      const blanc = (p: number[]) => Math.min(...p) >= 250
      const sans  = async (page: any, ctx: any) => { await page.close(); await ctx.close() }

      // [balise, coins enlevés par l'arrondi (x, y relatifs à la balise), points dedans, près des coins]
      for (const [sel, dehors, dedans] of [
        ['.cercle', [[2, 2], [158, 2], [2, 158], [158, 158]], [[80, 3], [3, 80], [80, 157], [157, 80]]],
        ['.ellipses', [[2, 2], [238, 2], [238, 118], [2, 118]], [[30, 10], [232, 40], [200, 112], [8, 100]]],
        ['.pourcents', [[2, 2], [198, 2], [198, 98], [2, 98]], [[30, 8], [195, 12], [170, 92], [5, 90]]]
      ] as const) {
        it(`${sel} : les coins que l'arrondi enlève gardent le fond de la page, la lumière est rouge dedans`, async function () {
          if (!present) return this.skip()
          const { ctx, page } = await ouvrir()
          try {
            const b = await boite(page, sel)
            await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 5 })
            await page.waitForTimeout(700)
            const px = await pixels(page, [...dehors, ...dedans].map(([x, y]) => [b.x + x, b.y + y] as [number, number]))
            px.slice(0, dehors.length).forEach((p: number[], i: number) => assert.ok(blanc(p), `${sel} : le coin à (${dehors[i]}) est enlevé par l'arrondi, le fond reste blanc : ${p}`))
            px.slice(dehors.length).forEach((p: number[], i: number) => assert.ok(rouge(p), `${sel} : le point à (${dedans[i]}) est dans la balise, la lumière y est rouge : ${p}`))
          }
          finally {
            await sans(page, ctx)
          }
        })
      }
    })
  }
})
