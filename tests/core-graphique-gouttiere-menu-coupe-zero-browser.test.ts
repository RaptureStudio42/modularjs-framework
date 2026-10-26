// module cœur <@@chart>, dans Chromium, Firefox et WebKit réels, en développement et en production. La gouttière des graduations suit
// leur largeur réelle : avec `decimals`, des graduations longues (« 1 000 000,00 », « 72,0000000000 ») restent dans le cadre du graphique,
// au bord de la fenêtre comme dans une carte qui coupe (`overflow: hidden`) ; sans elles, la gouttière garde ses 48 px. Le menu des formes
// de la barre n'est jamais coupé par un ancêtre : dans une carte qui coupe, chaque forme s'atteint à la souris ; le clavier et le focus
// restent justes ; quand la page défile, il suit son bouton, et se ferme quand le bouton sort de l'écran, en lui rendant le focus. Avec
// `decimals`, une petite valeur négative s'écrit 0.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $millions = [{ x: 'a', v: 1200000 }, { x: 'b', v: 3400000 }, { x: 'c', v: 5100000 }]
  $mesures  = [{ x: 'a', t: 72 }, { x: 'b', t: 73.5 }]
  $v        = [{ key: 'v', name: 'Valeur' }]
  $t        = [{ key: 't', name: 'Température', unit: '°C' }]
  $froid    = [{ x: 'a', t: -0.4 }, { x: 'b', t: 1.6 }, { x: 'c', t: -1.2 }]
  $presque  = [{ x: 'a', v: -0.001 }, { x: 'b', v: 2 }]
  $jours    = [{ x: '2026-09-01', v: 2 }, { x: '2026-09-02', v: 5 }, { x: '2026-09-03', v: 3 }]
</script>

<div class="tete"></div>
<div class="carte"><@@chart class="m1" rows={$jours} series={$v} toolbar="shapes"></@@chart></div>
<div class="bord"><@@chart class="g1" rows={$millions} series={$v} decimals="2"></@@chart></div>
<div class="carte"><@@chart class="g2" rows={$mesures} series={$t} decimals="10"></@@chart></div>
<@@chart class="g3" rows={$millions} series={$v}></@@chart>
<@@chart class="z1" rows={$froid} series={$t} decimals="0"></@@chart>
<@@chart class="z2" rows={$presque} series={$v} decimals="2"></@@chart>
<div class="pied"></div>

<style>
  :host
    display: block

  .bord
    margin-left: -8px

  .carte
    overflow: hidden
    border: 1px solid #999
    border-radius: 12px

  .tete
    height: 100px

  .pied
    height: 1200px
</style>
`

const SOURCES: Record<string, string> = { 'gm-page.mjs': PAGE }
const GRAPHIQUES = 6

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-gouttiere-menu', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gm-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)

// le bord gauche le plus à gauche des graduations, et le bord gauche de ce qui ne doit pas les couper
const gauche = (page: any, c: string, cadre: string) => lire(page, `const t = [...g('${c}').querySelectorAll('text.ylabel')]; return { n: t.length, gauche: Math.min(...t.map((n) => n.getBoundingClientRect().left)), cadre: ${cadre} }`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> gouttière des graduations, menu des formes dans une carte qui coupe, zéro sans signe (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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
    const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    const fautes: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://g.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-gm-page></mjs-gm-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://g.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gm-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.join(' | ')}`)
    }
    await page.waitForTimeout(400)
    return { ctx, page, plantages, fautes }
  }

  it('decimals : des graduations longues restent dans le cadre, au bord de la fenêtre comme dans une carte qui coupe ; sans elles, 48 px', async () => {
    const { ctx, page, plantages } = await ouvrir()
    assert.equal((await textes(page, 'g1', 'text.ylabel')).at(-1)?.replace(/\s/g, ''), '6000000,00')
    const bord = await gauche(page, 'g1', 'Math.max(0, h.querySelector(\'mjs-core-chart.g1\').getBoundingClientRect().left)')
    assert.ok(bord.n >= 2 && bord.gauche >= bord.cadre - 0.5, `au bord de la fenêtre : ${JSON.stringify(bord)}`)
    const carte = await gauche(page, 'g2', 'h.querySelectorAll(\'.carte\')[1].getBoundingClientRect().left + 1')
    assert.ok(carte.n >= 2 && carte.gauche >= carte.cadre - 0.5, `dans une carte qui coupe : ${JSON.stringify(carte)}`)
    assert.equal(await lire(page, `return getComputedStyle(g('g3').querySelector('.frame')).paddingLeft`), '48px', 'sans decimals, la gouttière ne change pas')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('le menu des formes dans une carte qui coupe : chaque forme s\'atteint à la souris, la dernière se choisit', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const b = await lire(page, `const r = g('m1').querySelector('button.pick').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    await page.mouse.click(b.x, b.y)
    await page.waitForTimeout(250)
    const vu = await lire(page, `const carte = h.querySelectorAll('.carte')[0].getBoundingClientRect(); const menu = g('m1').querySelector('.menu').getBoundingClientRect(); const items = [...g('m1').querySelectorAll('[role="menuitemradio"]')]; return { carte: [carte.top, carte.bottom], menu: [menu.top, menu.bottom], formes: items.map((n) => { const r = n.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const lu = g('m1').elementFromPoint(x, y); return { nom: n.textContent.trim(), x, y, atteinte: !!lu && lu.closest('[role="menuitemradio"]') === n } }) }`)
    assert.ok(vu.menu[0] < vu.carte[0] - 1 || vu.menu[1] > vu.carte[1] + 1, `le menu dépasse la carte (sinon l'essai ne prouve rien) : menu ${vu.menu}, carte ${vu.carte}`)
    assert.deepEqual(vu.formes.filter((f: any) => !f.atteinte).map((f: any) => f.nom), [], 'chaque forme s\'atteint')
    const derniere = vu.formes.at(-1)
    assert.equal(derniere.nom, 'Calendrier')
    await page.mouse.click(derniere.x, derniere.y)
    await page.waitForTimeout(250)
    assert.equal(await lire(page, `return !!g('m1').querySelector('.calendar') && !g('m1').querySelector('.menu')`), true, 'le calendrier choisi, le menu fermé')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('le clavier et le focus restent justes ; au défilement, le menu suit son bouton, puis se ferme quand le bouton sort de l\'écran', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const actif = () => lire(page, `const a = g('m1').activeElement; return a ? (a.classList.contains('pick') ? 'bouton' : a.textContent.trim()) : null`)
    await lire(page, `g('m1').querySelector('button.pick').focus()`)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(200)
    assert.equal(await actif(), 'Calendrier', 'flèche du haut : la dernière forme')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    assert.equal(await lire(page, `return !!g('m1').querySelector('.menu')`), false)
    assert.equal(await actif(), 'bouton', 'Échap rend le focus au bouton')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    assert.equal(await actif(), 'Courbe', 'Entrée : la forme en cours')
    const haut = () => lire(page, `const m = g('m1').querySelector('.menu'); return m ? Math.round(m.getBoundingClientRect().top - g('m1').querySelector('button.pick').getBoundingClientRect().bottom) : null`)
    const ecart = await haut()
    await page.evaluate(() => window.scrollBy(0, 40))
    await page.waitForTimeout(250)
    assert.equal(await haut(), ecart, 'le menu suit son bouton')
    assert.equal(await actif(), 'Courbe', 'le focus reste dans le menu')
    await page.evaluate(() => window.scrollBy(0, 1000))
    await page.waitForTimeout(250)
    assert.equal(await lire(page, `return !!g('m1').querySelector('.menu')`), false, 'le bouton sorti de l\'écran : le menu se ferme')
    assert.equal(await actif(), 'bouton', 'le focus revient au bouton')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('decimals : une petite valeur négative s\'écrit 0, jamais « -0 »', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const froid = await textes(page, 'z1', 'tbody td')
    assert.deepEqual(froid.slice(0, 2), ['0 °C', '2 °C'])
    assert.match(froid[2], /^[-−]1 °C$/)
    assert.deepEqual(await textes(page, 'z2', 'tbody td'), ['0,00', '2,00'])
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
