// *gallery(on: drag) au doigt, dans Chromium réel (toucher envoyé par le protocole du navigateur) : au toucher, le navigateur donne la
// prise du pointeur au panneau touché ; quand la galerie la prend pour elle (au-delà de 5 px), le panneau la perd, et cette perte
// remonte jusqu'à la galerie. Elle ne doit pas y voir la fin du geste : la galerie suit le doigt jusqu'à ce qu'il se lève.

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

const PANNEAUX = Array.from({ length: 8 }, (_, i) => `<div class="p">${i}</div>`).join('\n  ')
const SOURCE   = `<script>\n$n = 3\n</script>\n<div class="g" *gallery(coverflow, on: drag, index: 3, smooth: 1) @change={(e) -> $n = e.detail.index}>\n  ${PANNEAUX}\n</div>\n<b class="n">{$n}</b>\n<style>\n.g\n  height: 600px\n  width: 1000px\n  overflow: hidden\n.p\n  width: 470px\n  height: 310px\n  background: #39c\n</style>\n`
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('*gallery dans Chromium réel — glisser au doigt', function () {
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
    const root   = mjsTmp('effets-gallery-toucher')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gal-doigt.mjs'), SOURCE)
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

  it('le doigt posé sur un panneau tire la galerie jusqu\'à ce qu\'il se lève : la prise passée du panneau à la galerie ne finit pas le geste', async function () {
    if (!present) return this.skip()
    const ctx  = await browser.newContext({ hasTouch: true, viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-gal-doigt></mjs-gal-doigt><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-gal-doigt') as any)?._shadow?.querySelector('[mjs-fx]'))
    await attendre(300)
    // le panneau de tête (3), son centre ; les évènements de prise vus par la galerie
    const pos = await page.evaluate(() => {
      const g = (document.querySelector('mjs-gal-doigt') as any)._shadow.querySelector('.g')
      const w = window as any
      w.__ev = []
      for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'gotpointercapture']) g.addEventListener(t, (e: any) => w.__ev.push(t + (e.target === g ? '' : '@panneau')))
      const r = g.children[3].getBoundingClientRect()
      return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
    })
    const cdp = await ctx.newCDPSession(page)
    const T   = (type: string, pts: any[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
    await T('touchStart', [{ x: pos[0], y: pos[1], id: 1 }])
    for (let i = 1; i <= 12; i++) {
      await T('touchMove', [{ x: pos[0] - i * 20, y: pos[1], id: 1 }])
      await attendre(16)
    }
    const pendant = await page.evaluate(() => {
      const g = (document.querySelector('mjs-gal-doigt') as any)._shadow.querySelector('.g')
      const m = /translate3d\((-?[\d.]+)px/.exec(g.children[3].style.transform)
      return { tenu: g.hasAttribute('mjs-fx-gallery-drag'), x3: m ? +m[1] : null }
    })
    await T('touchEnd', [])
    await attendre(300)
    const ev = await page.evaluate(() => (window as any).__ev)
    await ctx.close()
    assert.deepEqual(erreurs, [])
    assert.equal(pendant.tenu, true, 'la galerie est tenue pendant le geste — évènements : ' + JSON.stringify(ev))
    assert.ok(pendant.x3 !== null && pendant.x3 < -150, 'le panneau de tête a suivi le doigt (240 px vers la gauche) : x = ' + pendant.x3 + ' — évènements : ' + JSON.stringify(ev))
  })
})
