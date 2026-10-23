// *lift(press) dans Chromium et Firefox réels : une balise désactivée ne s'enfonce pas. Chromium envoie
// `pointerdown` à un `<button disabled>` : sans garde, la touche inactive redescendait sous le doigt comme une
// touche active. Le témoin (la même touche, active) s'enfonce bien dans le même navigateur, ce qui prouve que le
// geste de la souris arrive jusqu'à la balise. La saisie au clavier (une carte focalisable marquée
// aria-disabled) ne l'appuie pas non plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
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

const STYLE = `<style>
.c
  display: block
  width: 200px
  height: 80px
  margin: 40px
  padding: 0
  border: 0
  background: #345
  color: #fff
  border-radius: 8px
fieldset
  margin: 0
  padding: 0
  border: 0
</style>`

const SOURCES: Record<string, string> = {
  'li-bouton.mjs':   `<button class="c" disabled *lift(on: always, press: true)>Touche</button>\n${STYLE}`,
  'li-aria.mjs':     `<div class="c" tabindex="0" aria-disabled="true" *lift(on: always, press: true)>Carte</div>\n${STYLE}`,
  'li-fieldset.mjs': `<fieldset disabled><button class="c" *lift(on: always, press: true)>Touche</button></fieldset>\n${STYLE}`,
  'li-actif.mjs':    `<button class="c" *lift(on: always, press: true)>Touche</button>\n${STYLE}`
}

const MONTEE = 'matrix(1, 0, 0, 1, 0, -8)'
const A_PLAT = 'matrix(1, 0, 0, 1, 0, 0)'

describe('*lift(press) (navigateurs réels) — une balise désactivée ne s\'enfonce pas', function () {
  this.timeout(180000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-lift-inactif')
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

      async function ouvre(tag: string) {
        const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.c'), tag)
        await page.waitForTimeout(400)
        return page
      }

      const vue = (page: any, tag: string) => page.evaluate((t: string) => {
        const el = (document.querySelector(t) as any)._shadow.querySelector('.c')
        return { transform: getComputedStyle(el).transform, appui: el.hasAttribute('mjs-fx-lift-press') }
      }, tag)

      const centre = (page: any, tag: string) => page.evaluate((t: string) => {
        const r = (document.querySelector(t) as any)._shadow.querySelector('.c').getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, tag)

      it('le témoin : une touche active s\'enfonce sous la souris (le geste arrive jusqu\'à la balise)', async function () {
        if (!present) { this.skip(); return }
        const page = await ouvre('mjs-li-actif')
        const p = await centre(page, 'mjs-li-actif')
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.waitForTimeout(450)
        assert.deepEqual(await vue(page, 'mjs-li-actif'), { transform: A_PLAT, appui: true })
        await page.mouse.up()
        await page.close()
      })

      it('<button disabled> et un bouton dans un fieldset désactivé : la souris ne les enfonce pas, ils restent soulevés', async function () {
        if (!present) { this.skip(); return }
        for (const tag of ['mjs-li-bouton', 'mjs-li-fieldset']) {
          const page = await ouvre(tag)
          const p = await centre(page, tag)
          assert.equal((await vue(page, tag)).transform, MONTEE, `${tag} : soulevé au repos`)
          await page.mouse.move(p.x, p.y)
          await page.mouse.down()
          await page.waitForTimeout(450)
          assert.deepEqual(await vue(page, tag), { transform: MONTEE, appui: false }, `${tag} : la souris enfoncée ne le baisse pas`)
          await page.mouse.up()
          await page.close()
        }
      })

      it('aria-disabled="true" : ni la souris ni Entrée ni Espace ne l\'enfoncent', async function () {
        if (!present) { this.skip(); return }
        const page = await ouvre('mjs-li-aria')
        const p = await centre(page, 'mjs-li-aria')
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.waitForTimeout(450)
        assert.deepEqual(await vue(page, 'mjs-li-aria'), { transform: MONTEE, appui: false }, 'la souris')
        await page.mouse.up()
        await page.evaluate(() => (document.querySelector('mjs-li-aria') as any)._shadow.querySelector('.c').focus())
        for (const k of ['Enter', ' ']) {
          await page.keyboard.down(k)
          await page.waitForTimeout(450)
          assert.deepEqual(await vue(page, 'mjs-li-aria'), { transform: MONTEE, appui: false }, `${JSON.stringify(k)} tenu`)
          await page.keyboard.up(k)
        }
        await page.close()
      })
    })
  }
})
