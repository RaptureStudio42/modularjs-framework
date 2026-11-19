// dans de vrais navigateurs (Chromium, Firefox, WebKit), en développement et en production : une page rechargée ou quittée pendant la
// demande d'une valeur qui attend (sans `µfailed`, son erreur irait à la console d'erreurs) — le navigateur coupe la demande, ce n'est
// pas une erreur de l'appli : rien dans la console. Les requêtes sont tenues par le test (`page.route`), jamais servies

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const MUETTE = `<script>
  $q = 0
  f  = (q) -> fetch("/api/m?q=#{q}").then((r) -> r.json())
  $m = await f($q)
</script>
<b class="v">{$m}</b>
`
const B = 'mjs-banc'

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('dérivée qui attend — page quittée pendant la demande (' + nav + ')', function () {
    this.timeout(120000)
    let browser: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[nav].executablePath())) { console.log('  ℹ️  ' + nav + ' non installé, test sauté'); return }
      browser = await playwright[nav].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const mode of ['dev-parents-avant', 'bundle'] as const) {
      it(mode + ' : rechargée, puis quittée — aucune erreur à la console', async function () {
        if (!browser) { this.skip(); return }
        let tenues = 0
        const relais = async (page: any) => {
          await page.route('**/api/**', () => { tenues++ })
          await page.route('http://liaison.test/ailleurs', (route: any) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>ailleurs</title><p>ailleurs</p>' }))
        }
        const o = await charger(browser, await construire(mode, { 'banc.mjs': `<@c-muette></@c-muette>`, 'c-muette.mjs': MUETTE }, [B]), B, '', 300, relais)
        try {
          const p = o.page
          const enVol = async (n: number) => {
            for (let i = 0; i < 50 && tenues < n; i++) await p.waitForTimeout(100)
            assert.equal(tenues, n, 'la demande est partie')
          }
          await enVol(1)
          await p.reload({ waitUntil: 'load' })
          await enVol(2)
          await p.waitForTimeout(500)
          await p.goto('http://liaison.test/ailleurs', { waitUntil: 'load' })
          await p.waitForTimeout(500)
          const dites = o.avis.filter((a) => /\$m\b|Failed to fetch|NetworkError|Load failed|fetch/i.test(a))
          assert.deepEqual(dites, [], 'la demande coupée par le départ de la page n\'est pas dite')
          assert.deepEqual(graves(o), [], 'aucune erreur de page')
        }
        finally {
          await o.fermer()
        }
      })
    }
  })
}
