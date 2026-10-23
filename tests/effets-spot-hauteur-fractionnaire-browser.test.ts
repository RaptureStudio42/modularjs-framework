// *filter(…, spot) dans Chromium réel, sur une balise de hauteur fractionnaire (92,4 px) : sa hauteur de mise en page (offsetHeight)
// est arrondie à 92, mais rien ne la met à l'échelle — la zone nette se pose sous la souris, au dixième de pixel, comme sur une balise de
// 92 px tout rond (le témoin), au lieu de remonter jusqu'à un demi-pixel vers le haut quand la souris descend.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ROUGE  = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>')
const SOURCE = `<div class="w"><img class="f" *filter(grayscale, spot: 60, soft: 0, smooth: 1) src="${ROUGE}" alt="a"></div><div class="w"><img class="r" *filter(grayscale, spot: 60, soft: 0, smooth: 1) src="${ROUGE}" alt="b"></div>\n<style>\n.w\n  height: 150px\n.f, .r\n  display: block\n  width: 300px\n.f\n  height: 92.4px\n.r\n  height: 92px\n</style>\n`

describe('*filter(spot) dans Chromium réel — une balise de hauteur fractionnaire', function () {
  this.timeout(240000)
  let script = ''
  let browser: any = null
  let present = false

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-spot-fraction')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-spot-frac.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('la souris à 88 px du haut : le centre de la zone nette est sous elle, sur la balise de 92,4 px comme sur celle de 92 px', async function () {
    if (!present) return this.skip()
    const page = await browser.newPage({ viewport: { width: 600, height: 500 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-frac></mjs-fx-spot-frac><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-frac') as any)?._shadow?.querySelector('.r'))
    await page.waitForTimeout(400)
    const ecart: Record<string, any> = {}
    for (const sel of ['.f', '.r']) {
      const a = await page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-fx-spot-frac') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, h: r.height }
      }, sel)
      const mx = Math.round(a.x) + 150
      const my = Math.round(a.y) + 88
      await page.mouse.move(mx - 30, my - 40, { steps: 2 })
      await page.mouse.move(mx, my, { steps: 3 })
      await page.waitForTimeout(300)
      ecart[sel] = await page.evaluate(async ([px, py]: number[]) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const lens = (document.querySelector('mjs-fx-spot-frac') as any)._shadow.querySelector('[mjs-fx-filter-lens]')
        if (!lens) return null
        const b = lens.getBoundingClientRect()
        return { dx: +(b.left + b.width / 2 - px).toFixed(2), dy: +(b.top + b.height / 2 - py).toFixed(2) }
      }, [mx, my])
      await page.mouse.move(590, 490, { steps: 2 })
      await page.waitForTimeout(300)
    }
    await page.close()
    assert.deepEqual(erreurs, [])
    assert.ok(ecart['.r'] && Math.abs(ecart['.r'].dx) < 0.2 && Math.abs(ecart['.r'].dy) < 0.2, 'le témoin (92 px) : la zone sous la souris — ' + JSON.stringify(ecart))
    assert.ok(ecart['.f'] && Math.abs(ecart['.f'].dx) < 0.2 && Math.abs(ecart['.f'].dy) < 0.2, 'la balise de 92,4 px : la zone sous la souris — ' + JSON.stringify(ecart))
  })
})
