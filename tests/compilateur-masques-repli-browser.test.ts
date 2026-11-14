// fallback d'un `<@failed>` dont l'interpolation cite `<style>` ou `<script>`, repli déclenché pour de bon (un enfant qui
// lève à son rendu) : le texte et le titre tels qu'écrits, dans Chromium, Firefox et WebKit, sans jeton interne à leur place

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const REPLI   = '<script>\n$n = 0\n</script>\n<@failed err reset>\n<p class="f" title={"<script>a</script>"}>{"<style>x</style>"}</p>\n</@failed>\n<@fragile></@fragile>\n'
// un enfant qui lève à son rendu quand `window.__boum` est posé
const FRAGILE = '<script>\n$obj = if window.__boum then null else {v: 1}\n</script>\n<p class="v">{$obj.v}</p>\n'
const MOTEURS = ['chromium', 'firefox', 'webkit']

describe('<@failed> : un fallback qui cite <style> ou <script> s\'affiche tel qu\'écrit, repli déclenché (trois moteurs)', function () {
  this.timeout(180000)

  it('texte et titre du fallback affiché', async () => {
    const root   = mjsTmp('masques-repli')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'repli.mjs'), REPLI)
    writeFileSync(join(srcDir, 'fragile.mjs'), FRAGILE)
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
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
        await page.evaluate(() => {
          (window as any).__boum = true
          document.body.innerHTML = '<mjs-repli></mjs-repli>'
        })
        await page.waitForFunction(() => (document.querySelector('mjs-repli') as any)?._shadow?.querySelector('.f') != null)
        vus.push(moteur + ' : ' + await page.evaluate(() => {
          const p = (document.querySelector('mjs-repli') as any)._shadow.querySelector('.f')
          return JSON.stringify([p.textContent, p.getAttribute('title')])
        }))
      }
      finally {
        await browser.close()
      }
    }
    assert.deepEqual(vus, MOTEURS.map((m) => m + ' : ' + JSON.stringify(['<style>x</style>', '<script>a</script>'])))
  })
})
