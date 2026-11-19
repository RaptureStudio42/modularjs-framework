// `layout="grid"` écrit par une page serveur (du HTML que la construction ne lit pas) sur un composant qui déclare son propre `$layout`,
// dans une appli qui n'a aucun modèle de style : la valeur va à la variable, aucune feuille « grid » n'est demandée, aucun avertissement,
// en développement comme en production
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, construire, graves } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'ls-hote.mjs': '<p class="pret">prêt</p>\n',
  'ls-var.mjs': `<script>\n  $layout ?= 'list'\n</script>\n<p class="vu">{$layout}</p>\n`
}

// joué dans la page : le texte du composant et les feuilles « grid » demandées
async function lire(): Promise<{ texte: string, feuilles: string[] }> {
  const el: any = document.querySelector('mjs-ls-var')
  await new Promise((r) => setTimeout(r, 400))
  const feuilles = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /grid/.test(n))
  return { texte: el._shadow.querySelector('.vu').textContent, feuilles }
}

for (const nav of ['chromium', 'firefox']) for (const mode of ['dev-parents-avant', 'bundle'] as const) describe(`layout en clair venu d'une page serveur, appli sans modèle de style (${nav}, ${mode})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  let cible: any   = null
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
    cible   = await construire(mode, SOURCES, [])
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('la variable prend « grid », aucune feuille de style demandée, aucun avertissement', async function () {
    if (!present) { this.skip(); return }
    const page = { ...cible, document: (b: string, v: string) => cible.document(b, v).replace(`<${b}></${b}>`, `<${b}></${b}><mjs-ls-var layout="grid"></mjs-ls-var>`) }
    const o    = await charger(browser, page, 'mjs-ls-hote')
    try {
      await o.page.waitForFunction(`!!(document.querySelector('mjs-ls-var') && document.querySelector('mjs-ls-var')._shadow && document.querySelector('mjs-ls-var')._shadow.querySelector('.vu'))`, null, { timeout: 30000 })
      const r = await o.page.evaluate(lire)
      console.log(`      ${JSON.stringify(r)} | avis : ${JSON.stringify(o.avis.filter((a: string) => /grid|layout|modèle/i.test(a)))}`)
      assert.equal(r.texte, 'grid', 'la valeur va à $layout')
      assert.deepEqual(r.feuilles, [], 'aucune feuille « grid » demandée')
      assert.deepEqual(o.avis.filter((a: string) => /grid|layout|modèle/i.test(a)), [], 'aucun avertissement')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
