// module cœur <@@chart>, dans Chromium, Firefox et WebKit réels, en développement et en production. Sous un `zoom` CSS, sur la page, sur
// un conteneur ou les deux (ils se multiplient), le menu des formes s'ouvre contre son bouton et reste dans la fenêtre, comme sans zoom et
// sur un écran à forte densité. Fermé par un clic ailleurs, ou retiré de la page menu ouvert, le graphique ne laisse aucun écouteur sur la
// fenêtre (comptés par le protocole de débogage de Chromium ; ailleurs, le retrait se fait sans erreur). Un zéro négatif (« -0.0 » d'un
// JSON) s'écrit « 0 °C » dans le tableau, la bulle et les graduations, statistiques tracées. Une heure au jour impossible s'affiche telle
// quelle, au lieu de devenir une autre date, dans les trois moteurs (Date.parse de WebKit passe 10:00:60 à 10:01)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const IMPOSSIBLES = ['2026-11-31 10:00', '2026-02-30T10:00:00Z', '2026-10-19 24:30', '2026-02-30T10:00:00.000Z', '2026-13-01T10:00:00.000Z', '2026-00-10T10:00:00.000Z', '2026-10-19T10:60:00.000Z', '2026-10-19T10:00:60.000Z']

const PAGE = `<script>
  $jours   = [{ x: '2026-09-01', v: 2 }, { x: '2026-09-02', v: 5 }, { x: '2026-09-03', v: 3 }]
  $v       = [{ key: 'v', name: 'Valeur' }]
  $t       = [{ key: 't', name: 'Température', unit: '°C' }]
  $nuls    = JSON.parse('[{"x":"lun","t":-0.0},{"x":"mar","t":-0.0}]')
  $faux    = ${JSON.stringify(IMPOSSIBLES.slice(0, 3).map((x, i) => ({ x, v: i + 1 })))}
  $melange = ${JSON.stringify(['2026-11-30 10:00'].concat(IMPOSSIBLES).map((x, i) => ({ x, v: i + 1 })))}
  $montre  = true
</script>

<div class="tete"></div>
<div class="carte">{if $montre}<@@chart class="m1" rows={$jours} series={$v} toolbar="shapes"></@@chart>{end}</div>
<input class="retire" type="checkbox" aria-label="retirer le graphique" @change={$montre = false}>
<div class="zoom"><div class="carte"><@@chart class="m2" rows={$jours} series={$v} toolbar="shapes"></@@chart></div></div>
<@@chart class="z1" rows={$nuls} series={$t} stats="mean median"></@@chart>
<@@chart class="h1" rows={$faux} series={$v}></@@chart>
<@@chart class="h2" rows={$melange} series={$v} axis="datetime"></@@chart>
<div class="pied"></div>

<style>
  :host
    display: block

  .carte
    overflow: hidden
    border: 1px solid #999
    border-radius: 12px

  .zoom
    zoom: 1.5

  .tete
    height: 60px

  .pied
    height: 1500px
</style>
`

const SOURCES: Record<string, string> = { 'mz-page.mjs': PAGE }
const GRAPHIQUES = 5

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-menu-zoom', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-mz-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)

// les écouteurs de la fenêtre, par sorte, lus par le protocole de débogage de Chromium
async function ecouteurs(ctx: any, page: any): Promise<Record<string, number>> {
  const cdp = await ctx.newCDPSession(page)
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' })
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
  await cdp.detach()
  const n: Record<string, number> = { scroll: 0, resize: 0, pointerdown: 0, click: 0 }
  for (const l of listeners) if (l.type in n) n[l.type]++
  return n
}

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> menu des formes sous zoom CSS, écouteurs de la fenêtre, zéro négatif, jours impossibles (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  async function ouvrir(options: { zoom?: boolean, densite?: number } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: options.densite ?? 1 })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    const fautes: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    const racine = options.zoom ? ' style="zoom:1.5"' : ''
    await page.route('http://g.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${racine}><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-mz-page></mjs-mz-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://g.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-mz-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    }
    catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.join(' | ')}`)
    }
    await page.waitForTimeout(400)
    return { ctx, page, plantages, fautes }
  }

  // le menu ouvert au clavier (Entrée sur le bouton) : dans la fenêtre, contre son bouton (l'écart de 4 px suit le zoom), aligné sur lui ;
  // puis refermé par Échap. À la souris, le bouton appuyé rétrécit (`scale(.96)`) le temps de l'appui : sa place mesurée bouge de quelques px
  async function menuContre(page: any, c: string, zoom: number, cas: string) {
    await lire(page, `const b = g('${c}').querySelector('button.pick'); b.scrollIntoView({ block: 'nearest' }); b.focus()`)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const v = await lire(page, `const b = g('${c}').querySelector('button.pick').getBoundingClientRect(); const m = g('${c}').querySelector('.menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { bouton: [b.left, b.top, b.right, b.bottom].map(Math.round), menu: [r.left, r.top, r.right, r.bottom].map(Math.round), haut: m.classList.contains('up'), fenetre: [innerWidth, innerHeight] }`)
    assert.ok(v, `${cas} : le menu s'ouvre`)
    const dit = `${cas} : ${JSON.stringify(v)}`
    assert.ok(v.menu[1] >= 0 && v.menu[3] <= v.fenetre[1] && v.menu[0] >= 0 && v.menu[2] <= v.fenetre[0], `dans la fenêtre — ${dit}`)
    const ecart = v.haut ? v.bouton[1] - v.menu[3] : v.menu[1] - v.bouton[3]
    assert.ok(ecart >= -1 && ecart <= 4 * zoom + 2, `contre son bouton (écart ${ecart}) — ${dit}`)
    assert.ok(Math.abs(v.menu[0] - v.bouton[0]) <= 2, `aligné sur son bouton — ${dit}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    assert.equal(await lire(page, `return !!g('${c}').querySelector('.menu')`), false, `${cas} : Échap ferme le menu`)
  }

  it('sans zoom CSS, sur un écran à forte densité : le menu s\'ouvre contre son bouton, dans la fenêtre', async () => {
    const { ctx, page, plantages } = await ouvrir({ densite: 2 })
    await menuContre(page, 'm1', 1, 'sans zoom')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('sous un zoom de la page : le menu s\'ouvre contre son bouton, dans la fenêtre ; dans un conteneur zoomé en plus, aussi', async () => {
    const { ctx, page, plantages } = await ouvrir({ zoom: true })
    await menuContre(page, 'm1', 1.5, 'html { zoom: 1.5 }')
    await menuContre(page, 'm2', 2.25, 'html { zoom: 1.5 } et conteneur { zoom: 1.5 }')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('dans un conteneur zoomé : le menu s\'ouvre contre son bouton, dans la fenêtre', async () => {
    const { ctx, page, plantages } = await ouvrir()
    await menuContre(page, 'm2', 1.5, 'conteneur { zoom: 1.5 }')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('fermé par un clic ailleurs, ou retiré de la page menu ouvert : le graphique ne laisse aucun écouteur sur la fenêtre', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const compter = nom === 'chromium'
    const depart = compter ? await ecouteurs(ctx, page) : null
    const ouvrirMenu = async () => {
      const b = await lire(page, `const r = g('m1').querySelector('button.pick').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
      await page.mouse.click(b.x, b.y)
      await page.waitForTimeout(300)
      assert.equal(await lire(page, `return !!g('m1').querySelector('.menu')`), true, 'le menu s\'ouvre')
    }
    await ouvrirMenu()
    if (compter) {
      const ouvert = await ecouteurs(ctx, page)
      assert.equal(ouvert.scroll, depart!.scroll + 1, `menu ouvert, il suit le défilement (sinon l'essai ne prouve rien) : ${JSON.stringify({ depart, ouvert })}`)
    }
    await page.mouse.click(640, 30)
    await page.waitForTimeout(300)
    assert.equal(await lire(page, `return !!g('m1').querySelector('.menu')`), false, 'un clic ailleurs ferme le menu')
    if (compter) {
      const ferme = await ecouteurs(ctx, page)
      assert.deepEqual(ferme, depart, 'fermé par un clic ailleurs : les écouteurs de départ, rien de plus')
    }
    await ouvrirMenu()
    await lire(page, `const c = h.querySelector('input.retire'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }))`)
    await page.waitForTimeout(300)
    assert.equal(await lire(page, `return !!h.querySelector('mjs-core-chart.m1')`), false, 'le graphique est retiré')
    if (compter) {
      const retire = await ecouteurs(ctx, page)
      assert.deepEqual(retire, { scroll: depart!.scroll, resize: depart!.resize, pointerdown: depart!.pointerdown - 1, click: depart!.click - 1 }, 'retiré menu ouvert : plus aucun écouteur du graphique')
    }
    await page.evaluate(() => window.scrollBy(0, 200))
    await page.waitForTimeout(200)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('un zéro négatif (« -0.0 » d\'un JSON) s\'écrit « 0 °C » : tableau, bulle, graduations', async () => {
    const { ctx, page, plantages } = await ouvrir()
    assert.deepEqual(await textes(page, 'z1', 'tbody td'), ['0 °C', '0 °C'])
    await lire(page, `g('z1').querySelector('.hit').scrollIntoView({ block: 'center' })`)
    const p = await lire(page, `const r = g('z1').querySelector('.hit').getBoundingClientRect(); return { x: r.left + r.width * 0.1, y: r.top + r.height / 2 }`)
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(300)
    const bulle = (await textes(page, 'z1', '.tip'))[0] ?? ''
    const graduations = await textes(page, 'z1', 'text.ylabel')
    assert.match(bulle, /0 °C/, `la bulle : « ${bulle} »`)
    assert.ok(graduations.includes('0'), `les graduations : ${JSON.stringify(graduations)}`)
    const signe = /[-−]0(?![\d,.])/
    for (const [ou, t] of [['la bulle', bulle], ...graduations.map((x: string) => ['une graduation', x])]) assert.ok(!signe.test(t), `${ou} : « ${t} »`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('une heure au jour impossible s\'affiche telle quelle, sans devenir une autre date', async () => {
    const { ctx, page, plantages } = await ouvrir()
    assert.deepEqual(await textes(page, 'h1', 'tbody th'), IMPOSSIBLES.slice(0, 3), 'sans axis : des libellés, tels qu\'écrits')
    const vus = await textes(page, 'h2', 'tbody th')
    for (const ecrit of IMPOSSIBLES) assert.ok(vus.includes(ecrit), `« ${ecrit} » tel quel : ${JSON.stringify(vus)}`)
    assert.ok(!vus.includes('2026-11-30 10:00') && vus.some((x: string) => x.includes('30') && x.includes('nov')), `une heure possible s'écrit en date : ${JSON.stringify(vus)}`)
    assert.ok(!vus.some((x: string) => /déc|mars|janv|oct/.test(x)), `aucune autre date : ${JSON.stringify(vus)}`)
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
