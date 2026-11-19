// `$resultats = await rechercher($q, µsignal)` dans un vrai navigateur : la requête de la frappe dépassée est coupée sur le
// réseau (le navigateur la voit échouer, annulée), sa réponse ne vient jamais ; celle de la dernière frappe est montrée. Les
// requêtes de la recherche sont tenues par le test (`page.route`) jusqu'à sa réponse.
// Chromium ; développement

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const RESEAU = `<script>
  $q         = ''
  rechercher = (q, signal) -> if q then fetch("/api/search?q=#{q}", { signal }).then((r) -> r.json()) else Promise.resolve([])
  $resultats = await rechercher($q, µsignal)
  @chercher  = (q) -> $q = q
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
<i class="att">{µpending($resultats)}</i>
`
const B = 'mjs-reseau'

describe('dérivée qui attend : la requête dépassée est coupée (chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { console.log('  ℹ️  chromium non installé, test sauté'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('deux frappes : la première requête est annulée sur le réseau, la seconde est montrée', async function () {
    if (!browser) { this.skip(); return }
    const o = await charger(browser, await construire('dev-parents-avant', { 'reseau.mjs': RESEAU }, [B]), B)
    try {
      const p = o.page
      const tenues: Record<string, any> = {}
      const coupees: string[] = []
      await p.route('**/api/search**', (route: any) => { tenues[new URL(route.request().url()).searchParams.get('q') ?? ''] = route })
      p.on('requestfailed', (r: any) => coupees.push(new URL(r.url()).searchParams.get('q') + ' ' + (r.failure()?.errorText ?? '')))
      await p.waitForFunction(`document.querySelector('${B}')?._shadow?.querySelector('.att')?.textContent === 'false'`, null, { timeout: 10000 })
      await p.evaluate(`document.querySelector('${B}').chercher('a')`)
      await p.waitForTimeout(150)
      assert.ok(tenues.a, 'la frappe « a » demande au serveur')
      await p.evaluate(`document.querySelector('${B}').chercher('ab')`)
      await p.waitForTimeout(150)
      assert.ok(tenues.ab, 'la frappe « ab » demande au serveur')
      assert.deepEqual(coupees.map((c) => c.split(' ')[0]), ['a'], 'la requête de « a » est coupée — ' + coupees.join(' | '))
      assert.match(coupees[0], /ABORT|cancel/i, coupees[0])
      await tenues.ab.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 2, pseudo: 'Abel' }]) })
      await p.waitForFunction(`document.querySelector('${B}')._shadow.querySelector('.att').textContent === 'false'`, null, { timeout: 10000 })
      assert.equal(await p.evaluate(`Array.from(document.querySelector('${B}')._shadow.querySelectorAll('li')).map((l) => l.textContent).join(',')`), 'Abel')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
