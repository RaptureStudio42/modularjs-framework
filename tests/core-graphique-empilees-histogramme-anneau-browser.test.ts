// module cœur <@@chart>, formes « barres empilées » (stack), « histogramme » (histogram) et « anneau » (pie), dans Chromium, Firefox et
// WebKit réels, en développement et en production : segments et échelle sur le total, bulle (chaque segment et le total), clavier et @pick
// des barres empilées ; classes aux bornes rondes, axe y en effectifs entiers, statistiques en traits verticaux (sans tendance) et bulle de
// l'histogramme, qui se parcourt au clavier sans être choisi ; parts par série ou par libellé (sept au plus, puis « autres »), centre (total,
// part survolée ou au focus), légende survolable, clavier, note quand l'anneau ne convient pas, texte de vide ; tableau lu par les lecteurs
// d'écran, tactile à 390 px, thème sombre, mouvement réduit. Et une série vide ne décide plus d'une échelle par série.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

// vingt mesures : six classes de 2,5 kg à partir de 60 (3, 7, 6, 1, 2 et 1 valeurs) ; moyenne 65,45, médiane 64,5, Q1 63, Q3 66,5
const MESURES = [61, 62, 62, 63, 63, 63, 64, 64, 64, 64, 65, 65, 65, 66, 66, 67, 68, 70, 72, 75]

const PAGE = `<script>
  $jours   = [{ id: 'r1', x: '2026-09-01', matin: 10, soir: 20, note: 'calme' }, { id: 'r2', x: '2026-09-02', matin: 15, soir: 5 }, { id: 'r3', x: '2026-09-03', readings: { matin: 30, soir: 25 } }, { id: 'r4', x: '2026-09-04', matin: 0, soir: 12 }, { id: 'r5', x: '2026-09-05', matin: 8 }, { id: 'r6', x: '2026-09-06', matin: 12, soir: 18 }]
  $series  = [{ key: 'matin', name: 'Matin', unit: 'min' }, { key: 'soir', name: 'Soir', unit: 'min', color: 'orange' }, { key: 'note', name: 'Note', kind: 'text' }]
  $mesures = [${MESURES.map((v, i) => `{ id: 'h${i}', x: ${i + 1}, poids: ${v} }`).join(', ')}]
  $poids   = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $temps   = [{ id: 't1', x: '2026-09-01', lecture: 2, sport: 4, repos: 1 }, { id: 't2', x: '2026-09-02', lecture: 3, sport: 4, repos: 1 }, { id: 't3', x: '2026-09-03', lecture: 5, sport: 4, repos: 1 }]
  $activites = [{ key: 'lecture', name: 'Lecture', unit: 'h' }, { key: 'sport', name: 'Sport', unit: 'h' }, { key: 'repos', name: 'Repos', unit: 'h' }]
  $villes  = [{ x: 'Anvers', n: 9 }, { x: 'Bâle', n: 8 }, { x: 'Cork', n: 7 }, { x: 'Delft', n: 6 }, { x: 'Essen', n: 5 }, { x: 'Faro', n: 4 }, { x: 'Gand', n: 3 }, { x: 'Hull', n: 2 }, { x: 'Ivrea', n: 1 }]
  $nombre  = [{ key: 'n', name: 'Visites' }]
  $seule   = [{ key: 'matin', name: 'Matin', unit: 'min' }]
  $vide    = []
  $mixte   = [{ key: 'matin', name: 'Matin', unit: 'min' }, { key: 'taille', name: 'Taille', unit: 'cm' }]
  $choix   = ''
</script>

<p class="vu">{$choix}</p>
<@@chart class="s1" rows={$jours} series={$series} shape="stack" pickable @pick={$choix = e.data.id}></@@chart>
<@@chart class="h1" rows={$mesures} series={$poids} shape="histogram" stats="mean median q1 q3"></@@chart>
<@@chart class="p1" rows={$temps} series={$activites} shape="pie"></@@chart>
<@@chart class="p2" rows={$villes} series={$nombre} shape="pie" axis="category"></@@chart>
<@@chart class="p3" rows={$jours} series={$seule} shape="pie"></@@chart>
<@@chart class="p4" rows={$vide} series={$activites} shape="pie"></@@chart>
<@@chart class="e1" rows={$jours} series={$mixte}></@@chart>

<style>
  :host
    display: block
  .vu
    display: none
</style>
`

const SOURCES: Record<string, string> = { 'gf-page.mjs': PAGE }
const GRAPHIQUES = 7

type Contexte = { largeur?: number, sombre?: boolean, teinte?: string, reduit?: boolean, tactile?: boolean }

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-formes', SOURCES, prod))

// une expression lue dans la page : `g('s1')` est l'ombre du graphique de classe s1, `h` celle de la page hôte
const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gf-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const vu = async (page: any) => String(await lire(page, `return h.querySelector('.vu').textContent`))
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> empilées, histogramme, anneau (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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
    const teinte = o.teinte ? `;--mjs-chart-1:${o.teinte}` : ''
    await page.route('http://f.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"${theme}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;${fond}${teinte}"><mjs-gf-page></mjs-gf-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://f.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gf-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
    }
    await page.waitForTimeout(250)
    return { ctx, page, erreurs, avis }
  }

  const zone = (page: any, c: string) => lire(page, `const r = g('${c}').querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`)
  const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)
  const bulle = (page: any, c: string) => lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; const r = t.getBoundingClientRect(); return { titre: t.querySelector('b').textContent.trim(), lignes: [...t.querySelectorAll('.row')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()), left: r.left, right: r.right, vw: document.documentElement.clientWidth }`)
  const centre = (page: any, c: string) => lire(page, `const n = g('${c}').querySelector('.center'); return n ? [...n.children].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()) : null`)
  // un point au milieu de l'anneau (entre ses deux rayons), à `tour` tours depuis le haut dans le sens des aiguilles
  const surAnneau = (page: any, c: string, tour: number) => lire(page, `const r = g('${c}').querySelector('.ring').getBoundingClientRect(); const a = (${tour} - 0.25) * 2 * Math.PI; const rayon = r.width * 0.385; return { x: r.left + r.width / 2 + rayon * Math.cos(a), y: r.top + r.height / 2 + rayon * Math.sin(a) }`)

  it('barres empilées : un segment par valeur positive, l\'échelle sur le plus haut total, la bulle donne chaque segment et le total, clavier et @pick, tableau', async () => {
    const { ctx, page, erreurs, avis } = await ouvrir()
    // six lignes, deux séries de nombres : r4 n'a pas de matin (0), r5 pas de soir, la série de mots ne se dessine pas
    assert.equal(await compte(page, 's1', 'rect.bar'), 10)
    assert.equal(await compte(page, 's1', 'path.line'), 0)
    assert.equal(await compte(page, 's1', 'circle.dot'), 0)
    // le plus haut total (55) fixe l'échelle : 0 à 60 ; les deux segments de r3 se touchent, le plus haut atteint presque le sommet
    assert.deepEqual(await textes(page, 's1', 'text.ylabel'), ['0', '20', '40', '60'])
    const sommet = await lire(page, `return Math.min(...[...g('s1').querySelectorAll('rect.bar')].map((b) => Number(b.getAttribute('y'))))`)
    assert.ok(Math.abs(sommet - 300 * (1 - 55 / 60)) < 0.6, `le sommet de la plus haute colonne est à 55 sur 60 : ${sommet}`)
    assert.ok(await lire(page, `const bars = [...g('s1').querySelectorAll('rect.bar')]; const xs = new Map(); for (const b of bars) { const k = b.getAttribute('x'); xs.set(k, [...(xs.get(k) || []), b]) } return [...xs.values()].filter((l) => l.length === 2).every(([a, b]) => { const [lo, hi] = Number(a.getAttribute('y')) > Number(b.getAttribute('y')) ? [a, b] : [b, a]; return Math.abs(Number(hi.getAttribute('y')) + Number(hi.getAttribute('height')) - Number(lo.getAttribute('y'))) < 0.02 })`), 'chaque segment se pose sur le précédent')
    // la bulle de la première colonne : chaque série, puis le total, puis la série de mots
    const z = await zone(page, 's1')
    await page.mouse.move(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(80)
    let b = await bulle(page, 's1')
    assert.ok(b, 'la bulle s\'ouvre')
    assert.match(b.titre, /^1\s*sept\.? 2026$/)
    assert.deepEqual(b.lignes, ['Matin 10 min', 'Soir 20 min', 'Total 30 min', 'Note calme'])
    // r4 : le matin vaut 0, il n'empile rien mais se lit dans la bulle ; r5 : le soir manque
    await page.mouse.move(z.x + z.w * (3.5 / 6), z.y + z.h / 2)
    await page.waitForTimeout(80)
    b = await bulle(page, 's1')
    assert.deepEqual(b.lignes.slice(0, 3), ['Matin 0 min', 'Soir 12 min', 'Total 12 min'])
    assert.ok(await lire(page, `return g('s1').querySelectorAll('rect.bar.on').length === 1`), 'le segment de la colonne survolée s\'allume')
    await page.mouse.move(z.x + z.w + 60, z.y + z.h + 260)
    await page.waitForTimeout(60)
    assert.equal(await bulle(page, 's1'), null)
    // un clic choisit la ligne ; au clavier, Fin puis flèche gauche puis Entrée choisissent r5
    await page.mouse.click(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(60)
    assert.equal(await vu(page), 'r1')
    assert.equal(await lire(page, `return g('s1').querySelector('.hit').getAttribute('tabindex')`), '0')
    await lire(page, `g('s1').querySelector('.hit').focus()`)
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.equal(await vu(page), 'r5')
    assert.match((await bulle(page, 's1')).titre, /^5\s*sept/)
    assert.match(String(await lire(page, `return g('s1').querySelector('[aria-live]').textContent`)), /Total 8 min/)
    // le tableau : une colonne par série visible, la série de mots, puis le total
    assert.deepEqual(await textes(page, 's1', 'thead th'), ['Date', 'Matin (min)', 'Soir (min)', 'Note', 'Total (min)'])
    assert.equal(await compte(page, 's1', 'tbody tr'), 6)
    assert.deepEqual((await lire(page, `return [...g('s1').querySelectorAll('tbody tr')[2].children].map((t) => t.textContent)`)).slice(1), ['30 min', '25 min', '—', '55 min'])
    // une série vide, d'une autre unité, n'impose plus une échelle par série : graduations communes, aucune note
    assert.equal(await compte(page, 'e1', '.note'), 0)
    assert.ok(Number(await compte(page, 'e1', 'text.ylabel')) >= 2)
    assert.deepEqual(erreurs, [])
    assert.deepEqual(avis.filter((a) => /chart/.test(a)), [], 'aucune forme refusée')
    await ctx.close()
  })

  it('histogramme : classes aux bornes rondes, axe y en effectifs entiers, statistiques en traits verticaux sans tendance, bulle, clavier sans choix, tableau', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    // six classes de 2,5 kg, de 60 à 75 : une barre par classe non vide, l'axe y de 0 à 8 en entiers
    assert.equal(await compte(page, 'h1', 'rect.bar'), 6)
    assert.deepEqual(await textes(page, 'h1', 'text.ylabel'), ['0', '2', '4', '6', '8'])
    const xs = await textes(page, 'h1', 'text.xlabel')
    assert.equal(xs[0], '60')
    assert.equal(xs[xs.length - 1], '75')
    assert.ok(xs.includes('62,5'), `les bornes des classes : ${xs.join(' / ')}`)
    const hauteurs = await lire(page, `return [...g('h1').querySelectorAll('rect.bar')].map((b) => Math.round(Number(b.getAttribute('height')) / 300 * 8 * 100) / 100)`)
    assert.deepEqual(hauteurs, [3, 7, 6, 1, 2, 1], 'la hauteur de chaque barre est son effectif')
    // moyenne, médiane, Q1 et Q3 : des traits verticaux à leur place sur l'étendue des classes ; la tendance n'a pas de sens ici
    for (const s of ['mean', 'median', 'q1', 'q3']) assert.equal(await compte(page, 'h1', `svg.svg path.stat-${s}`), 1, s)
    assert.equal(await compte(page, 'h1', 'path.trend'), 0)
    assert.equal(await compte(page, 'h1', 'circle.ghost'), 0)
    const traits = await lire(page, `return Object.fromEntries(['mean', 'median', 'q1', 'q3'].map((s) => [s, g('h1').querySelector('svg.svg path.stat-' + s).getAttribute('d').match(/[-\\d.]+/g).map(Number)]))`)
    for (const [s, d] of Object.entries(traits) as [string, number[]][]) assert.ok(d[0] === d[2] && d[1] === 0 && d[3] === 300, `${s} : un trait vertical de haut en bas (${d.join(' ')})`)
    assert.equal(traits.q1[0], 200, 'Q1 = 63, au cinquième de 60 à 75')
    assert.equal(traits.median[0], 300, 'médiane = 64,5')
    assert.ok(Math.abs(traits.mean[0] - 363.33) < 0.01, `moyenne = 65,45 : ${traits.mean[0]}`)
    assert.ok(Math.abs(traits.q3[0] - 433.33) < 0.01, `Q3 = 66,5 : ${traits.q3[0]}`)
    assert.equal(await compte(page, 'h1', '.keys .key'), 4, 'la légende nomme les quatre traits')
    // sur les barres de la série, les traits prennent la couleur du texte
    assert.notEqual(await lire(page, `return getComputedStyle(g('h1').querySelector('svg.svg path.stat-mean')).stroke`), await lire(page, `return getComputedStyle(g('h1').querySelector('rect.bar')).fill`))
    // la bulle : la classe et son effectif
    const z = await zone(page, 'h1')
    await page.mouse.move(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(80)
    let b = await bulle(page, 'h1')
    assert.equal(b.titre, 'De 60 à 62,5 kg')
    assert.deepEqual(b.lignes, ['Valeurs 3'])
    await page.mouse.move(z.x + z.w + 60, z.y + z.h + 260)
    // sans pickable, l'histogramme se parcourt au clavier ; Entrée ne choisit rien
    assert.equal(await lire(page, `return g('h1').querySelector('.hit').getAttribute('tabindex')`), '0')
    await lire(page, `g('h1').querySelector('.hit').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    assert.equal((await bulle(page, 'h1')).titre, 'De 60 à 62,5 kg')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    b = await bulle(page, 'h1')
    assert.equal(b.titre, 'De 72,5 à 75 kg')
    assert.deepEqual(b.lignes, ['Valeurs 1'])
    assert.equal(await vu(page), '', 'Entrée ne choisit rien')
    // le tableau : une ligne par classe
    assert.deepEqual(await textes(page, 'h1', 'thead th'), ['Classe', 'Valeurs'])
    assert.equal(await compte(page, 'h1', 'tbody tr'), 6)
    assert.deepEqual(await lire(page, `return [...g('h1').querySelectorAll('tbody tr')[1].children].map((t) => t.textContent)`), ['De 62,5 à 65 kg', '7'])
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('anneau : une part par série ou par libellé (sept, puis « autres »), le centre, la légende survolable, le clavier, la note et le vide, le tableau', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    // par série (axe des jours) : le total de chacune, de la plus grande à la plus petite
    assert.equal(await compte(page, 'p1', 'path.slice'), 3)
    assert.deepEqual(await textes(page, 'p1', '.legend .part'), ['Sport 12 h 48 %', 'Lecture 10 h 40 %', 'Repos 3 h 12 %'])
    assert.deepEqual(await centre(page, 'p1'), ['25 h', 'Total'])
    assert.equal(await lire(page, `return getComputedStyle(g('p1').querySelector('path.slice')).fillRule`), 'evenodd')
    // une part survolée prend le centre et s'allume, avec sa ligne de légende
    let p = await surAnneau(page, 'p1', 0.24)
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(80)
    assert.deepEqual(await centre(page, 'p1'), ['12 h', '48 %', 'Sport'])
    assert.equal(await compte(page, 'p1', 'path.slice.on'), 1)
    assert.equal(await lire(page, `return g('p1').querySelector('.legend .part.on').textContent.replace(/\\s+/g, ' ').trim()`), 'Sport 12 h 48 %')
    // la légende se survole aussi
    const ligne = await lire(page, `const r = g('p1').querySelectorAll('.legend .part')[2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    await page.mouse.move(ligne.x, ligne.y)
    await page.waitForTimeout(80)
    assert.deepEqual(await centre(page, 'p1'), ['3 h', '12 %', 'Repos'])
    await page.mouse.move(5, 880)
    await page.waitForTimeout(80)
    assert.deepEqual(await centre(page, 'p1'), ['25 h', 'Total'], 'la souris partie, le centre revient au total')
    // au clavier : l'anneau entre dans la tabulation, les flèches parcourent les parts, Échap rend le total
    assert.equal(await lire(page, `return g('p1').querySelector('.ring').getAttribute('tabindex')`), '0')
    await lire(page, `g('p1').querySelector('.ring').focus()`)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(60)
    assert.deepEqual(await centre(page, 'p1'), ['12 h', '48 %', 'Sport'])
    await page.keyboard.press('End')
    await page.waitForTimeout(60)
    assert.deepEqual(await centre(page, 'p1'), ['3 h', '12 %', 'Repos'])
    assert.match(String(await lire(page, `return g('p1').querySelector('[aria-live]').textContent`)), /Repos/)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(60)
    assert.deepEqual(await centre(page, 'p1'), ['25 h', 'Total'])
    assert.notEqual(await lire(page, `const s = getComputedStyle(g('p1').querySelector('.ring')); return s.outlineStyle + s.boxShadow`), 'nonenone', 'le focus se voit')
    // par libellé (axe category) : sept parts, puis « autres » qui réunit les deux plus petites, en teinte neutre
    assert.equal(await compte(page, 'p2', 'path.slice'), 8)
    const villes = await textes(page, 'p2', '.legend .part .name')
    assert.deepEqual(villes, ['Anvers', 'Bâle', 'Cork', 'Delft', 'Essen', 'Faro', 'Gand', 'Autres'])
    assert.equal(await compte(page, 'p2', 'path.slice.others'), 1)
    assert.deepEqual(await centre(page, 'p2'), ['45', 'Total'])
    const remplis = await lire(page, `return [...g('p2').querySelectorAll('path.slice')].map((s) => getComputedStyle(s).fill + '/' + getComputedStyle(s).fillOpacity)`)
    assert.equal(new Set(remplis).size, 8, `huit parts, huit remplissages distincts : ${remplis.join(' | ')}`)
    p = await surAnneau(page, 'p2', 0.97)
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(80)
    assert.deepEqual(await centre(page, 'p2'), ['3', '6,7 %', 'Autres'])
    await page.mouse.move(5, 880)
    // une seule série dans le temps : l'anneau ne convient pas, une note le dit ; aucune ligne : le texte de vide
    assert.equal(await compte(page, 'p3', 'path.slice'), 0)
    assert.match(String(await lire(page, `return g('p3').querySelector('.note')?.textContent`)), /anneau ne convient pas/)
    assert.equal(await lire(page, `return g('p3').querySelector('.ring').hasAttribute('tabindex')`), false)
    assert.equal(await lire(page, `return g('p4').querySelector('.empty')?.textContent`), 'Aucune valeur')
    assert.equal(await compte(page, 'p4', 'path.slice'), 0)
    // le tableau : une ligne par part, la valeur et la part
    assert.deepEqual(await textes(page, 'p1', 'thead th'), ['Série', 'Total (h)', 'Part'])
    assert.deepEqual(await lire(page, `return [...g('p1').querySelectorAll('tbody tr')[0].children].map((t) => t.textContent.replace(/\\s+/g, ' '))`), ['Sport', '12 h', '48 %'])
    assert.deepEqual(await textes(page, 'p2', 'thead th'), ['Libellé', 'Visites', 'Part'])
    assert.equal(await compte(page, 'p2', 'tbody tr'), 8)
    assert.equal(await lire(page, `return g('p1').querySelector('svg.disc').getAttribute('aria-hidden')`), 'true')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('à 390 px au doigt : la bulle des barres empilées reste dans l\'écran ; un appui sur une part prend le centre, un appui ailleurs le rend ; la légende tient à côté ou sous l\'anneau', async () => {
    const { ctx, page, erreurs } = await ouvrir({ largeur: 390, tactile: true })
    const z = await zone(page, 's1')
    await page.touchscreen.tap(z.x + z.w - 4, z.y + z.h / 2)
    await page.waitForTimeout(400)
    const b = await bulle(page, 's1')
    assert.ok(b, 'un appui ouvre la bulle')
    assert.ok(b.left >= 0 && b.right <= b.vw + 0.5, `la bulle reste dans l'écran : ${b.left}–${b.right} sur ${b.vw}`)
    await page.touchscreen.tap(z.x + z.w / 2, z.y + z.h + 300)
    await page.waitForTimeout(400)
    assert.equal(await bulle(page, 's1'), null)
    await lire(page, `g('p1').querySelector('.ring').scrollIntoView({ block: 'center' })`)
    await page.waitForTimeout(150)
    const p = await surAnneau(page, 'p1', 0.64)
    await page.touchscreen.tap(p.x, p.y)
    await page.waitForTimeout(400)
    assert.deepEqual(await centre(page, 'p1'), ['10 h', '40 %', 'Lecture'], 'un appui sur une part la montre au centre')
    const loin = await lire(page, `const r = g('p1').querySelector('.ring').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top - 30 }`)
    await page.touchscreen.tap(loin.x, Math.max(2, loin.y))
    await page.waitForTimeout(400)
    assert.deepEqual(await centre(page, 'p1'), ['25 h', 'Total'], 'un appui ailleurs rend le total')
    const place = await lire(page, `const a = g('p1').querySelector('.ring').getBoundingClientRect(); const l = g('p1').querySelector('.legend').getBoundingClientRect(); return { anneau: a.bottom, bord: a.right, legende: l.top, gauche: l.left, droite: l.right, vw: document.documentElement.clientWidth }`)
    assert.ok(place.legende >= place.anneau - 0.5 || place.gauche >= place.bord - 0.5, `la légende ne recouvre pas l'anneau : ${JSON.stringify(place)}`)
    assert.ok(place.droite <= place.vw + 0.5, 'la légende ne déborde pas')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('thème sombre : les parts prennent les teintes du thème, « autres » reste neutre ; mouvement réduit : les parts ne glissent plus', async () => {
    const clair = await ouvrir()
    const sombre = await ouvrir({ sombre: true, teinte: 'rgb(1, 2, 3)' })
    const lu = (page: any) => lire(page, `return { teinte1: getComputedStyle(g('p2').querySelector('path.slice.tone-1')).fill, autres: getComputedStyle(g('p2').querySelector('path.slice.others')).fill, legende: getComputedStyle(g('p2').querySelector('.legend .part')).color }`)
    const a = await lu(clair.page)
    const s = await lu(sombre.page)
    assert.equal(a.teinte1, 'rgb(59, 130, 246)', 'la teinte 1 par défaut')
    assert.equal(s.teinte1, 'rgb(1, 2, 3)', 'la variable de thème --mjs-chart-1 de la page repeint la part')
    assert.notEqual(a.autres, s.autres, '« autres » suit la couleur du texte du thème')
    assert.notEqual(a.legende, s.legende, 'la légende suit le thème')
    const duree = (page: any) => lire(page, `return getComputedStyle(g('p1').querySelector('path.slice')).transitionDuration`)
    assert.notEqual(await duree(clair.page), '0s', 'sans mouvement réduit, une part survolée grandit en douceur')
    await clair.ctx.close()
    await sombre.ctx.close()
    const reduit = await ouvrir({ reduit: true })
    assert.equal(await duree(reduit.page), '0s')
    assert.deepEqual([...clair.erreurs, ...sombre.erreurs, ...reduit.erreurs], [])
    await reduit.ctx.close()
  })
})
