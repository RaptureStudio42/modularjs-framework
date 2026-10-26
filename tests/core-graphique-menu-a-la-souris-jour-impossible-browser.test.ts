// module cœur <@@chart>, dans Chromium, Firefox et WebKit réels, en développement et en production. Le menu des formes ouvert à la souris se
// cale sur son bouton tel qu'il est au repos : le bouton appuyé rétrécit le temps de l'appui (`scale(.96)`), le menu ne suit plus ce
// rétrécissement (il se posait de 3 ou 4 px à côté, un bouton large le montre). Sur un axe de jours, un jour impossible (le 31 novembre, le
// mois 13, le mois 0) s'affiche tel quel, au lieu de devenir une autre date.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const IMPOSSIBLES = ['2026-11-31', '2026-13-01', '2026-00-10']

const PAGE = `<script>
  $jours = [{ x: '2026-09-01', v: 2 }, { x: '2026-09-02', v: 5 }, { x: '2026-09-03', v: 3 }]
  $faux  = ${JSON.stringify(['2026-11-30'].concat(IMPOSSIBLES).map((x, i) => ({ x, v: i + 1 })))}
  $v     = [{ key: 'v', name: 'Valeur' }]
</script>

<div class="grand"><@@chart class="m1" rows={$jours} series={$v} toolbar="shapes"></@@chart></div>
<@@chart class="j1" rows={$faux} series={$v} axis="date"></@@chart>

<style>
  :host
    display: block

  .grand
    font-size: 26px
</style>
`

const SOURCES: Record<string, string> = { 'ms-page.mjs': PAGE }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-menu-souris', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-ms-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const bouton = (page: any) => lire(page, `const r = g('m1').querySelector('button.pick').getBoundingClientRect(); return { gauche: r.left, haut: r.top, droite: r.right, bas: r.bottom }`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> menu des formes ouvert à la souris, jour impossible (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
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
    const ctx  = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://g.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:20px 60px;font:14px sans-serif"><mjs-ms-page></mjs-ms-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://g.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const c = (document.querySelector('mjs-ms-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 2 && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, null, { timeout: 15000 })
    await page.waitForTimeout(300)
    return { ctx, page, plantages }
  }

  it('ouvert à la souris, le menu se cale sur le bouton au repos, pas sur le bouton rétréci par l\'appui', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const repos = await bouton(page)
    // l'appui, repris tant que le moteur n'a pas encore pris le pointeur en compte (au plus trois fois)
    let appuye = repos
    for (let essai = 0; essai < 3 && appuye.gauche - repos.gauche < 1.5; essai++) {
      if (essai) {
        await page.mouse.up()
        await page.waitForTimeout(150)
        if (await lire(page, `return !!g('m1').querySelector('.menu')`)) await page.keyboard.press('Escape')
        await page.waitForTimeout(150)
      }
      await page.mouse.move((repos.gauche + repos.droite) / 2, (repos.haut + repos.bas) / 2)
      await page.waitForTimeout(150)
      await page.mouse.down()
      await page.waitForTimeout(250)
      appuye = await bouton(page)
    }
    assert.ok(appuye.gauche - repos.gauche >= 1.5, `témoin : le bouton appuyé rétrécit assez pour se voir (${JSON.stringify({ repos, appuye })})`)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const v = await lire(page, `const m = g('m1').querySelector('.menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { gauche: r.left, haut: r.top, dessus: m.classList.contains('up') }`)
    assert.ok(v, 'le menu s\'ouvre')
    const b   = await bouton(page)
    const dit = JSON.stringify({ bouton: b, menu: v, appuye })
    assert.equal(v.dessus, false, `le menu s'ouvre sous le bouton — ${dit}`)
    assert.ok(Math.abs(v.gauche - b.gauche) <= 1, `aligné sur le bouton au repos — ${dit}`)
    assert.ok(Math.abs(v.haut - (b.bas + 4)) <= 1, `à 4 px sous le bouton au repos — ${dit}`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('un jour impossible s\'affiche tel quel, sans devenir une autre date', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const vus: string[] = await lire(page, `return [...g('j1').querySelectorAll('tbody th')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)
    for (const ecrit of IMPOSSIBLES) assert.ok(vus.includes(ecrit), `« ${ecrit} » tel quel : ${JSON.stringify(vus)}`)
    assert.ok(vus.some((x) => x.includes('30') && x.includes('nov')), `un jour possible s'écrit en date : ${JSON.stringify(vus)}`)
    assert.ok(!vus.some((x) => /déc|janv/.test(x)), `aucune autre date : ${JSON.stringify(vus)}`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
