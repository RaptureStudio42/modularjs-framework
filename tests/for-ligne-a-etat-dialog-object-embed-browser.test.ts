// {for … by clé} : une ligne qui porte un `<dialog>`, un `<object>` ou un `<embed>` garde un état que son gabarit ne connaît pas (dialogue
// ouvert par `show()` / `showModal()`, document ou greffon chargé) : elle n'est jamais reprise pour une autre clé, ni quand toute la liste
// est remplacée, ni par la réserve après son retrait. Une ligne qui bouge garde son dialogue ouvert. Navigateurs réels, Chromium,
// Firefox et WebKit quand ils sont installés

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-ligne-a-etat-dialog'

const SOURCES: Record<string, string> = {
  'ligne-a-etat-dialog.mjs': `<script lang="coffee">
  $rows = [ { id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' } ]
  @remplacer = -> $rows = [ { id: 4, label: 'D' }, { id: 5, label: 'E' }, { id: 6, label: 'F' } ]
  @retirer = -> $rows = $rows.filter((r) -> r.id isnt 2)
  @ajouter = -> $rows = [...$rows, { id: 7, label: 'G' }]
  @tourner = -> $rows = [$rows[2], $rows[0], $rows[1]]
</script>
<div class="ld">
  {for row in $rows by id}
    <section class="row"><dialog class="d"><span>{row.label}</span></dialog><span class="lbl">{row.label}</span></section>
  {end}
</div>
<div class="lo">
  {for row in $rows by id}
    <section class="row"><object class="o" type="text/plain"></object><span class="lbl">{row.label}</span></section>
  {end}
</div>
<div class="le">
  {for row in $rows by id}
    <section class="row"><embed class="e" type="text/plain"><span class="lbl">{row.label}</span></section>
  {end}
</div>
`
}

// dans la page : chaque balise à état marquée de l'étiquette de sa ligne, le dialogue de B ouvert, puis le geste ; rend, pour chaque
// liste, les lignes `étiquette:marque[:ouvert]` (marque `-` : élément neuf)
const SCENE = (geste: string, modal: boolean) => `(async () => {
  const h = document.querySelector('${BALISE}'), sh = h._shadow
  for (const s of sh.querySelectorAll('section.row')) s.querySelector('dialog, object, embed').__ligne = s.querySelector('.lbl').textContent
  const b = [...sh.querySelectorAll('.ld section.row')].find((s) => s.querySelector('.lbl').textContent === 'B').querySelector('dialog')
  ${modal ? 'b.showModal()' : 'b.show()'}
  for (const g of ${JSON.stringify(geste.split(' '))}) {
    h[g]()
    await new Promise((r) => setTimeout(r, 60))
  }
  const lire = (c) => [...sh.querySelectorAll(c + ' section.row')].map((s) => {
    const x = s.querySelector('dialog, object, embed')
    return s.querySelector('.lbl').textContent + ':' + (x.__ligne || '-') + (x.open ? ':ouvert' : '')
  })
  return { d: lire('.ld'), o: lire('.lo'), e: lire('.le') }
})()`

const cible = construire('dev-parents-avant', SOURCES, [BALISE])

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`{for} : une ligne à <dialog>, <object> ou <embed> n'est jamais reprise pour une autre clé (${moteur} réel)`, function () {
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

  const jouer = async (geste: string, modal: boolean) => {
    const o = await charger(browser, await cible, BALISE)
    try {
      await o.page.waitForFunction(`document.querySelector('${BALISE}')?._shadow?.querySelectorAll('section.row').length === 9`, null, { timeout: 10000 })
      const vu = await o.page.evaluate(SCENE(geste, modal))
      assert.deepEqual(o.erreurs, [])
      return vu
    }
    finally {
      await o.fermer()
    }
  }

  it('toute la liste remplacée, dialogue de B ouvert par showModal() : les lignes neuves sont neuves, aucun dialogue ouvert', async function () {
    if (!present) { this.skip(); return }
    const vu = await jouer('remplacer', true)
    assert.deepEqual(vu, { d: ['D:-', 'E:-', 'F:-'], o: ['D:-', 'E:-', 'F:-'], e: ['D:-', 'E:-', 'F:-'] })
  })

  it('B retirée puis G ajoutée, dialogue de B ouvert par show() : la réserve ne rend pas la ligne de B à G', async function () {
    if (!present) { this.skip(); return }
    const vu = await jouer('retirer ajouter', false)
    assert.deepEqual(vu, { d: ['A:A', 'C:C', 'G:-'], o: ['A:A', 'C:C', 'G:-'], e: ['A:A', 'C:C', 'G:-'] })
  })

  it('les lignes tournent : B garde sa ligne et son dialogue ouvert', async function () {
    if (!present) { this.skip(); return }
    const vu = await jouer('tourner', false)
    assert.deepEqual(vu, { d: ['C:C', 'A:A', 'B:B:ouvert'], o: ['C:C', 'A:A', 'B:B'], e: ['C:C', 'A:A', 'B:B'] })
  })
})
