// Le défilement de la page sous deux effets, dans Chromium :
//   - *tilt : la page défile à la molette sous une carte survolée — l'inclinaison se calcule sur la place de la carte
//     d'après le défilement (pas sur sa boîte lue à l'entrée du pointeur), et une carte sortie de sous le pointeur
//     n'est plus suivie (elle revient à plat, sans `mjs-fx-tilt-active`) ;
//   - *parallax : un défilement de la page arrive à l'effet par deux écoutes (la capture sur le document et la
//     fenêtre) — il n'est traité qu'une fois, le défilement relu une seule fois par événement.

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

const COMPOSANTS: Record<string, string> = {
  'fx-id-carte': '<div class="haut"></div><div class="card" *tilt(max: 12)>carte</div><div class="bas"></div>\n<style>\n.haut\n  height: 100px\n.card\n  width: 300px\n  height: 300px\n  background: #ccc\n.bas\n  height: 2000px\n</style>\n',
  'fx-id-plan':  '<div class="pl" *parallax(speed: 0.5)>p</div><div class="bas"></div>\n<style>\n.pl\n  height: 100px\n.bas\n  height: 3000px\n</style>\n',
}

describe('*tilt et *parallax — la page qui défile (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-inclinaison-parallax-defilement-browser')
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
    page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
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

  it('*tilt : l\'inclinaison suit la carte qui a défilé, une carte sortie de sous le pointeur revient à plat', async () => {
    await page.evaluate(() => { document.body.appendChild(document.createElement('mjs-fx-id-carte')) })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-id-carte') as any)?._shadow?.querySelector('.card'), null, { timeout: 60000 })
    await page.waitForTimeout(300)
    const carte = () => page.evaluate(() => {
      const c = (document.querySelector('mjs-fx-id-carte') as any)._shadow.querySelector('.card')
      return { rx: parseFloat(c.style.getPropertyValue('--mjs-fx-tilt-rx') || '0'), actif: c.hasAttribute('mjs-fx-tilt-active') }
    })
    await page.mouse.move(150, 250)
    await page.waitForTimeout(100)
    await page.mouse.move(150, 251)
    await page.waitForTimeout(200)
    const avant = await carte()
    // 100 px de molette : la carte monte, le pointeur est maintenant à 83 % de sa hauteur (≈ 8° pour 12° au bord)
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(500)
    await page.mouse.move(150, 250)
    await page.waitForTimeout(200)
    const defile = await carte()
    // 400 px de plus : la carte est sortie de l'écran
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(600)
    await page.mouse.move(151, 250)
    await page.waitForTimeout(200)
    const sortie = await carte()
    await page.evaluate(() => { document.querySelector('mjs-fx-id-carte')!.remove(); window.scrollTo(0, 0) })
    await page.mouse.move(5, 5)
    assert.equal(avant.actif, true)
    assert.ok(Math.abs(avant.rx) < 1, 'au centre : ' + JSON.stringify(avant))
    assert.equal(defile.actif, true)
    assert.ok(defile.rx > 6 && defile.rx < 10, 'après 100 px de défilement : ' + JSON.stringify(defile))
    assert.equal(sortie.actif, false, 'carte sortie de sous le pointeur : ' + JSON.stringify(sortie))
  })

  it('*parallax : le défilement relu une seule fois par événement de défilement de la page', async () => {
    const r = await page.evaluate(async () => {
      const h = document.createElement('mjs-fx-id-plan')
      document.body.appendChild(h)
      await new Promise((f) => setTimeout(f, 400))
      let lu = 0
      let ev = 0
      const d: any = Object.getOwnPropertyDescriptor(Window.prototype, 'scrollY') || Object.getOwnPropertyDescriptor(window, 'scrollY')
      Object.defineProperty(window, 'scrollY', { configurable: true, get() { lu++; return d.get.call(window) } })
      window.addEventListener('scroll', () => { ev++ }, { passive: true })
      for (let i = 1; i <= 10; i++) {
        window.scrollTo(0, i * 20)
        await new Promise((f) => setTimeout(f, 60))
      }
      delete (window as any).scrollY
      h.remove()
      window.scrollTo(0, 0)
      return { evenements: ev, lectures: lu }
    })
    assert.ok(r.evenements >= 5, JSON.stringify(r))
    assert.ok(r.lectures <= r.evenements, 'lectures du défilement : ' + JSON.stringify(r))
  })
})
