// *particles(mode: network) dans Chromium : le réseau compte au plus 800 points, ceux des clics compris — les fils se
// testent par paires (n² par image) et un grand compte sur une grande balise (count: 400 sur 1600 × 4000 px : 4 000
// points, 8 millions de paires) faisait tomber la page à quelques images par seconde. Sous le plafond, rien ne change :
// la densité suit la surface, un clic ajoute quatre points. Les points se comptent aux disques dessinés en une image.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const taille = (w: number, h: number) => '\n<style>\n.z\n  width: ' + w + 'px\n  height: ' + h + 'px\n</style>\n'

const COMPOSANTS: Record<string, string> = {
  'fx-pp-grand': '<div class="z" *particles(mode: network, count: 400)></div>' + taille(1600, 4000),
  'fx-pp-petit': '<div class="z" *particles(mode: network)></div>' + taille(800, 600),
}

describe('*particles(network) — au plus 800 points, ceux des clics compris (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-particules-reseau-plafond-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
    page    = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage()
    // chaque disque dessiné est un point du réseau
    await page.addInitScript(() => {
      const proto: any = CanvasRenderingContext2D.prototype
      const arc = proto.arc
      ;(window as any).__disques = 0
      proto.arc = function (...a: any[]) {
        ;(window as any).__disques++
        return arc.apply(this, a)
      }
    })
    await page.route('http://t.test/**', async (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  // les points d'une image : les disques dessinés entre deux images (une seule toile animée à la fois)
  const points = async () => await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
    ;(window as any).__disques = 0
    requestAnimationFrame(() => r((window as any).__disques))
  })))
  const poser = async (nom: string) => {
    await page.evaluate((nom: string) => { document.body.appendChild(document.createElement(nom)) }, nom)
    await page.waitForFunction((nom: string) => !!(document.querySelector(nom) as any)?._shadow?.querySelector('[mjs-fx-layer="particles"] canvas'), nom, { timeout: 60000 })
    await page.waitForTimeout(400)
  }
  const cliquer = async (n: number) => {
    for (let k = 0; k < n; k++) await page.mouse.click(300 + k * 10, 300)
    await page.waitForTimeout(100)
  }

  it('count: 400 sur 1600 × 4000 px : 800 points, et pas un de plus après dix clics', async () => {
    await poser('mjs-fx-pp-grand')
    const avant = await points()
    await cliquer(10)
    const apres = await points()
    await page.evaluate(() => document.querySelector('mjs-fx-pp-grand')!.remove())
    assert.deepEqual({ avant, apres }, { avant: 800, apres: 800 })
  })

  it('sous le plafond, rien ne change : la densité de la surface, quatre points par clic', async () => {
    await poser('mjs-fx-pp-petit')
    const avant = await points()
    await cliquer(10)
    const apres = await points()
    await page.evaluate(() => document.querySelector('mjs-fx-pp-petit')!.remove())
    assert.ok(avant > 0 && avant < 800, 'points : ' + avant)
    assert.equal(apres, (avant as number) + 40)
  })
})
