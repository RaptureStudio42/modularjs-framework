// module cœur <@@chart>, dans les navigateurs réels, en développement et en production : l'unité d'une série s'écrit telle quelle dans
// les bornes de l'histogramme (« De 1,0 à 1,5 kg »), même quand elle contient un `$` que le remplacement d'un texte lirait comme un motif
// (`$&`, `$$`). Limite écrite au chapitre du graphique, vue ici : deux colonnes de même clé n'en font qu'une — une série qui prend la clé
// `#total` d'une pile cache la colonne du total, une série dont la clé est déjà prise ne s'affiche pas — et la construction de
// développement le signale (« clés dupliquées »)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $mesures = [${[1.02, 1.07, 1.31, 1.48, 1.52, 1.9, 2.05, 2.4].map((n, i) => `{ x: 'm${i}', v: ${n} }`).join(', ')}]
  $et      = [{ key: 'v', name: 'Valeur', unit: '$&' }]
  $double  = [{ key: 'v', name: 'Valeur', unit: '$$' }]
  $lignes  = [{ x: 'a', v: 1, '#total': 2 }, { x: 'b', v: 3, '#total': 4 }]
  $total   = [{ key: 'v', name: 'Un' }, { key: '#total', name: 'Deux' }]
  $memes   = [{ key: 'v', name: 'Un' }, { key: 'v', name: 'Deux' }]
</script>

<@@chart class="h1" rows={$mesures} series={$et} shape="histogram" decimals="1"></@@chart>
<@@chart class="h2" rows={$mesures} series={$double} shape="histogram" decimals="1"></@@chart>
<@@chart class="r1" rows={$lignes} series={$total} shape="stack"></@@chart>
<@@chart class="r2" rows={$lignes} series={$memes}></@@chart>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'gu-page.mjs': PAGE }
const GRAPHIQUES = 4

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-unite-dollar', SOURCES, prod))

const lire   = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gu-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> unité avec un $, clés de série réservées ou en double (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  async function ouvrir() {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    const fautes: string[]    = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') fautes.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://u.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-gu-page></mjs-gu-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://u.test/', { waitUntil: 'load' })
    await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gu-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES)
    await page.waitForTimeout(300)
    return { ctx, page, plantages, fautes }
  }

  it('l\'unité $& ou $$ s\'écrit telle quelle dans les bornes de l\'histogramme', async () => {
    const { ctx, page, plantages } = await ouvrir()
    try {
      assert.deepEqual(await textes(page, 'h1', 'tbody th'), ['De 1,0 à 1,5 $&', 'De 1,5 à 2,0 $&', 'De 2,0 à 2,5 $&'])
      assert.deepEqual(await textes(page, 'h2', 'tbody th'), ['De 1,0 à 1,5 $$', 'De 1,5 à 2,0 $$', 'De 2,0 à 2,5 $$'])
      assert.deepEqual(plantages, [])
    }
    finally {
      await ctx.close()
    }
  })

  it('clé réservée #total dans une pile : la colonne du total ne s\'affiche pas ; clé en double : la seconde série non plus ; signalé en développement', async () => {
    const { ctx, page, plantages, fautes } = await ouvrir()
    try {
      assert.deepEqual(await textes(page, 'r1', 'thead th'), ['Libellé', 'Un', 'Deux'], 'aucune colonne « Total »')
      assert.deepEqual(await textes(page, 'r2', 'thead th'), ['Libellé', 'Un'], 'la série « Deux » ne s\'affiche pas')
      if (!prod) assert.ok(fautes.some((f) => /clés dupliquées/.test(f)), fautes.join('\n'))
      assert.deepEqual(plantages, [])
    }
    finally {
      await ctx.close()
    }
  })
})
