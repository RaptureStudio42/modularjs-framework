// *blend(color: …) sur une image (le chemin du filtre SVG), dans Chromium réel : la couleur du calque est lue sur la balise elle-même,
// pas sur son parent — une variable posée sur l'image (`var(--teinte)`) et sa propre couleur (`currentColor`) y sont vues ; le parent,
// bleu, ne prête pas la sienne. La lecture ne laisse rien sur la balise (ni `caret-color` ni `transition` écrits en ligne).

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

const PX     = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#fff"/></svg>')
const SOURCE = '<div class="p"><img class="i" src="' + PX + '" *blend(color: var(--teinte), mode: multiply)><img class="k" src="' + PX + '" *blend(color: currentColor, mode: multiply)></div>\n<style>\n.p\n  color: rgb(0, 0, 255)\n.i\n  --teinte: rgb(255, 0, 0)\n.k\n  color: rgb(0, 128, 0)\n.i, .k\n  width: 40px\n  height: 40px\n</style>\n'

describe('*blend dans Chromium réel — la couleur du calque lue sur la balise', function () {
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
    const root   = mjsTmp('effets-fusion-couleur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-teinte.mjs'), SOURCE)
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

  it('var(--teinte) posée sur l\'image donne un calque rouge, currentColor de l\'image un calque vert ; rien ne reste écrit sur elles', async function () {
    if (!present) return this.skip()
    const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-fx-teinte></mjs-fx-teinte><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => ((document.querySelector('mjs-fx-teinte') as any)?._shadow?.querySelectorAll('feFlood').length || 0) >= 2)
    const vu = await page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-fx-teinte') as any)._shadow
      const imgs = Array.from(sh.querySelectorAll('img')) as any[]
      return {
        couleurs: (Array.from(sh.querySelectorAll('feFlood')) as any[]).map((f) => f.getAttribute('flood-color')).sort(),
        laisse: imgs.map((i) => i.style.getPropertyValue('caret-color') + '|' + i.style.getPropertyValue('transition-property'))
      }
    })
    await page.close()
    assert.deepEqual(erreurs, [])
    assert.deepEqual(vu.couleurs, ['rgb(0, 128, 0)', 'rgb(255, 0, 0)'], 'les couleurs vues sur les images, pas le bleu du parent')
    assert.deepEqual(vu.laisse, ['|', '|'], 'ni caret-color ni transition laissés en ligne')
  })
})
