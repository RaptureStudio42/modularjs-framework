// module cœur <@@chart> : une faute venue d'une VARIABLE (le build ne la voit pas) écrit une erreur µ.error, en développement comme en
// production (le niveau de console par défaut garde les erreurs), puis le graphique prend la valeur par défaut et reste lisible : mot
// inconnu de shape, stats, step, axis, toolbar ou shapes ; couleur de série refusée ou que le navigateur ne sait pas lire (`'bleu'`) ;
// stats sur une carte (les autres formes sans statistiques, dans core-graphique-cases-vides-anneau-statistiques-browser), step="year" ou un axe qui n'est pas une date sur un calendrier. Les limites liées aux données (un radar de 1 ou 2
// lignes, dessiné en courbe ; plus de 24 axes de radar ; des séries d'unités différentes sur une même échelle) ne sont pas des fautes du
// programmeur : un avertissement du développement, absent en production. Dans Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $lignes   = [{ id: 'a', x: '2026-10-01', v: 2, w: 5 }, { id: 'b', x: '2026-10-02', v: 4, w: 3 }, { id: 'c', x: '2026-10-03', v: 3, w: 4 }]
  $une      = [{ key: 'v', name: 'Valeur' }]
  $forme    = 'courbe'
  $stats    = 'mean moyenne'
  $pas      = 'quinzaine'
  $axe      = 'heure'
  $teinte   = [{ key: 'v', name: 'Valeur', color: 'red;background:url(x)' }]
  $moyenne  = 'mean'
  $an       = 'year'
  $nombre   = 'number'
  $deux     = [{ id: 'f', x: 'Force', v: 2 }, { id: 's', x: 'Souplesse', v: 4 }]
  $vingtSix = [${Array.from({ length: 26 }, (_, i) => `{ x: 'A${i + 1}', v: ${i + 1} }`).join(', ')}]
  $unites   = [{ key: 'v', name: 'Poids', unit: 'kg' }, { key: 'w', name: 'Durée', unit: 'min' }]
  $bleu     = [{ key: 'v', name: 'Valeur', color: 'bleu' }]
  $violet   = [{ key: 'v', name: 'Valeur', color: 'rebeccapurple' }]
  $outils   = 'legend shapes legende'
  $formes   = 'line courbe'
</script>

<@@chart class="m1" rows={$lignes} series={$une} shape={$forme}></@@chart>
<@@chart class="m2" rows={$lignes} series={$une} stats={$stats}></@@chart>
<@@chart class="m3" rows={$lignes} series={$une} step={$pas}></@@chart>
<@@chart class="m4" rows={$lignes} series={$une} axis={$axe}></@@chart>
<@@chart class="t1" rows={$lignes} series={$teinte}></@@chart>
<@@chart class="x1" rows={$lignes} series={$une} shape="heatmap" stats={$moyenne}></@@chart>
<@@chart class="x2" rows={$lignes} series={$une} shape="calendar" step={$an}></@@chart>
<@@chart class="x3" rows={$lignes} series={$une} shape="calendar" axis={$nombre}></@@chart>
<@@chart class="r1" rows={$deux} series={$une} shape="radar"></@@chart>
<@@chart class="r2" rows={$vingtSix} series={$une} shape="radar"></@@chart>
<@@chart class="u1" rows={$lignes} series={$unites} shape="stack"></@@chart>
<@@chart class="t2" rows={$lignes} series={$bleu}></@@chart>
<@@chart class="t3" rows={$lignes} series={$violet}></@@chart>
<@@chart class="o1" rows={$lignes} series={$une} toolbar={$outils} shapes={$formes}></@@chart>
<@@chart class="e1" rows={$lignes} series={$une} shape=" bar " step=" day " axis=" date " toolbar=" legend " shapes=" line bar "></@@chart>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'ge-page.mjs': PAGE }
const GRAPHIQUES = 15

const P = '[ModularJS] <@@chart> : '
const ERREURS = [
  P + '« courbe » n\'est pas une valeur connue de shape, elle est ignorée — valeurs connues : line area dots bar stack histogram pie heatmap radar calendar.',
  P + '« moyenne » n\'est pas une valeur connue de stats, elle est ignorée — valeurs connues : mean median q1 q3 trend.',
  P + '« quinzaine » n\'est pas une valeur connue de step, elle est ignorée — valeurs connues : auto day week month year.',
  P + '« heure » n\'est pas une valeur connue de axis, elle est ignorée — valeurs connues : date datetime number category.',
  P + 'la couleur « red;background:url(x) » de la série « v » est refusée, la série prend la teinte 1 — écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).',
  P + 'la forme heatmap ne trace pas stats « mean », il est ignoré — formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar.',
  P + 'step « year » ne va pas avec la forme calendar, il est ignoré — valeurs possibles : auto day week month.',
  P + 'axis « number » ne va pas avec la forme calendar, il est ignoré — valeurs possibles : date datetime.',
  P + 'la couleur « bleu » de la série « v » est refusée, la série prend la teinte 1 — écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \\ », « /* » ni url(…).',
  P + '« legende » n\'est pas une valeur connue de toolbar, elle est ignorée — valeurs connues : legend shapes stats step.',
  P + '« courbe » n\'est pas une valeur connue de shapes, elle est ignorée — valeurs connues : line area dots bar stack histogram pie heatmap radar calendar.',
]
const AVERTISSEMENTS = [
  P + 'un radar demande au moins 3 lignes, une par axe ; il en reçoit 2, une courbe le remplace.',
  P + 'un radar montre 24 axes au plus, les 26 lignes reçues sont réduites aux 24 dernières.',
  P + 'les séries de la forme stack n\'ont pas la même unité (kg min) et partagent pourtant une même échelle.',
]

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-fautes-execution', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-ge-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> fautes venues de variables (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  it('µ.error pour chaque faute, une seule fois, puis la valeur par défaut ; les limites de données (radar de 2 lignes compris) avertissent en développement seulement', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const fautes: string[] = []
    const avis: string[] = []
    const plantages: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()); else if (m.type() === 'warning') avis.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://f.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><mjs-ge-page></mjs-ge-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://f.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-ge-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.concat(avis).join(' | ')}`)
    }
    // en production, le texte d'une erreur arrive avec le fichier des messages : la console la réécrit alors en clair
    const attente = Date.now() + 8000
    while (Date.now() < attente && !ERREURS.every((e) => fautes.includes(e))) await page.waitForTimeout(100)
    await page.waitForTimeout(300)
    const dites = fautes.filter((f) => f.startsWith(P))
    for (const e of ERREURS) assert.equal(dites.filter((f) => f === e).length, 1, `erreur attendue une fois : ${e}\n--- erreurs vues :\n${fautes.join('\n')}`)
    assert.equal(dites.length, ERREURS.length, `aucune autre erreur du graphique :\n${dites.join('\n')}`)
    assert.deepEqual(avis.filter((a) => a.includes('<@@chart>')), prod ? [] : AVERTISSEMENTS, 'les limites de données : un avertissement du développement')
    assert.deepEqual(plantages, [])
    // la valeur par défaut : une courbe, la moyenne seule, une teinte du thème, une carte sans trait, des calendriers par jour, sur des dates
    assert.equal(await compte(page, 'm1', 'path.line'), 1, 'une forme inconnue : la courbe')
    assert.equal(await compte(page, 'm2', 'svg.draw path.stat'), 1, 'le mot connu reste, l\'inconnu part')
    assert.equal(await compte(page, 'm2', 'svg.draw path.stat-mean'), 1)
    assert.equal(await compte(page, 'm3', 'path.line'), 1)
    assert.equal(await compte(page, 'm4', 'text.xlabel'), 3, 'l\'axe deviné sur les abscisses')
    assert.equal(await lire(page, `return g('t1').querySelector('path.line').getAttribute('class')`), 'line tone-1')
    assert.equal(await lire(page, `return g('t1').querySelector('path.line').style.getPropertyValue('--mjs-chart-tone')`), '', 'la couleur refusée n\'est jamais posée')
    assert.equal(await compte(page, 'x1', 'rect.cell'), 3)
    assert.equal(await compte(page, 'x1', '.stat'), 0)
    assert.equal(await compte(page, 'x2', 'text.day'), 3, 'un calendrier par jour : lundi, mercredi, vendredi')
    assert.ok(Number(await lire(page, `return [...g('x3').querySelectorAll('rect.cell')].filter((r) => !/level-0/.test(r.getAttribute('class'))).length`)) >= 3, 'l\'axe deviné : les jours ont leurs cases')
    assert.equal(await compte(page, 'r1', 'svg.web'), 0, 'un radar de 2 lignes n\'est pas dessiné')
    assert.equal(await compte(page, 'r1', 'path.line'), 1, 'une courbe à sa place')
    assert.equal(await compte(page, 'r2', 'line.spoke'), 24, '24 axes au plus')
    assert.ok(Number(await compte(page, 'u1', 'rect.bar')) >= 3)
    assert.equal(await lire(page, `return g('t2').querySelector('path.line').getAttribute('class')`), 'line tone-1', 'une couleur que le navigateur ne lit pas : la teinte par défaut')
    assert.equal(await lire(page, `return g('t2').querySelector('path.line').style.getPropertyValue('--mjs-chart-tone')`), '')
    assert.equal(await lire(page, `return g('t3').querySelector('path.line').getAttribute('class')`), 'line tone-0', 'une couleur nommée du CSS passe')
    assert.equal(await lire(page, `return g('t3').querySelector('path.line').style.getPropertyValue('--mjs-chart-tone').trim()`), 'rebeccapurple')
    assert.equal(await compte(page, 'o1', 'button.series'), 1, 'les outils connus restent')
    assert.equal(await compte(page, 'o1', 'button.pick'), 1)
    assert.equal(await compte(page, 'e1', 'rect.bar'), 3, 'un mot écrit avec des espaces se lit sans eux, comme à la construction')
    assert.equal(await compte(page, 'e1', 'button.series'), 1)
    await ctx.close()
  })
})
