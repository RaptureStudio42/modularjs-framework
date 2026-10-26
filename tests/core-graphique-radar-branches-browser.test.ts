// module cœur <@@chart>, forme « radar », de 3 à 24 branches, dans Chromium, Firefox et WebKit réels, en développement et en production :
// jusqu'à 8 axes, chaque branche porte son nom ; au-delà, seuls les noms des branches du haut, de droite, du bas et de gauche s'écrivent (les
// plus proches quand le nombre d'axes ne se divise pas par 4), tous les noms restant dans la bulle et le tableau des valeurs ; au-delà de
// 24 lignes, les 24 dernières, avec un avertissement du développement. Les 16 axes du test de personnalité d'une application voisine, dans
// leur ordre, écrivent switch (haut), dominant (droite), vanille (bas) et soumis (gauche), avec la toile d'un partenaire d'une couleur
// réglée et des bornes de 0 à 100. Les noms gardent la taille des autres textes du graphique à toute largeur (300 px, 390 px, 800 px) et
// rien ne sort de l'écran.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const AXES  = ['switch', 'sadique', 'rigger', 'tamer', 'dominant', 'caregiver', 'primal', 'exhib', 'vanille', 'masochiste', 'corde', 'brat', 'soumis', 'little', 'devotion', 'voyeur']
const ligne = (prefixe: string, n: number) => Array.from({ length: n }, (_, i) => `{ x: '${prefixe}${i + 1}', n: ${(i % 5) + 1} }`).join(', ')

const PAGE = `<script>
  $profil   = [${AXES.map((k, i) => `{ id: '${k}', x: '${k}', moi: ${30 + (i * 37) % 70}, toi: ${20 + (i * 53) % 75} }`).join(', ')}]
  $nous     = [{ key: 'moi', name: 'Moi', unit: '%' }, { key: 'toi', name: 'Partenaire', unit: '%', color: '#c0392b' }]
  $cent     = [0, 100]
  $cinq     = [{ x: 'Une branche au nom vraiment très long', n: 3 }, { x: 'Deux', n: 4 }, { x: 'Trois branches longues', n: 2 }, { x: 'Quatre', n: 5 }, { x: 'Cinq et demie', n: 1 }]
  $huit     = [${ligne('H', 8)}]
  $neuf     = [${ligne('N', 9)}]
  $dix      = [${ligne('B', 10)}]
  $vingtSix = [${ligne('A', 26)}]
  $une      = [{ key: 'n', name: 'Nombre' }]
  $courbe   = [{ x: 'a', n: 1 }, { x: 'b', n: 3 }, { x: 'c', n: 2 }]
</script>

<div class="etroit"><@@chart class="b1" rows={$profil} series={$nous} shape="radar" bounds={$cent}></@@chart></div>
<@@chart class="b2" rows={$profil} series={$nous} shape="radar" bounds={$cent}></@@chart>
<@@chart class="c5" rows={$cinq} series={$une} shape="radar"></@@chart>
<@@chart class="h8" rows={$huit} series={$une} shape="radar"></@@chart>
<@@chart class="n9" rows={$neuf} series={$une} shape="radar"></@@chart>
<@@chart class="d10" rows={$dix} series={$une} shape="radar"></@@chart>
<@@chart class="v26" rows={$vingtSix} series={$une} shape="radar"></@@chart>
<@@chart class="l1" rows={$courbe} series={$une}></@@chart>

<style>
  :host
    display: block
  .etroit
    width: 300px
</style>
`

const SOURCES: Record<string, string> = { 'gb-page.mjs': PAGE }
const GRAPHIQUES = 8
const RADARS = ['b1', 'b2', 'c5', 'h8', 'n9', 'd10', 'v26']

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-radar-branches', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gb-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const noms = (page: any, c: string) => lire(page, `return [...g('${c}').querySelectorAll('text.pole')].map((t) => t.textContent.trim())`)
const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)
// la taille d'un texte telle qu'elle se voit : sa taille de police, mise à l'échelle de son dessin
const tailles = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((t) => Math.round(parseFloat(getComputedStyle(t).fontSize) * t.getScreenCTM().a * 100) / 100)`)
// chaque nom : son ancre, et sa place par rapport au centre de la toile (en px)
const places = (page: any, c: string) => lire(page, `const w = g('${c}').querySelector('svg.web').getBoundingClientRect(); const cx = w.left + w.width / 2; const cy = w.top + w.height / 2; return [...g('${c}').querySelectorAll('text.pole')].map((t) => { const r = t.getBoundingClientRect(); return { nom: t.textContent.trim(), ancre: t.getAttribute('text-anchor'), dx: Math.round(r.left + r.width / 2 - cx), dy: Math.round(r.top + r.height / 2 - cy), rayon: w.width / 2 } })`)
const bulle = (page: any, c: string) => lire(page, `const t = g('${c}').querySelector('.tip'); if (!t) return null; return { titre: t.querySelector('b').textContent.trim(), lignes: [...t.querySelectorAll('.row')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()) }`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> radar de 3 à 24 branches (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
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

  async function ouvrir(largeur = 800) {
    const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://r.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0 8px;font:14px sans-serif;background:#fff;color:#222"><mjs-gb-page></mjs-gb-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://r.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gb-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
    }
    await page.waitForTimeout(300)
    return { ctx, page, erreurs, avis }
  }

  it('les 16 axes du test, dans leur ordre : switch en haut, dominant à droite, vanille en bas, soumis à gauche ; la toile du partenaire, sa couleur, les bornes de 0 à 100 ; tous les noms dans la bulle et le tableau', async () => {
    const { ctx, page, erreurs, avis } = await ouvrir()
    for (const c of ['b1', 'b2']) {
      assert.deepEqual(await noms(page, c), ['switch', 'dominant', 'vanille', 'soumis'], `seuls les quatre pôles s'écrivent (${c})`)
      const p = await places(page, c)
      assert.deepEqual(p.map((x: any) => x.ancre), ['middle', 'start', 'middle', 'end'])
      const [haut, droite, bas, gauche] = p
      assert.ok(haut.dy < -haut.rayon / 2 && Math.abs(haut.dx) < 4, `switch en haut : ${JSON.stringify(haut)}`)
      assert.ok(droite.dx > droite.rayon / 2 && Math.abs(droite.dy) < 4, `dominant à droite : ${JSON.stringify(droite)}`)
      assert.ok(bas.dy > bas.rayon / 2 && Math.abs(bas.dx) < 4, `vanille en bas : ${JSON.stringify(bas)}`)
      assert.ok(gauche.dx < -gauche.rayon / 2 && Math.abs(gauche.dy) < 4, `soumis à gauche : ${JSON.stringify(gauche)}`)
      assert.equal(await compte(page, c, 'line.spoke'), 16)
      assert.equal(await compte(page, c, 'polygon.shape'), 2, 'la toile de chacun')
      assert.equal(await compte(page, c, 'polygon.mesh'), 4, 'un anneau par graduation de 25 à 100')
      assert.equal(await compte(page, c, 'circle.vertex'), 32)
      assert.equal(await lire(page, `return getComputedStyle(g('${c}').querySelectorAll('polygon.shape')[1]).stroke`), 'rgb(192, 57, 43)', 'la couleur réglée du partenaire')
      assert.deepEqual(await lire(page, `return [...g('${c}').querySelectorAll('tbody th')].map((t) => t.textContent)`), AXES, 'le tableau garde les 16 noms')
    }
    assert.deepEqual(await lire(page, `return [...g('b2').querySelectorAll('thead th')].map((t) => t.textContent)`), ['Libellé', 'Moi (%)', 'Partenaire (%)'])
    // la bulle d'un axe sans nom écrit : son nom et la valeur de chacun
    await lire(page, `g('b2').querySelector('.dial').focus()`)
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(80)
    assert.deepEqual(await bulle(page, 'b2'), { titre: 'sadique', lignes: ['Moi 67 %', 'Partenaire 73 %'] })
    assert.deepEqual(erreurs, [])
    assert.deepEqual(avis.filter((a) => /chart/.test(a)), prod ? [] : ['[ModularJS] <@@chart> : un radar montre 24 axes au plus, les 26 lignes reçues sont réduites aux 24 dernières.'])
    await ctx.close()
  })

  it('jusqu\'à 8 axes, chaque nom s\'écrit (abrégé au-delà de 18 signes) ; au-delà, les quatre pôles, les plus proches quand le nombre d\'axes ne se divise pas par 4 ; plus de 24 lignes : les 24 dernières', async () => {
    const { ctx, page, erreurs } = await ouvrir()
    assert.deepEqual(await noms(page, 'c5'), ['Une branche au no…', 'Deux', 'Trois branches lo…', 'Quatre', 'Cinq et demie'])
    assert.deepEqual(await noms(page, 'h8'), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'])
    assert.deepEqual(await noms(page, 'n9'), ['N1', 'N3', 'N6', 'N8'], '9 axes : 0°, 80°, 200°, 280°')
    assert.deepEqual(await noms(page, 'd10'), ['B1', 'B4', 'B6', 'B8'], '10 axes : 0°, 108°, 180°, 252°, symétriques')
    assert.equal(await compte(page, 'v26', 'line.spoke'), 24)
    assert.deepEqual(await noms(page, 'v26'), ['A3', 'A9', 'A15', 'A21'])
    assert.equal(await compte(page, 'v26', 'tbody tr'), 24)
    assert.equal(await lire(page, `return g('v26').querySelector('tbody th').textContent`), 'A3')
    assert.equal(await compte(page, 'd10', 'path.wedge'), 10, 'chaque axe se survole, nommé ou non')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  for (const largeur of [800, 390]) it(`à ${largeur} px : les noms ont au moins la taille des autres textes du graphique, rien ne sort de l'écran ni du cadre`, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur)
    const reference = Math.min(...await tailles(page, 'l1', 'text.ylabel'))
    assert.ok(reference >= 10, `la taille des graduations : ${reference}`)
    for (const c of RADARS) {
      const t = await tailles(page, c, 'text.pole')
      assert.ok(t.length > 0 && t.every((x: number) => x >= reference - 0.01), `les noms de ${c} gardent ${reference} px : ${t.join(' ')}`)
    }
    const bord = await lire(page, `const vw = document.documentElement.clientWidth; const hors = []; for (const c of ${JSON.stringify(RADARS)}) for (const n of g(c).querySelectorAll('text.pole, polygon, line.spoke')) { const r = n.getBoundingClientRect(); if (r.width && (r.left < -0.5 || r.right > vw + 0.5)) hors.push(c + ' ' + n.tagName + ' ' + Math.round(r.left) + '–' + Math.round(r.right)) } return { vw, hors: hors.slice(0, 6), large: document.documentElement.scrollWidth }`)
    assert.deepEqual(bord.hors, [], `rien ne sort de l'écran (${bord.vw} px)`)
    assert.ok(bord.large <= bord.vw, `la page ne défile pas en largeur : ${bord.large}`)
    // le radar posé dans 300 px y tient, ses noms compris
    const etroit = await lire(page, `const cadre = h.querySelector('.etroit').getBoundingClientRect(); return [...g('b1').querySelectorAll('text.pole, svg.web')].map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.left - cadre.left), Math.round(cadre.right - r.right)] })`)
    assert.ok(etroit.every((e: number[]) => e[0] >= -1 && e[1] >= -1), `tout tient dans les 300 px : ${JSON.stringify(etroit)}`)
    const toile = await lire(page, `return Math.round(g('b2').querySelector('svg.web').getBoundingClientRect().width)`)
    assert.ok(toile >= 180, `la toile garde de la place : ${toile} px`)
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
