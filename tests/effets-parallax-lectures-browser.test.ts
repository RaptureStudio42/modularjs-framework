// *parallax dans Chromium et Firefox réels : aucune lecture de la mise en page dans la boucle d'images. La mise en page
// (le conteneur qui défile, la boîte de la balise) se lit au besoin — à la pose, au redimensionnement, au début d'un
// défilement — jamais dans les images d'animation : un trace mesure les lectures faites pendant un rappel d'image
// (boîtes, styles calculés, positions de défilement, tailles), il en faut zéro pendant que la page et un conteneur défilent.
// La valeur écrite reste celle d'avant : comparée, une fois la balise posée, à la formule du réglage lue sur la page vivante.

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

const SOURCES: Record<string, string> = {
  'lec-scene.mjs': `<div class="page">
<div class="plan a" *parallax(0.3)>A</div>
<div class="plan b" *parallax(0.4, smooth: 0.1)>B</div>
<div class="plan c" *parallax(0.5, origin: page)>C</div>
<div class="boite"><div class="long"><div class="plan d" *parallax(0.3)>D</div></div></div>
</div>
<style>
.page
  position: relative
  height: 3200px
.plan
  position: absolute
  left: 20px
  width: 100px
  height: 80px
  background: #357
.a
  top: 600px
.b
  top: 900px
  left: 160px
.c
  top: 1200px
  left: 300px
.boite
  position: absolute
  top: 1500px
  left: 450px
  width: 300px
  height: 300px
  overflow: auto
.long
  position: relative
  height: 1200px
.d
  top: 500px
  left: 20px
</style>
`
}

// ce que la page compte : les lectures de mise en page faites PENDANT un rappel d'image d'animation
const COMPTEURS = () => {
  const w = window as any
  w.__enImage  = 0
  w.__lectures = 0
  w.__detail   = {}
  const ra = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => ra((t: number) => { w.__enImage++; try { return f(t) } finally { w.__enImage-- } })
  const note = (nom: string) => { if (w.__enImage > 0) { w.__lectures++; w.__detail[nom] = (w.__detail[nom] || 0) + 1 } }
  const surveille = (cible: any, nom: string) => {
    for (let o = cible; o; o = Object.getPrototypeOf(o)) {
      const d = Object.getOwnPropertyDescriptor(o, nom)
      if (!d) continue
      if (d.get) Object.defineProperty(o, nom, { ...d, get() { note(nom); return d.get!.call(this) } })
      else if (typeof d.value === 'function') Object.defineProperty(o, nom, { ...d, value: function (this: any, ...a: any[]) { note(nom); return d.value.apply(this, a) } })
      return
    }
  }
  for (const n of ['getBoundingClientRect', 'getClientRects', 'scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth', 'clientTop', 'clientLeft', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) surveille(Element.prototype, n)
  for (const n of ['getComputedStyle', 'scrollY', 'scrollX', 'pageYOffset', 'pageXOffset', 'innerHeight', 'innerWidth']) surveille(w, n)
}

describe('*parallax (navigateurs réels) — aucune lecture de la mise en page dans la boucle', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-parallax-lectures')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
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
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function avec<T>(fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-lec-scene></mjs-lec-scene><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-lec-scene') as any)?._shadow?.querySelector('.plan.d')?.style.getPropertyValue('--mjs-fx-parallax-y'))
          await page.waitForTimeout(300)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      const defile = async (page: any, y: number, haut?: number) => {
        await page.evaluate(([y, haut]: [number, number | undefined]) => {
          window.scrollTo(0, y)
          if (haut !== undefined) (document.querySelector('mjs-lec-scene') as any)._shadow.querySelector('.boite').scrollTop = haut
        }, [y, haut])
        await page.waitForTimeout(260)
      }

      it('la page et un conteneur défilent, avec et sans élan : zéro lecture de la mise en page pendant les images d\'animation', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await page.evaluate(() => { (window as any).__lectures = 0; (window as any).__detail = {} })
          for (const y of [150, 420, 800, 1100, 1500, 1900, 1300]) await defile(page, y)
          for (const h of [120, 400, 250]) await defile(page, 1500, h)
          await page.waitForTimeout(1800)
          const r = await page.evaluate(() => ({ n: (window as any).__lectures, detail: (window as any).__detail }))
          assert.equal(r.n, 0, `lectures de la mise en page dans les rappels d'image : ${JSON.stringify(r.detail)}`)
        })
      })

      it('les valeurs écrites sont celles de la formule du réglage, lue sur la page vivante (page, conteneur, avec et sans élan)', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          await defile(page, 1500, 300)
          await page.waitForTimeout(1800)
          const r = await page.evaluate(() => {
            const sh  = (document.querySelector('mjs-lec-scene') as any)._shadow
            const lu  = (c: string) => parseFloat(sh.querySelector('.' + c).style.getPropertyValue('--mjs-fx-parallax-y'))
            const box = (c: string) => sh.querySelector('.' + c).getBoundingClientRect()
            const mid = innerHeight / 2
            const pb  = sh.querySelector('.boite').getBoundingClientRect()
            const att = (c: string, k: number, milieu: number) => { const b = box(c); return (milieu - ((b.top - lu(c)) + b.height / 2)) * k }
            return {
              a: [lu('a'), att('a', 0.3, mid)],
              b: [lu('b'), att('b', 0.4, mid)],
              c: [lu('c'), scrollY * 0.5],
              d: [lu('d'), att('d', 0.3, pb.top + sh.querySelector('.boite').clientTop + sh.querySelector('.boite').clientHeight / 2)]
            }
          })
          for (const [c, [ecrit, attendu]] of Object.entries(r) as [string, number[]][]) {
            assert.ok(Math.abs(ecrit - attendu) < 0.25, `balise ${c} : écrit ${ecrit}, formule ${attendu.toFixed(2)}`)
          }
          assert.ok(Math.abs(r.a[0]) > 20 && Math.abs(r.d[0]) > 5, 'les balises ont bien bougé')
        })
      })
    })
  }
})
