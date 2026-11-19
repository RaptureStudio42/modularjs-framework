// Une attache `:attach={f(_node)}` qui appelle une fonction du <script> se pose une fois, comme en 4.0.0, dans un vrai navigateur
// (Chromium, Firefox, WebKit) : la forme d'un verrou qui publie son état dans un magasin (`$$ui.locked = true`, nettoyage
// `-> $$ui.locked = false`) se relançait sur sa propre écriture jusqu'au garde-fou des 10 000 rendus ; celle d'un bouton « haut de
// page » dont l'attache lit `$shown` se réinstallait à chaque changement de `$shown`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const VERROU = '<script>\n$$ui = { locked: false }\npublish = (node) ->\n  globalThis.__publie = (globalThis.__publie or 0) + 1\n  $$ui.locked = true\n  -> $$ui.locked = false\n</script>\n<div class="verrou" :attach={publish(_node)}>{if $$ui.locked}L{else}O{end}</div>\n'
const HAUT   = '<script>\n$shown = false\nhook = (node) ->\n  globalThis.__pose = (globalThis.__pose or 0) + 1\n  node.dataset.vu = String($shown)\n  -> null\n</script>\n<div class="haut" :attach={hook(_node)}>{$shown}</div>\n<button class="bascule" @click={$shown = not $shown}>b</button>\n'

async function moteur(nom: string): Promise<any> {
  try {
    return (await import('playwright') as any)[nom]
  }
  catch {
    return (await import('@playwright/test' as string) as any)[nom]
  }
}

describe('attache qui appelle une fonction du <script> : un seul passage (navigateur)', function () {
  this.timeout(180000)

  let code = ''

  before(async () => {
    const root   = mjsTmp('attache-fonction-un-passage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'verrou.mjs'), VERROU)
    writeFileSync(join(srcDir, 'haut.mjs'), HAUT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) {
    it(`${nom} : le verrou publie une fois, le bouton « haut » se pose une fois malgré six bascules`, async () => {
      const browser = await (await moteur(nom)).launch()
      try {
        const page    = await browser.newPage()
        const erreurs = [] as string[]
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
        await page.evaluate(() => { document.body.innerHTML = '<mjs-verrou></mjs-verrou><mjs-haut></mjs-haut>' })
        await page.waitForFunction(() => ((document.querySelector('mjs-verrou') as any)?._shadow?.querySelector('.verrou')?.textContent ?? '').trim() === 'L')
        await page.waitForFunction(() => (document.querySelector('mjs-haut') as any)?._shadow?.querySelector('.bascule') != null)
        for (let i = 0; i < 6; i++) {
          await page.evaluate(() => (document.querySelector('mjs-haut') as any)._shadow.querySelector('.bascule').click())
          await page.waitForFunction((n) => ((document.querySelector('mjs-haut') as any)._shadow.querySelector('.haut').textContent ?? '').trim() === String(n % 2 === 0), i, { timeout: 5000 })
        }
        await new Promise((r) => setTimeout(r, 200))
        const passages = await page.evaluate(() => ({ publie: (globalThis as any).__publie, pose: (globalThis as any).__pose }))
        assert.deepEqual(passages, { publie: 1, pose: 1 })
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
