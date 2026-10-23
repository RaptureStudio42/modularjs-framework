// <@@select aria-labelledby> vers deux étiquettes sous un même ancêtre : la liste des éléments guettés ne cite
// chaque parent qu'une fois (le grand-père commun et la racine ne sont observés qu'une seule fois).
// Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<@@select id="tard" name="t" aria-labelledby="la lb"><@@option value="x">X</@@option></@@select>
<div id="grand"><section id="p1"><span id="la">A</span></section><section id="p2"><span id="lb">B</span></section></div>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-guets-sans-doublon')
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

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select aria-labelledby> : guets sans doublon (${nom} réel)`, function () {
  this.timeout(180000)
  let browser: any

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('deux étiquettes sous un même ancêtre : chaque parent n\'est guetté qu\'une fois', async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) { this.skip(); return }
    const code = await script()
    browser = await playwright[nom].launch()
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#tard')?._shadow?.querySelector('.select-btn'))
    await page.waitForTimeout(500)
    await page.evaluate(`(() => { const O = MutationObserver.prototype.observe; window.__obs = []; MutationObserver.prototype.observe = function (n, o) { window.__obs.push(n.id || (n.nodeType === 11 ? 'racine' : n.nodeName)); return O.call(this, n, o) } })()`)
    // l'ordre change : la liste des cibles est refaite
    await page.evaluate(`(() => { document.querySelector('mjs-hote')._shadow.querySelector('#tard').setAttribute('aria-labelledby', 'lb la') })()`)
    await page.waitForTimeout(300)
    const obs = await page.evaluate('window.__obs')
    assert.ok(obs.length > 0, 'les guets ont été refaits')
    assert.deepEqual(obs, [...new Set(obs)], `aucun parent guetté deux fois : ${JSON.stringify(obs)}`)
  })
})
