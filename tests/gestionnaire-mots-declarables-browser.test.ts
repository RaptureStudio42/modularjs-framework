// un mot du langage que Civet prend pour un nom (`on`, `yes`…), déclaré dans le <script>, est appelé par `<@window @keyup=on>` et
// par `@click=on` dans le fallback d'un `<@failed>`, comme sur un élément ; le gestionnaire levait « undefined is not a function »
// à chaque touche, et le bouton du fallback était mort. Chromium réel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function chromium(): Promise<any> {
  try {
    return (await import('playwright')).chromium
  }
  catch {
    return (await import('@playwright/test' as string)).chromium
  }
}

describe('mot du langage déclaré, nommé seul : appelé sur une balise globale et dans un <@failed> (Chromium)', function () {
  this.timeout(120000)

  it('<@window @keyup=on> et @click=on dans le fallback appellent la fonction on du <script>, sans erreur', async () => {
    const root   = mjsTmp('gestionnaire-mots-declarables')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'kwf.mjs'), [
      '<script>',
      '$n = 0',
      'on = -> window.__on = (window.__on ?? 0) + 1',
      '</script>',
      '<@window @keyup=on />',
      '<@failed err reset>',
      '<p class="err">{err.message}</p>',
      '<button class="on-f" @click=on>F</button>',
      '</@failed>',
      '<@fragile></@fragile>',
      '',
    ].join('\n'))
    writeFileSync(join(srcDir, 'fragile.mjs'), '<script>\n$obj = if window.__boum then null else {v: 1}\n</script>\n<p class="v">{$obj.v}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const browser = await (await chromium()).launch()
    try {
      const page    = await browser.newPage()
      const erreurs = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
      await page.evaluate(() => {
        (window as any).__boum = true
        document.body.innerHTML = '<mjs-kwf></mjs-kwf>'
      })
      await page.waitForFunction(() => (document.querySelector('mjs-kwf') as any)?._shadow?.querySelector('.on-f') != null)
      erreurs.length = 0
      const compte = () => page.evaluate(() => (window as any).__on ?? 0)
      await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })) })
      await page.waitForTimeout(50)
      assert.equal(await compte(), 1, '<@window @keyup=on>')
      await page.evaluate(() => (document.querySelector('mjs-kwf') as any)._shadow.querySelector('.on-f').click())
      await page.waitForTimeout(50)
      assert.equal(await compte(), 2, '@click=on dans le fallback')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await browser.close()
    }
  })
})
