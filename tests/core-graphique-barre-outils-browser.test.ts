// module cœur <@@chart> : la barre d'outils, en option (`toolbar="legend shapes stats step"`, un outil par mot, rien sans elle). La
// légende cache ou montre une série (la dernière visible reste), en boutons à aria-pressed ; le menu des formes suit le modèle menu /
// menuitemradio (flèches en boucle, Début, Fin, Échap, Entrée), grise une forme impossible avec ces données (radar sous 3 lignes,
// calendrier sans axe de dates, anneau qui n'a pas de sens), se restreint par `shapes` et ne sort jamais de l'écran ; les statistiques
// se cochent (chaque case montre son trait), grisées quand la forme n'en trace pas ; le pas de temps n'existe que sur un axe du temps,
// le calendrier sans « année ». La barre écrit les props elles-mêmes : liées par !{…}, le parent suit. Un choix fait dans la barre
// n'écrit jamais rien en console (ni erreur ni avertissement des contrôles du module), en développement comme en production ; une
// valeur du programmeur venue ensuite reste contrôlée. Écran de 390 px : la barre passe à la ligne. Survol, focus clavier et appui
// s'allument ; le mouvement réduit coupe les transitions. Dans Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const JOURS = Array.from({ length: 14 }, (_, i) => `{ id: 'j${i}', x: '2026-10-${String(i + 1).padStart(2, '0')}', poids: ${70 + (i % 4)}, pas: ${60 + (i % 5)} }`).join(', ')

const PAGE = `<script>
  $jours     = [${JOURS}]
  $series    = [{ key: 'poids', name: 'Poids', unit: 'kg' }, { key: 'pas', name: 'Pas', unit: 'kg' }]
  $une       = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $unites    = [{ key: 'poids', name: 'Poids', unit: 'kg' }, { key: 'pas', name: 'Durée', unit: 'min' }]
  $deux      = [{ id: 'f', x: 'Force', poids: 2 }, { id: 's', x: 'Souplesse', poids: 4 }]
  $quatorze  = [${Array.from({ length: 14 }, (_, i) => `{ x: 'A${i + 1}', poids: ${i + 1}, pas: ${20 - i} }`).join(', ')}]
  $forme     = 'line'
  $stats     = ''
  $pas       = 'auto'
  $cache     = []
  $programme = 'line'
</script>

<@@chart class="b1" rows={$jours} series={$series} toolbar="legend shapes stats step" shape=!{$forme} stats=!{$stats} step=!{$pas} hidden=!{$cache}></@@chart>
<p class="echo">{$forme}|{$stats}|{$pas}|{$cache.join(',')}</p>
<@@chart class="b2" rows={$deux} series={$une} toolbar="shapes step"></@@chart>
<@@chart class="b3" rows={$jours} series={$unites} toolbar="shapes" shapes="line bar pie"></@@chart>
<@@chart class="b4" rows={$jours} series={$series} toolbar="stats shapes" stats="mean"></@@chart>
<@@chart class="b5" rows={$quatorze} series={$unites} toolbar="shapes legend" shape=!{$programme}></@@chart>
<@@chart class="b6" rows={$jours} series={$series} toolbar="shapes step" step="year"></@@chart>
<@@chart class="b0" rows={$jours} series={$series}></@@chart>
<button type="button" class="faute" @click={$programme = 'courbe'}>faute</button>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'gb-page.mjs': PAGE }
const GRAPHIQUES = 7
const P = '[ModularJS] <@@chart> : '
const FAUTE = P + '« courbe » n\'est pas une valeur connue de shape, elle est ignorée — valeurs connues : line area dots bar stack histogram pie heatmap radar calendar.'

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-barre-outils', SOURCES, prod))

const PREFIXE = `const h = document.querySelector('mjs-gb-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow;`
const lire = (page: any, corps: string) => page.evaluate(`(() => { ${PREFIXE} ${corps} })()`)
const q = (v: string) => JSON.stringify(v)
// le centre d'un élément d'un graphique, amené à l'écran : celui qui répond au sélecteur (et porte ce texte, s'il est donné) ; les ombres
// sont fermées, la souris clique à ses coordonnées
const centre = (page: any, c: string, s: string, texte = '', rang = 0) => lire(page, `const n = [...g(${q(c)}).querySelectorAll(${q(s)})].filter((x) => !${q(texte)} || x.textContent.trim() === ${q(texte)})[${rang}]; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
async function cliquer(page: any, c: string, s: string, texte = '', rang = 0) {
  const p = await centre(page, c, s, texte, rang)
  assert.ok(p, `${c} : ${s} ${texte} absent`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(120)
}
const focaliser = (page: any, c: string, s: string, rang = 0) => lire(page, `g(${q(c)}).querySelectorAll(${q(s)})[${rang}].focus()`)
// l'élément qui a le focus, dans les ombres imbriquées : son rôle (ou sa balise) et son texte
const actif = (page: any) => page.evaluate(() => { let a: any = document.activeElement; while (a && (a._shadow ?? a.shadowRoot)?.activeElement) a = (a._shadow ?? a.shadowRoot).activeElement; return a ? (a.getAttribute('role') ?? a.localName) + ':' + a.textContent.trim() : '' })
const menuOuvert = (page: any, c: string) => lire(page, `return !!g('${c}').querySelector('[role="menu"]')`)
const items = (page: any, c: string) => lire(page, `return [...g('${c}').querySelectorAll('[role="menuitemradio"]')].map((n) => n.textContent.trim() + (n.getAttribute('aria-checked') === 'true' ? '*' : '') + (n.getAttribute('aria-disabled') === 'true' ? '#' : ''))`)

async function ouvrir(prod: boolean, built: { root: string, script: string }, browser: any, options: any) {
  const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 }, ...options })
  const page2 = await ctx.newPage()
  page2.setDefaultTimeout(8000)
  const sortie: string[] = []
  const plantages: string[] = []
  page2.on('pageerror', (e: any) => plantages.push(String(e)))
  page2.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') sortie.push(m.type() + ' ' + m.text()) })
  await page2.addInitScript('window.__name = function (f) { return f };')
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
  await page2.route('http://b.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-gb-page></mjs-gb-page>${charge}</body></html>` })
    const fichier = join(built.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page2.goto('http://b.test/', { waitUntil: 'load' })
  try {
    await page2.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gb-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
  } catch {
    throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${sortie.join(' | ')}`)
  }
  await page2.waitForTimeout(200)
  return { ctx, page: page2, sortie, plantages }
}

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> barre d'outils (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  it('légende, menu des formes, statistiques et pas de temps : rendu, clavier, grisés, liaisons, et rien en console', async () => {
    const { ctx, page, sortie, plantages } = await ouvrir(prod, built, browser, {})
    // sans toolbar, rien ne change ; avec, un outil par mot, chacun nommé
    assert.equal(await lire(page, `return g('b0').querySelectorAll('.tools').length`), 0, 'sans toolbar, aucune barre')
    assert.equal(await lire(page, `return g('b1').querySelector('.tools').getAttribute('role') + '|' + g('b1').querySelector('.tools').getAttribute('aria-label')`), 'group|Outils du graphique')
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('.tools [aria-label]')].map((n) => n.getAttribute('role') + ':' + n.getAttribute('aria-label'))`), ['group:Séries affichées', 'null:Forme\u00a0: Courbe', 'group:Statistiques', 'radiogroup:Pas de temps'])
    // la légende : un bouton par série de nombres, dans sa teinte ; un clic cache, la dernière visible reste, le parent suit
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('button.series')].map((b) => b.textContent.trim() + ':' + b.getAttribute('aria-pressed') + ':' + /tone-\\d/.exec(b.getAttribute('class'))[0])`), ['Poids:true:tone-1', 'Pas:true:tone-2'])
    assert.equal(await lire(page, `return g('b1').querySelectorAll('path.line').length`), 2)
    await cliquer(page, 'b1', 'button.series', '', 0)
    assert.equal(await lire(page, `return g('b1').querySelectorAll('path.line').length`), 1, 'la série cachée n\'est plus tracée')
    assert.equal(await lire(page, `return g('b1').querySelector('button.series').getAttribute('aria-pressed')`), 'false')
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'line||auto|poids', 'hidden=!{…} : le parent suit')
    await cliquer(page, 'b1', 'button.series', '', 1)
    assert.equal(await lire(page, `return g('b1').querySelectorAll('path.line').length`), 1, 'la dernière série visible ne se cache pas')
    assert.equal(await lire(page, `return g('b1').querySelectorAll('button.series')[1].getAttribute('aria-pressed')`), 'true')
    await cliquer(page, 'b1', 'button.series', '', 0)
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'line||auto|')
    // le menu des formes : bouton à aria-haspopup, menu role=menu, une forme par élément menuitemradio, icône SVG et nom
    assert.equal(await lire(page, `const b = g('b1').querySelector('button.pick'); return b.getAttribute('aria-haspopup') + '|' + b.getAttribute('aria-expanded') + '|' + !!b.querySelector('svg path')`), 'menu|false|true')
    await focaliser(page, 'b1', 'button.pick')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(150)
    assert.equal(await menuOuvert(page, 'b1'), true, 'flèche du bas : le menu s\'ouvre')
    assert.equal(await lire(page, `return g('b1').querySelector('[role="menu"]').getAttribute('aria-label') + '|' + g('b1').querySelector('button.pick').getAttribute('aria-expanded')`), 'Forme|true')
    assert.deepEqual(await items(page, 'b1'), ['Courbe*', 'Aire', 'Points', 'Barres', 'Barres empilées', 'Histogramme', 'Anneau', 'Carte d\'intensité', 'Radar', 'Calendrier'])
    assert.equal(await lire(page, `return [...g('b1').querySelectorAll('[role="menuitemradio"]')].every((n) => n.querySelector('svg path') && n.getAttribute('tabindex') === '-1')`), true)
    assert.equal(await actif(page), 'menuitemradio:Courbe', 'la forme choisie prend le focus')
    await page.keyboard.press('ArrowDown')
    assert.equal(await actif(page), 'menuitemradio:Aire')
    await page.keyboard.press('End')
    assert.equal(await actif(page), 'menuitemradio:Calendrier')
    await page.keyboard.press('ArrowDown')
    assert.equal(await actif(page), 'menuitemradio:Courbe', 'les flèches bouclent')
    await page.keyboard.press('ArrowUp')
    assert.equal(await actif(page), 'menuitemradio:Calendrier')
    await page.keyboard.press('Home')
    assert.equal(await actif(page), 'menuitemradio:Courbe')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    assert.equal(await menuOuvert(page, 'b1'), false, 'Échap ferme')
    assert.equal(await actif(page), 'button:Courbe', 'le focus revient au bouton')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    assert.equal(await menuOuvert(page, 'b1'), true, 'Entrée ouvre')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    assert.equal(await actif(page), 'menuitemradio:Barres')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    assert.equal(await menuOuvert(page, 'b1'), false, 'un choix ferme le menu')
    assert.equal(await actif(page), 'button:Barres')
    assert.ok(Number(await lire(page, `return g('b1').querySelectorAll('rect.bar').length`)) >= 14, 'des barres')
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'bar||auto|', 'shape=!{…} : le parent suit')
    // un clic ailleurs ferme le menu
    await cliquer(page, 'b1', 'button.pick')
    assert.equal(await menuOuvert(page, 'b1'), true)
    const ailleurs = await lire(page, `const r = h.querySelector('.echo').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }`)
    await page.mouse.click(ailleurs.x, ailleurs.y)
    await page.waitForTimeout(120)
    assert.equal(await menuOuvert(page, 'b1'), false, 'un clic ailleurs ferme')
    // les statistiques : une case par statistique, avec l'échantillon de son trait ; cocher écrit stats, le parent suit
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('[aria-label="Statistiques"] label')].map((l) => l.textContent.trim() + ':' + l.querySelector('input').type + ':' + !!l.querySelector('svg.sample path.stat'))`), ['Moyenne:checkbox:true', 'Médiane:checkbox:true', 'Premier quartile:checkbox:true', 'Troisième quartile:checkbox:true', 'Tendance:checkbox:true'])
    await cliquer(page, 'b1', '[aria-label="Statistiques"] label', '', 0)
    assert.ok(Number(await lire(page, `return g('b1').querySelectorAll('svg.draw path.stat-mean').length`)) >= 1, 'la moyenne est tracée')
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'bar|mean|auto|', 'stats=!{…} : le parent suit')
    await focaliser(page, 'b1', '[aria-label="Statistiques"] input', 4)
    await page.keyboard.press('Space')
    await page.waitForTimeout(120)
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'bar|mean trend|auto|', 'au clavier aussi')
    // le pas de temps : sur un axe de dates, cinq pas ; écrit step, le parent suit
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('[role="radiogroup"] label')].map((l) => l.textContent.trim() + (l.querySelector('input').checked ? '*' : ''))`), ['Automatique*', 'Jour', 'Semaine', 'Mois', 'Année'])
    await cliquer(page, 'b1', '[role="radiogroup"] label', '', 2)
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'bar|mean trend|week|', 'step=!{…} : le parent suit')
    assert.equal(await lire(page, `return g('b1').querySelectorAll('rect.bar').length`), 6, 'deux séries sur trois semaines')
    // histogramme : la tendance grisée ; carte : toutes les statistiques grisées, cochées comme avant ; le pas grisé (la carte ne suit pas les lignes)
    await cliquer(page, 'b1', 'button.pick')
    await cliquer(page, 'b1', '[role="menuitemradio"]', 'Histogramme')
    await page.waitForTimeout(150)
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('[aria-label="Statistiques"] input')].map((i) => (i.checked ? 'x' : '-') + (i.disabled ? '#' : ''))`), ['x', '-', '-', '-', 'x#'])
    await cliquer(page, 'b1', 'button.pick')
    await cliquer(page, 'b1', '[role="menuitemradio"]', 'Carte d\'intensité')
    await page.waitForTimeout(150)
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('[aria-label="Statistiques"] input')].map((i) => (i.checked ? 'x' : '-') + (i.disabled ? '#' : ''))`), ['x#', '-#', '-#', '-#', 'x#'])
    assert.equal(await lire(page, `return [...g('b1').querySelectorAll('[role="radiogroup"] input')].every((i) => i.disabled)`), true)
    assert.ok(Number(await lire(page, `return g('b1').querySelectorAll('rect.cell').length`)) > 0, 'la carte est dessinée')
    // calendrier : quatre pas, sans « année »
    await cliquer(page, 'b1', 'button.pick')
    await cliquer(page, 'b1', '[role="menuitemradio"]', 'Calendrier')
    await page.waitForTimeout(150)
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('[role="radiogroup"] label')].map((l) => l.textContent.trim() + (l.querySelector('input').checked ? '*' : ''))`), ['Automatique', 'Jour', 'Semaine*', 'Mois'])
    assert.equal(await lire(page, `return h.querySelector('.echo').textContent`), 'calendar|mean trend|week|')
    // grisés : radar sous 3 lignes, calendrier sans axe de dates, pas de temps absent hors du temps ; `shapes` restreint, anneau sans sens grisé
    await cliquer(page, 'b2', 'button.pick')
    assert.deepEqual(await items(page, 'b2'), ['Courbe*', 'Aire', 'Points', 'Barres', 'Barres empilées', 'Histogramme', 'Anneau', 'Carte d\'intensité', 'Radar#', 'Calendrier#'])
    await cliquer(page, 'b2', '[role="menuitemradio"]', 'Radar')
    await page.waitForTimeout(120)
    assert.equal(await menuOuvert(page, 'b2'), true, 'une forme grisée ne se choisit pas')
    assert.equal(await lire(page, `return g('b2').querySelectorAll('path.line').length`), 1)
    await page.keyboard.press('Escape')
    assert.equal(await lire(page, `return g('b2').querySelectorAll('[role="radiogroup"]').length`), 0, 'pas de pas de temps sur des libellés')
    await cliquer(page, 'b3', 'button.pick')
    assert.deepEqual(await items(page, 'b3'), ['Courbe*', 'Barres', 'Anneau#'])
    await page.keyboard.press('Escape')
    // un choix de la barre n'est jamais une faute : cocher une statistique puis choisir la carte, des séries d'unités différentes empilées,
    // un radar de 14 lignes, un calendrier sous step="year" — rien en console
    await cliquer(page, 'b4', 'button.pick')
    await cliquer(page, 'b4', '[role="menuitemradio"]', 'Carte d\'intensité')
    await cliquer(page, 'b5', 'button.pick')
    await cliquer(page, 'b5', '[role="menuitemradio"]', 'Barres empilées')
    await page.waitForTimeout(120)
    assert.ok(Number(await lire(page, `return g('b5').querySelectorAll('rect.bar').length`)) >= 14)
    await cliquer(page, 'b5', 'button.pick')
    await cliquer(page, 'b5', '[role="menuitemradio"]', 'Radar')
    await page.waitForTimeout(120)
    assert.equal(await lire(page, `return g('b5').querySelectorAll('line.spoke').length`), 14, 'quatorze lignes, quatorze axes : 24 au plus')
    await cliquer(page, 'b6', 'button.pick')
    await cliquer(page, 'b6', '[role="menuitemradio"]', 'Calendrier')
    await page.waitForTimeout(400)
    assert.ok(Number(await lire(page, `return g('b6').querySelectorAll('rect.cell').length`)) > 0)
    assert.deepEqual(sortie, [], 'aucun choix de la barre n\'écrit en console')
    assert.deepEqual(plantages, [])
    // une valeur du programmeur venue ensuite reste contrôlée
    await lire(page, `h.querySelector('button.faute').click()`)
    const attente = Date.now() + 8000
    while (Date.now() < attente && !sortie.includes('error ' + FAUTE)) await page.waitForTimeout(100)
    await page.waitForTimeout(200)
    assert.deepEqual(sortie.filter((s) => s.includes('<@@chart>')), ['error ' + FAUTE], 'la faute du programmeur est dite, une fois')
    assert.equal(await lire(page, `return g('b5').querySelectorAll('path.line').length`), 2, 'puis la valeur par défaut')
    await ctx.close()
  })

  it('écran de 390 px : la barre passe à la ligne, le menu reste dans l\'écran (en bas, il s\'ouvre au-dessus) ; survol, focus et appui s\'allument', async () => {
    const { ctx, page, plantages } = await ouvrir(prod, built, browser, { viewport: { width: 390, height: 700 } })
    const barre = await lire(page, `const t = g('b1').querySelector('.tools'); const r = t.getBoundingClientRect(); const p = [...t.querySelectorAll('button, label')].map((n) => n.getBoundingClientRect()); return { h: r.height, droite: Math.max(...p.map((x) => x.right)), gauche: Math.min(...p.map((x) => x.left)), lignes: new Set(p.map((x) => Math.round(x.top))).size }`)
    assert.ok(barre.lignes >= 3, `la barre passe à la ligne : ${JSON.stringify(barre)}`)
    assert.ok(barre.droite <= 390 && barre.gauche >= 0, `rien ne sort de l'écran : ${JSON.stringify(barre)}`)
    await cliquer(page, 'b1', 'button.pick')
    await page.waitForTimeout(200)
    const bas = await lire(page, `const r = g('b1').querySelector('[role="menu"]').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, up: g('b1').querySelector('[role="menu"]').classList.contains('up'), vh: innerHeight }`)
    assert.ok(bas.l >= 0 && bas.r <= 390 && bas.t >= 0 && bas.b <= bas.vh, `le menu dans l'écran : ${JSON.stringify(bas)}`)
    await page.keyboard.press('Escape')
    // le bouton au bas de l'écran : le menu s'ouvre au-dessus
    await lire(page, `const b = g('b3').querySelector('button.pick'); const y = b.getBoundingClientRect().bottom + scrollY; scrollTo(0, y - innerHeight + 6); return scrollY`)
    await page.waitForTimeout(100)
    await cliquer(page, 'b3', 'button.pick')
    await page.waitForTimeout(200)
    const haut = await lire(page, `const m = g('b3').querySelector('[role="menu"]'); const r = m.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, up: m.classList.contains('up'), vh: innerHeight }`)
    assert.ok(haut.up, `au bas de l'écran, le menu s'ouvre au-dessus : ${JSON.stringify(haut)}`)
    assert.ok(haut.l >= 0 && haut.r <= 390 && haut.t >= 0 && haut.b <= haut.vh, `le menu dans l'écran : ${JSON.stringify(haut)}`)
    await page.keyboard.press('Escape')
    // survol : contour et halo ; focus clavier : contour ; appui : léger rétrécissement
    await lire(page, `scrollTo(0, 0); return 0`)
    const pastille = await centre(page, 'b1', 'button.series')
    const repos = await lire(page, `return getComputedStyle(g('b1').querySelector('button.series')).boxShadow`)
    await page.mouse.move(pastille.x, pastille.y)
    await page.waitForTimeout(250)
    assert.notEqual(await lire(page, `return getComputedStyle(g('b1').querySelector('button.series')).boxShadow`), repos, 'le survol allume la pastille')
    await focaliser(page, 'b1', 'button.pick')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await actif(page), 'button:Pas')
    assert.equal(await lire(page, `return getComputedStyle(g('b1').querySelectorAll('button.series')[1]).outlineStyle`), 'solid', 'le focus clavier se voit')
    await page.mouse.move(pastille.x, pastille.y)
    await page.mouse.down()
    await page.waitForTimeout(250)
    assert.match(String(await lire(page, `return getComputedStyle(g('b1').querySelector('button.series')).transform`)), /matrix\(0\.9/, 'l\'appui rétrécit')
    await page.mouse.up()
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('mouvement réduit : aucune transition dans la barre', async () => {
    const { ctx, page } = await ouvrir(prod, built, browser, { reducedMotion: 'reduce' })
    assert.deepEqual(await lire(page, `return [...g('b1').querySelectorAll('.tools button, .tools label')].map((n) => getComputedStyle(n).transitionDuration).filter((d) => d.split(',').some((x) => parseFloat(x) > 0))`), [])
    await ctx.close()
  })
})
