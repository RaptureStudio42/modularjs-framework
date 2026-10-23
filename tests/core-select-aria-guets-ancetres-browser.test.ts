// <@@select aria-labelledby> vers une étiquette posée sous plusieurs ancêtres : retirer un ANCÊTRE de l'étiquette
// (pas son parent direct) puis le remettre doit être vu — la liste perd son nom, puis le retrouve. Et mille
// insertions au niveau du parent direct de l'étiquette ne relancent pas mille fois la mise en place des guets :
// la liste de ce qui est guetté n'ayant pas changé, le module n'y touche pas.
// Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<@@select id="tard" name="t" aria-labelledby="tard-t"><@@option value="x">X</@@option></@@select>
<div id="grand"><section id="parent"><span id="tard-t">Étiquette</span></section></div>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-etiquette-ancetre')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compile
}

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select aria-labelledby> : ancêtres de l'étiquette et coût des guets (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const etiquettes = async () => JSON.parse(await page.evaluate(`JSON.stringify((document.querySelector('mjs-hote')._shadow.querySelector('#tard')._shadow.querySelector('.select-btn').ariaLabelledByElements || []).map((e) => e.id + (e.isConnected ? '' : ' (détachée)')))`))

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const code = await script()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#tard')?._shadow?.querySelector('.select-btn'))
      await page.waitForTimeout(500)
      // compte les mises en place des guets : chaque `disconnect` d'un observateur (le prototype est lu à chaque appel)
      await page.evaluate(`(() => { const D = MutationObserver.prototype.disconnect; window.__disc = 0; MutationObserver.prototype.disconnect = function () { window.__disc++; return D.call(this) } })()`)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('un ancêtre de l\'étiquette retiré puis remis : la liste perd son nom, puis le retrouve', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await etiquettes(), ['tard-t'], 'au départ')
    await page.evaluate(`(() => { const r = document.querySelector('mjs-hote')._shadow; window.__grand = r.querySelector('#grand'); window.__grand.remove() })()`)
    await page.waitForTimeout(300)
    assert.deepEqual(await etiquettes(), [], 'l\'ancêtre est parti avec l\'étiquette : plus de nom')
    await page.evaluate(`(() => { const r = document.querySelector('mjs-hote')._shadow; r.appendChild(window.__grand) })()`)
    await page.waitForTimeout(300)
    assert.deepEqual(await etiquettes(), ['tard-t'], 'l\'ancêtre est revenu : le nom aussi')
    assert.ok(await page.evaluate('window.__disc') > 0, 'le compteur de disconnect voit les remises en place')
  })

  it('1 000 insertions au niveau du parent direct : aucune remise en place des guets', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`window.__disc = 0`)
    const ms = await page.evaluate(`(async () => { const p = document.querySelector('mjs-hote')._shadow.querySelector('#parent'); const t0 = performance.now(); for (let i = 0; i < 1000; i++) { p.appendChild(document.createElement('i')); await 0 } await new Promise((r) => setTimeout(r, 100)); return performance.now() - t0 })()`)
    const disc = await page.evaluate('window.__disc')
    console.log(`      ${nom} : 1000 insertions, ${Math.round(ms)} ms, ${disc} disconnect`)
    assert.ok(disc <= 5, `${disc} disconnect pour 1000 insertions`)
    assert.deepEqual(await etiquettes(), ['tard-t'], 'le nom tient toujours')
  })
})
