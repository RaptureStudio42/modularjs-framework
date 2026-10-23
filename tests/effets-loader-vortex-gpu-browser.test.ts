// *loader(vortex) dans Chromium et Firefox réels : le tourbillon tourne sans rien demander au fil principal.
// Le flou qui se résorbe n'est pas animé (un `filter: blur()` animé refait le style et la peinture des vingt points à
// chaque image, en boucle) : les animations du tourbillon ne portent que `transform` et `opacity`, que la carte graphique
// mène seule. Garde de principe, indépendante de la vitesse de la machine : les propriétés animées ; en plus, dans
// Chromium, la trace du navigateur (tuiles re-tramées et images principales sur une seconde et demie, avec une large marge).

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
  'gpu-vortex.mjs': '<div class="scene"><span class="v" *loader(vortex, size: 140)></span></div>\n<style>\n.scene\n  padding: 60px\n</style>\n'
}

describe('*loader(vortex) (navigateurs réels) — tout sur la carte graphique', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-loader-vortex-gpu')
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
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-gpu-vortex></mjs-gpu-vortex><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-gpu-vortex') as any)?._shadow?.querySelector('[mjs-fx-layer="loader"]'))
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      it('aucune animation du tourbillon ne porte autre chose que transform et opacity (pas de filter animé)', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const r = await page.evaluate(() => {
            const calque = (document.querySelector('mjs-gpu-vortex') as any)._shadow.querySelector('[mjs-fx-layer="loader"]')
            const anims  = calque.getAnimations({ subtree: true })
            const props  = new Set<string>()
            for (const a of anims) for (const f of a.effect.getKeyframes()) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k)
            return { n: anims.length, props: [...props].sort(), noms: [...new Set(anims.map((a: any) => a.animationName))].sort() }
          })
          assert.ok(r.n >= 20, `le tourbillon anime au moins ses vingt points (${r.n})`)
          assert.deepEqual(r.props, ['opacity', 'transform'], `propriétés animées : ${r.props.join(', ')} (animations : ${r.noms.join(', ')})`)
        })
      })

      it('Chromium : une seconde et demie de tourbillon ne re-trame presque aucune tuile et ne demande presque aucune image principale', async function () {
        if (!present || nom !== 'chromium') { this.skip(); return }
        await avec(async (page) => {
          await page.waitForTimeout(1200)
          await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'toplevel'] })
          await page.waitForTimeout(1500)
          const trace = JSON.parse((await browser.stopTracing()).toString())
          const compte = (n: string) => trace.traceEvents.filter((e: any) => e.name === n).length
          const tuiles = compte('RasterTask')
          const images = compte('BeginMainThreadFrame')
          assert.ok(tuiles < 40, `tuiles re-tramées en 1,5 s : ${tuiles} (un flou animé en refait des milliers)`)
          assert.ok(images < 25, `images principales en 1,5 s : ${images} (un flou animé en demande une par image)`)
        })
      })
    })
  }
})
