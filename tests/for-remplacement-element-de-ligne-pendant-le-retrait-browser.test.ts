// {for … by clé} remplacé (toutes les clés, ou une ligne au milieu) pendant qu'un champ d'une ligne qui part a le focus : Chromium
// envoie `blur` (et `focusout`) à ce champ pendant le retrait, le nœud encore dans le document. Le gestionnaire de la ligne reçoit
// l'élément de SA ligne, jamais celui de même rang dans la nouvelle liste, que la ligne soit pure (élément lu sur l'entrée de la ligne)
// ou ordinaire (elle lit aussi une variable du composant). Firefox et WebKit n'envoient rien au retrait. Navigateurs réels, Chromium,
// Firefox et WebKit quand ils sont installés

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const ligne = (lbl: string) => `<section class="row"><input class="f" aria-label="saisie" @blur={-> noter(row)} /><span class="lbl">${lbl}</span></section>`
const script = `<script lang="coffee">
  $rows = [ { id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' } ]
  $suffixe = ''
  noter = (r) -> window.__vu.push(if Array.isArray(r) then 'tableau' else if r? and r.label? then r.label else 'autre')
  @tout = -> $rows = [ { id: 4, label: 'D' }, { id: 5, label: 'E' }, { id: 6, label: 'F' } ]
  @partiel = -> $rows = [ $rows[0], { id: 7, label: 'G' }, $rows[2] ]
</script>`
const SOURCES: Record<string, string> = {
  // ligne pure : balises natives, l'élément de la ligne seul
  'remplace-pure.mjs': `${script}\n<div>\n  {for row in $rows by id}\n    ${ligne('{row.label}')}\n  {end}\n</div>\n`,
  // ligne ordinaire : elle lit aussi une variable du composant
  'remplace-ordinaire.mjs': `${script}\n<div>\n  {for row in $rows by id}\n    ${ligne('{row.label}{$suffixe}')}\n  {end}\n</div>\n`,
}

const cible = construire('dev-parents-avant', SOURCES, ['mjs-remplace-pure', 'mjs-remplace-ordinaire'])

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`{for} remplacé : le gestionnaire qui part pendant le retrait lit l'élément de sa ligne (${moteur} réel)`, function () {
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

  for (const balise of ['mjs-remplace-pure', 'mjs-remplace-ordinaire']) for (const geste of ['tout', 'partiel']) {
    it(`${balise.slice(13)}, remplacement ${geste}, focus dans la ligne B qui part : \`row\` vaut l'élément B`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible, balise)
      try {
        await o.page.waitForFunction(`document.querySelector('${balise}')?._shadow?.querySelectorAll('section.row').length === 3`, null, { timeout: 10000 })
        const vu = await o.page.evaluate(`(async () => {
          window.__vu = []
          const h = document.querySelector('${balise}'), sh = h._shadow
          sh.querySelectorAll('input.f')[1].focus()
          h.${geste}()
          await new Promise((r) => setTimeout(r, 150))
          return { lignes: [...sh.querySelectorAll('.lbl')].map((s) => s.textContent).join(','), vu: window.__vu }
        })()`)
        assert.equal(vu.lignes, geste === 'tout' ? 'D,E,F' : 'A,G,C', 'liste remplacée')
        assert.ok(vu.vu.every((x: string) => x === 'B'), `le gestionnaire parti pendant le retrait lit l'élément de sa ligne : ${JSON.stringify(vu.vu)}`)
        if (moteur === 'chromium') assert.deepEqual(vu.vu, ['B'], 'Chromium envoie blur au retrait (sinon le test ne prouve rien)')
        assert.deepEqual(o.erreurs, [])
      }
      finally {
        await o.fermer()
      }
    })
  }
})
