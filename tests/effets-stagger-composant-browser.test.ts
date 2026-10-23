// `*stagger(unit: child)` sur un composant — Chromium et Firefox réels : les enfants glissés dans le composant arrivent un
// par un (rang, retard, départ caché, arrivée complète), puis redeviennent naturels

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

const SOURCE = [
  '<@vue-liste id="liste" *stagger(unit: child, opacity: 0, easing: linear, duration: 1000ms, step: 400ms, on: click)>',
  '  <li class="item">Un</li><li class="item">Deux</li><li class="item">Trois</li>',
  '</@vue-liste>',
  '<style>',
  ':host',
  '  display: block',
  '</style>'
].join('\n')

const LISTE = [
  '<ul class="boite"><slot></slot></ul>',
  '<style>',
  ':host',
  '  display: block',
  '.boite',
  '  margin: 0',
  '  padding: 0',
  '  list-style: none',
  '</style>'
].join('\n')

describe('*stagger(unit: child) sur un composant (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-stagger-composant-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-essai.mjs'), SOURCE)
    writeFileSync(join(srcDir, 'vue-liste.mjs'), LISTE)
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
      let page: any = null
      const erreurs: string[] = []

      before(async () => {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page = await browser.newPage({ viewport: { width: 600, height: 600 } })
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vue-essai></mjs-vue-essai><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => {
          const sh = (document.querySelector('mjs-vue-essai') as any)?._shadow
          return !!sh?.querySelector('mjs-vue-liste')?._shadow
        })
      })

      after(async () => { if (browser) await browser.close() })

      // les trois enfants glissés, vus du composant qui les porte
      const lire = () => page.evaluate(() => {
        const hote: any = (document.querySelector('mjs-vue-essai') as any)._shadow.querySelector('mjs-vue-liste')
        return Array.from(hote.children).map((el: any) => {
          const cs = getComputedStyle(el)
          return { marque: el.hasAttribute('mjs-fx-child'), k: el.style.getPropertyValue('--mjs-fx-stagger-k'), opacite: Number(cs.opacity), delai: cs.animationDelay, nom: cs.animationName, anims: el.getAnimations().length }
        })
      })

      it('avant le clic : rien n\'est marqué, les trois enfants sont là', async function () {
        if (!present) { this.skip(); return }
        const r = await lire()
        assert.equal(r.length, 3)
        assert.ok(r.every((e: any) => e.opacite === 1), 'avant l\'arrivée jouée, rien n\'est caché')
      })

      it('au clic : trois enfants marqués, rangs 0, 1, 2, retards de 0, 400 et 800 ms, une animation chacun', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (document.querySelector('mjs-vue-essai') as any)._shadow.querySelector('mjs-vue-liste').click())
        await page.waitForTimeout(80)
        const r = await lire()
        assert.deepEqual(r.map((e: any) => e.marque), [true, true, true])
        assert.deepEqual(r.map((e: any) => e.k), ['0', '1', '2'])
        assert.deepEqual(r.map((e: any) => e.delai), ['0s', '0.4s', '0.8s'])
        assert.deepEqual(r.map((e: any) => e.anims), [1, 1, 1])
        assert.ok(r[2].opacite < 0.05, `le troisième attend son tour (opacité ${r[2].opacite})`)
      })

      it('un par un : à 700 ms le premier est avancé, le deuxième commence, le troisième est encore caché ; à la fin les trois sont là, démarqués', async function () {
        if (!present) { this.skip(); return }
        const milieu = await page.evaluate(() => {
          const hote: any = (document.querySelector('mjs-vue-essai') as any)._shadow.querySelector('mjs-vue-liste')
          const out: number[] = []
          for (const el of Array.from(hote.children) as any[]) {
            for (const a of el.getAnimations()) { a.pause(); a.currentTime = 700 }
            out.push(Number(getComputedStyle(el).opacity))
          }
          return out
        })
        assert.ok(milieu[0] > 0.6 && milieu[0] < 0.8, `premier à 70 % : ${milieu[0]}`)
        assert.ok(milieu[1] > 0.2 && milieu[1] < 0.4, `deuxième à 30 % : ${milieu[1]}`)
        assert.ok(milieu[2] === 0, `troisième pas encore parti : ${milieu[2]}`)
        await page.evaluate(() => {
          const hote: any = (document.querySelector('mjs-vue-essai') as any)._shadow.querySelector('mjs-vue-liste')
          for (const el of Array.from(hote.children) as any[]) for (const a of el.getAnimations()) a.finish()
        })
        await page.waitForTimeout(150)
        const fin = await lire()
        assert.deepEqual(fin.map((e: any) => e.opacite), [1, 1, 1])
        assert.deepEqual(fin.map((e: any) => e.marque), [false, false, false], 'les enfants redeviennent naturels')
      })

      it('aucune erreur de page', function () {
        if (!present) { this.skip(); return }
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
