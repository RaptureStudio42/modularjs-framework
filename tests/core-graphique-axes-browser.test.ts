// module cœur <@@chart>, graphiques à axes (courbe, aire, points, barres), dans Chromium, Firefox et WebKit réels, en développement et en
// production : les quatre formes, les bornes, les quatre sortes d'axe x, les étiquettes à 390 px (entières, sans chevauchement), la bulle
// (son côté, jamais coupée), le clavier, le tactile, @pick, le texte de vide, le masquage (hidden), les statistiques (stats), la tendance,
// le regroupement par période (step), le thème clair et sombre, le tableau lu par les lecteurs d'écran, le mouvement réduit et la liaison
// à deux sens de shape, stats, step et hidden. Les lignes s'écrivent à plat ou avec leurs mesures dans `readings` : les deux se lisent.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const ICI = dirname(fileURLToPath(import.meta.url))

// douze relevés, un tous les deux jours à partir du mardi 1er septembre 2026 : six écrits à plat, six avec leurs mesures dans `readings` ;
// par semaine (du lundi), ils se rangent en 3, 4, 3 et 2 relevés
const JOURS = [
  "{ id: 'r1', x: '2026-09-01', poids: 72, tour: 81, note: 'bien' }",
  "{ id: 'r2', x: '2026-09-03', poids: 72.4, tour: 81.5 }",
  "{ id: 'r3', x: '2026-09-05', poids: 73, tour: 82, note: 'fatigué' }",
  "{ id: 'r4', x: '2026-09-07', poids: 72.2, tour: 81 }",
  "{ id: 'r5', x: '2026-09-09', poids: 71.8, tour: 80.6 }",
  "{ id: 'r6', x: '2026-09-11', poids: 72.6, tour: 81.2 }",
  "{ id: 'r7', x: '2026-09-13', readings: { poids: 73.1, tour: 82.3, note: 'en forme' } }",
  "{ id: 'r8', x: '2026-09-15', readings: { poids: 73.4, tour: 82.8 } }",
  "{ id: 'r9', x: '2026-09-17', readings: { poids: 72.9, tour: 82.1 } }",
  "{ id: 'r10', x: '2026-09-19', readings: { poids: 73.8, tour: 83 } }",
  "{ id: 'r11', x: '2026-09-21', readings: { poids: 74.1, tour: 83.4 } }",
  "{ id: 'r12', x: '2026-09-23', readings: { poids: 74.5, tour: 83.9 } }"
]

const LONG = Array.from({ length: 60 }, (_, i) => `{ id: 'l${i}', x: '${new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)}', v: ${50 + (i % 7)} }`)

const PAGE = `<script>
  $jours = [
    ${JOURS.join('\n    ')}
  ]
  $series     = [{ key: 'poids', name: 'Poids', unit: 'kg' }, { key: 'tour', name: 'Tour', unit: 'kg', color: 'orange' }, { key: 'note', name: 'Note', kind: 'text' }]
  $vide       = []
  $nombres    = [{ id: 'n1', x: 1, v: 20 }, { id: 'n2', x: 2, v: 35 }, { id: 'n3', x: 3, v: 60 }, { id: 'n4', x: 4, v: 42 }, { id: 'n5', x: 5, v: 51 }]
  $categories = [{ id: 'k1', x: 'Lundi', v: 3 }, { id: 'k2', x: 'Mardi', v: 5 }, { id: 'k3', x: 'Mercredi', v: 2 }, { id: 'k4', x: 'Jeudi', v: 6 }]
  $instants   = [{ id: 'i1', x: '2026-09-01T08:30:00Z', v: 3 }, { id: 'i2', x: '2026-09-01T12:00:00Z', v: 5 }, { id: 'i3', x: '2026-09-01T18:45:00Z', v: 4 }]
  $long       = [
    ${LONG.join('\n    ')}
  ]
  $mixte      = [{ id: 'm1', x: '2026-09-01', kg: 72, cm: 180 }, { id: 'm2', x: '2026-09-02', kg: 73, cm: 181 }]
  $s3         = [{ key: 'v', name: 'Valeur' }]
  $s7         = [{ key: 'kg', name: 'Masse', unit: 'kg' }, { key: 'cm', name: 'Taille', unit: 'cm', color: 5 }]
  $bornes     = [0, 100]
  $forme      = 'line'
  $stats      = ''
  $pas        = 'auto'
  $cachees    = []
  $choix      = ''
</script>

<div class="boutons">
  <button class="b-line" @click={$forme = 'line'}>l</button>
  <button class="b-area" @click={$forme = 'area'}>a</button>
  <button class="b-dots" @click={$forme = 'dots'}>d</button>
  <button class="b-bar" @click={$forme = 'bar'}>b</button>
  <button class="b-stats" @click={$stats = 'mean median q1 q3 trend'}>s</button>
  <button class="b-nostats" @click={$stats = ''}>s0</button>
  <button class="b-week" @click={$pas = 'week'}>w</button>
  <button class="b-auto" @click={$pas = 'auto'}>w0</button>
  <button class="b-hide" @click={$cachees = ['tour']}>h</button>
  <button class="b-show" @click={$cachees = []}>h0</button>
</div>
<p class="vu">{$forme}|{$stats}|{$pas}|{$cachees.join(',')}|{$choix}</p>
<@@chart class="c1" rows={$jours} series={$series} shape=!{$forme} stats=!{$stats} step=!{$pas} hidden=!{$cachees} pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="c2" rows={$vide} series={$series}></@@chart>
<@@chart class="c3" rows={$nombres} series={$s3} axis="number" bounds={$bornes}></@@chart>
<@@chart class="c4" rows={$categories} series={$s3} shape="bar"></@@chart>
<@@chart class="c5" rows={$instants} series={$s3} label="Relevés horaires"></@@chart>
<@@chart class="c6" rows={$long} series={$s3}></@@chart>
<@@chart class="c7" rows={$mixte} series={$s7}></@@chart>

<style>
  :host
    display: block
  .boutons, .vu
    display: none
</style>
`

const SOURCES: Record<string, string> = { 'gr-page.mjs': PAGE }

// le corps de page des essais : la page hôte et, pour le thème, ses couleurs de fond et de texte
type Contexte = { largeur?: number, sombre?: boolean, teinte?: string, reduit?: boolean, tactile?: boolean }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-axes', SOURCES, prod))

// une expression lue dans la page : `g('c1')` est l'ombre du graphique de classe c1, `h` celle de la page hôte
const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gr-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const cliquer = (page: any, bouton: string) => page.evaluate(`document.querySelector('mjs-gr-page')._shadow.querySelector('.${bouton}').click()`)
const vu = async (page: any) => String(await lire(page, `return h.querySelector('.vu').textContent`))

// la luminance relative et le contraste de deux couleurs rgb(…) (WCAG)
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contraste = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('<@@chart> : les six teintes par défaut se lisent sur fond clair et sur fond sombre', () => {
  it('chaque teinte garde un contraste d\'au moins 3 contre le blanc et contre un fond sombre', () => {
    const texte = readFileSync(join(ICI, '..', 'src', 'core-modules', 'chart.mjs'), 'utf-8')
    const teintes = [...texte.matchAll(/var\(--mjs-chart-([1-6]), #([0-9a-f]{6})\)/g)].map((m) => [m[1], m[2]])
    assert.deepEqual(teintes.map((t) => t[0]), ['1', '2', '3', '4', '5', '6'])
    for (const [n, hex] of teintes) {
      const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`
      assert.ok(contraste(rgb, 'rgb(255, 255, 255)') >= 3, `teinte ${n} (#${hex}) sur blanc : ${contraste(rgb, 'rgb(255, 255, 255)').toFixed(2)}`)
      assert.ok(contraste(rgb, 'rgb(18, 18, 18)') >= 3, `teinte ${n} (#${hex}) sur fond sombre : ${contraste(rgb, 'rgb(18, 18, 18)').toFixed(2)}`)
    }
  })
})

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> à axes (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  async function ouvrir(o: Contexte = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.largeur ?? 800, height: 700 }, ...(o.reduit ? { reducedMotion: 'reduce' } : {}), ...(o.tactile ? { hasTouch: true, isMobile: nom !== 'firefox' } : {}) })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    // le thème sombre du cœur (`data-mjs-theme="dark"`), sur son fond
    const fond   = o.sombre ? 'background:#232936;color:#e8eaed' : 'background:#ffffff;color:#222222'
    const theme  = o.sombre ? ' data-mjs-theme="dark"' : ''
    const teinte = o.teinte ? `;--mjs-chart-1:${o.teinte}` : ''
    await page.route('http://g.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;${fond}${teinte}"><mjs-gr-page></mjs-gr-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://g.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction(() => { const c = (document.querySelector('mjs-gr-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === 7 && [...c].every((x: any) => x._shadow?.querySelector('svg.svg')) }, null, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
    }
    await page.waitForTimeout(250)
    return { ctx, page, erreurs, avis }
  }

  // la zone de tracé d'un graphique, en px de la page
  const zone = (page: any, c: string) => lire(page, `const r = g('${c}').querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`)
  const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)
  const bulle = (page: any, c: string) => lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; const r = t.getBoundingClientRect(); const b = g('${c}').querySelector('.chart').getBoundingClientRect(); return { side: t.dataset.side, titre: t.querySelector('b').textContent, lignes: [...t.querySelectorAll('.row')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()), groupe: t.querySelector('.grouped')?.textContent ?? '', left: r.left, right: r.right, width: r.width, boxLeft: b.left, boxRight: b.right, vw: document.documentElement.clientWidth }`)

  it('les quatre formes, deux écritures des lignes, les bornes, les quatre sortes d\'axe, le vide, le tableau accessible, les points au-delà de 40 lignes', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    // courbe : une ligne par série de nombres (la série de mots n'est jamais dessinée), douze points chacune, écrites à plat ou dans readings
    assert.equal(await compte(page, 'c1', 'path.line'), 2)
    assert.equal(await compte(page, 'c1', 'circle.dot'), 24)
    assert.equal(await lire(page, `return g('c1').querySelector('path.line').getAttribute('d').split(/[ML]/).filter((s) => s.trim()).length`), 12)
    await cliquer(page, 'b-area')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'path.area'), 2, 'aire : une surface par série')
    assert.equal(await compte(page, 'c1', 'path.line'), 2, 'aire : son trait par-dessus')
    await cliquer(page, 'b-dots')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'path.line'), 0, 'points : aucun trait')
    assert.equal(await compte(page, 'c1', 'circle.dot'), 24)
    await cliquer(page, 'b-bar')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'rect.bar'), 24, 'barres : une par série et par relevé')
    assert.equal(await compte(page, 'c1', 'circle.dot'), 0)
    assert.ok(await lire(page, `return [...g('c1').querySelectorAll('rect.bar')].every((b) => Number(b.getAttribute('height')) > 0 && b.getBoundingClientRect().width > 1)`), 'chaque barre a une hauteur et une largeur')
    assert.equal(await vu(page), 'bar||auto||', 'la page voit la forme choisie')
    await cliquer(page, 'b-line')
    await page.waitForTimeout(80)
    // les bornes : l'axe garde [0, 100] même si les valeurs vont de 20 à 60 ; axe des nombres
    assert.deepEqual(await lire(page, `return [...g('c3').querySelectorAll('text.ylabel')].map((t) => t.textContent)`), ['0', '25', '50', '75', '100'])
    assert.deepEqual(await lire(page, `return [...g('c3').querySelectorAll('text.xlabel')].map((t) => t.textContent)`).then((l: string[]) => [l[0], l[l.length - 1]]), ['1', '5'])
    // axe des jours (deviné), des libellés (barres), des instants (heure et minutes)
    assert.match(String(await lire(page, `return g('c1').querySelector('text.xlabel').textContent`)), /^1\s*sept\.?$/)
    assert.deepEqual(await lire(page, `return [...g('c4').querySelectorAll('text.xlabel')].map((t) => t.textContent)`).then((l: string[]) => [l[0], l[l.length - 1]]), ['Lundi', 'Jeudi'])
    assert.equal(await compte(page, 'c4', 'rect.bar'), 4)
    assert.match(String(await lire(page, `return g('c5').querySelector('text.xlabel').textContent`)), /\d{1,2}:\d{2}/)
    // le vide : le cadre et sa hauteur tout de suite, le texte de vide, aucun tracé
    assert.equal(await lire(page, `return g('c2').querySelector('.empty')?.textContent`), 'Aucune valeur')
    assert.ok(Number(await lire(page, `return g('c2').querySelector('.plot').getBoundingClientRect().height`)) >= 100, 'la hauteur est réservée')
    assert.equal(await compte(page, 'c2', 'path.line'), 0)
    assert.equal(await compte(page, 'c2', 'text.ylabel'), 0)
    // tableau lu par les lecteurs d'écran : titre, en-têtes (la série de mots comprise), une ligne par relevé ; le dessin leur est caché
    assert.equal(await lire(page, `return g('c1').querySelector('svg.svg').getAttribute('aria-hidden')`), 'true')
    assert.equal(await lire(page, `return g('c1').querySelector('table caption').textContent`), 'Graphique')
    assert.equal(await lire(page, `return g('c5').querySelector('table caption').textContent`), 'Relevés horaires')
    assert.deepEqual(await lire(page, `return [...g('c1').querySelectorAll('thead th')].map((t) => t.textContent)`), ['Date', 'Poids (kg)', 'Tour (kg)', 'Note'])
    assert.equal(await compte(page, 'c1', 'tbody tr'), 12)
    assert.deepEqual(await lire(page, `return [...g('c1').querySelectorAll('tbody tr')[0].children].map((t) => t.textContent)`).then((l: string[]) => l.slice(1)), ['72 kg', '81 kg', 'bien'])
    assert.ok(Number(await lire(page, `return g('c1').querySelector('table').parentElement.getBoundingClientRect().width`)) <= 1, 'le tableau ne se voit pas à l\'écran')
    assert.equal(await lire(page, `return getComputedStyle(g('c1').querySelector('table').parentElement).clipPath`), 'inset(50%)')
    // au-delà de 40 lignes, la courbe perd ses points ; la forme « points » les garde
    assert.equal(await compte(page, 'c6', 'circle.dot'), 0)
    assert.equal(await compte(page, 'c6', 'path.line'), 1)
    // des unités différentes : une échelle par série, sans graduation commune, et une note le dit
    assert.equal(await compte(page, 'c7', 'text.ylabel'), 0)
    assert.match(String(await lire(page, `return g('c7').querySelector('.note')?.textContent`)), /échelle par série/)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('masquage, statistiques sur chaque série visible, tendance et point estimé, regroupement par semaine, liaison à deux sens', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    await cliquer(page, 'b-stats')
    await page.waitForTimeout(80)
    for (const s of ['mean', 'median', 'q1', 'q3']) assert.equal(await compte(page, 'c1', `svg.svg path.stat-${s}`), 2, `${s} : un trait par série visible`)
    assert.equal(await compte(page, 'c1', 'path.trend'), 2)
    assert.equal(await compte(page, 'c1', 'svg.svg circle.ghost'), 2)
    const traits = await lire(page, `return ['mean', 'median', 'q1', 'q3', 'trend'].map((s) => getComputedStyle(g('c1').querySelector(s === 'trend' ? 'path.trend' : 'path.stat-' + s)).strokeDasharray)`)
    assert.equal(new Set(traits).size, 5, `un style de trait par statistique : ${traits.join(' / ')}`)
    assert.ok(await lire(page, `const d = g('c1').querySelector('path.stat-mean').getAttribute('d').match(/[-\\d.]+/g).map(Number); return d[1] === d[3] && d[0] === 0`), 'la moyenne est un trait horizontal d\'un bord à l\'autre')
    assert.ok(await lire(page, `const c = g('c1').querySelector('svg.svg circle.ghost'); const dots = [...g('c1').querySelectorAll('circle.dot')].map((d) => parseFloat(d.getAttribute('cx'))); return parseFloat(c.getAttribute('cx')) > Math.max(...dots)`), 'le point estimé vient après le dernier relevé')
    assert.equal(await compte(page, 'c1', '.keys .key'), 5, 'la légende des traits nomme chaque statistique')
    // la couleur de chaque série : la teinte 1 pour la première, « orange » (la teinte 2) pour la seconde ; ses statistiques la reprennent
    const couleurs = await lire(page, `return [...g('c1').querySelectorAll('path.line')].map((p) => getComputedStyle(p).stroke)`)
    assert.equal(couleurs.length, 2)
    assert.notEqual(couleurs[0], couleurs[1])
    assert.equal(await lire(page, `return getComputedStyle(g('c1').querySelectorAll('svg.svg path.stat-mean')[1]).stroke`), couleurs[1])
    // masquer une série : ni trait, ni statistique, ni colonne du tableau, ni ligne de bulle
    await cliquer(page, 'b-hide')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'path.line'), 1)
    assert.equal(await compte(page, 'c1', 'svg.svg path.stat-mean'), 1)
    assert.deepEqual(await lire(page, `return [...g('c1').querySelectorAll('thead th')].map((t) => t.textContent)`), ['Date', 'Poids (kg)', 'Note'])
    await cliquer(page, 'b-show')
    await cliquer(page, 'b-nostats')
    // par semaine : quatre colonnes (3, 4, 3 et 2 relevés), la bulle dit la semaine et la moyenne de combien de valeurs
    await cliquer(page, 'b-week')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'circle.dot'), 8)
    assert.equal(await compte(page, 'c1', 'tbody tr'), 4)
    assert.equal(await lire(page, `return g('c1').querySelector('thead th').textContent`), 'Période')
    const z = await zone(page, 'c1')
    await page.mouse.move(z.x + 2, z.y + z.h / 2)
    await page.waitForTimeout(80)
    const b = await bulle(page, 'c1')
    assert.ok(b, 'la bulle est ouverte')
    assert.match(b.titre, /^Semaine du 31 août 2026$/)
    assert.equal(b.groupe, 'Moyenne de 3 valeurs')
    assert.equal(b.lignes.length, 2, 'une série de mots ne se moyenne pas : elle quitte la bulle regroupée')
    await page.mouse.move(z.x + z.w + 40, z.y - 40)
    await cliquer(page, 'b-auto')
    await page.waitForTimeout(80)
    assert.equal(await compte(page, 'c1', 'circle.dot'), 24)
    // à deux sens : ce que le graphique écrit lui-même (comme le fera sa barre d'outils) remonte dans les variables de la page ; l'écriture passe
    // par `µ._set`, le chemin de toute écriture d'état compilée, que seul le développement expose à la page (la production abrège ses noms)
    if (!prod) {
      await lire(page, `const c = h.querySelector('mjs-core-chart.c1'); for (const [k, v] of [['shape', 'area'], ['stats', 'mean'], ['step', 'month'], ['hidden', ['note']]]) µ._set(c, k, v)`)
      await page.waitForTimeout(80)
      assert.equal(await vu(page), 'area|mean|month|note|')
      assert.equal(await compte(page, 'c1', 'path.area'), 2)
    }
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('la bulle change de côté et reste entière, le clavier parcourt les points, @pick part au clic et à Entrée', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    const z = await zone(page, 'c1')
    await page.mouse.move(z.x + 4, z.y + z.h / 2)
    await page.waitForTimeout(80)
    let b = await bulle(page, 'c1')
    assert.equal(b.side, 'right', 'à gauche du tracé, la bulle s\'ouvre à droite du curseur')
    assert.match(b.titre, /^1\s*sept\.? 2026$/)
    assert.deepEqual(b.lignes, ['Poids 72 kg', 'Tour 81 kg', 'Note bien'])
    assert.ok(b.width <= 260 + 0.5)
    await page.mouse.move(z.x + z.w - 3, z.y + z.h / 2)
    await page.waitForTimeout(80)
    b = await bulle(page, 'c1')
    assert.equal(b.side, 'left', 'à droite du tracé, elle s\'ouvre à gauche')
    assert.ok(b.left >= b.boxLeft - 0.5 && b.right <= b.boxRight + 0.5, `bulle entière dans le cadre : ${b.left}–${b.right} dans ${b.boxLeft}–${b.boxRight}`)
    assert.ok(await lire(page, `return g('c1').querySelectorAll('circle.mark').length === 2 && !!g('c1').querySelector('line.cursor')`), 'le curseur et les points de la colonne survolée s\'allument')
    await page.mouse.move(z.x + z.w + 50, z.y + z.h + 200)
    await page.waitForTimeout(80)
    assert.equal(await bulle(page, 'c1'), null, 'la souris partie, la bulle se ferme')
    // un clic choisit la ligne la plus proche
    await page.mouse.click(z.x + 2, z.y + z.h / 2)
    await page.waitForTimeout(80)
    assert.equal((await vu(page)).split('|')[4], 'r1')
    await page.mouse.move(z.x + z.w + 50, z.y + z.h + 200)
    // clavier : un graphique qu'on peut choisir entre dans la tabulation, les autres non
    assert.equal(await lire(page, `return g('c1').querySelector('.hit').getAttribute('tabindex')`), '0')
    assert.equal(await lire(page, `return g('c3').querySelector('.hit').hasAttribute('tabindex')`), false)
    // la tabulation y entre (le focus se voit alors dans tous les navigateurs) ; WebKit, qui ne tabule que les champs, reçoit le focus du script
    // le clic d'avant y a mis le focus à la souris : il en sort d'abord, la tabulation le ramène
    await lire(page, `g('c1').activeElement?.blur()`)
    await page.keyboard.press('Tab')
    if (!await lire(page, `return g('c1').activeElement === g('c1').querySelector('.hit')`)) await lire(page, `g('c1').querySelector('.hit').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    assert.match((await bulle(page, 'c1')).titre, /^1\s*sept/)
    await page.keyboard.press('End')
    await page.waitForTimeout(60)
    assert.match((await bulle(page, 'c1')).titre, /^23\s*sept/)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.equal((await vu(page)).split('|')[4], 'r11')
    assert.match(String(await lire(page, `return g('c1').querySelector('[aria-live]').textContent`)), /21\s*sept/)
    await page.keyboard.press('Home')
    await page.waitForTimeout(60)
    assert.match((await bulle(page, 'c1')).titre, /^1\s*sept/)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(60)
    assert.equal(await bulle(page, 'c1'), null)
    assert.notEqual(await lire(page, `const s = getComputedStyle(g('c1').querySelector('.hit')); return s.outlineStyle + s.boxShadow`), 'nonenone', `le focus se voit : ${await lire(page, `const a = g('c1').activeElement; return (a ? a.className : 'aucun') + ' / focus-visible : ' + (a ? a.matches(':focus-visible') : '-')`)}`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('à 390 px : étiquettes entières sans chevauchement, bulle dans l\'écran ; au doigt, un appui ouvre la bulle, un appui ailleurs la ferme', async () => {
    const { ctx, page, erreurs } = await ouvrir({ largeur: 390, tactile: true })
    for (const c of ['c1', 'c5', 'c6', 'c4']) {
      const etiquettes = await lire(page, `const z = g('${c}').querySelector('.plot').getBoundingClientRect(); return { z: [z.left, z.right], l: [...g('${c}').querySelectorAll('text.xlabel')].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right, t.textContent] }) }`)
      assert.ok(etiquettes.l.length >= 2, `${c} : au moins la première et la dernière étiquette`)
      for (let i = 1; i < etiquettes.l.length; i++) assert.ok(etiquettes.l[i][0] >= etiquettes.l[i - 1][1] + 2, `${c} : « ${etiquettes.l[i - 1][2]} » touche « ${etiquettes.l[i][2]} »`)
      assert.ok(etiquettes.l[0][0] >= etiquettes.z[0] - 1 && etiquettes.l[etiquettes.l.length - 1][1] <= etiquettes.z[1] + 1.5, `${c} : les étiquettes restent sous le tracé : ${JSON.stringify(etiquettes)}`)
    }
    assert.equal(await lire(page, `return getComputedStyle(g('c1').querySelector('.hit')).touchAction`), 'pan-y')
    const z = await zone(page, 'c1')
    await page.touchscreen.tap(z.x + z.w / 2, z.y + z.h / 2)
    await page.waitForTimeout(400)
    const b = await bulle(page, 'c1')
    assert.ok(b, 'un appui ouvre la bulle')
    assert.ok(b.left >= 0 && b.right <= b.vw + 0.5, `la bulle reste dans l'écran : ${b.left}–${b.right} sur ${b.vw}`)
    assert.ok(b.width <= Math.min(260, b.vw * 0.7) + 0.5, `largeur ${b.width}`)
    await page.touchscreen.tap(z.x + z.w / 2, z.y + z.h + 260)
    await page.waitForTimeout(400)
    assert.equal(await bulle(page, 'c1'), null, 'un appui ailleurs la ferme')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('thème clair et sombre, teinte du thème surchargée, mouvement réduit', async () => {
    const clair = await ouvrir()
    const sombre = await ouvrir({ sombre: true, teinte: 'rgb(1, 2, 3)' })
    const lu = (page: any) => lire(page, `return { texte: getComputedStyle(g('c1').querySelector('text.ylabel')).fill, trait: getComputedStyle(g('c1').querySelector('path.line')).stroke }`)
    const a = await lu(clair.page)
    const s = await lu(sombre.page)
    assert.ok(contraste(a.texte, 'rgb(255, 255, 255)') >= 3, `graduations lisibles sur fond clair : ${a.texte}`)
    assert.ok(contraste(s.texte, 'rgb(35, 41, 54)') >= 3, `graduations lisibles sur fond sombre : ${s.texte}`)
    assert.notEqual(a.texte, s.texte, 'les graduations suivent le thème du cœur')
    assert.equal(a.trait, 'rgb(59, 130, 246)', 'la teinte 1 par défaut')
    assert.equal(s.trait, 'rgb(1, 2, 3)', 'la variable de thème --mjs-chart-1 de la page repeint la série')
    const duree = async (page: any) => {
      const z = await zone(page, 'c1')
      await page.mouse.move(z.x + 4, z.y + z.h / 2)
      await page.waitForTimeout(80)
      return lire(page, `return getComputedStyle(g('c1').querySelector('.tip')).transitionDuration + '/' + getComputedStyle(g('c1').querySelector('circle.mark')).transitionDuration`)
    }
    assert.notEqual(await duree(clair.page), '0s/0s', 'sans mouvement réduit, la bulle et les points glissent')
    await clair.ctx.close()
    await sombre.ctx.close()
    const reduit = await ouvrir({ reduit: true })
    assert.equal(await duree(reduit.page), '0s/0s')
    assert.deepEqual([...clair.erreurs, ...sombre.erreurs, ...reduit.erreurs], [])
    await reduit.ctx.close()
  })
})
