// module cœur <@@chart>, dans Chromium, Firefox et WebKit réels, en développement et en production. Sous un `zoom` CSS posé sur un conteneur
// (1,5 ou 0,5), la bulle se place où elle se place sans zoom : à 10 px à droite du point survolé sur une courbe, à 10 px à droite de la case
// survolée sur une carte d'intensité. Son emplacement se mesure à l'écran (`getBoundingClientRect`) mais s'écrit en pixels CSS (`left`), que
// le navigateur multiplie par le zoom : la bulle partait trop loin sous un zoom de 1,5, trop près sous un zoom de 0,5

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $jours = [{ x: '2026-09-01', v: 2 }, { x: '2026-09-02', v: 5 }, { x: '2026-09-03', v: 3 }, { x: '2026-09-04', v: 4 }]
  $v     = [{ key: 'v', name: 'Valeur' }]
</script>

<div class="plain"><@@chart class="c0" rows={$jours} series={$v}></@@chart></div>
<div class="big"><@@chart class="c1" rows={$jours} series={$v}></@@chart></div>
<div class="small"><@@chart class="c2" rows={$jours} series={$v}></@@chart></div>
<div class="plain"><@@chart class="h0" rows={$jours} series={$v} shape="heatmap"></@@chart></div>
<div class="big"><@@chart class="h1" rows={$jours} series={$v} shape="heatmap"></@@chart></div>
<div class="small"><@@chart class="h2" rows={$jours} series={$v} shape="heatmap"></@@chart></div>

<style>
  :host
    display: block

  .plain
    width: 600px

  .big
    zoom: 1.5
    width: 400px

  .small
    zoom: .5
    width: 1200px
</style>
`

const GRAPHIQUES = 6
const GAP        = 10

// sans zoom, avec un zoom de 1,5 (la bulle partait de +93 px), avec un zoom de 0,5 (de -101 px)
const COURBES = [['c0', 1], ['c1', 1.5], ['c2', 0.5]] as const
const CARTES  = [['h0', 1], ['h1', 1.5], ['h2', 0.5]] as const

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-bulle-zoom', { 'bz-page.mjs': PAGE }, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-bz-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> la bulle sous un zoom CSS (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(120000)
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
    const ctx  = await browser.newContext({ viewport: { width: 1000, height: 1200 } })
    const page = await ctx.newPage()
    const plantages: string[] = []
    const fautes: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://g.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-bz-page></mjs-bz-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://g.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-bz-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    }
    catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.join(' | ')}`)
    }
    await page.waitForTimeout(400)
    return { ctx, page, plantages, fautes }
  }

  // le pointeur posé à 30 % de la zone de la courbe, où le point le plus proche est le deuxième de quatre (au tiers) : la bulle s'ouvre à
  // 10 px à sa droite
  async function bulleDeLaCourbe(page: any, c: string) {
    const zone = await lire(page, `const e = h.querySelector('mjs-core-chart.${c}'); e.scrollIntoView({ block: 'center' }); const r = g('${c}').querySelector('.hit').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2, gauche: r.left, largeur: r.width }`)
    await page.mouse.move(zone.x - 5, zone.y)
    await page.mouse.move(zone.x, zone.y, { steps: 3 })
    await page.waitForTimeout(400)
    const bulle = await lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; const r = t.getBoundingClientRect(); return { gauche: r.left, cote: t.dataset.side, pret: !t.classList.contains('wait') }`)
    return { zone, bulle, attendu: zone.gauche + zone.largeur / 3 + GAP }
  }

  // le pointeur posé sur la première case de la carte : la bulle s'ouvre à 10 px à droite de la case. Le bord de la case se lit une fois la
  // bulle posée, la case survolée : Firefox la dessine alors avec un contour qui change sa boîte de quelques pixels
  async function bulleDeLaCarte(page: any, c: string) {
    const premiere = await lire(page, `const e = h.querySelector('mjs-core-chart.${c}'); e.scrollIntoView({ block: 'center' }); const r = g('${c}').querySelector('rect.cell[data-i="0"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
    await page.mouse.move(premiere.x - 3, premiere.y)
    await page.mouse.move(premiere.x, premiere.y, { steps: 2 })
    await page.waitForTimeout(400)
    const bulle = await lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; const r = t.getBoundingClientRect(); return { gauche: r.left, cote: t.dataset.side, pret: !t.classList.contains('wait'), caseDroite: g('${c}').querySelector('rect.cell[data-i="0"]').getBoundingClientRect().right }`)
    return { bulle, attendu: (bulle?.caseDroite ?? 0) + GAP }
  }

  for (const [c, zoom] of COURBES) it(`courbe, zoom ${zoom} : la bulle s'ouvre à 10 px à droite du point survolé`, async () => {
    const { ctx, page, plantages } = await ouvrir()
    const { zone, bulle, attendu } = await bulleDeLaCourbe(page, c)
    const dit = `${JSON.stringify({ zone, bulle, attendu })}`
    assert.ok(bulle?.pret, `la bulle est ouverte et montrée — ${dit}`)
    assert.equal(bulle.cote, 'right', `à droite du point — ${dit}`)
    assert.ok(Math.abs(bulle.gauche - attendu) <= 3, `bord gauche de la bulle à ${Math.round(bulle.gauche)} px, attendu ${Math.round(attendu)} (écart ${Math.round(bulle.gauche - attendu)}) — ${dit}`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  for (const [c, zoom] of CARTES) it(`carte d'intensité, zoom ${zoom} : la bulle s'ouvre à 10 px à droite de la case survolée`, async () => {
    const { ctx, page, plantages } = await ouvrir()
    const { bulle, attendu } = await bulleDeLaCarte(page, c)
    const dit = `${JSON.stringify({ bulle, attendu })}`
    assert.ok(bulle?.pret, `la bulle est ouverte et montrée — ${dit}`)
    assert.equal(bulle.cote, 'right', `à droite de la case — ${dit}`)
    assert.ok(Math.abs(bulle.gauche - attendu) <= 3, `bord gauche de la bulle à ${Math.round(bulle.gauche)} px, attendu ${Math.round(attendu)} (écart ${Math.round(bulle.gauche - attendu)}) — ${dit}`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
