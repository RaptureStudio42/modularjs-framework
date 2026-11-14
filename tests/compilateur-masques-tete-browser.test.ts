// titre du document et méta d'un `<@head>` dont l'interpolation cite `<style>` ou `<script>` : le texte tel qu'écrit, dans Chromium,
// Firefox et WebKit, sans jeton interne à sa place

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { SCRIPT } from './helpers/composants-pieges.js'

const TETE    = '<@head>\n<title>{"<style>x</style>"}</title>\n<meta name="d" content={"<script>a</script>"}>\n</@head>\n<p class="k">t</p>\n'
const MOTEURS = ['chromium', 'firefox', 'webkit']

describe('<@head> : une interpolation qui cite <style> ou <script> s\'affiche telle qu\'écrite (trois moteurs)', function () {
  this.timeout(180000)

  it('titre du document et contenu de la méta', async () => {
    const root   = mjsTmp('masques-tete')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'tete.mjs'), SCRIPT + TETE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const playwright: any = await import('playwright')
    const vus = [] as string[]
    // un navigateur à la fois
    for (const moteur of MOTEURS) {
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        await page.setContent('<!doctype html><html><head><title>t</title></head><body></body></html>')
        await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
        await page.evaluate(() => { document.body.innerHTML = '<mjs-tete></mjs-tete>' })
        await page.waitForFunction(() => document.querySelector('meta[name="d"]') !== null)
        vus.push(moteur + ' : ' + await page.evaluate(() => JSON.stringify([document.title, document.querySelector('meta[name="d"]')?.getAttribute('content')])))
      }
      finally {
        await browser.close()
      }
    }
    assert.deepEqual(vus, MOTEURS.map((m) => m + ' : ' + JSON.stringify(['<style>x</style>', '<script>a</script>'])))
  })
})
