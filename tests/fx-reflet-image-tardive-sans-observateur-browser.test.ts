// *reflect sur une image qui mesure 0 x 0 à la pose puis charge (servie avec retard), et sans ResizeObserver (navigateur ancien :
// `delete window.ResizeObserver` avant le chargement), dans Chromium et Firefox réels : le reflet suit le chargement de l'image,
// le redimensionnement de la fenêtre et l'insertion d'un frère avant la balise. `blur` impose la boîte (copie ou -moz-element) : le
// reflet natif de Chromium vit dans le rendu de la balise et n'a rien à mesurer.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#36c"/></svg>'

const COMPOSANTS: Record<string, string> = {
  'fx-rt-image': '<div class="p"><img class="im" src="/lent.svg" alt="" *reflect(blur: 2)></div>\n<style>\n:host\n  display: block\n.p\n  position: relative\n  width: 60%\n  margin: 20px 0 0 15px\n  padding: 10px\n.im\n  display: block\n  width: 50%\n</style>\n',
}

describe('*reflect — image tardive et repli sans ResizeObserver (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-reflet-image-tardive-sans-observateur-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
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
    for (const sansRO of [false, true]) {
      describe(`${nom}${sansRO ? ', sans ResizeObserver' : ''}`, function () {
        let browser: any
        let page: any
        let erreurs: string[]

        before(async function () {
          if (!(await navigateurPresent(nom))) {
            console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
            return this.skip()
          }
          const playwright = await import('playwright')
          browser = await playwright[nom].launch()
          page    = await (await browser.newContext({ viewport: { width: 800, height: 700 } })).newPage()
          erreurs = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          if (sansRO) await page.addInitScript('delete window.ResizeObserver')
          await page.route('http://t.test/**', async (route: any) => {
            const url = route.request().url()
            if (url === 'http://t.test/lent.svg') {
              await new Promise((f) => setTimeout(f, 700))
              return route.fulfill({ contentType: 'image/svg+xml', body: SVG })
            }
            if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-fx-rt-image></mjs-fx-rt-image><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-fx-rt-image') as any)?._shadow?.querySelector('.im'), null, { timeout: 90000 })
        })

        after(async () => { await browser?.close() })

        // l'image et son reflet, lus à l'écran
        const lire = () => page.evaluate(() => {
          const racine = (document.querySelector('mjs-fx-rt-image') as any)._shadow
          const img    = racine.querySelector('.im')
          const calque = racine.querySelector('[mjs-fx-layer="reflect"]')
          const a = img.getBoundingClientRect()
          const b = calque ? calque.getBoundingClientRect() : null
          return { complete: img.complete, sansRO: typeof ResizeObserver === 'undefined', image: { left: a.left, bottom: a.bottom, width: a.width, height: a.height }, calque: b && { top: b.top, left: b.left, width: b.width, height: b.height } }
        })
        const juste = async (quand: string) => {
          await page.evaluate(() => new Promise((f) => setTimeout(f, 250)))
          const r = await lire()
          assert.ok(r.complete, quand + ' : l\'image est chargée')
          assert.ok(r.image.width > 0 && r.image.height > 0, quand + ' : l\'image a une taille')
          assert.ok(r.calque, quand + ' : le reflet existe')
          const c = r.calque
          const proche = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) <= 1.5, `${quand} : ${msg} : ${Math.round(a * 100) / 100} au lieu de ${Math.round(b * 100) / 100}`)
          proche(c.width, r.image.width, 'la largeur du reflet')
          proche(c.height, r.image.height, 'la hauteur du reflet')
          proche(c.left, r.image.left, 'l\'abscisse du reflet')
          proche(c.top, r.image.bottom + 4, 'le reflet est à 4 px sous l\'image')
        }

        it('le navigateur est bien dans le cas testé', async () => {
          assert.equal((await lire()).sansRO, sansRO)
        })

        it('une image qui mesure 0 x 0 à la pose, puis charge : le reflet prend sa taille', async () => {
          await page.waitForFunction(() => (document.querySelector('mjs-fx-rt-image') as any)._shadow.querySelector('.im').complete, null, { timeout: 30000 })
          await juste('après le chargement')
        })

        it('la fenêtre redimensionnée : le reflet suit', async () => {
          await page.setViewportSize({ width: 500, height: 700 })
          await juste('à 500 px')
          await page.setViewportSize({ width: 900, height: 700 })
          await juste('à 900 px')
        })

        it('un frère inséré avant l\'image : le reflet suit', async () => {
          await page.evaluate(() => {
            const racine = (document.querySelector('mjs-fx-rt-image') as any)._shadow
            const d = document.createElement('div')
            d.style.cssText = 'height:37px'
            racine.querySelector('.p').insertBefore(d, racine.querySelector('.im'))
          })
          await juste('après l\'insertion')
        })

        it('aucune erreur de page', () => {
          assert.deepEqual(erreurs, [])
        })
      })
    }
  }
})
