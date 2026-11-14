// module cœur <@@chart>, la taille de ses textes dans Chromium réel : sans réglage, chaque famille de texte garde sa taille (11, 12, 13
// ou 17 px) ; `--mjs-chart-font` posée sur la balise les fait toutes suivre, dans le même rapport ; à 17 px, aucune étiquette d'axe ne
// sort de la boîte du graphique

import assert from 'node:assert/strict'
import { construire, navigateurPresent } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SERIE = "[{ key: 'v', name: 'Valeur moyenne du jour' }, { key: 'w', name: 'Seconde mesure', color: 'orange' }]"
const LIGNES = "[{ id: 'a', x: 'Lundi', v: 3, w: 4 }, { id: 'b', x: 'Mardi', v: 5, w: 2 }, { id: 'c', x: 'Mercredi', v: 2, w: 6 }, { id: 'd', x: 'Jeudi', v: 6, w: 1 }]"

// trois jeux identiques : sans réglage, à 22 px, à 17 px
const jeu = (k: string, classe: string) => `
<@@chart class="${k}-barres ${classe}" rows={$lignes} series={$series} shape="bar" toolbar="legend shapes"></@@chart>
<@@chart class="${k}-courbe ${classe}" rows={$lignes} series={$series} toolbar="legend"></@@chart>
<@@chart class="${k}-vide ${classe}" rows={$vide} series={$series}></@@chart>
<@@chart class="${k}-anneau ${classe}" rows={$lignes} series={$series} shape="pie"></@@chart>`

const PAGE = `<script>
  $lignes = ${LIGNES}
  $series = ${SERIE}
  $vide   = []
</script>
${jeu('n', '')}
${jeu('d', 'f22')}
${jeu('m', 'f17')}

<style>
  :host
    display: block
  .f22
    --mjs-chart-font: 22px
  .f17
    --mjs-chart-font: 17px
</style>
`

// chaque famille : le graphique, le sélecteur dans son ombre, la taille d'aujourd'hui en px
const FAMILLES: [string, string, number][] = [
  ['barres', '.svg', 11],
  ['barres', '.tools', 12],
  ['courbe', '.svg', 11],
  ['courbe', '.tools', 12],
  ['vide', '.empty', 13],
  ['anneau', '.center b', 17],
  ['anneau', '.center small', 11]
]

describe('<@@chart> : la taille des textes suit --mjs-chart-font (chromium réel)', function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let page: any = null

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) return
    const built = await construire('graphique-taille', { 'gt-page.mjs': PAGE }, false)
    browser = await (await import('playwright')).chromium.launch()
    page = await (await browser.newContext({ viewport: { width: 800, height: 900 } })).newPage()
    page.setDefaultTimeout(8000)
    await page.addInitScript('window.__name = function (f) { return f };')
    await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><mjs-gt-page></mjs-gt-page><script>${built.script}</script></body></html>` }))
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const c = (document.querySelector('mjs-gt-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 12 && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, null, { timeout: 15000 })
    await page.waitForTimeout(250)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  const taille = (classe: string, sel: string) => page.evaluate(`(() => { const n = document.querySelector('mjs-gt-page')._shadow.querySelector('mjs-core-chart.${classe}')._shadow.querySelector('${sel}'); return n ? parseFloat(getComputedStyle(n).fontSize) : null })()`)

  it('sans la variable, chaque famille garde sa taille d\'aujourd\'hui', async () => {
    for (const [g, sel, px] of FAMILLES) assert.equal(await taille('n-' + g, sel), px, `${g} ${sel}`)
  })

  it('avec --mjs-chart-font: 22px sur la balise, chaque taille est doublée', async () => {
    for (const [g, sel, px] of FAMILLES) assert.equal(await taille('d-' + g, sel), px * 2, `${g} ${sel}`)
  })

  it('à 17 px, aucune étiquette d\'axe ne sort de la boîte du graphique', async () => {
    const hors = await page.evaluate(`(() => {
      const h = document.querySelector('mjs-gt-page')._shadow
      const out = []
      for (const c of ['m-barres', 'm-courbe']) {
        const o = h.querySelector('mjs-core-chart.' + c)._shadow
        const b = o.querySelector('.chart').getBoundingClientRect()
        const t = [...o.querySelectorAll('text.xlabel, text.ylabel')]
        if (!t.length) out.push(c + ' : aucune étiquette')
        for (const n of t) { const r = n.getBoundingClientRect(); if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(c + ' ' + n.textContent) }
      }
      return out
    })()`)
    assert.deepEqual(hors, [])
  })
})
