// le menu des formes de <@@chart> et la bulle `@title` placés par le script — dans une boîte en `position: fixed` dont le corps défile,
// comme une fenêtre `µ.modal` — se ferment quand le conteneur qui défile cache leur élément, comme la liste de <@@select> : le
// focus revient au bouton du menu sans rien faire défiler, et le menu ouvert par un script, son bouton caché, se ferme aussitôt ; l'élément
// encore visible, le menu reste ouvert et suit son bouton, la bulle reste. La bulle est dans un conteneur posé dans un composant, dont le
// défilement n'atteint pas la fenêtre (celui de la page la ferme toujours). Chromium, Firefox et WebKit réels, en développement et en
// production

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

// le graphique dans le corps qui défile d'une boîte fixe de la page (hors du composant : son défilement atteint la fenêtre, comme celui
// d'une `µ.modal`) ; la bulle dans le corps qui défile d'une boîte fixe du composant ; une autre boîte fixe porte un élément sans boîte CSS
// et l'intérieur d'un `<svg>`
const PAGE = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>

<@@chart class="c" rows={$rows} series={$series} toolbar="shapes"></@@chart>
<div class="panneau"><div class="defile"><div class="vide"></div><button class="t" type="button" :title={ text: 'Bulle du panneau', delay: 30 }>T</button><div class="long"></div></div></div>
<div class="autres"><span class="sb" :title={ text: 'Bulle sans boîte', delay: 30 }><button class="sbb" type="button">S</button></span><svg class="sv" width="40" height="20"><rect class="sr" width="40" height="20" :title={ text: 'Bulle du dessin', delay: 30 }></rect></svg></div>

<style>
  :host
    display: block

  .panneau
    position: fixed
    left: 760px
    top: 300px
    width: 180px

  .defile
    height: 120px
    overflow: auto

  .autres
    position: fixed
    left: 760px
    top: 560px
    width: 180px
    height: 80px

  .sb
    display: contents

  .vide
    height: 20px

  .long
    height: 900px
</style>
`

const SOURCES: Record<string, string> = { 'mf-page.mjs': PAGE }
const BOITE   = '<style>.fenetre { position: fixed; left: 40px; top: 100px; width: 640px } .corps { height: 420px; overflow: auto } .corps .haut { height: 40px } .corps .bas { height: 1200px }</style>'

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('menus-places-par-le-script', SOURCES, prod))

// l'ombre du composant, celle du graphique, le corps de la boîte de la page, une boîte lue à l'écran, la bulle visible
const OUTILS = `
window.__name = (f) => f
window.__h = () => document.querySelector('mjs-mf-page')._shadow
window.__o = () => window.__h().querySelector('mjs-core-chart.c')._shadow
window.__f = () => document.querySelector('.corps')
window.__r = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
window.__bulle = () => [...window.__h().querySelectorAll('.mjs-title'), ...document.querySelectorAll('.mjs-title')].find((b) => b.classList.contains('mjs-title-visible')) || null
`

// contre son bouton : le menu à 4 px sous sa boîte (`.picker`, au-dessus avec `up`), bord gauche
const contreMenu = (m: any) => (m.haut ? Math.abs(m.m.b - (m.k.t - 4)) : Math.abs(m.m.t - (m.k.b + 4))) <= 1.5 && Math.abs(m.m.l - m.k.l) <= 1.5

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`menu des formes et bulle placés par le script, élément caché par le conteneur qui défile (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present             = false
  let browser: any        = null
  let page: any           = null
  const erreurs: string[] = []

  const lire     = (corps: string) => page.evaluate(`(async () => { ${corps} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 10000 })
  const images   = () => lire(`await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))`)
  // après un défilement ou une ouverture : les observateurs ont parlé (une image), la page s'est redessinée
  const repos    = async () => { await images(); await page.waitForTimeout(120); await images() }

  const menu = () => lire(`const o = __o(), m = o.querySelector('.menu'); if (!m) return { ouvert: false }; return { ouvert: true, m: __r(m), k: __r(o.querySelector('.picker')), dessus: m.matches(':popover-open'), ancre: m.classList.contains('anchored'), haut: m.classList.contains('up') }`)

  // le menu ouvert par un vrai clic sur son bouton : la boîte fixe fausse l'ancre, le script le pose dans la couche du dessus
  async function ouvrirMenu() {
    const c = await lire(`const r = __r(__o().querySelector('button.pick')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.click(c.x, c.y)
    await attendre(`(() => { const m = __o().querySelector('.menu'); return !!m && !m.classList.contains('wait') })()`)
    await images()
    const m = await menu()
    assert.ok(m.ouvert && m.dessus && !m.ancre && contreMenu(m), `menu placé par le script contre son bouton, dans la couche du dessus : ${JSON.stringify(m)}`)
  }

  // la boîte de la page défilée jusqu'à cacher le bouton du menu sous son bord haut, le bouton restant dans la fenêtre
  const cacherBouton = () => lire(`const f = __f(), k = __r(__o().querySelector('.picker')); f.scrollTop += Math.ceil(k.b - __r(f).t) + 2; return f.scrollTop`)
  // après coup : le menu fermé, ouvert un instant (cf. le menu ouvert par un script), le bouton caché par la boîte et dans la fenêtre, le focus, le défilement
  const apres = () => lire(`const o = __o(), k = __r(o.querySelector('.picker')), d = __r(__f()); return { ferme: !o.querySelector('.menu'), vu: !!window.__seenMark, cache: k.b <= d.t && k.t >= 0, focus: o.activeElement === o.querySelector('button.pick'), defile: __f().scrollTop, k, d }`)

  // la bulle montrée par le focus sur son élément : la boîte fixe fausse l'ancre, le script la place
  async function montrerBulle() {
    await lire(`__h().querySelector('.t').focus()`)
    await attendre(`!!__bulle()`)
    await images()
    assert.ok(await lire(`return !__bulle().classList.contains('mjs-title-anchored')`), 'la bulle est placée par le script')
  }
  const bulle = () => lire(`const e = __r(__h().querySelector('.t')), p = __r(__h().querySelector('.defile')); return { visible: !!__bulle(), cache: e.b <= p.t && e.t >= 0, e, p }`)

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    const built = await bati(prod)
    browser     = await (await import('playwright'))[nom].launch()
    const ctx   = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' })
    page        = await ctx.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.addInitScript(OUTILS)
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://f.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${BOITE}</head><body style="margin:0;font:14px sans-serif"><div class="fenetre"><div class="corps"><div class="haut"></div><mjs-mf-page></mjs-mf-page><div class="bas"></div></div></div>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://f.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-mf-page'), c = h && h._shadow && h._shadow.querySelector('mjs-core-chart.c'); return !!c && !!c._shadow && !!c._shadow.querySelector('button.pick') && !!h._shadow.querySelector('.t') })()`, null, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'}`)
    }
    await page.waitForTimeout(300)
  })

  afterEach(async function () {
    if (!present || !page) return
    await page.keyboard.press('Escape')
    await page.mouse.click(990, 790)
    await lire(`window.__mo && window.__mo.disconnect(); window.__seenMark = false; __f().scrollTop = 0; __h().querySelector('.defile').scrollTop = 0; for (const r of [__o(), __h(), document]) { const a = r.activeElement; if (a && a.blur) a.blur() }`)
    await attendre(`!__o().querySelector('.menu') && !__bulle()`)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le bouton encore visible quand la boîte défile : le menu reste ouvert et suit son bouton', async function () {
    if (!present) { this.skip(); return }
    await ouvrirMenu()
    await lire(`__f().scrollTop = 12`)
    await repos()
    const m = await menu()
    assert.ok(m.ouvert && m.dessus && contreMenu(m), `menu ouvert, contre son bouton : ${JSON.stringify(m)}`)
  })

  it('le bouton caché par la boîte qui défile : le menu se ferme, le focus revient au bouton sans rien faire défiler', async function () {
    if (!present) { this.skip(); return }
    await ouvrirMenu()
    const avant = await cacherBouton()
    await repos()
    const r = await apres()
    assert.ok(r.cache, `le bouton est caché par la boîte, dans la fenêtre : ${JSON.stringify(r)}`)
    assert.ok(r.ferme && r.focus && r.defile === avant, `le menu est fermé, le focus sur le bouton, la boîte à sa place (${avant}) : ${JSON.stringify(r)}`)
  })

  it('le menu ouvert par un script, son bouton caché : il se ferme aussitôt, le focus sur le bouton', async function () {
    if (!present) { this.skip(); return }
    const avant = await cacherBouton()
    await lire(`const o = __o(); window.__mo = new MutationObserver(() => { if (o.querySelector('.menu')) window.__seenMark = true }); window.__mo.observe(o, { childList: true, subtree: true }); o.querySelector('button.pick').click()`)
    await repos()
    const r = await apres()
    assert.ok(r.cache && r.vu, `le menu s'est ouvert, son bouton caché par la boîte, dans la fenêtre : ${JSON.stringify(r)}`)
    assert.ok(r.ferme && r.focus && r.defile === avant, `le menu est fermé, le focus sur le bouton, la boîte à sa place (${avant}) : ${JSON.stringify(r)}`)
  })

  it('l\'élément encore visible quand le conteneur du composant défile : la bulle reste', async function () {
    if (!present) { this.skip(); return }
    await montrerBulle()
    await lire(`__h().querySelector('.defile').scrollTop = 6`)
    await repos()
    const b = await bulle()
    assert.ok(!b.cache && b.visible, `la bulle est toujours là : ${JSON.stringify(b)}`)
  })

  it('l\'élément caché par le conteneur du composant qui défile : la bulle se ferme', async function () {
    if (!present) { this.skip(); return }
    await montrerBulle()
    await lire(`const p = __h().querySelector('.defile'), e = __r(__h().querySelector('.t')); p.scrollTop += Math.ceil(e.b - __r(p).t) + 2`)
    await repos()
    const b = await bulle()
    assert.ok(b.cache, `l'élément est caché par le conteneur, dans la fenêtre : ${JSON.stringify(b)}`)
    assert.ok(!b.visible, `la bulle est fermée : ${JSON.stringify(b)}`)
  })

  it('un élément sans boîte CSS (`display: contents`) et l\'intérieur d\'un `<svg>`, placés par le script : la bulle reste', async function () {
    if (!present) { this.skip(); return }
    await lire(`__h().querySelector('.sbb').focus()`)
    await attendre(`!!__bulle()`)
    await repos()
    const sans = await lire(`const b = __bulle(); return { visible: !!b, texte: b && b.textContent, ancree: !!b && b.classList.contains('mjs-title-anchored') }`)
    assert.ok(sans.visible && sans.texte === 'Bulle sans boîte' && !sans.ancree, `la bulle de l'élément sans boîte reste : ${JSON.stringify(sans)}`)
    await lire(`__h().querySelector('.sbb').blur()`)
    await attendre(`!__bulle()`)
    const c = await lire(`const r = __r(__h().querySelector('.sr')); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }`)
    await page.mouse.move(c.x, c.y)
    await attendre(`!!__bulle()`)
    await repos()
    const dessin = await lire(`const b = __bulle(); return { visible: !!b, texte: b && b.textContent, ancree: !!b && b.classList.contains('mjs-title-anchored') }`)
    assert.ok(dessin.visible && dessin.texte === 'Bulle du dessin' && !dessin.ancree, `la bulle de l'intérieur du dessin reste : ${JSON.stringify(dessin)}`)
  })

  it('aucune erreur dans la page', function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [])
  })
})
