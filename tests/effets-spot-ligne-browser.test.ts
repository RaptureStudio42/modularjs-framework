// *spotlight sur une balise en ligne (un lien, un composant : sa boîte intérieure n'a pas de taille) dans Chromium et Firefox réels : le halo s'y
// voit comme avant, sur une ligne, sous la souris, et il la suit. Une balise qui a une taille intérieure (un bloc, un
// « inline-block ») garde le halo déplacé par l'animation de son pseudo-élément.

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

const FX = '*spotlight(where: fill, color: #f00, fill: 1, size: 90)'

// trois scènes sur fond blanc : un lien sur une ligne, un composant (en ligne par défaut), un « inline-block »
const PAGE = `<p class="texte">Un texte <a class="lien" ${FX}>un lien en ligne avec un halo</a> qui continue sur la ligne.</p>\n`
  + `<p class="texte">Un composant <@fx-spot-ligne-pastille class="pastille" ${FX}></@fx-spot-ligne-pastille> en ligne.</p>\n`
  + `<p class="texte">Un bloc <span class="bloc" ${FX}>en ligne-bloc</span> pour comparer.</p>\n`
  + '<style>\np\n  margin: 0\n  padding: 14px 10px\n  background: #fff\n  color: #000\n  font: 16px/1.4 sans-serif\n'
  + '.lien, .pastille\n  padding: 4px 8px\n'
  + '.pastille\n  display: inline\n'
  + '.bloc\n  display: inline-block\n  padding: 4px 8px\n</style>\n'

const SOURCES: Record<string, string> = {
  'fx-spot-ligne': PAGE,
  'fx-spot-ligne-pastille': '<span class="dedans">pastille en ligne</span>\n'
}

async function construire(): Promise<string> {
  const root   = mjsTmp('fx-spot-ligne')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('*spotlight : le halo d\'une balise en ligne', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    script = await construire()
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test du halo en ligne sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 500, height: 400 } })
        const page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-ligne></mjs-fx-spot-ligne><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-ligne') as any)?._shadow?.querySelector('.bloc'))
        await page.waitForTimeout(600)
        return { ctx, page }
      }

      // la boîte d'une balise et celle de chacune de ses lignes (une balise en ligne qui passe à la ligne en a plusieurs)
      const boites = (page: any, sel: string) => page.evaluate((s: string) => {
        const e = (document.querySelector('mjs-fx-spot-ligne') as any)._shadow.querySelector(s)
        const b = e.getBoundingClientRect()
        return { x: b.left, y: b.top, w: b.width, h: b.height, lignes: Array.from(e.getClientRects()).map((r: any) => ({ x: r.left, y: r.top, w: r.width, h: r.height })) }
      }, sel)

      // la capture de la fenêtre, relue pixel par pixel dans la page : [r, g, b] aux points demandés
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

      // ce que la balise porte : ses animations de pseudo-élément et les deux variables qui placent la lumière
      const etat = (page: any, sel: string) => page.evaluate((s: string) => {
        const e = (document.querySelector('mjs-fx-spot-ligne') as any)._shadow.querySelector(s)
        return { animations: e.getAnimations({ subtree: true }).filter((a: any) => a.effect.pseudoElement === '::after' && !(a instanceof CSSTransition)).length, x: e.style.getPropertyValue('--mjs-fx-spot-x'), y: e.style.getPropertyValue('--mjs-fx-spot-y') }
      }, sel)

      const rouge  = (p: number[]) => p[0] > 200 && p[1] < 150 && p[2] < 150
      const blanc  = (p: number[]) => Math.min(...p) >= 235
      const sans   = async (page: any, ctx: any) => { await page.close(); await ctx.close() }

      it('un lien en ligne : le halo est sous la souris, la suit, et part avec elle (le halo d\'avant : un dégradé dont deux variables placent le centre)', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boites(page, '.lien')
          const y  = b.y + b.h / 2
          const x1 = b.x + 30
          const x2 = b.x + b.w - 30
          await page.mouse.move(x1, y, { steps: 5 })
          await page.waitForTimeout(700)
          const [sous1, loin1] = await pixels(page, [[x1, b.y + 1], [x1 + 140, b.y + 1]])
          assert.ok(rouge(sous1), 'sous la souris, la lumière est rouge : ' + sous1)
          assert.ok(blanc(loin1), 'à 140 px de la souris, hors de la lumière, le fond reste blanc : ' + loin1)
          const e1 = await etat(page, '.lien')
          assert.equal(e1.animations, 0, 'une balise sans taille intérieure n\'a rien à rogner : aucune animation de pseudo-élément')
          assert.ok(Math.abs(parseFloat(e1.x) - 30) < 1.5, 'la variable du centre est dans le repère de la balise : ' + e1.x)
          await page.mouse.move(x2, y, { steps: 5 })
          await page.waitForTimeout(700)
          const [sous2, ancien] = await pixels(page, [[x2, b.y + 1], [x1, b.y + 1]])
          assert.ok(rouge(sous2), 'la lumière a suivi la souris : ' + sous2)
          assert.ok(blanc(ancien), 'et a quitté sa première place : ' + ancien)
          await page.mouse.move(3, 380, { steps: 5 })
          await page.waitForTimeout(900)
          const [parti] = await pixels(page, [[x2, b.y + 1]])
          assert.ok(blanc(parti), 'la souris partie, la lumière s\'efface : ' + parti)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('un composant (en ligne par défaut) : le halo est sous la souris', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boites(page, '.pastille')
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 5 })
          await page.waitForTimeout(700)
          const [sous, loin] = await pixels(page, [[b.x + b.w / 2, b.y + 1], [b.x + b.w + 120, b.y + 1]])
          assert.ok(rouge(sous), 'sous la souris, la lumière est rouge : ' + sous)
          assert.ok(blanc(loin), 'hors de la lumière, le fond reste blanc : ' + loin)
        }
        finally {
          await sans(page, ctx)
        }
      })

      it('un « inline-block » (il a une taille intérieure) : le halo est sous la souris, déplacé par l\'animation de son pseudo-élément', async function () {
        if (!present) return this.skip()
        const { ctx, page } = await ouvrir()
        try {
          const b = await boites(page, '.bloc')
          await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 5 })
          await page.waitForTimeout(700)
          const [sous] = await pixels(page, [[b.x + b.w / 2, b.y + 1]])
          assert.ok(rouge(sous), 'sous la souris, la lumière est rouge : ' + sous)
          const e = await etat(page, '.bloc')
          assert.equal(e.animations, 1, 'une animation sur le pseudo-élément du halo')
          assert.equal(e.x, '', 'aucune variable de placement : le halo est un point que l\'animation déplace')
        }
        finally {
          await sans(page, ctx)
        }
      })
    })
  }
})
