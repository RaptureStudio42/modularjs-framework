// module cœur color (<@@color>) dans Chromium réel : la pastille ne peint qu'une couleur. Une valeur qui n'en est pas une — souvent
// venue d'une donnée (couleur de profil, d'étiquette) — comme `url(https://…)` ne devient jamais une image de fond : aucune requête ne
// part vers le site qu'elle nomme (pixel de suivi, adresse IP du lecteur). Une vraie couleur peint toujours.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const HOTE = `<script>
  $c = 'url(https://pisteur.invalid/p.png)'
</script>
<@@color class="piege" value={$c}></@@color>
<@@color class="rouge" value="red"></@@color>
<@@color class="oklch" value="oklch(62% .19 245)"></@@color>
`

describe('mjs-core-color — une valeur qui n\'est pas une couleur n\'est jamais peinte (chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  const requetes: string[] = []

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) return
    const root   = mjsTmp('color-hors-couleur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page    = await browser.newPage()
    page.on('request', (r: any) => { if (!r.url().startsWith('data:')) requetes.push(r.url()) })
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(`!!document.querySelector('mjs-hote')?._shadow?.querySelector('.oklch')?._shadow?.querySelector('.swatch')`)
    await page.waitForTimeout(600)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const fond = (sel: string) => page.evaluate(`(() => { const s = getComputedStyle(document.querySelector('mjs-hote')._shadow.querySelector('${sel}')._shadow.querySelector('.swatch')); return { image: s.backgroundImage, couleur: s.backgroundColor } })()`)

  it('value="url(https://…)" : aucune requête vers le site nommé, aucune image de fond', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(requetes.filter((u) => u.includes('pisteur.invalid')), [])
    assert.equal((await fond('.piege')).image, 'none')
  })

  it('une vraie couleur peint toujours la pastille, quelle que soit sa syntaxe', async function () {
    if (!present) { this.skip(); return }
    assert.equal((await fond('.rouge')).couleur, 'rgb(255, 0, 0)')
    assert.match((await fond('.oklch')).couleur, /^oklch\(/)
  })
})
