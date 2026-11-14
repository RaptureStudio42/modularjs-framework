// {for … by clé} vidé d'un coup pendant qu'un champ d'une ligne a le focus : Chromium envoie `blur` (et `focusout`) à ce champ
// pendant l'effacement, le nœud encore dans le document. Le gestionnaire d'une ligne pure lit l'élément de sa ligne sur l'entrée de
// la ligne (`_mjs_it`) : il doit y trouver l'élément de la ligne qui part, jamais une marque de la réserve. Firefox et WebKit
// n'envoient rien au retrait : le gestionnaire ne part pas, rien à lire. Navigateurs réels, Chromium, Firefox et WebKit quand ils sont
// installés

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-vidage-blur-ligne'

const SOURCES: Record<string, string> = {
  'vidage-blur-ligne.mjs': `<script lang="coffee">
  $rows = [ { id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' } ]
  noter = (r) -> window.__vu.push(if Array.isArray(r) then 'tableau' else if r? and r.label? then r.label else 'autre')
  @vider = -> $rows = []
</script>
<div>
  {for row in $rows by id}
    <section class="row"><input class="f" aria-label="saisie" @blur={-> noter(row)} /><span class="lbl">{row.label}</span></section>
  {end}
</div>
`
}

const cible = construire('dev-parents-avant', SOURCES, [BALISE])

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`{for} vidé d'un coup : le gestionnaire qui part pendant le retrait lit l'élément de sa ligne (${moteur} réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('focus dans la ligne B, liste vidée : `row` vaut l\'élément B, jamais la réserve', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, BALISE)
    try {
      await o.page.waitForFunction(`document.querySelector('${BALISE}')?._shadow?.querySelectorAll('section.row').length === 3`, null, { timeout: 10000 })
      const vu = await o.page.evaluate(`(async () => {
        window.__vu = []
        const h = document.querySelector('${BALISE}'), sh = h._shadow
        sh.querySelectorAll('input.f')[1].focus()
        h.vider()
        await new Promise((r) => setTimeout(r, 150))
        return { lignes: sh.querySelectorAll('section.row').length, vu: window.__vu }
      })()`)
      assert.equal(vu.lignes, 0, 'liste vidée')
      assert.ok(vu.vu.every((x: string) => x === 'B'), `le gestionnaire parti pendant le retrait lit l'élément de sa ligne : ${JSON.stringify(vu.vu)}`)
      if (moteur === 'chromium') assert.deepEqual(vu.vu, ['B'], 'Chromium envoie blur au retrait (sinon le test ne prouve rien)')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })
})
