// *flipcard(on: click) sous WebKit (le moteur de Safari) : un clic sur un bouton logé dans un composant (ombre fermée, le chemin
// du clic n'en montre que la balise) garde son action et ne retourne pas la carte. La carte s'en apercevait seulement par le focus
// que le clic donne au bouton ; Safari (WebKit sur macOS) ne donne pas le focus à un bouton cliqué. Le WebKit de Playwright sous
// Linux le donne : l'absence de focus est reproduite par un bouton qui le refuse à l'appui (`mousedown` empêché), dans les deux
// moteurs. Un clic ailleurs dans la carte la retourne toujours ; un clic sur le texte du même composant, aussi.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function present(moteur: 'webkit' | 'chromium'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[moteur].executablePath())
  } catch {
    return false
  }
}

const COMPOSANTS: Record<string, string> = {
  'fx-wk-bouton': '<span class="txt">texte </span><button class="b">info</button>\n<style>\n.b\n  width: 80px\n  height: 30px\n</style>\n',
}

const PAGE = '<div id="carte" style="width:320px;height:120px"><div id="recto">Recto <mjs-fx-wk-bouton></mjs-fx-wk-bouton></div><div>Verso</div></div>'

for (const moteur of ['webkit', 'chromium'] as const) {
  describe(`*flipcard(on: click) — bouton d'un composant à ombre fermée (${moteur})`, function () {
    this.timeout(240000)
    let ok      = false
    let script  = ''
    let browser: any = null
    let ctx: any = null
    let page: any = null

    before(async function () {
      ok = await present(moteur)
      if (!ok) {
        console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
        return
      }
      const root   = mjsTmp('effets-carte-ombre-fermee-' + moteur)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
      writeFileSync(join(srcDir, 'fx-wk-banc.mjs'), '<div *flipcard(on: click)><div>r</div><div>v</div></div>\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const playwright = await import('playwright')
      browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    beforeEach(async function () {
      if (!ok) return this.skip()
      ctx  = await browser.newContext({ viewport: { width: 800, height: 600 } })
      page = await ctx.newPage()
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${PAGE}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-fx-wk-bouton') as any)?._shadow?.querySelector('.b'))
      await page.evaluate(() => { (window as any).µ._mjs_fx(null, document.getElementById('carte'), 'flipcard', { on: 'click', duration: '0s' }) })
      await page.waitForTimeout(100)
    })

    afterEach(async () => {
      if (ctx) await ctx.close()
      ctx = null
    })

    // le centre d'une balise de l'ombre du composant, en coordonnées de la page
    const centre = (sel: string) => page.evaluate((s: string) => {
      const r = (document.querySelector('mjs-fx-wk-bouton') as any)._shadow.querySelector(s).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, sel)
    // l'état de la carte : celui de sa commande (pressée : le verso est montré)
    const etat = () => page.evaluate(() => document.getElementById('carte')!.querySelector(':scope > [mjs-fx-flipcard-turn]')!.getAttribute('aria-pressed'))

    it('un clic sur le bouton du composant : la carte ne se retourne pas, le bouton reçoit son clic', async () => {
      await page.evaluate(() => {
        const b = (document.querySelector('mjs-fx-wk-bouton') as any)._shadow.querySelector('.b')
        b.addEventListener('click', () => { (window as any).clics = ((window as any).clics || 0) + 1 })
      })
      assert.equal(await etat(), 'false')
      const p = await centre('.b')
      await page.mouse.click(p.x, p.y)
      await page.waitForTimeout(100)
      assert.deepEqual([await etat(), await page.evaluate(() => (window as any).clics)], ['false', 1], 'bouton cliqué, carte au recto')
    })

    it('un bouton du composant qui ne prend pas le focus au clic (comme sous Safari) : la carte ne se retourne pas', async () => {
      await page.evaluate(() => {
        const b = (document.querySelector('mjs-fx-wk-bouton') as any)._shadow.querySelector('.b')
        b.addEventListener('mousedown', (e: Event) => e.preventDefault())
        b.addEventListener('click', () => { (window as any).clics = ((window as any).clics || 0) + 1 })
      })
      const p = await centre('.b')
      await page.mouse.click(p.x, p.y)
      await page.waitForTimeout(100)
      const vu = await page.evaluate(() => [document.getElementById('carte')!.querySelector(':scope > [mjs-fx-flipcard-turn]')!.getAttribute('aria-pressed'), (window as any).clics, document.activeElement === document.querySelector('mjs-fx-wk-bouton')])
      assert.deepEqual(vu, ['false', 1, false], 'bouton cliqué sans focus, carte au recto')
    })

    it('un clic sur le texte du composant, ou ailleurs dans la carte : elle se retourne', async () => {
      const t = await centre('.txt')
      await page.mouse.click(t.x, t.y)
      await page.waitForTimeout(100)
      assert.equal(await etat(), 'true', 'le texte du composant n\'est pas un contrôle')
      const r = await page.evaluate(() => { const q = document.getElementById('recto')!.getBoundingClientRect(); return { x: q.left + 10, y: q.top + 8 } })
      await page.mouse.click(r.x, r.y)
      await page.waitForTimeout(100)
      assert.equal(await etat(), 'false')
    })
  })
}
