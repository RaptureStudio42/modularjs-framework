// une liste qui part vide (`$liste = []`) n'est pas réconciliée à son premier rendu : rien n'est entre ses bornes, son état reste celui
// d'une liste absente, et la réconciliation n'est compilée qu'à sa première ligne (démarrage et mémoire au repos d'une page dont la
// liste arrive plus tard). Ensuite la liste se remplit, se vide et se remplit de nouveau comme avant, sans erreur ; une liste qui
// part pleine est réconciliée dès son premier rendu
// développement (l'état interne se lit sur la balise) et production en un seul fichier (les lignes seulement) ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'lv-vide.mjs': `<script>
  $liste = []

  @poser   = (l) -> $liste = l
  @ajouter = (x) -> $liste.push(x)
</script>
<ul class="l">{for x in $liste by id}<li>{x.nom}</li>{end}</ul>
<p class="pret">prêt</p>
`,
  'lv-pleine.mjs': `<script>
  $liste = [{ id: 1, nom: 'a' }]

  @poser = (l) -> $liste = l
</script>
<ul class="l">{for x in $liste by id}<li>{x.nom}</li>{end}</ul>
<p class="pret">prêt</p>
`
}

const BALISES = ['mjs-lv-vide', 'mjs-lv-pleine']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode) as Promise<Cible>
}

// les textes des lignes, séparés par des virgules
const lignes = (page: any, balise: string): Promise<string> => page.evaluate(`Array.from(document.querySelector('${balise}')._shadow.querySelectorAll('ul.l li')).map((n) => n.textContent).join(',')`)

const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
  await page.waitForTimeout(100)
}

const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(150)
}

// la liste a-t-elle été réconciliée (ancre posée par la réconciliation) ; lisible en développement seulement, les noms internes
// étant raccourcis en production
const reconciliee = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => { const a = document.querySelector('${balise}')._mjs_list_anchor; return !!a && Object.keys(a).length > 0 })()`)

for (const mode of ['dev-parents-avant', 'bundle'] as const) describe(`liste qui part vide, premier rendu sans réconciliation (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la liste qui part vide sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const jouer = async (balise: string, scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), balise)
    try {
      await pret(o.page, balise)
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('la liste vide au premier rendu n\'est pas réconciliée, puis se remplit, se vide et se remplit de nouveau', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-lv-vide'
    await jouer(B, async (page) => {
      assert.equal(await lignes(page, B), '', 'rien au premier rendu')
      if (mode !== 'bundle') assert.equal(await reconciliee(page, B), false, 'la liste vide n\'est pas réconciliée à son premier rendu')
      await regler(page, B, 'poser([{ id: 1, nom: \'a\' }, { id: 2, nom: \'b\' }])')
      assert.equal(await lignes(page, B), 'a,b', 'la liste se remplit')
      if (mode !== 'bundle') assert.equal(await reconciliee(page, B), true, 'réconciliée à sa première ligne')
      await regler(page, B, 'ajouter({ id: 3, nom: \'c\' })')
      assert.equal(await lignes(page, B), 'a,b,c', 'une ligne ajoutée en place')
      await regler(page, B, 'poser([])')
      assert.equal(await lignes(page, B), '', 'la liste se vide')
      await regler(page, B, 'poser([{ id: 2, nom: \'b\' }])')
      assert.equal(await lignes(page, B), 'b', 'la liste se remplit de nouveau')
    })
  })

  it('la liste vide au premier rendu se remplit par une ligne ajoutée en place', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-lv-vide'
    await jouer(B, async (page) => {
      await regler(page, B, 'ajouter({ id: 7, nom: \'g\' })')
      assert.equal(await lignes(page, B), 'g', 'la ligne ajoutée paraît')
    })
  })

  it('la liste pleine au premier rendu est réconciliée dès lui', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-lv-pleine'
    await jouer(B, async (page) => {
      assert.equal(await lignes(page, B), 'a', 'la ligne du premier rendu')
      if (mode !== 'bundle') assert.equal(await reconciliee(page, B), true, 'la liste pleine est réconciliée à son premier rendu')
      await regler(page, B, 'poser([])')
      assert.equal(await lignes(page, B), '', 'la liste se vide')
    })
  })
})
