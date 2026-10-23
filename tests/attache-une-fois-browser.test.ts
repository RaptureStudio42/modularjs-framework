// La carte qui suit la souris : son attache branche un rappel qui écrit `$light`, que la carte affiche.
// Sans `.once`, dans une ligne de `{for}` qui lit sa ligne, chaque mouvement redessine la ligne et rejoue
// l'attache (retrait puis pose à chaque `pointermove`). Avec `@attach.once`, 16 mouvements : une pose,
// aucun retrait. Vrai Chromium.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCE = (modificateur: string) => `<script>
  $light = 0
  $cartes = [{ key: 'a' }]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  suivre = (key) -> (node) ->
    ecoute = -> $light++
    node.addEventListener('pointermove', ecoute)
    log('pose ' + key)
    ->
      node.removeEventListener('pointermove', ecoute)
      log('retrait ' + key)
</script>

{for p in $cartes by key}<div class="carte" @attach${modificateur}={suivre(p.key)}>{p.key} {$light}</div>{end}
`

async function construire(prefixe: string, modificateur: string): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'demo-carte.mjs'), SOURCE(modificateur))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('@attach.once : la carte qui suit la souris (Chromium réel)', function () {
  this.timeout(120000)
  let present = false
  const scripts: Record<string, string> = {}

  before(async function () {
    present = await navigateurPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté')
      return
    }
    scripts.once = await construire('attache-une-fois-browser-once', '.once')
    scripts.sans = await construire('attache-une-fois-browser-sans', '')
  })

  after(async () => { await terminateSharedWorkerPool() })

  async function mouvements(script: string): Promise<{ journal: string[], light: number }> {
    const browser = await (await import('playwright')).chromium.launch()
    try {
      const page = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-demo-carte></mjs-demo-carte><script>${script}</script></body></html>` }))
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-demo-carte') as any)?._shadow?.querySelector('.carte'))
      await page.waitForTimeout(150)
      for (let i = 0; i < 16; i++) {
        await page.evaluate(() => (document.querySelector('mjs-demo-carte') as any)._shadow.querySelector('.carte').dispatchEvent(new PointerEvent('pointermove', { bubbles: true })))
        await page.waitForTimeout(20)
      }
      await page.waitForTimeout(150)
      const journal = await page.evaluate(() => [...((window as any).__journal ?? [])])
      const light   = await page.evaluate(() => (document.querySelector('mjs-demo-carte') as any)._shadow.querySelector('.carte').textContent)
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
      return { journal, light: parseInt(String(light).split(' ')[1], 10) }
    }
    finally {
      await browser.close()
    }
  }

  it('avec .once : 16 pointermove, une pose, aucun retrait', async function () {
    if (!present) { this.skip(); return }
    const { journal, light } = await mouvements(scripts.once)
    assert.deepEqual(journal, ['pose a'], 'une pose, aucun retrait')
    assert.equal(light, 16, 'les 16 mouvements ont bien écrit $light, affiché par la carte')
  })

  it('sans .once : la carte se redessine, l\'attache est rejouée (comportement inchangé)', async function () {
    if (!present) { this.skip(); return }
    const { journal } = await mouvements(scripts.sans)
    assert.ok(journal.filter((e) => e === 'retrait a').length >= 1, `rejouée sans .once : ${JSON.stringify(journal)}`)
  })
})
