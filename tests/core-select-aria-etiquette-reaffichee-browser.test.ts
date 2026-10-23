// <@@select aria-labelledby> vers une étiquette dans un {if} : retirée puis réaffichée, l'étiquette est un NOUVEL
// élément. La liste doit rester nommée à chaque affichage (le bouton interne reçoit l'élément neuf par
// `ariaLabelledByElements` ; dans Chromium le nom se lit aussi dans l'arbre d'accessibilité), et le module ne
// guette toujours pas toute la racine de la liste tant que ses étiquettes sont là.
// Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $show = false
</script>
<@@select id="tard" name="t" aria-labelledby="tard-t"><@@option value="x">X</@@option></@@select>
<div id="encadre">{if $show}<span id="tard-t">Étiquette</span>{end}</div>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-etiquette-reaffichee')
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

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select aria-labelledby> : étiquette réaffichée (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  // les étiquettes du bouton interne : pour chacune, l'id et si l'élément est toujours dans la page
  const etiquettes = async () => JSON.parse(await page.evaluate(`JSON.stringify((document.querySelector('mjs-hote')._shadow.querySelector('#tard')._shadow.querySelector('.select-btn').ariaLabelledByElements || []).map((e) => e.id + (e.isConnected ? '' : ' (détachée)')))`))

  async function nom1() {
    const client = await page.context().newCDPSession(page)
    await client.send('Accessibility.enable')
    const { nodes } = await client.send('Accessibility.getFullAXTree')
    await client.detach()
    return nodes.filter((n: any) => !n.ignored && n.role?.value === 'combobox').map((n: any) => n.name?.value ?? '')[0]
  }

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
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('l\'étiquette affichée, retirée, réaffichée : la liste est nommée à chaque affichage', async function () {
    if (!present) { this.skip(); return }
    for (let i = 1; i <= 4; i++) {
      await page.evaluate(`document.querySelector('mjs-hote')._set('show', true)`)
      await page.waitForTimeout(400)
      assert.deepEqual(await etiquettes(), ['tard-t'], `affichage ${i} : le bouton tient l'étiquette de la page, vivante`)
      if (nom === 'chromium') assert.equal(await nom1(), 'Étiquette', `affichage ${i} : le nom dans l'arbre d'accessibilité`)
      await page.evaluate(`document.querySelector('mjs-hote')._set('show', false)`)
      await page.waitForTimeout(400)
    }
  })
})
