// `<@module $comp>` dans une ligne de `{for}` : le gestionnaire posé sur la balise (`@click={…}`) agit sur sa propre ligne, au premier
// rendu (le composant demandé remplace déjà le repère), après un changement de composant et après un déplacement de la ligne par sa clé,
// au premier niveau comme au cinquième. Sans les rangs de la ligne sur le composant vivant, chaque clic agissait sur la première ligne.
// Navigateurs réels, en développement, en production (noms raccourcis) et après un rendu serveur refait par le navigateur
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const DONNEES = "[{ id: 1, b: [{ id: 2, c: [{ id: 3, d: [{ id: 4, f: [{ id: 5 }, { id: 6 }] }] }] }] }, { id: 7, b: [{ id: 8, c: [{ id: 9, d: [{ id: 10, f: [{ id: 11 }, { id: 12 }] }] }] }] }]"
const SOURCES: Record<string, string> = {
  'c-ma.mjs': '<span>A</span>\n',
  'c-mb.mjs': '<span>B</span>\n',
  'ml-un.mjs': `<script>
$comp = 'c-ma'
$sel  = ''
$rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
</script>
{for r in $rows by id}<@module $comp class="l" data-k={r.id} role="button" tabindex="0" @click={$sel = r.id + ':' + index}></@module>{end}
<p class="vu">{$sel}</p>
<button class="changer" @click={$comp = 'c-mb'}>c</button>
<button class="inverser" @click={$rows.reverse()}>i</button>
`,
  'ml-cinq.mjs': `<script>
$comp = 'c-ma'
$sel  = ''
$a    = ${DONNEES}
inverser = -> $a[0].b[0].c[0].d[0].f.reverse()
</script>
{for a in $a by id}{for b in a.b by id}{for c in b.c by id}{for d in c.d by id}{for f in d.f by id}<@module $comp class="l" data-k={f.id} role="button" tabindex="0" @click={$sel = a.id + '-' + b.id + '-' + c.id + '-' + d.id + '-' + f.id}></@module>{end}{end}{end}{end}{end}
<p class="vu">{$sel}</p>
<button class="changer" @click={$comp = 'c-mb'}>c</button>
<button class="inverser" @click={inverser()}>i</button>
`
}
const HOTES = ['mjs-ml-un', 'mjs-ml-cinq']

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>
const MODES: Array<[Mode, string]> = [['dev-parents-avant', ''], ['bundle', ''], ['ssr', 'replace']]
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, HOTES))
  return cibles.get(mode)!
}

const OMBRE = (hote: string) => `document.querySelector('${hote}')._shadow`
// clique la ligne `k` et rend ce que montre `.vu`
async function choisir(page: any, hote: string, k: number): Promise<string> {
  await page.waitForFunction(`!!${OMBRE(hote)}?.querySelector('[data-k="${k}"]')`, null, { timeout: 5000 }).catch(() => {})
  const r = await page.evaluate(`(() => { const n = ${OMBRE(hote)}.querySelector('[data-k="${k}"]'); if (!n) return 'absent'; n.click(); return 'ok' })()`)
  if (r !== 'ok') return r
  await page.waitForTimeout(80)
  return page.evaluate(`${OMBRE(hote)}.querySelector('.vu').textContent`)
}
async function bouton(page: any, hote: string, c: string) {
  await page.evaluate(`${OMBRE(hote)}.querySelector('.${c}').click()`)
  await page.waitForTimeout(120)
}
const lignes = (page: any, hote: string) => page.evaluate(`Array.from(${OMBRE(hote)}.querySelectorAll('.l')).map((n) => n.localName + ':' + n.dataset.k).join(',')`)

for (const nav of NAVIGATEURS) describe(`<@module> dans une ligne de {for} : chaque ligne reçoit son clic (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [mode, variante] of MODES) {
    const nom = mode + (variante ? ' ' + variante : '')
    it(`premier niveau (${nom}) : au premier rendu, après un changement de composant, après un déplacement`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-ml-un', variante)
      try {
        const vus: string[] = []
        for (const k of [2, 3]) vus.push(await choisir(o.page, 'mjs-ml-un', k))
        await bouton(o.page, 'mjs-ml-un', 'changer')
        vus.push(await lignes(o.page, 'mjs-ml-un'))
        for (const k of [2, 1]) vus.push(await choisir(o.page, 'mjs-ml-un', k))
        await bouton(o.page, 'mjs-ml-un', 'inverser')
        vus.push(await lignes(o.page, 'mjs-ml-un'))
        for (const k of [3, 1]) vus.push(await choisir(o.page, 'mjs-ml-un', k))
        assert.deepEqual(vus, ['2:1', '3:2', 'mjs-c-mb:1,mjs-c-mb:2,mjs-c-mb:3', '2:1', '1:0', 'mjs-c-mb:3,mjs-c-mb:2,mjs-c-mb:1', '3:0', '1:2'], 'le choix de chaque ligne')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })

    it(`cinquième niveau (${nom}) : après un changement de composant et un déplacement`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-ml-cinq', variante)
      try {
        const vus = [await choisir(o.page, 'mjs-ml-cinq', 6)]
        await bouton(o.page, 'mjs-ml-cinq', 'changer')
        for (const k of [6, 5, 12, 11]) vus.push(await choisir(o.page, 'mjs-ml-cinq', k))
        await bouton(o.page, 'mjs-ml-cinq', 'inverser')
        vus.push(await lignes(o.page, 'mjs-ml-cinq'))
        for (const k of [6, 5]) vus.push(await choisir(o.page, 'mjs-ml-cinq', k))
        assert.deepEqual(vus, ['1-2-3-4-6', '1-2-3-4-6', '1-2-3-4-5', '7-8-9-10-12', '7-8-9-10-11', 'mjs-c-mb:6,mjs-c-mb:5,mjs-c-mb:11,mjs-c-mb:12', '1-2-3-4-6', '1-2-3-4-5'], 'le choix de chaque ligne')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }
})
