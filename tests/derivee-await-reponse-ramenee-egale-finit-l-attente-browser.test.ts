// dans de vrais navigateurs (Chromium, Firefox, WebKit), en développement et en production : une réponse que le type du <vars>
// ramène sur la valeur déjà affichée (`$r int 0..100` montre 100, la réponse suivante vaut 300) finit l'attente à l'écran,
// `$occupe = µpending($r)` compris. Les requêtes sont tenues par le test (`page.route`)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const TYPEE = `<vars>
  $r int 0..100
</vars>
<script>
  $q        = 0
  f         = (q, signal) -> fetch("/api/t?q=#{q}", { signal }).then((r) -> r.json())
  $r        = await f($q, µsignal)
  $occupe   = µpending($r)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$r}</b><i class="occ">{$occupe}</i><s class="att">{µpending($r)}</s><u class="err">{µfailed($r)?.message}</u>
`
const B  = 'mjs-banc'
const EN = `document.querySelector('${B}')._shadow.querySelector('mjs-c-typee')`
const VU = `(() => { const e = ${EN}; return e ? ['v', 'occ', 'att', 'err'].map((c) => e._shadow.querySelector('.' + c)?.textContent ?? '∅').join('|') : '∅' })()`

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('dérivée qui attend — réponse ramenée sur la valeur affichée (' + nav + ')', function () {
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
      it(mode + ' : 100, puis 300 ramené à 100 — l\'attente finit à l\'écran', async function () {
        if (!browser) { this.skip(); return }
        const tenues: Record<string, any[]> = {}
        const relais = async (page: any) => {
          await page.route('**/api/**', (route: any) => { const q = new URL(route.request().url()).searchParams.get('q') ?? ''; (tenues[q] ||= []).push(route) })
        }
        const o = await charger(browser, await construire(mode, { 'banc.mjs': `<@c-typee></@c-typee>`, 'c-typee.mjs': TYPEE }, [B]), B, '', 200, relais)
        try {
          const p   = o.page
          const rep = async (q: string, corps: any) => { const r = (tenues[q] || []).pop(); assert.ok(r, 'rien de tenu pour q=' + q); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) }); await p.waitForTimeout(150) }
          await p.waitForFunction(`!!(${EN})`, null, { timeout: 10000 })
          await p.waitForTimeout(300)
          // le mode des types que le manifeste pose dans une vraie page de développement
          if (mode === 'dev-parents-avant') await p.evaluate('µ._typesMode = "warn"')
          await rep('0', 100)
          assert.equal(await p.evaluate(VU), '100|false|false|')
          await p.evaluate(`${EN}.chercher(1)`)
          await p.waitForTimeout(150)
          assert.equal(await p.evaluate(VU), '100|true|true|', 'l\'attente se voit')
          await rep('1', 300)
          assert.equal(await p.evaluate(VU), '100|false|false|', 'l\'écran montre l\'attente finie')
          assert.deepEqual(graves(o), [], 'aucune erreur de page')
        }
        finally {
          await o.fermer()
        }
      })
    }
  })
}
