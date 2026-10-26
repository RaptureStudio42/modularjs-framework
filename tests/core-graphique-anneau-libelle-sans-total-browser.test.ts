// module cœur <@@chart>, anneau par libellé (une seule série sur un axe de libellés), dans Chromium, Firefox et WebKit réels, en
// développement et en production. Un libellé dont le total n'est pas positif (des valeurs négatives, ou qui s'annulent) n'a pas de part :
// en développement, un avertissement le dit, une fois par libellé, comme pour la série sans total positif d'un anneau par série ; rien
// en production, et rien quand l'anneau vient d'un choix fait dans la barre d'outils. Avant, le libellé disparaissait sans rien dire.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $ventes = [{ x: 'Anvers', v: 3 }, { x: 'Bâle', v: -2 }, { x: 'Cork', v: 2 }, { x: 'Cork', v: -2 }, { x: 'Dax', v: 1 }]
  $une    = [{ key: 'v', name: 'Ventes', unit: '€' }]
  $soldes = [{ x: 'Est', s: 4 }, { x: 'Ouest', s: -3 }]
  $solde  = [{ key: 's', name: 'Solde', unit: '€' }]
</script>

<@@chart class="l1" rows={$ventes} series={$une} shape="pie"></@@chart>
<@@chart class="o1" rows={$soldes} series={$solde} toolbar="shapes"></@@chart>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'ga-page.mjs': PAGE }
const GRAPHIQUES = 2
const P = '[ModularJS] <@@chart> : '
const AVERTISSEMENTS = [
  P + 'le libellé « Bâle » n\'a pas de total positif, l\'anneau ne lui donne aucune part.',
  P + 'le libellé « Cork » n\'a pas de total positif, l\'anneau ne lui donne aucune part.',
]

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-anneau-libelle', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-ga-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> anneau par libellé, libellé sans total positif (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('le libellé sans total positif n\'a pas de part et le développement le dit, une fois par libellé ; rien en production ni pour un anneau choisi dans la barre', async () => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    const fautes: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()); else if (m.type() === 'warning') avis.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://a.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-ga-page></mjs-ga-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://a.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-ga-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    }
    catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.concat(avis).join(' | ')}`)
    }
    await page.waitForTimeout(300)
    assert.deepEqual(await lire(page, `return [...g('l1').querySelectorAll('.legend .name')].map((n) => n.textContent.trim())`), ['Anvers', 'Dax'], 'seuls les libellés au total positif ont une part')
    // la barre choisit l'anneau : une seule série sur un axe de libellés, une part par libellé, « Ouest » sans part et sans un mot de plus
    await lire(page, `g('o1').querySelector('button.pick').click()`)
    await page.waitForTimeout(150)
    await lire(page, `[...g('o1').querySelectorAll('[role="menuitemradio"]')].find((n) => n.textContent.trim() === 'Anneau').click()`)
    await page.waitForTimeout(300)
    assert.deepEqual(await lire(page, `return [...g('o1').querySelectorAll('.legend .name')].map((n) => n.textContent.trim())`), ['Est'], 'l\'anneau choisi par la barre')
    assert.deepEqual(avis.filter((a) => a.startsWith(P)), prod ? [] : AVERTISSEMENTS, 'un avertissement du développement par libellé, une fois ; rien pour le choix de la barre')
    assert.deepEqual(fautes.filter((f) => f.startsWith(P)), [], 'aucune erreur')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
