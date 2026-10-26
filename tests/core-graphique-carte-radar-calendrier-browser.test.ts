// module cœur <@@chart>, formes « carte d'intensité » (heatmap), « radar » et « calendrier » (calendar), dans Chromium, Firefox et WebKit
// réels, en développement et en production : grille jour × heure (lundi en tête, heure locale, moyenne de la série ou nombre de relevés) et
// grille générale (une ligne par série, une colonne par libellé) ; un axe par ligne et un polygone par série pour le radar, 24 axes au
// plus ; calendrier par jour (une colonne par semaine, du lundi au dimanche, les mois en tête), par semaine et par mois. Pour les trois :
// cinq niveaux et leur légende « moins → plus », une case vide distincte d'une case faible, bulle, clavier, @pick d'une case qui porte une
// seule ligne, tableau lu par les lecteurs d'écran, 390 px au doigt sans rien couper, thème sombre et mouvement réduit.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

// les relevés datés sont écrits à l'heure locale du navigateur, puis en UTC (toISOString) : lundi 19 octobre 8 h (deux), mardi 9 h,
// mercredi 13 h (sans humeur), dimanche 25 octobre 23 h 30 ; les cartes c1 et c2 les montrent à l'heure de l'écran (timezone="local")
const PAGE = `<script>
  $evenements = [{ id: 'e1', x: new Date(2026, 9, 19, 8, 15).toISOString(), humeur: 2 }, { id: 'e2', x: new Date(2026, 9, 19, 8, 50).toISOString(), humeur: 4 }, { id: 'e3', x: new Date(2026, 9, 20, 9, 5).toISOString(), humeur: 5 }, { id: 'e4', x: new Date(2026, 9, 25, 23, 30).toISOString(), humeur: 1 }, { id: 'e5', x: new Date(2026, 9, 21, 13, 0).toISOString(), note: 'calme' }]
  $humeur   = [{ key: 'humeur', name: 'Humeur' }, { key: 'note', name: 'Note', kind: 'text' }]
  $aucune   = []
  $villes   = [{ id: 'v1', x: 'Anvers', matin: 3, soir: 7 }, { id: 'v2', x: 'Bâle', matin: 0, soir: 2 }, { id: 'v3', x: 'Cork', matin: 10 }]
  $duo      = [{ key: 'matin', name: 'Matin', unit: 'min' }, { key: 'soir', name: 'Soir', unit: 'min', color: 'orange' }]
  $profil   = [{ id: 'f', x: 'Force', moi: 80, toi: 60 }, { id: 's', x: 'Souplesse', moi: 50, toi: 90 }, { id: 'e', x: 'Endurance', moi: 70 }, { id: 'v', x: 'Vitesse', moi: 40, toi: 30 }]
  $nous     = [{ key: 'moi', name: 'Moi' }, { key: 'toi', name: 'Toi' }]
  $vingtSix = [${Array.from({ length: 26 }, (_, i) => `{ x: 'A${i + 1}', n: ${i + 1} }`).join(', ')}]
  $une      = [{ key: 'n', name: 'Nombre' }]
  $pourcent = [0, 100]
  $jours    = [{ id: 'j1', x: '2026-09-01', humeur: 1 }, { id: 'j2', x: '2026-10-06', humeur: 2 }, { id: 'j3', x: '2026-10-06', humeur: 3 }, { id: 'j4', x: '2026-10-14', note: 'rien' }, { id: 'j5', x: '2026-10-20', humeur: 4.6 }, { id: 'j6', x: '2026-10-21', humeur: 1 }]
  $cinq     = [1, 5]
  $vide     = []
  $choix    = ''
</script>

<p class="vu">{$choix}</p>
<@@chart class="c1" rows={$evenements} series={$humeur} shape="heatmap" timezone="local" pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="c2" rows={$evenements} series={$aucune} shape="heatmap" timezone="local"></@@chart>
<@@chart class="c3" rows={$villes} series={$duo} shape="heatmap" pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="r1" rows={$profil} series={$nous} shape="radar" bounds={$pourcent} pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="r2" rows={$vingtSix} series={$une} shape="radar"></@@chart>
<@@chart class="k1" rows={$jours} series={$humeur} shape="calendar" bounds={$cinq} pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="k2" rows={$jours} series={$humeur} shape="calendar" step="week"></@@chart>
<@@chart class="k3" rows={$jours} series={$humeur} shape="calendar" step="month"></@@chart>
<@@chart class="k4" rows={$vide} series={$humeur} shape="calendar"></@@chart>

<style>
  :host
    display: block
  .vu
    display: none
</style>
`

const SOURCES: Record<string, string> = { 'gc-page.mjs': PAGE }
const GRAPHIQUES = 9

type Contexte = { largeur?: number, sombre?: boolean, teinte?: string, reduit?: boolean, tactile?: boolean }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-cases', SOURCES, prod))

// une expression lue dans la page : `g('c1')` est l'ombre du graphique de classe c1, `h` celle de la page hôte
const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gc-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const vu = async (page: any) => String(await lire(page, `return h.querySelector('.vu').textContent`))
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)
const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)
const niveaux = (page: any, c: string) => lire(page, `return [...g('${c}').querySelectorAll('rect.cell')].map((r) => Number(/level-(\\d)/.exec(r.getAttribute('class'))[1]))`)
const niveau = (page: any, c: string, i: number) => lire(page, `return Number(/level-(\\d)/.exec(g('${c}').querySelector('rect.cell[data-i="${i}"]').getAttribute('class'))[1])`)
const bulle = (page: any, c: string) => lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; const r = t.getBoundingClientRect(); return { titre: t.querySelector('b').textContent.trim(), lignes: [...t.querySelectorAll('.row')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()), left: r.left, right: r.right, vw: document.documentElement.clientWidth }`)
// le centre d'une pièce du dessin, ramenée à l'écran d'abord
const centre = (page: any, c: string, sel: string) => lire(page, `const n = g('${c}').querySelector('${sel}'); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
// un point sur l'axe `k` d'un radar à `n` axes, à mi-rayon (la toile va de 0 à 100, le centre est en 50, 50)
const surAxe = (page: any, c: string, k: number, n: number) => lire(page, `const s = g('${c}').querySelector('svg.web'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); const u = r.width / 100; const a = ${k} / ${n} * 2 * Math.PI - Math.PI / 2; return { x: r.left + 50 * u + 20 * u * Math.cos(a), y: r.top + 50 * u + 20 * u * Math.sin(a) }`)
// le remplissage tel qu'il se voit : couleur et opacité
const teinte = (page: any, c: string, i: number) => lire(page, `const s = getComputedStyle(g('${c}').querySelector('rect.cell[data-i="${i}"]')); return s.fill + ' / ' + s.fillOpacity`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> carte, radar, calendrier (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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
    const ctx = await browser.newContext({ viewport: { width: o.largeur ?? 800, height: 900 }, ...(o.reduit ? { reducedMotion: 'reduce' } : {}), ...(o.tactile ? { hasTouch: true, isMobile: nom !== 'firefox' } : {}) })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    const fond   = o.sombre ? 'background:#232936;color:#e8eaed' : 'background:#ffffff;color:#222222'
    const theme  = o.sombre ? ' data-mjs-theme="dark"' : ''
    const ton    = o.teinte ? `;--mjs-chart-1:${o.teinte}` : ''
    await page.route('http://c.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;${fond}${ton}"><mjs-gc-page></mjs-gc-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://c.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gc-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
    }
    await page.waitForTimeout(250)
    return { ctx, page, erreurs, avis }
  }

  const survole = async (page: any, c: string, sel: string) => {
    const p = await centre(page, c, sel)
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(80)
  }
  const clique = async (page: any, c: string, sel: string) => {
    const p = await centre(page, c, sel)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(80)
  }

  it('carte jour × heure : 7 jours sur 24 heures à l\'heure locale, la moyenne ou le nombre de relevés, cinq niveaux, bulle, clavier, @pick, tableau ; grille générale par série et par libellé', async () => {
    const { ctx, page, erreurs, avis } = await ouvrir()
    // une case par heure de chaque jour ; lundi 8 h (deux relevés, moyenne 3), mardi 9 h (5), dimanche 23 h (1) ; mercredi 13 h n'a pas d'humeur
    assert.equal(await compte(page, 'c1', 'rect.cell'), 168)
    assert.deepEqual([await niveau(page, 'c1', 8), await niveau(page, 'c1', 33), await niveau(page, 'c1', 167), await niveau(page, 'c1', 61)], [3, 5, 1, 0])
    assert.equal((await niveaux(page, 'c1')).filter((n: number) => n === 0).length, 165, 'les autres cases restent vides')
    assert.deepEqual(await textes(page, 'c1', '.names .name'), ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'])
    assert.deepEqual(await textes(page, 'c1', 'text.xlabel'), ['00 h', '03 h', '06 h', '09 h', '12 h', '15 h', '18 h', '21 h'])
    // la légende : une case vide, puis « moins », les cinq niveaux, « plus »
    assert.deepEqual(await textes(page, 'c1', '.ramp .key'), ['Aucune valeur', 'Moins Plus'])
    assert.deepEqual(await lire(page, `return [...g('c1').querySelectorAll('.ramp .swatch')].map((s) => /level-(\\d)/.exec(s.getAttribute('class'))[1]).join('')`), '012345')
    // la bulle : le jour et l'heure, la moyenne, le nombre de relevés
    await survole(page, 'c1', 'rect.cell[data-i="8"]')
    let b = await bulle(page, 'c1')
    assert.ok(b, 'la bulle s\'ouvre')
    assert.equal(b.titre, 'lundi 08 h')
    assert.deepEqual(b.lignes, ['Humeur 3', 'Valeurs 2'])
    assert.equal(await compte(page, 'c1', 'rect.cell.on'), 1, 'la case survolée s\'allume')
    await survole(page, 'c1', 'rect.cell[data-i="61"]')
    assert.deepEqual((await bulle(page, 'c1')).lignes, ['Aucune valeur'])
    // un clic choisit la case qui porte un seul relevé, pas celle qui en porte deux
    await clique(page, 'c1', 'rect.cell[data-i="33"]')
    assert.equal(await vu(page), 'e3')
    assert.deepEqual((await bulle(page, 'c1')).lignes, ['Humeur 5', 'Valeurs 1'])
    await clique(page, 'c1', 'rect.cell[data-i="8"]')
    assert.equal(await vu(page), 'e3', 'deux relevés : rien n\'est choisi')
    await page.mouse.move(2, 2)
    // au clavier : flèches à droite et en bas, Fin, Entrée
    assert.equal(await lire(page, `return g('c1').querySelector('.heat').getAttribute('tabindex')`), '0')
    await lire(page, `g('c1').querySelector('.heat').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    assert.equal((await bulle(page, 'c1')).titre, 'lundi 00 h')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(60)
    assert.equal((await bulle(page, 'c1')).titre, 'mardi 00 h')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.equal((await bulle(page, 'c1')).titre, 'dimanche 23 h')
    assert.equal(await vu(page), 'e4')
    assert.match(String(await lire(page, `return g('c1').querySelector('[aria-live]').textContent`)), /dimanche 23 h, Humeur 1/)
    await page.keyboard.press('Escape')
    // sans série de nombres : le nombre de relevés, mercredi compris
    assert.deepEqual([await niveau(page, 'c2', 8), await niveau(page, 'c2', 33), await niveau(page, 'c2', 61)], [5, 1, 1])
    await survole(page, 'c2', 'rect.cell[data-i="8"]')
    assert.deepEqual((await bulle(page, 'c2')).lignes, ['Valeurs 2'])
    // grille générale : une ligne par série (sa teinte), une colonne par libellé ; une valeur nulle se distingue d'une case vide
    assert.deepEqual(await niveaux(page, 'c3'), [2, 1, 5, 4, 2, 0])
    assert.deepEqual(await textes(page, 'c3', '.names .name'), ['Matin', 'Soir'])
    assert.deepEqual(await textes(page, 'c3', 'text.xlabel'), ['Anvers', 'Bâle', 'Cork'])
    assert.equal(await compte(page, 'c3', 'rect.cell.tone-2'), 3, 'la ligne du soir prend la teinte orange')
    assert.notEqual(await teinte(page, 'c3', 1), await teinte(page, 'c3', 5), 'une valeur nulle ne ressemble pas à une case vide')
    await survole(page, 'c3', 'rect.cell[data-i="5"]')
    b = await bulle(page, 'c3')
    assert.deepEqual([b.titre, b.lignes], ['Cork', ['Aucune valeur']])
    await clique(page, 'c3', 'rect.cell[data-i="1"]')
    b = await bulle(page, 'c3')
    assert.deepEqual([b.titre, b.lignes], ['Bâle', ['Matin 0 min']])
    assert.equal(await vu(page), 'v2')
    // les tableaux : les cases à relevés de la grille jour × heure ; la grille générale comme les graphiques à axes
    assert.deepEqual(await textes(page, 'c1', 'thead th'), ['Jour et heure', 'Humeur', 'Valeurs'])
    assert.equal(await compte(page, 'c1', 'tbody tr'), 3)
    assert.deepEqual(await lire(page, `return [...g('c1').querySelectorAll('tbody tr')[0].children].map((t) => t.textContent)`), ['lundi 08 h', '3', '2'])
    assert.deepEqual(await textes(page, 'c2', 'thead th'), ['Jour et heure', 'Valeurs'])
    assert.deepEqual(await textes(page, 'c3', 'thead th'), ['Libellé', 'Matin (min)', 'Soir (min)'])
    assert.deepEqual(await lire(page, `return [...g('c3').querySelectorAll('tbody tr')[2].children].map((t) => t.textContent)`), ['Cork', '10 min', '—'])
    assert.equal(await lire(page, `return g('c1').querySelector('svg.cells').getAttribute('aria-hidden')`), 'true')
    assert.deepEqual(erreurs, [])
    // le radar de 26 lignes (r2) n'en montre que 24 : une limite des données, dite en développement seulement
    assert.deepEqual(avis.filter((a) => /chart/.test(a)), prod ? [] : ['[ModularJS] <@@chart> : un radar montre 24 axes au plus, les 26 lignes reçues sont réduites aux 24 dernières.'], 'aucune forme refusée')
    await ctx.close()
  })

  it('radar : un axe par ligne depuis le haut, un polygone par série, l\'échelle de bounds, bulle par axe, clavier, @pick, 24 axes au plus, tableau', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    assert.equal(await compte(page, 'r1', 'polygon.shape'), 2)
    assert.equal(await compte(page, 'r1', 'polygon.shape.tone-2'), 1)
    assert.equal(await compte(page, 'r1', 'polygon.mesh'), 4, 'un anneau par graduation de 25 à 100')
    assert.equal(await compte(page, 'r1', 'line.spoke'), 4)
    assert.deepEqual(await textes(page, 'r1', 'text.pole'), ['Force', 'Souplesse', 'Endurance', 'Vitesse'])
    assert.equal(await lire(page, `return g('r1').querySelector('polygon.shape').getAttribute('points')`), '50.00,22.80 67.00,50.00 50.00,73.80 36.40,50.00')
    assert.equal(await lire(page, `return g('r1').querySelectorAll('polygon.shape')[1].getAttribute('points')`), '50.00,29.60 80.60,50.00 50.00,50.00 39.80,50.00', 'une valeur absente revient au centre')
    assert.equal(await compte(page, 'r1', 'circle.vertex'), 7, 'un sommet par valeur')
    // la bulle de l'axe survolé : chaque série
    let p = await surAxe(page, 'r1', 0, 4)
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(80)
    let b = await bulle(page, 'r1')
    assert.ok(b, 'la bulle s\'ouvre')
    assert.deepEqual([b.titre, b.lignes], ['Force', ['Moi 80', 'Toi 60']])
    assert.equal(await compte(page, 'r1', 'line.spoke.on'), 1)
    assert.equal(await compte(page, 'r1', 'circle.vertex.on'), 2)
    p = await surAxe(page, 'r1', 1, 4)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(80)
    assert.equal((await bulle(page, 'r1')).titre, 'Souplesse')
    assert.equal(await vu(page), 's')
    await page.mouse.move(2, 2)
    // au clavier
    await lire(page, `g('r1').querySelector('.dial').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    b = await bulle(page, 'r1')
    assert.deepEqual([b.titre, b.lignes], ['Endurance', ['Moi 70', 'Toi —']])
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.equal(await vu(page), 'v')
    await page.keyboard.press('Escape')
    // vingt-six lignes : les 24 dernières, les noms des quatre pôles seulement
    assert.equal(await compte(page, 'r2', 'line.spoke'), 24)
    assert.deepEqual(await textes(page, 'r2', 'text.pole'), ['A3', 'A9', 'A15', 'A21'])
    assert.equal(await compte(page, 'r2', 'tbody tr'), 24)
    // le tableau : une ligne par axe, une colonne par série
    assert.deepEqual(await textes(page, 'r1', 'thead th'), ['Libellé', 'Moi', 'Toi'])
    assert.deepEqual(await lire(page, `return [...g('r1').querySelectorAll('tbody tr')[2].children].map((t) => t.textContent)`), ['Endurance', '70', '—'])
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('calendrier : une colonne par semaine du lundi au dimanche, les mois en tête, cinq niveaux (une humeur : son arrondi), la case vide, bulle, clavier, @pick, semaine et mois, tableau', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    // 26 semaines jusqu'à celle du dernier relevé (mercredi 21 octobre) ; les quatre jours qui suivent ne se dessinent pas
    assert.equal(await compte(page, 'k1', 'rect.cell'), 178)
    // mardi 6 : moyenne 2,5, niveau 3 ; mardi 20 : 4,6, niveau 5 ; mercredi 21 : 1 ; mercredi 14 : sans humeur ; mardi 1er septembre : 1
    assert.deepEqual([await niveau(page, 'k1', 162), await niveau(page, 'k1', 176), await niveau(page, 'k1', 177), await niveau(page, 'k1', 170), await niveau(page, 'k1', 127)], [3, 5, 1, 0, 1])
    assert.notEqual(await teinte(page, 'k1', 170), await teinte(page, 'k1', 177), 'une case vide ne ressemble pas à une case faible')
    assert.deepEqual(await textes(page, 'k1', 'text.head'), ['mai', 'juin', 'juil.', 'août', 'sept.', 'oct.'])
    assert.deepEqual(await textes(page, 'k1', 'text.day'), ['lun.', 'mer.', 'ven.'])
    assert.equal(await compte(page, 'k1', '.ramp .swatch'), 6)
    const carre = await lire(page, `const r = g('k1').querySelector('rect.cell').getBoundingClientRect(); return [r.width, r.height]`)
    assert.ok(Math.abs(carre[0] - carre[1]) < 0.6, `les cases sont carrées : ${carre.join(' × ')}`)
    // la bulle
    await survole(page, 'k1', 'rect.cell[data-i="162"]')
    let b = await bulle(page, 'k1')
    assert.ok(b, 'la bulle s\'ouvre')
    assert.deepEqual([b.titre, b.lignes], ['mardi 6 octobre 2026', ['Humeur 2,5', 'Valeurs 2']])
    await page.mouse.move(2, 2)
    // au clavier : Fin (aujourd'hui), flèche en haut (la veille), Entrée choisit, flèche à gauche (la semaine d'avant)
    await lire(page, `g('k1').querySelector('.calendar').focus()`)
    await page.keyboard.press('End')
    await page.waitForTimeout(60)
    assert.equal((await bulle(page, 'k1')).titre, 'mercredi 21 octobre 2026')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.equal(await vu(page), 'j5')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(60)
    b = await bulle(page, 'k1')
    assert.deepEqual([b.titre, b.lignes], ['mardi 13 octobre 2026', ['Aucune valeur']])
    await page.keyboard.press('Escape')
    // un clic choisit le jour d'un seul relevé, pas celui de deux
    await clique(page, 'k1', 'rect.cell[data-i="127"]')
    assert.equal(await vu(page), 'j1')
    await clique(page, 'k1', 'rect.cell[data-i="162"]')
    assert.equal(await vu(page), 'j1')
    await page.mouse.move(2, 2)
    // par semaine et par mois
    assert.equal(await compte(page, 'k2', 'rect.cell'), 26)
    assert.equal(await niveau(page, 'k2', 25), 5)
    assert.deepEqual(await textes(page, 'k2', 'text.head'), ['mai', 'juin', 'juil.', 'août', 'sept.', 'oct.'])
    await survole(page, 'k2', 'rect.cell[data-i="25"]')
    b = await bulle(page, 'k2')
    assert.deepEqual([b.titre, b.lignes], ['Semaine du 19 oct. 2026', ['Humeur 2,8', 'Valeurs 2']])
    assert.equal(await compte(page, 'k3', 'rect.cell'), 12)
    const mois = await textes(page, 'k3', 'text.head')
    assert.deepEqual([mois.length, mois[0], mois[11]], [12, 'nov.', 'oct.'])
    await survole(page, 'k3', 'rect.cell[data-i="11"]')
    b = await bulle(page, 'k3')
    assert.deepEqual([b.titre, b.lignes], ['octobre 2026', ['Humeur 2,65', 'Valeurs 4']])
    await page.mouse.move(2, 2)
    // aucune ligne : le texte de vide
    assert.equal(await lire(page, `return g('k4').querySelector('.empty')?.textContent`), 'Aucune valeur')
    assert.equal(await compte(page, 'k4', 'rect.cell'), 0)
    // les tableaux : une ligne par période qui a des relevés
    assert.deepEqual(await textes(page, 'k1', 'thead th'), ['Date', 'Humeur', 'Valeurs'])
    assert.equal(await compte(page, 'k1', 'tbody tr'), 4)
    assert.deepEqual(await lire(page, `return [...g('k1').querySelectorAll('tbody tr')[1].children].map((t) => t.textContent)`), ['mardi 6 octobre 2026', '2,5', '2'])
    assert.deepEqual(await textes(page, 'k2', 'thead th'), ['Période', 'Humeur', 'Valeurs'])
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('à 390 px au doigt : le calendrier se resserre, la carte et le radar tiennent, rien ne déborde ; un appui ouvre la bulle dans l\'écran, un appui ailleurs la ferme', async () => {
    const { ctx, page, erreurs } = await ouvrir({ largeur: 390, tactile: true })
    const bord = await lire(page, `const vw = document.documentElement.clientWidth; const hors = []; for (const c of ['c1', 'c3', 'r1', 'k1', 'k2', 'k3']) for (const n of g(c).querySelectorAll('rect.cell, text, polygon')) { const r = n.getBoundingClientRect(); if (r.width && (r.left < -0.5 || r.right > vw + 0.5)) hors.push(c + ' ' + n.tagName + ' ' + Math.round(r.left) + '–' + Math.round(r.right)) } return { vw, hors: hors.slice(0, 6), large: document.documentElement.scrollWidth }`)
    assert.deepEqual(bord.hors, [], `rien ne sort de l'écran (${bord.vw} px)`)
    assert.ok(bord.large <= bord.vw, `la page ne défile pas en largeur : ${bord.large}`)
    const forme = await lire(page, `const s = g('k1').querySelector('svg.days'); const r = s.getBoundingClientRect(); const v = s.viewBox.baseVal; return { echelle: r.width / v.width, rapport: (r.height / r.width) / (v.height / v.width) }`)
    assert.ok(forme.echelle < 1 && Math.abs(forme.rapport - 1) < 0.01, `les cases se resserrent (moins d'un pixel par unité du dessin) et restent carrées : ${JSON.stringify(forme)}`)
    const etiquettes = await lire(page, `return [...g('c1').querySelectorAll('text.xlabel')].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right] }).sort((a, b) => a[0] - b[0])`)
    assert.ok(etiquettes.length >= 2 && etiquettes.every((e: number[], i: number) => i === 0 || e[0] >= etiquettes[i - 1][1]), `les heures ne se chevauchent pas : ${JSON.stringify(etiquettes)}`)
    for (const [c, sel] of [['k1', 'rect.cell[data-i="176"]'], ['c1', 'rect.cell[data-i="167"]']]) {
      const p = await centre(page, c, sel)
      await page.touchscreen.tap(p.x, p.y)
      await page.waitForTimeout(400)
      const b = await bulle(page, c)
      assert.ok(b, `un appui ouvre la bulle (${c})`)
      assert.ok(b.left >= 0 && b.right <= b.vw + 0.5, `la bulle reste dans l'écran (${c}) : ${b.left}–${b.right} sur ${b.vw}`)
      await page.touchscreen.tap(p.x, Math.max(2, p.y - 260))
      await page.waitForTimeout(400)
      assert.equal(await bulle(page, c), null, `un appui ailleurs la ferme (${c})`)
    }
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('thème sombre : les cases prennent les teintes du thème, la case vide suit la couleur du texte ; mouvement réduit : les cases ne s\'animent plus', async () => {
    const clair = await ouvrir()
    const sombre = await ouvrir({ sombre: true, teinte: 'rgb(1, 2, 3)' })
    const lu = (page: any) => lire(page, `const f = (i) => getComputedStyle(g('c1').querySelector('rect.cell[data-i="' + i + '"]')).fill; return { plein: f(33), vide: f(0), nom: getComputedStyle(g('c1').querySelector('.names .name')).color }`)
    const a = await lu(clair.page)
    const s = await lu(sombre.page)
    assert.equal(a.plein, 'rgb(59, 130, 246)', 'la teinte 1 par défaut')
    assert.equal(s.plein, 'rgb(1, 2, 3)', 'la variable de thème --mjs-chart-1 de la page repeint les cases')
    assert.notEqual(a.vide, s.vide, 'la case vide suit la couleur du texte du thème')
    assert.notEqual(a.nom, s.nom, 'les noms des lignes suivent le thème')
    const duree = (page: any) => lire(page, `return getComputedStyle(g('k1').querySelector('rect.cell')).transitionDuration`)
    assert.notEqual(await duree(clair.page), '0s', 'sans mouvement réduit, une case change en douceur')
    await clair.ctx.close()
    await sombre.ctx.close()
    const reduit = await ouvrir({ reduit: true })
    assert.equal(await duree(reduit.page), '0s')
    assert.deepEqual([...clair.erreurs, ...sombre.erreurs, ...reduit.erreurs], [])
    await reduit.ctx.close()
  })
})
