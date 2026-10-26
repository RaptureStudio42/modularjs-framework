// module cœur <@@chart> : une case sans valeur d'une carte ou d'un calendrier garde l'allure de `$$chart-empty` même quand la série porte une
// couleur de l'auteur (`color: '#c0392b'`), les niveaux 1 à 5 prennent cette couleur plus ou moins couvrante ; `stats` sur des barres
// empilées ou un anneau, `trend` sur un histogramme, venus d'une variable, écrivent une erreur µ.error, une fois, puis le graphique trace
// ce qu'il peut (rien, ou les autres statistiques) — un choix fait dans la barre d'outils ne dit jamais rien, elle grise ces cas ; la règle
// de l'anneau : une part par série dès deux séries visibles de même unité, quel que soit l'axe, une part par libellé pour une seule série
// sur un axe de libellés, sinon la note « L'anneau ne convient pas à ces données » — jamais une série perdue sans rien dire, et le menu des
// formes grise l'anneau selon la même règle, sur les séries visibles ; les bornes de classes d'un millième autour de 1 s'écrivent
// différemment. Dans Chromium, Firefox et WebKit réels, en développement et en production.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $jours    = [{ id: 'j1', x: '2026-10-01', v: 1 }, { id: 'j2', x: '2026-10-03', v: 2 }, { id: 'j3', x: '2026-10-05', v: 3 }, { id: 'j4', x: '2026-10-07', v: 4 }, { id: 'j5', x: '2026-10-09', v: 5 }]
  $rouge    = [{ key: 'v', name: 'Valeur', color: '#c0392b' }]
  $vert     = [{ key: 'v', name: 'Valeur', color: 'green' }]
  $libelles = [{ x: 'a', v: null }, { x: 'b', v: 1 }, { x: 'c', v: 2 }, { x: 'd', v: 3 }, { x: 'e', v: 4 }, { x: 'f', v: 5 }]
  $instants = [{ x: '2026-10-05T09:00', v: 1 }, { x: '2026-10-06T10:00', v: 3 }, { x: '2026-10-07T11:00', v: 5 }]
  $une      = [{ key: 'v', name: 'Course', unit: 'h' }]
  $deux     = [{ key: 'v', name: 'Course', unit: 'h' }, { key: 'w', name: 'Vélo', unit: 'h' }]
  $mixtes   = [{ key: 'v', name: 'Course', unit: 'h' }, { key: 'w', name: 'Distance', unit: 'km' }]
  $cats     = [{ x: 'Lun', v: 3, w: 10 }, { x: 'Mar', v: 5, w: 20 }]
  $duo      = [{ x: '2026-10-01', v: 3, w: 10 }, { x: '2026-10-02', v: 5, w: 20 }]
  $mesures  = [{ x: 1, v: 60 }, { x: 2, v: 62 }, { x: 3, v: 63 }, { x: 4, v: 65 }, { x: 5, v: 61 }, { x: 6, v: 64 }]
  $fins     = [${Array.from({ length: 12 }, (_, i) => `{ x: ${i + 1}, v: ${(1 + (i + 1) / 1000).toFixed(3)} }`).join(', ')}]
  $moyenne  = 'mean'
  $tendance = 'mean trend'
</script>

<@@chart class="c1" rows={$jours} series={$rouge} shape="calendar"></@@chart>
<@@chart class="c2" rows={$jours} series={$vert} shape="calendar"></@@chart>
<@@chart class="h1" rows={$libelles} series={$rouge} shape="heatmap"></@@chart>
<@@chart class="h2" rows={$libelles} series={$vert} shape="heatmap"></@@chart>
<@@chart class="h3" rows={$instants} series={$rouge} shape="heatmap"></@@chart>
<@@chart class="s1" rows={$duo} series={$deux} shape="pie" stats={$moyenne}></@@chart>
<@@chart class="s2" rows={$duo} series={$deux} shape="stack" stats={$moyenne}></@@chart>
<@@chart class="s3" rows={$mesures} series={$une} shape="histogram" stats={$tendance}></@@chart>
<@@chart class="b1" rows={$duo} series={$deux} toolbar="shapes stats" stats="mean trend"></@@chart>
<@@chart class="p1" rows={$jours} series={$une} shape="pie"></@@chart>
<@@chart class="p2" rows={$cats} series={$deux} shape="pie"></@@chart>
<@@chart class="p3" rows={$cats} series={$une} shape="pie"></@@chart>
<@@chart class="p4" rows={$cats} series={$mixtes} shape="pie"></@@chart>
<@@chart class="p5" rows={$cats} series={$deux} shape="pie" hidden={['w']}></@@chart>
<@@chart class="p6" rows={$duo} series={$deux} shape="pie"></@@chart>
<@@chart class="t1" rows={$cats} series={$mixtes} toolbar="shapes legend"></@@chart>
<@@chart class="t2" rows={$cats} series={$deux} toolbar="shapes"></@@chart>
<@@chart class="t3" rows={$jours} series={$une} toolbar="shapes"></@@chart>
<@@chart class="f1" rows={$fins} series={$une} shape="histogram"></@@chart>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'gv-page.mjs': PAGE }
const GRAPHIQUES = 19
const ROUGE = 'rgb(192, 57, 43)'

const P = '[ModularJS] <@@chart> : '
const LISTE = 'formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar.'
const ERREURS = [
  P + 'la forme pie ne trace pas stats « mean », il est ignoré — ' + LISTE,
  P + 'la forme stack ne trace pas stats « mean », il est ignoré — ' + LISTE,
  P + 'la forme histogram ne trace pas stats « trend », il est ignoré — ' + LISTE,
]

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-cases-anneau-stats', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gv-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const compte = (page: any, c: string, sel: string) => lire(page, `return g('${c}').querySelectorAll('${sel}').length`)
const noms = (page: any, c: string) => lire(page, `return [...g('${c}').querySelectorAll('li.part .name')].map((n) => n.textContent)`)
const cases = (page: any, c: string) => lire(page, `return [...g('${c}').querySelectorAll('rect.cell')].map((r) => { const cs = getComputedStyle(r); return { niveau: Number(/level-(\\d)/.exec(r.getAttribute('class'))[1]), fill: cs.fill, alpha: Number(cs.fillOpacity), teinte: r.style.getPropertyValue('--mjs-chart-tone').trim() } })`)

// le menu des formes de `c` ouvert, l'état de chaque forme (grisée ou non), puis le menu refermé
async function menu(page: any, c: string): Promise<Record<string, boolean>> {
  await lire(page, `g('${c}').querySelector('button.pick').click()`)
  await page.waitForFunction((k: string) => (document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.' + k)._shadow.querySelectorAll('.menu .item').length === 10, c)
  const etat = await lire(page, `return Object.fromEntries([...g('${c}').querySelectorAll('.menu .item')].map((i) => [i.querySelector('.glyph').getAttribute('class').replace('glyph glyph-', ''), i.getAttribute('aria-disabled') === 'true']))`)
  await lire(page, `g('${c}').querySelector('button.pick').click()`)
  await page.waitForFunction((k: string) => !(document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.' + k)._shadow.querySelector('.menu'), c)
  return etat
}

// une forme choisie dans le menu de `c`, comme le ferait l'utilisateur
async function choisir(page: any, c: string, forme: string): Promise<void> {
  await lire(page, `g('${c}').querySelector('button.pick').click()`)
  await page.waitForFunction((k: string) => (document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.' + k)._shadow.querySelectorAll('.menu .item').length === 10, c)
  await lire(page, `g('${c}').querySelector('.menu .item .glyph-${forme}').closest('.item').click()`)
  await page.waitForFunction(([k, f]: string[]) => (document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.' + k)._shadow.querySelector('button.pick .glyph-' + f), [c, forme])
}

const cochees = (page: any, c: string) => lire(page, `return Object.fromEntries([...g('${c}').querySelectorAll('.box[type="checkbox"]')].map((b) => [b.closest('label').querySelector('.stat').getAttribute('class').replace('stat stat-', ''), (b.checked ? 'on' : '') + (b.disabled ? 'off' : '')]))`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> cases vides, statistiques refusées, règle de l'anneau (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }
  let page: any = null
  let ctx: any = null
  const fautes: string[] = []
  const avis: string[] = []
  const plantages: string[] = []

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
    ctx     = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' })
    page    = await ctx.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()); else if (m.type() === 'warning') avis.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://f.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif"><mjs-gv-page></mjs-gv-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://f.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gv-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.concat(avis).join(' | ')}`)
    }
  })

  after(async () => {
    await ctx?.close()
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('une case sans valeur garde l\'allure de $$chart-empty malgré une couleur de l\'auteur ; les niveaux 1 à 5 prennent cette couleur', async () => {
    for (const [c, temoin, niveaux] of [['c1', 'c2', [0, 1, 2, 3, 4, 5]], ['h1', 'h2', [0, 1, 2, 3, 4, 5]], ['h3', 'h2', [0, 1, 3, 5]]] as const) {
      const vu  = await cases(page, c)
      const vide = (await cases(page, temoin)).find((k: any) => k.niveau === 0)!.fill
      assert.deepEqual([...new Set(vu.map((k: any) => k.niveau))].sort(), [...niveaux], c + ' : les niveaux dessinés')
      for (const k of vu) {
        if (k.niveau === 0) {
          assert.equal(k.fill, vide, `${c} : une case sans valeur a la couleur de $$chart-empty (${JSON.stringify(k)})`)
          assert.notEqual(k.fill, ROUGE, c)
          assert.equal(k.teinte, '', c + ' : la couleur de l\'auteur n\'est pas posée sur une case sans valeur')
        }
        else {
          assert.equal(k.fill, ROUGE, `${c} : niveau ${k.niveau} dans la couleur de l'auteur`)
          assert.ok(Math.abs(k.alpha - (k.niveau === 5 ? 1 : k.niveau * 0.2)) < 0.01, `${c} : niveau ${k.niveau}, opacité ${k.alpha}`)
        }
      }
    }
  })

  it('stats sur un anneau ou des barres empilées, trend sur un histogramme, venus d\'une variable : une erreur chacun, une fois, puis le reste', async () => {
    const attente = Date.now() + 8000
    while (Date.now() < attente && !ERREURS.every((e) => fautes.includes(e))) await page.waitForTimeout(100)
    await page.waitForTimeout(300)
    const dites = fautes.filter((f) => f.startsWith(P))
    for (const e of ERREURS) assert.equal(dites.filter((f) => f === e).length, 1, `erreur attendue une fois : ${e}\n--- erreurs vues :\n${fautes.join('\n')}`)
    assert.equal(dites.length, ERREURS.length, `aucune autre erreur du graphique :\n${dites.join('\n')}`)
    assert.deepEqual(avis.filter((a) => a.includes('<@@chart>')), [], 'aucun avertissement')
    assert.deepEqual(plantages, [])
    assert.equal(await compte(page, 's1', 'path.slice'), 2, 'l\'anneau se dessine')
    assert.equal(await compte(page, 's1', '.stat'), 0)
    assert.ok(Number(await compte(page, 's2', 'rect.bar')) >= 2)
    assert.equal(await compte(page, 's2', '.stat'), 0)
    assert.equal(await compte(page, 's3', 'svg.draw path.stat-mean'), 1, 'la moyenne reste')
    assert.equal(await compte(page, 's3', 'path.trend'), 0)
  })

  it('la barre d\'outils grise ces cas et ne dit jamais rien en console', async () => {
    const avant = fautes.length + avis.length
    assert.deepEqual(await cochees(page, 'b1'), { mean: 'on', median: '', q1: '', q3: '', trend: 'on' })
    await choisir(page, 'b1', 'pie')
    assert.deepEqual(await cochees(page, 'b1'), { mean: 'onoff', median: 'off', q1: 'off', q3: 'off', trend: 'onoff' })
    assert.equal(await compte(page, 'b1', 'path.slice'), 2)
    await choisir(page, 'b1', 'stack')
    assert.deepEqual(await cochees(page, 'b1'), { mean: 'onoff', median: 'off', q1: 'off', q3: 'off', trend: 'onoff' })
    await choisir(page, 'b1', 'histogram')
    assert.deepEqual(await cochees(page, 'b1'), { mean: 'on', median: '', q1: '', q3: '', trend: 'onoff' })
    assert.equal(await compte(page, 'b1', 'svg.draw path.stat-mean'), 1)
    assert.equal(await compte(page, 'b1', 'path.trend'), 0)
    await lire(page, `g('b1').querySelectorAll('.box[type="checkbox"]')[2].click()`)
    await page.waitForFunction(() => (document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.b1')._shadow.querySelectorAll('svg.draw path.stat-q1').length === 1)
    await choisir(page, 'b1', 'pie')
    await choisir(page, 'b1', 'line')
    assert.equal(await compte(page, 'b1', 'path.trend'), 2, 'de retour sur la courbe, la tendance revient')
    await page.waitForTimeout(300)
    assert.equal(fautes.length + avis.length, avant, `rien en console :\n${fautes.concat(avis).slice(avant).join('\n')}`)
  })

  it('l\'anneau : une part par série dès deux séries de même unité, par libellé pour une seule série sur des libellés, sinon la note', async () => {
    const note = (c: string) => lire(page, `return g('${c}').querySelector('.note')?.textContent ?? ''`)
    assert.match(await note('p1'), /^L'anneau ne convient pas à ces données/, 'une série sur un axe de dates')
    assert.equal(await compte(page, 'p1', 'path.slice'), 0)
    assert.deepEqual(await noms(page, 'p2'), ['Vélo', 'Course'], 'deux séries de même unité sur des libellés : une part par série, aucune perdue')
    assert.deepEqual(await noms(page, 'p3'), ['Mar', 'Lun'], 'une série sur des libellés : une part par libellé')
    assert.match(await note('p4'), /^L'anneau ne convient pas à ces données/, 'deux unités : la note, plutôt qu\'une série perdue')
    assert.equal(await compte(page, 'p4', 'path.slice'), 0)
    assert.deepEqual(await noms(page, 'p5'), ['Mar', 'Lun'], 'la seconde série cachée : une seule série visible, par libellé')
    assert.deepEqual(await noms(page, 'p6'), ['Vélo', 'Course'], 'deux séries sur des dates : une part par série')
    assert.equal(await note('p2'), '')
  })

  it('le menu des formes grise l\'anneau selon la même règle, sur les séries visibles', async () => {
    assert.equal((await menu(page, 't1')).pie, true, 'deux unités sur des libellés : grisé')
    assert.equal((await menu(page, 't2')).pie, false, 'deux séries de même unité : permis')
    assert.equal((await menu(page, 't3')).pie, true, 'une série sur des dates : grisé')
    await lire(page, `g('t1').querySelectorAll('button.series')[1].click()`)
    await page.waitForFunction(() => (document.querySelector('mjs-gv-page') as any)._shadow.querySelector('mjs-core-chart.t1')._shadow.querySelectorAll('button.series.dim').length === 1)
    assert.equal((await menu(page, 't1')).pie, false, 'la série en km cachée : une seule série visible sur des libellés, permis')
    await choisir(page, 't1', 'pie')
    assert.deepEqual(await noms(page, 't1'), ['Mar', 'Lun'])
  })

  it('des classes d\'un millième autour de 1 : deux bornes voisines ne s\'écrivent jamais pareil', async () => {
    const lignes: string[] = await lire(page, `return [...g('f1').querySelectorAll('.sr tbody th')].map((t) => t.textContent)`)
    assert.ok(lignes.length >= 3, JSON.stringify(lignes))
    assert.equal(new Set(lignes).size, lignes.length, JSON.stringify(lignes))
    for (const l of lignes) {
      const m = /^De (.+) à (.+?)(?: h)?$/.exec(l)
      assert.ok(m && m[1] !== m[2], `une classe qui s'écrit « ${l} »`)
    }
  })
})
