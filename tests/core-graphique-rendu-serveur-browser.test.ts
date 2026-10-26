// module cœur <@@chart> dans une page RENDUE PAR LE SERVEUR : le graphique est dessiné dans la page servie (cadre, graduations, étiquettes,
// séries, statistiques, tableau des valeurs ; barres empilées, histogramme et anneau avec son centre et sa légende ; calendrier, radar et
// carte d'intensité avec leurs cases, leurs axes et leur légende ; la barre d'outils, ses séries, son bouton de forme, ses cases et son
// pas de temps), sans aucun style écrit dans les balises pour les teintes du thème ; puis la page est hydratée
// dans Chromium, Firefox et WebKit réels, en développement et en production (mode de reprise « markers ») : le graphique reprend le dessin
// du serveur sans saut (mêmes tracés, même nombre de pièces, même hauteur, une seule courbe, la même barre d'outils), sans erreur, et répond
// ensuite au survol et à la barre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const HOTE = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', readings: { poids: 73.5 } }, { id: 'c', x: '2026-09-05', poids: 71 }, { id: 'd', x: '2026-09-07', poids: 74 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $vide   = []
  $trois  = [{ id: 'a', x: '2026-09-01', lecture: 2, sport: 4 }, { id: 'b', x: '2026-09-02', lecture: 3, sport: 4 }, { id: 'c', x: '2026-09-03', lecture: 5, sport: 4 }]
  $deux   = [{ key: 'lecture', name: 'Lecture', unit: 'h' }, { key: 'sport', name: 'Sport', unit: 'h' }]
  $jours  = [{ id: 'j1', x: '2026-10-06', humeur: 2 }, { id: 'j2', x: '2026-10-20', humeur: 5 }]
  $humeur = [{ key: 'humeur', name: 'Humeur' }]
  $profil = [{ id: 'f', x: 'Force', moi: 80 }, { id: 's', x: 'Souplesse', moi: 50 }, { id: 'e', x: 'Endurance', moi: 70 }]
  $moi    = [{ key: 'moi', name: 'Moi' }]
  $villes = [{ id: 'v1', x: 'Anvers', lecture: 3, sport: 7 }, { id: 'v2', x: 'Bâle', lecture: 1 }]
</script>
<@@chart class="g1" rows={$rows} series={$series} stats="mean trend"></@@chart>
<@@chart class="g2" rows={$rows} series={$series} shape="bar"></@@chart>
<@@chart class="g3" rows={$vide} series={$series}></@@chart>
<@@chart class="g4" rows={$trois} series={$deux} shape="stack"></@@chart>
<@@chart class="g5" rows={$rows} series={$series} shape="histogram" stats="mean median"></@@chart>
<@@chart class="g6" rows={$trois} series={$deux} shape="pie"></@@chart>
<@@chart class="g7" rows={$jours} series={$humeur} shape="calendar"></@@chart>
<@@chart class="g8" rows={$profil} series={$moi} shape="radar"></@@chart>
<@@chart class="g9" rows={$villes} series={$deux} shape="heatmap"></@@chart>
<@@chart class="g10" rows={$trois} series={$deux} toolbar="legend shapes stats step" stats="mean"></@@chart>
`

type Rendu = { html: string, hydrateScript: string }
type Construit = { rendu: Rendu, bundle: string, fichiers: Map<string, Buffer> }

const construits: Record<string, Promise<Construit>> = {}

function construire(prod: boolean): Promise<Construit> {
  return (construits[prod ? 'prod' : 'dev'] ??= (async () => {
    const root   = mjsTmp('graphique-rendu-serveur-' + (prod ? 'prod' : 'dev'))
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gr-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, ...(prod ? { env: 'prod' } : { outputDir: outDir }), bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendu: Rendu = await renderer.renderToString('mjs-gr-ssr', { ssrMode: 'markers' } as any)
    await renderer.close()
    const fichiers = new Map<string, Buffer>()
    if (prod) {
      const prodDir = join(root, 'prod')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(prodDir, f)))
      return { rendu, bundle: '', fichiers }
    }
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return { rendu, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres + '\n' + libellesDuManifeste(join(outDir, 'bundle.js')), fichiers }
  })())
}

// le contenu d'un graphique dans le HTML servi (son ombre déclarative), repéré par sa classe
function graphique(html: string, cls: string): string {
  const debut = html.indexOf(`<mjs-core-chart class="${cls}"`)
  assert.ok(debut >= 0, `graphique ${cls} absent de la page servie`)
  return html.slice(debut, html.indexOf('</mjs-core-chart>', debut))
}

describe('<@@chart> : la page servie porte le graphique déjà dessiné', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) it(`cadre, graduations, étiquettes, séries, statistiques et tableau sont dans le HTML (${prod ? 'production' : 'développement'})`, async () => {
    const { rendu } = await construire(prod)
    const g1 = graphique(rendu.html, 'g1')
    assert.match(g1, /<svg class="svg" aria-hidden="true"/)
    assert.match(g1, /<path class="line tone-1" d="M 0\.00 [\d.]+ L [\d. L]+"/, 'la courbe est tracée')
    assert.match(g1, /<path class="stat stat-mean tone-1" d="M 0 [\d.]+ L 1000 [\d.]+"/, 'la moyenne est tracée')
    assert.match(g1, /<path class="trend stat-trend tone-1"/, 'la tendance est tracée')
    assert.match(g1, /<circle class="ghost tone-1"/, 'le point estimé est posé')
    assert.equal((g1.match(/<circle class="dot tone-1"/g) ?? []).length, 4)
    assert.ok((g1.match(/<text class="ylabel"/g) ?? []).length >= 2, 'les graduations')
    assert.match(g1, /<text class="xlabel"[^>]*>1 sept\.<\/text>/, 'la première étiquette')
    assert.equal((g1.match(/<tr><th scope="row">/g) ?? []).length, 4, 'le tableau des valeurs, une ligne par relevé')
    assert.match(g1, /<td>73,5 kg<\/td>/)
    assert.equal((graphique(rendu.html, 'g2').match(/<rect class="bar tone-1"/g) ?? []).length, 4, 'les barres')
    assert.match(graphique(rendu.html, 'g3'), /<p class="empty" part="empty">/, 'le vide est dit dès la page servie')
    // barres empilées : un segment par série et par ligne ; histogramme : trois classes (71, 72, 73 à 74) et la moyenne en trait vertical
    assert.equal((graphique(rendu.html, 'g4').match(/<rect class="bar tone-[12]/g) ?? []).length, 6, 'les segments empilés')
    const g5 = graphique(rendu.html, 'g5')
    assert.equal((g5.match(/<rect class="bar tone-1/g) ?? []).length, 3, 'les classes de l\'histogramme')
    assert.match(g5, /<path class="stat stat-mean tone-0" d="M ([\d.]+) 0 L \1 300"/, 'la moyenne en trait vertical')
    // anneau : deux parts (le total de chaque série), le total au centre, la légende
    const g6 = graphique(rendu.html, 'g6')
    assert.equal((g6.match(/<path class="slice tone-[12]/g) ?? []).length, 2, 'les parts de l\'anneau')
    assert.match(g6, /<b>(<!--[^>]*-->)?22 h<\/b>/, 'le total au centre')
    assert.equal((g6.match(/<li class="part tone-[12]/g) ?? []).length, 2, 'la légende')
    assert.match(g6, /<th scope="row">Sport<\/th><td>12 h<\/td>/, 'le tableau des parts')
    // calendrier : 26 semaines jusqu'au mardi 20 octobre (les cinq jours suivants ne se dessinent pas), les mois, les jours, la légende ;
    // radar : trois axes, un polygone ; carte : deux séries sur deux libellés
    const g7 = graphique(rendu.html, 'g7')
    assert.equal((g7.match(/<rect class="cell tone-1 level-\d/g) ?? []).length, 177, 'les cases du calendrier')
    assert.match(g7, /<rect class="cell tone-1 level-5[^>]*data-i="176"/, 'le jour le plus haut au cinquième niveau')
    assert.match(g7, /<text class="head"[^>]*>(<!--[^>]*-->)?oct\.<\/text>/, 'les mois en tête')
    assert.match(g7, /<text class="day"[^>]*>(<!--[^>]*-->)?lun\.<\/text>/, 'les jours')
    assert.match(g7, /<p class="ramp" part="ramp">/, 'la légende des niveaux')
    const g8 = graphique(rendu.html, 'g8')
    assert.equal((g8.match(/<polygon class="shape tone-1"/g) ?? []).length, 1, 'le polygone du radar')
    assert.equal((g8.match(/<path class="wedge" data-i="\d"/g) ?? []).length, 3, 'un secteur par axe')
    assert.match(g8, /<text class="pole"[^>]*>(<!--[^>]*-->)?Souplesse<\/text>/, 'les noms des axes')
    const g9 = graphique(rendu.html, 'g9')
    assert.equal((g9.match(/<rect class="cell tone-[12] level-\d/g) ?? []).length, 4, 'les cases de la carte')
    assert.match(g9, /<span class="name">(<!--[^>]*-->)?Sport<\/span>/, 'les noms des lignes')
    // la barre d'outils : les séries (pressées), le bouton du menu (fermé), les cinq cases (la moyenne cochée), les cinq pas (automatique choisi)
    const g10 = graphique(rendu.html, 'g10')
    // (les noms de la barre sont des libellés du cœur : le rendu serveur les écrit dans la langue de la page, cf. core-libelles-rendu-serveur-browser.test.ts)
    assert.match(g10, /<div class="tools" part="tools" role="group"/, 'la barre est dans la page servie')
    assert.equal((g10.match(/<button type="button" class="pill series tone-[12]"[^>]*aria-pressed="true"/g) ?? []).length, 2, 'une pastille par série')
    assert.match(g10, /<button type="button" class="pill pick"[^>]*aria-haspopup="menu" aria-expanded="false"/, 'le bouton du menu, fermé')
    assert.doesNotMatch(g10, /role="menu"/, 'aucun menu ouvert')
    assert.equal((g10.match(/<input type="checkbox"/g) ?? []).length, 5, 'les cinq statistiques')
    assert.equal((g10.match(/<input type="checkbox"[^>]*checked/g) ?? []).length, 1, 'la moyenne cochée')
    assert.equal((g10.match(/<input type="radio"/g) ?? []).length, 5, 'les cinq pas')
    assert.match(g10, /<input type="radio"[^>]*value="auto"[^>]*checked/, 'le pas automatique choisi')
    assert.doesNotMatch(graphique(rendu.html, 'g1'), /class="tools"/, 'sans toolbar, aucune barre')
    assert.doesNotMatch(rendu.html, /<mjs-core-chart[\s\S]*style="/, 'aucun style écrit dans les balises du graphique')
    assert.doesNotMatch(rendu.html, /class="tip"/, 'aucune bulle ouverte')
  })
})

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> : la page servie hydratée (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null

  before(async function () {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
    } catch { present = false }
    if (!present) return
    await construire(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('le graphique reprend le dessin du serveur sans saut, puis répond au survol', async () => {
    const fait = await construire(prod)
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    page.on('requestfailed', (r: any) => avis.push('échec ' + r.url()))
    await page.addInitScript('window.__name = function (f) { return f };')
    // avant tout script : le tracé, le nombre de pièces du dessin et la hauteur que le serveur a écrits
    const avant = `<script>(() => { const g = document.querySelector('mjs-gr-ssr').shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot; const a = document.querySelector('mjs-gr-ssr').shadowRoot.querySelector('mjs-core-chart.g6').shadowRoot; const k = document.querySelector('mjs-gr-ssr').shadowRoot.querySelector('mjs-core-chart.g7').shadowRoot; const o = document.querySelector('mjs-gr-ssr').shadowRoot.querySelector('mjs-core-chart.g10').shadowRoot; window.__avant = { t: [...o.querySelectorAll('.tools *')].map((n) => n.localName + '.' + n.getAttribute('class') + '.' + (n.getAttribute('aria-pressed') ?? '') + (n.checked ? '*' : '')).join(' '), n10: o.querySelectorAll('.tools *').length,  d: g.querySelector('path.line').getAttribute('d'), h: g.querySelector('.plot').getBoundingClientRect().height, n: g.querySelectorAll('svg.svg *').length, d6: a.querySelector('path.slice').getAttribute('d'), n6: a.querySelectorAll('.pie *').length, n7: k.querySelectorAll('rect.cell').length, h7: k.querySelector('svg.days').getBoundingClientRect().height } })()</script>`
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.bundle}</script>`
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px">${fait.rendu.html}\n${avant}\n${fait.rendu.hydrateScript}\n${charge}</body></html>`
    await page.route('http://ssr.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
      // le manifeste sert sous /out, il demande ses morceaux sous le nom du dossier de build : le nom du fichier suffit
      const f = normalize(chemin).slice(normalize(chemin).lastIndexOf('/') + 1)
      if (prod && fait.fichiers.has(f)) return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: fait.fichiers.get(f) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://ssr.test/', { waitUntil: 'load' })
    // les noms internes (`_shadow`, `_mjs_is_mounted`) sont abrégés en production : l'ombre ouverte et la balise définie suffisent
    await page.waitForFunction(() => { const h = document.querySelector('mjs-gr-ssr') as any; const c = h?.shadowRoot?.querySelectorAll('mjs-core-chart'); return !!customElements.get('mjs-core-chart') && !!c && c.length === 10 && [...c].every((x: any) => x.shadowRoot?.querySelector('.hit, .ring, .heat, .dial, .calendar')) }, null, { timeout: 15000 }).catch(() => { throw new Error(`la page servie ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur'} / console : ${avis.join(' | ') || 'rien'}`) })
    await page.waitForTimeout(300)
    const apres = await page.evaluate(() => {
      const g = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot
      const w = window as any
      return { d: g.querySelector('path.line').getAttribute('d'), dAvant: w.__avant.d, h: g.querySelector('.plot').getBoundingClientRect().height, hAvant: w.__avant.h, lignes: g.querySelectorAll('path.line').length, hydrate: (document.querySelector('mjs-gr-ssr') as any)._mjs_hydrated, n: g.querySelectorAll('svg.svg *').length, nAvant: w.__avant.n }
    })
    if (!prod) assert.equal(apres.hydrate, true, 'la page est reprise, pas refaite')
    assert.equal(apres.n, apres.nAvant, 'le dessin a le même nombre de pièces')
    assert.equal(apres.lignes, 1, 'une seule courbe, jamais doublée')
    assert.equal(apres.d, apres.dAvant, 'le tracé ne bouge pas')
    assert.equal(apres.h, apres.hAvant, 'la hauteur ne bouge pas')
    const z = await page.evaluate(() => { const r = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot.querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
    await page.mouse.move(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(150)
    assert.match(String(await page.evaluate(() => (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot.querySelector('.tip b')?.textContent)), /^1\s*sept\.? 2026$/, 'la bulle s\'ouvre après la reprise')
    assert.equal(await page.evaluate(() => (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g3').shadowRoot.querySelector('.empty').textContent), 'Aucune valeur')
    // l'anneau reprend ses parts sans saut, puis une part survolée prend le centre (l'anneau, sous les autres graphiques, est d'abord amené à l'écran)
    const anneau = await page.evaluate(() => { const a = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g6').shadowRoot; const w = window as any; a.querySelector('.ring').scrollIntoView({ block: 'center' }); const r = a.querySelector('.ring').getBoundingClientRect(); return { d: a.querySelector('path.slice').getAttribute('d'), dAvant: w.__avant.d6, n: a.querySelectorAll('.pie *').length, nAvant: w.__avant.n6, x: r.left + r.width / 2 + r.width * 0.385 * Math.cos((0.27 - 0.25) * 2 * Math.PI), y: r.top + r.height / 2 + r.width * 0.385 * Math.sin((0.27 - 0.25) * 2 * Math.PI) } })
    assert.equal(anneau.d, anneau.dAvant, 'les parts ne bougent pas')
    assert.equal(anneau.n, anneau.nAvant, 'l\'anneau a le même nombre de pièces')
    await page.mouse.move(anneau.x, anneau.y)
    await page.waitForTimeout(150)
    const centre = await page.evaluate(() => { const a = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g6').shadowRoot; return { texte: a.querySelector('.center').textContent, allumee: a.querySelectorAll('path.slice.on').length, html: a.querySelector('.ring').innerHTML.replace(/d="[^"]*"/g, '').slice(0, 900) } })
    assert.match(centre.texte, /12 h.*Sport/, `la part survolée prend le centre : ${JSON.stringify(centre)} / point ${anneau.x},${anneau.y}`)
    // le calendrier reprend ses cases sans saut, puis un jour survolé ouvre sa bulle
    const jours = await page.evaluate(() => { const k = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g7').shadowRoot; const w = window as any; const c = k.querySelector('rect.cell[data-i="176"]'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { n: k.querySelectorAll('rect.cell').length, nAvant: w.__avant.n7, h: k.querySelector('svg.days').getBoundingClientRect().height, hAvant: w.__avant.h7, x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    assert.equal(jours.n, jours.nAvant, 'le calendrier garde ses cases')
    assert.equal(jours.h, jours.hAvant, 'le calendrier garde sa hauteur')
    await page.mouse.move(jours.x, jours.y)
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g7').shadowRoot.querySelector('.tip b')?.textContent), 'mardi 20 octobre 2026', 'la bulle du jour s\'ouvre après la reprise')
    // la barre d'outils reprend celle du serveur sans saut (mêmes pièces, même texte), puis une pastille cache sa série
    const barre = await page.evaluate(() => { const o = (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g10').shadowRoot; const w = window as any; o.querySelector('.tools').scrollIntoView({ block: 'center' }); return { n: o.querySelectorAll('.tools *').length, nAvant: w.__avant.n10, t: [...o.querySelectorAll('.tools *')].map((n: any) => n.localName + '.' + n.getAttribute('class') + '.' + (n.getAttribute('aria-pressed') ?? '') + (n.checked ? '*' : '')).join(' '), tAvant: w.__avant.t, lignes: o.querySelectorAll('path.line').length } })
    assert.equal(barre.n, barre.nAvant, 'la barre garde ses pièces')
    assert.equal(barre.t, barre.tAvant, 'la barre garde ses pièces, leurs classes, leurs états')
    assert.equal(barre.lignes, 2)
    await page.locator('mjs-core-chart.g10 button.series >> nth=0').click()
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => (document.querySelector('mjs-gr-ssr') as any).shadowRoot.querySelector('mjs-core-chart.g10').shadowRoot.querySelectorAll('path.line').length), 1, 'la barre répond après la reprise')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
