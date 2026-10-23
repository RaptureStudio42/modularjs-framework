// le coût de la bulle de *guard dans Chromium et Firefox réels : placer une bulle ne force qu'UNE mise en page, comme n'importe quelle
// lecture après une écriture. Cent cinquante champs gardés dans un même parent : afficher toutes les bulles, puis les replacer toutes
// (un enfant ajouté au parent), coûte du même ordre que cent cinquante tours « une écriture, une lecture » sur une page de même
// forme — pas le triple.

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

const N = 150
const STYLE = '\n<style>\n:host\n  display: block\n.p, .q\n  position: relative\n  padding: 10px\n  width: 600px\n.f\n  display: block\n  margin: 3px 0\n</style>\n'
const COMPOSANTS: Record<string, string> = {
  'fx-gc-liste': `<script>\n$l = []\n</script>\n<div class="p">{for i in $l}<input class="f" type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 60s, fx: none)>{end}</div>\n<div class="q">{for i in $l}<input class="f" type="number" min="1" max="10" aria-label="nombre">{end}</div>${STYLE}`,
}

describe('*guard — la bulle ne force qu\'une mise en page par placement (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('fx-guard-cout-lay-browser')
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
    describe(nom, function () {
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
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-fx-gc-liste></mjs-fx-gc-liste><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-gc-liste') as any)?._shadow?.querySelector('.p'), null, { timeout: 90000 })
        await page.evaluate((n: number) => new Promise<void>((fin) => {
          (document.querySelector('mjs-fx-gc-liste') as any)._set('l', Array.from({ length: n }, (_, i) => i))
          setTimeout(fin, 800)
        }), N)
      })

      after(async () => { await browser?.close() })

      // afficher les cent cinquante bulles (chaque affichage réveille l'observateur des autres champs du parent : elles sont
      // toutes replacées une fois), puis les replacer toutes (un enfant ajouté au parent)
      const afficher = () => page.evaluate(() => new Promise<number>((fin) => {
        const racine = (document.querySelector('mjs-fx-gc-liste') as any)._shadow
        for (const c of Array.from(racine.querySelectorAll('.p input')) as any[]) {
          c.value = '99'
          c.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        }
        setTimeout(() => fin(racine.querySelectorAll('[mjs-fx-guard-tip]').length), 50)
      }))
      const replacer = () => page.evaluate(() => new Promise<number>((fin) => {
        const racine = (document.querySelector('mjs-fx-gc-liste') as any)._shadow
        const t0 = performance.now()
        const x  = document.createElement('i')
        racine.querySelector('.p').appendChild(x)
        x.remove()
        setTimeout(() => fin(performance.now() - t0), 0)
      }))
      const effacer = () => page.evaluate(() => new Promise<void>((fin) => {
        const racine = (document.querySelector('mjs-fx-gc-liste') as any)._shadow
        for (const c of Array.from(racine.querySelectorAll('.p input')) as any[]) c.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
        setTimeout(fin, 50)
      }))

      if (nom === 'chromium') {
        it(`${N} bulles : une mise en page forcée par placement, pas trois (comptées par le navigateur)`, async () => {
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Performance.enable')
          const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'LayoutCount').value
          await afficher()
          await effacer()
          const l0 = await layouts()
          const n  = await afficher()
          const l1 = await layouts()
          await replacer()
          const l2 = await layouts()
          console.log(`    chromium : affichage ${l1 - l0} mises en page, replacement ${l2 - l1}`)
          assert.equal(n, N, 'toutes les bulles sont affichées')
          // affichage : un placement par champ, plus un replacement par champ (l'observateur du parent) ; replacement : un par champ
          assert.ok(l1 - l0 <= 2 * N + 20, `affichage : ${l1 - l0} mises en page pour ${N} bulles`)
          assert.ok(l2 - l1 <= N + 20, `replacement : ${l2 - l1} mises en page pour ${N} bulles`)
        })
      }

      it(`${N} bulles : le replacement coûte du même ordre que ${N} tours « écriture, lecture » (pas le triple)`, async () => {
        await afficher()
        const mesures = [] as number[]
        for (let tour = 0; tour < 4; tour++) mesures.push(await replacer())
        // témoin : cent cinquante tours « une écriture qui change la mise en page, une lecture », sur des nœuds de même forme
        const t = await page.evaluate(() => {
          const racine  = (document.querySelector('mjs-fx-gc-liste') as any)._shadow
          const temoins = Array.from(racine.querySelectorAll('.q input')) as any[]
          const spans   = temoins.map((c) => { const s = document.createElement('span'); s.textContent = 'Entre 1 et 10'; s.style.cssText = 'position:absolute;max-width:280px;padding:4px 9px'; c.after(s); return s })
          const out = [] as number[]
          for (let tour = 0; tour < 4; tour++) {
            const t0 = performance.now()
            spans.forEach((s, i) => { s.style.width = (10 + ((i + tour) % 2)) + 'px'; s.getBoundingClientRect() })
            out.push(performance.now() - t0)
          }
          spans.forEach((s) => s.remove())
          return Math.min(...out)
        })
        const m = Math.min(...mesures)
        console.log(`    ${nom} : replacement ${Math.round(m * 10) / 10} ms (témoin ${Math.round(t * 10) / 10})`)
        assert.ok(m <= 2.2 * t + 10, `replacement : ${m} ms contre ${t} ms pour ${N} tours « écriture, lecture »`)
      })

      it('aucune erreur de page', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
