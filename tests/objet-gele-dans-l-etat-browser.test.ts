// Un objet GELÉ rangé dans l'état, dans Chromium réel (production : le bundle se charge en module, donc en mode strict) :
// - il s'affiche (champ profond, `{for}` sur un tableau imbriqué) — l'enveloppe réactive violait la règle des Proxy
//   (une propriété figée doit rendre SA valeur), et le composant restait vide ;
// - y écrire fait ce que fait le navigateur sans le framework : une TypeError « Cannot assign to read only property »,
//   que l'écriture soit suivie par le compilateur (`$rows[0].nom = 'b'`) ou passe par un alias (`poser($rows[0])`) ;
//   ajouter une clé à un objet scellé lève de même. Rien n'est réécrit, l'affichage ne bouge pas.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'gel-ecrire.mjs': `<script>
  window.__j = []
  $rows = [Object.freeze({ nom: 'a', enfants: ['x', 'y'], info: { v: 1 } })]
  $s    = Object.seal({ n: 1 })
  poser   = (o) -> o.nom = 'b'
  ajouter = (o) -> o.neuf = 1
  essayer = (qui, f) ->
    try
      f()
      window.__j.push(qui + ' : ok')
    catch err
      window.__j.push(qui + ' : ' + err.constructor.name + ' ' + err.message)
  @ecrire = ->
    essayer 'suivie', -> $rows[0].nom = 'b'
    essayer 'alias', -> poser($rows[0])
    essayer 'natif', -> poser(Object.freeze({ nom: 'a' }))
    essayer 'scellé', -> ajouter($s)
    essayer 'scellé natif', -> ajouter(Object.seal({ n: 1 }))
</script>
{for row in $rows}<p class="v">{row.nom}-{row.info.v}</p><ul>{for nom in row.enfants}<li>{nom}</li>{end}</ul>{end}
`
}
const BALISE = 'mjs-gel-ecrire'

// ce que montre le composant : les paragraphes `.v`, puis les éléments de liste
const vu = (page: any): Promise<string> => page.evaluate(`(() => {
  const r = document.querySelector('${BALISE}')._shadow
  return [...r.querySelectorAll('p.v')].map((p) => p.textContent).join('|') + ' / ' + [...r.querySelectorAll('li')].map((li) => li.textContent).join(',')
})()`)

describe('objet gelé dans l\'état, Chromium réel (production)', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) {
      console.log('  ℹ️  chromium non installé, test de l\'objet gelé sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('il s\'affiche ; une écriture lève la même erreur que sans le framework, et ne change rien', async () => {
    const o = await charger(browser, await construire('bundle', SOURCES, [BALISE]), BALISE)
    try {
      await o.page.waitForFunction(`!!(document.querySelector('${BALISE}') || {})._shadow`, null, { timeout: 10000 })
      await o.page.waitForTimeout(300)
      assert.equal(await vu(o.page), 'a-1 / x,y')
      await o.page.evaluate(`document.querySelector('${BALISE}').ecrire()`)
      await o.page.waitForTimeout(100)
      const j     = await o.page.evaluate('window.__j.slice()') as string[]
      const issue = (qui: string) => (j.find((l) => l.startsWith(qui + ' : ')) ?? qui + ' : absent').slice(qui.length + 3)
      assert.match(issue('natif'), /^TypeError /)
      assert.equal(issue('suivie'), issue('natif'))
      assert.equal(issue('alias'), issue('natif'))
      assert.match(issue('scellé natif'), /^TypeError /)
      assert.equal(issue('scellé'), issue('scellé natif'))
      assert.equal(await vu(o.page), 'a-1 / x,y')
      assert.deepEqual(graves(o), [])
    } finally {
      await o.fermer()
    }
  })
})
