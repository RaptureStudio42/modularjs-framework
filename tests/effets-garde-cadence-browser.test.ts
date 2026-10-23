// la garde de cadence des effets (mjs_fx_toolgauge.ts) dans des navigateurs réels : un effet lourd posé fait demander une salve de
// 151 images à sa pose (de quoi juger un appareil lent qui joue seul, dans tous les navigateurs), puis plus aucune image au repos ;
// ensuite la mesure du mode économe s'arme à un geste, ou à une image longue que le navigateur signale (Chromium), puis se tait.
// Les images d'animation demandées sont comptées par la page elle-même (requestAnimationFrame enveloppé avant le moteur) ;
// l'effet lourd est un effet de banc sans aucune boucle à lui : toute image demandée est celle de la garde.
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

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

// une page qui pose un effet léger : le moteur et le cœur sont là, rien d'autre ne demande d'image
const SOURCES: Record<string, string> = {
  'gc-page.mjs': '<div class="c" *neon></div>\n<style>\n.c\n  width: 300px\n  height: 200px\n</style>\n',
  'gc-bruit.mjs': '<div class="c" *noise(speed: 0)></div>\n<style>\n.c\n  width: 300px\n  height: 200px\n</style>\n',
  'gc-retrait.mjs': '<script>\n$on = true\n</script>\n{if $on}\n<div class="c" *noise(speed: 0)></div>\n{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\n.c\n  width: 300px\n  height: 200px\n</style>\n'
}

// ce que la page compte : les images demandées (le total, et celles en attente)
const COMPTEURS = () => {
  const w = window as any
  w.__raf  = new Set()
  w.__rafN = 0
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.__ra = ra
  w.requestAnimationFrame = (f: any) => { w.__rafN++; const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
}

describe('la garde de cadence (navigateurs réels) — rien au repos, un vrai geste la lance', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-garde-cadence-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    // la page ne pose qu'un effet léger : la garde, que seuls les effets lourds embarquent, est demandée par son nom
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['fx_toolgauge'] as any })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = (r: number) => files.filter((f) => rang(f) === r).sort((a, b) => a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    script = [code(0), code(1), code(2)].join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      beforeEach(function () { if (!present) this.skip() })

      // la page, au repos, avec un effet lourd de banc posé ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(fn: (page: any) => Promise<T>, tag = 'mjs-gc-page'): Promise<T> {
        const page   = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          // le démarrage de la page est fini avant de compter
          await page.waitForTimeout(700)
          const r = await fn(page)
          assert.deepEqual(erreurs, [])
          return r
        } finally {
          await page.close()
        }
      }

      // pose l'effet lourd de banc : aucune boucle à lui, aucune image demandée par lui
      const poser = (page: any) => page.evaluate(() => {
        const w = window as any
        w.µ._mjs_fxDefs.lourd = { heavy: true, setup: () => () => {} }
        w.__rafN = 0
        const el = document.body.appendChild(document.createElement('div'))
        w.__off = w.µ._mjs_fx(null, el, 'lourd', {})
      })
      const demandes = (page: any): Promise<number> => page.evaluate(() => (window as any).__rafN)
      const attente  = (page: any): Promise<number> => page.evaluate(() => (window as any).__raf.size)
      // la salve de la pose est finie : au moins 151 images demandées, plus aucune en attente
      const salveFinie = (page: any) => page.waitForFunction(() => (window as any).__rafN >= 151 && (window as any).__raf.size === 0, undefined, { timeout: 60000, polling: 200 })
      // une page qui calcule `ms` ms par image
      const lente = (page: any, ms: number) => page.evaluate((m: number) => {
        const occupe = () => { const t = performance.now(); while (performance.now() - t < m) { /* une page qui calcule */ } }
        const boucle = () => { occupe(); requestAnimationFrame(boucle) }
        requestAnimationFrame(boucle)
      }, ms)
      // une page qui calcule `ms` ms par image et dont la `rang`e image dure `trou` ms de plus (un point d'arrêt, un ramasse-miettes) ; ses images ne sont pas comptées
      const lenteAvecTrou = (page: any, ms: number, rang: number, trou: number) => page.evaluate(([m, r, t]: number[]) => {
        const w = window as any
        const occupe = (d: number) => { const t0 = performance.now(); while (performance.now() - t0 < d) { /* une page qui calcule */ } }
        let n = 0
        const boucle = () => { occupe(m); if (++n === r) occupe(t); w.__ra(boucle) }
        w.__ra(boucle)
      }, [ms, rang, trou])
      const lite = (page: any): Promise<boolean> => page.evaluate(() => (window as any).µ._mjs_fxLite === true)
      // des gestes continus jusqu'au verdict « économe », ou jusqu'à la fin du délai ; vrai si le verdict est tombé
      async function gestes(page: any, secondes: number): Promise<boolean> {
        const fin = Date.now() + secondes * 1000
        let v = false
        for (let i = 0; !v && Date.now() < fin; i++) {
          await page.mouse.move(100 + (i % 40) * 10, 100 + (i % 7) * 15)
          await page.waitForTimeout(30)
          v = await lite(page)
        }
        return v
      }

      it('un effet lourd posé, aucun geste : une salve de 151 images à la pose, puis zéro image demandée au repos', async function () {
        await avec(async (page) => {
          await poser(page)
          await salveFinie(page)
          const fini = await demandes(page)
          assert.ok(fini >= 151 && fini < 400, 'une salve bornée : ' + fini + ' images')
          await page.waitForTimeout(3000)
          assert.equal(await demandes(page), fini, 'au repos, plus aucune image demandée')
          assert.equal(await attente(page), 0)
          assert.equal(await lite(page), false, 'un appareil qui suit n\'est pas économe')
        })
      })

      it('un vrai effet lourd posé par le bundler (*noise au grain figé), aucun geste : la salve de la pose, puis zéro image demandée au repos', async function () {
        await avec(async (page) => {
          await salveFinie(page)
          const fini = await demandes(page)
          assert.ok(fini >= 151 && fini < 400, 'une salve bornée : ' + fini + ' images')
          await page.waitForTimeout(3000)
          assert.equal(await demandes(page), fini, 'au repos, plus aucune image demandée')
          assert.equal(await attente(page), 0)
        }, 'mjs-gc-bruit')
      })

      it('un vrai geste, la salve finie, lance la mesure, qui se tait peu après : pas une boucle', async function () {
        await avec(async (page) => {
          await poser(page)
          await salveFinie(page)
          const avant = await demandes(page)
          for (let i = 0; i < 25; i++) {
            await page.mouse.move(100 + i * 12, 100 + (i % 5) * 20)
            await page.waitForTimeout(20)
          }
          const pendant = await demandes(page)
          assert.ok(pendant > avant, 'le geste lance la mesure')
          await page.waitForTimeout(1500)
          assert.equal(await attente(page), 0, 'la mesure s\'est tue')
          const fini = await demandes(page)
          await page.waitForTimeout(1000)
          assert.equal(await demandes(page), fini, 'plus aucune image demandée')
        })
      })

      it('un effet lourd qui joue seul sur une page lente (40 ms de calcul par image), AUCUN geste : le mode économe est décidé par la salve de la pose (aucune image de 50 ms : pas de signal du navigateur)', async function () {
        await avec(async (page) => {
          await lente(page, 40)
          await poser(page)
          await page.waitForFunction(() => (window as any).µ._mjs_fxLite === true, undefined, { timeout: 60000, polling: 500 }).catch(() => {})
          assert.equal(await lite(page), true, 'économe décidé sans aucun geste, dans ' + nom)
          assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('mjs-fx-lite')))
        })
      })

      it('une page lente (40 ms de calcul par image) dont UNE image dure 300 ms pendant la salve de la pose, AUCUN geste : le mode économe est décidé quand même (une pause ne consomme pas la salve)', async function () {
        await avec(async (page) => {
          // sans le signal des images longues du navigateur (Chromium) : la salve de la pose décide seule
          await page.evaluate(() => Object.defineProperty(PerformanceObserver, 'supportedEntryTypes', { value: [], configurable: true }))
          await poser(page)
          await lenteAvecTrou(page, 40, 20, 300)
          await page.waitForFunction(() => (window as any).µ._mjs_fxLite === true, undefined, { timeout: 40000, polling: 500 }).catch(() => {})
          assert.equal(await lite(page), true, 'économe décidé sans geste malgré une image de 300 ms, dans ' + nom)
          assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('mjs-fx-lite')))
        })
      })

      it('une page rapide à la pose, puis lente (60 ms de calcul par image), AUCUN geste : décidé par les images longues que le navigateur signale (là où il le fait)', async function () {
        const jugee = await avec(async (page) => {
          const connu = await page.evaluate(() => typeof PerformanceObserver === 'function' && (PerformanceObserver as any).supportedEntryTypes?.indexOf('long-animation-frame') >= 0)
          if (!connu) return null
          await poser(page)
          await salveFinie(page)
          await lente(page, 60)
          await page.waitForFunction(() => (window as any).µ._mjs_fxLite === true, undefined, { timeout: 60000, polling: 500 }).catch(() => {})
          return await lite(page)
        })
        if (jugee === null) return this.skip()
        assert.equal(jugee, true, 'économe décidé sans aucun geste, par les seules images longues')
      })

      it('une page rapide à la pose, puis lente (40 ms de calcul par image) sous un geste continu : le mode économe est décidé par les gestes', async function () {
        await avec(async (page) => {
          await poser(page)
          await salveFinie(page)
          await lente(page, 40)
          assert.equal(await gestes(page, 60), true, 'économe décidé par les gestes sur une page lente')
          assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('mjs-fx-lite')))
        })
      })

      it('l\'effet lourd retiré (un bloc {if} refermé), la page lente et des gestes continus : jamais économe, il n\'y a plus rien à ménager', async function () {
        await avec(async (page) => {
          await salveFinie(page)
          await page.evaluate(() => (document.querySelector('mjs-gc-retrait') as any)._shadow.querySelector('.t').click())
          await page.waitForFunction(() => (document.querySelector('mjs-gc-retrait') as any)._shadow.querySelectorAll('[mjs-fx]').length === 0, undefined, { timeout: 10000 })
          await lente(page, 40)
          assert.equal(await gestes(page, 16), false, 'aucun effet lourd posé : aucun verdict')
          assert.ok(!(await page.evaluate(() => document.documentElement.hasAttribute('mjs-fx-lite'))))
        }, 'mjs-gc-retrait')
      })

    })
  }
})
