// dans le fallback d'un `<@failed>`, un nom seul entre accolades appelle ce qu'il nomme, comme la forme nue : `@click={reset}`
// relance le rendu, `@click={fn}` appelle la fonction du <script>, `@click={@remet}` la méthode du composant, `@click={alert}`
// ouvre la boîte du navigateur. Ces boutons étaient morts : le gestionnaire rendait le nom sans l'appeler. `@click=@remet` et
// `@click={@remet}` appellent la méthode avec le composant pour `this` (la balise la recevait). Chromium réel

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

describe('<@failed> — un nom seul entre accolades est appelé (Chromium)', function () {
  this.timeout(120000)

  it('{alert}, {@remet}, @remet, {fn}, { fn } et {reset} font leur appel, la méthode avec le composant pour this', async () => {
    const root   = mjsTmp('gestionnaire-failed-accolades')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'garde.mjs'), [
      '<script>',
      '$n = 0',
      '@remet = -> (window.__qui ??= []).push(@tagName)',
      'fn = -> window.__fn = (window.__fn ?? 0) + 1',
      '</script>',
      '<@failed err reset>',
      '<p class="err">{err.message}</p>',
      '<button class="a" @click={alert}>A</button>',
      '<button class="m" @click={@remet}>M</button>',
      '<button class="m-nu" @click=@remet>M</button>',
      '<button class="f" @click={fn}>F</button>',
      '<button class="f-esp" @click={ fn }>F</button>',
      '<button class="r" @click={reset}>R</button>',
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
      const boites  = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      page.on('dialog', (d: any) => {
        boites.push(d.type())
        d.dismiss().catch(() => {})
      })
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
      await page.evaluate(() => {
        (window as any).__boum = true
        document.body.innerHTML = '<mjs-garde></mjs-garde>'
      })
      await page.waitForFunction(() => (document.querySelector('mjs-garde') as any)?._shadow?.querySelector('.err') != null)
      erreurs.length = 0
      await page.evaluate(() => { (window as any).__boum = false })
      const clic = (c: string) => page.evaluate((x: string) => (document.querySelector('mjs-garde') as any)._shadow.querySelector(`.${x}`).click(), c)
      for (const c of ['a', 'm', 'm-nu', 'f', 'f-esp']) {
        await clic(c)
        await page.waitForTimeout(50)
      }
      assert.deepEqual(boites, ['alert'])
      assert.deepEqual(await page.evaluate(() => (window as any).__qui ?? []), ['MJS-GARDE', 'MJS-GARDE'])
      assert.equal(await page.evaluate(() => (window as any).__fn ?? 0), 2)
      await clic('r')
      await page.waitForFunction(() => (document.querySelector('mjs-garde') as any)?._shadow?.querySelector('mjs-fragile')?._shadow?.querySelector('.v')?.textContent === '1', null, { timeout: 3000 })
      assert.deepEqual(erreurs, [])
    }
    finally {
      await browser.close()
    }
  })
})
