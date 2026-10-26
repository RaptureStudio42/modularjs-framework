// module cœur <@@chart> sans barre d'outils : quand aucune balise du projet n'écrit `toolbar`, la construction retire la barre (son code,
// son style, ses icônes, ses libellés ; cf. bundler-coeur-tri-graphique-barre.test.ts). Le graphique dessine alors exactement comme avec
// le module complet, au pixel près : courbe à statistiques, barres, anneau, carte, radar, calendrier, graphique vide ; la bulle s'ouvre au
// survol et se referme. Une appli qui écrit l'attribut, lié (`toolbar={$outils}`), a sa barre, et elle marche. Une page servie par un rendu
// serveur de développement est reprise sans saut par un navigateur de production : le serveur et le navigateur ont pris la même décision.
// Dans Chromium, Firefox et WebKit réels, en développement et en production.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const DONNEES = `<script>
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73.5 }, { id: 'c', x: '2026-09-05', poids: 71 }, { id: 'd', x: '2026-09-07', poids: 74 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $vide   = []
  $trois  = [{ id: 'a', x: '2026-09-01', lecture: 2, sport: 4 }, { id: 'b', x: '2026-09-02', lecture: 3, sport: 4 }, { id: 'c', x: '2026-09-03', lecture: 5, sport: 4 }]
  $deux   = [{ key: 'lecture', name: 'Lecture', unit: 'h' }, { key: 'sport', name: 'Sport', unit: 'h' }]
  $jours  = [{ id: 'j1', x: '2026-10-06', humeur: 2 }, { id: 'j2', x: '2026-10-20', humeur: 5 }]
  $humeur = [{ key: 'humeur', name: 'Humeur' }]
  $profil = [{ id: 'f', x: 'Force', moi: 80 }, { id: 's', x: 'Souplesse', moi: 50 }, { id: 'e', x: 'Endurance', moi: 70 }]
  $moi    = [{ key: 'moi', name: 'Moi' }]
  $villes = [{ id: 'v1', x: 'Anvers', lecture: 3, sport: 7 }, { id: 'v2', x: 'Bâle', lecture: 1 }]
  $outils = 'legend shapes'
</script>
`

const GRAPHIQUES = `<@@chart class="g1" rows={$rows} series={$series} stats="mean trend"></@@chart>
<@@chart class="g2" rows={$trois} series={$deux} shape="bar"></@@chart>
<@@chart class="g3" rows={$vide} series={$series}></@@chart>
<@@chart class="g4" rows={$trois} series={$deux} shape="pie"></@@chart>
<@@chart class="g5" rows={$villes} series={$deux} shape="heatmap"></@@chart>
<@@chart class="g6" rows={$profil} series={$moi} shape="radar"></@@chart>
<@@chart class="g7" rows={$jours} series={$humeur} shape="calendar"></@@chart>
`
const CLASSES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7']

// la même page, avec ou sans un huitième graphique qui écrit `toolbar` : dans une place de hauteur fixe, sous les sept autres, pour que
// la page garde la même hauteur
const PAGE = (barre: boolean) => DONNEES + GRAPHIQUES + `<div class="place">${barre ? '<@@chart class="gb" rows={$trois} series={$deux} toolbar={$outils}></@@chart>' : ''}</div>

<style>
  :host
    display: block

  .place
    height: 420px
    overflow: hidden
</style>
`

type Construit = { root: string, script: string }
const construits: Record<string, Promise<Construit>> = {}
const bati = (barre: boolean, prod: boolean) => (construits[(barre ? 'avec-' : 'sans-') + (prod ? 'prod' : 'dev')] ??= construire('graphique-barre-retiree-' + (barre ? 'avec' : 'sans'), { 'gs-page.mjs': PAGE(barre) }, prod))

/** le code du graphique que le navigateur reçoit */
function codeGraphique(fait: Construit, prod: boolean): string {
  if (!prod) return fait.script
  const out = join(fait.root, 'out')
  return readdirSync(out).filter((f) => f.startsWith('core-chart')).map((f) => readFileSync(join(out, f), 'utf-8')).join('\n')
}

async function ouvrir(browser: any, fait: Construit, prod: boolean, n: number) {
  const ctx  = await browser.newContext({ viewport: { width: 800, height: 2600 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  const erreurs: string[] = []
  const avis: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.type() + ' ' + m.text().slice(0, 300)) })
  await page.addInitScript('window.__name = function (f) { return f };')
  const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.script}</script>`
  await page.route('http://r.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-gs-page></mjs-gs-page>${charge}</body></html>` })
    const fichier = join(fait.root, normalize(chemin))
    if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://r.test/', { waitUntil: 'load' })
  await page.waitForFunction((k: number) => { const h = document.querySelector('mjs-gs-page') as any; const c = (h?._shadow ?? h?.shadowRoot)?.querySelectorAll('mjs-core-chart'); return !!c && c.length === k && [...c].every((x: any) => (x._shadow ?? x.shadowRoot)?.querySelector('.chart')) }, n, { timeout: 15000 }).catch(() => { throw new Error(`la page ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`) })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  return { ctx, page, erreurs, avis }
}

// l'ombre d'un graphique de la page, repéré par sa classe
const OMBRE = `const h = document.querySelector('mjs-gs-page'); const g = (c) => { const x = (h._shadow ?? h.shadowRoot).querySelector('mjs-core-chart.' + c); return x._shadow ?? x.shadowRoot };`
const lire = (page: any, corps: string) => page.evaluate(`(() => { ${OMBRE} ${corps} })()`)
// les ombres sont fermées : un graphique se photographie à ses coordonnées, un élément d'un graphique se clique en son centre, amené à l'écran
const cadre = (page: any, c: string) => lire(page, `const r = (h._shadow ?? h.shadowRoot).querySelector('mjs-core-chart.${c}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }`)
async function cliquer(page: any, c: string, s: string, rang = 0) {
  const p = await lire(page, `const n = g('${c}').querySelectorAll('${s}')[${rang}]; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
  assert.ok(p, `${c} : ${s} absent`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(150)
}

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> sans barre d'outils (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await Promise.all([bati(false, prod), bati(true, prod)])
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('la barre ne part pas quand aucune balise ne l\'écrit, elle part quand une balise l\'écrit', async () => {
    const sans = codeGraphique(await bati(false, prod), prod)
    const avec = codeGraphique(await bati(true, prod), prod)
    assert.ok(sans.length > 5000 && avec.length > 5000, 'le module du graphique est là')
    assert.deepEqual(['menuitemradio', 'radiogroup'].filter((m) => sans.includes(m)), [], 'sans balise qui l\'écrit : pas de barre')
    assert.deepEqual(['menuitemradio', 'radiogroup'].filter((m) => !avec.includes(m)), [], 'une balise l\'écrit : la barre')
  })

  it('chaque graphique dessine au pixel près comme avec le module complet', async () => {
    const images: Record<string, Buffer[]> = {}
    for (const barre of [false, true]) {
      const { ctx, page, erreurs } = await ouvrir(browser, await bati(barre, prod), prod, barre ? 8 : 7)
      for (const c of CLASSES) (images[c] ??= []).push(await page.screenshot({ clip: await cadre(page, c), animations: 'disabled' }))
      assert.deepEqual(erreurs, [])
      await ctx.close()
    }
    for (const c of CLASSES) assert.equal(images[c][0].equals(images[c][1]), true, `${c} : le dessin sans barre diffère de celui du module complet`)
  })

  it('sans barre, la bulle s\'ouvre au survol et se referme quand le pointeur s\'en va', async () => {
    const { ctx, page, erreurs, avis } = await ouvrir(browser, await bati(false, prod), prod, 7)
    const z = await lire(page, `const r = g('g1').querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`)
    await page.mouse.move(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(200)
    assert.match(String(await lire(page, `return g('g1').querySelector('.tip b')?.textContent`)), /^1\s*sept\.? 2026$/, 'la bulle s\'ouvre')
    await page.mouse.move(z.x + z.w / 2, z.y + z.h + 200)
    await page.waitForTimeout(200)
    assert.equal(await lire(page, `return !!g('g1').querySelector('.tip')`), false, 'la bulle se referme')
    assert.deepEqual(erreurs, [])
    assert.deepEqual(avis, [])
    await ctx.close()
  })

  it('une appli qui écrit `toolbar={$outils}` a sa barre : la légende cache une série, le menu change la forme', async () => {
    const { ctx, page, erreurs } = await ouvrir(browser, await bati(true, prod), prod, 8)
    assert.equal(await lire(page, `return g('gb').querySelectorAll('path.line').length`), 2)
    await cliquer(page, 'gb', 'button.series')
    assert.equal(await lire(page, `return g('gb').querySelectorAll('path.line').length`), 1, 'la pastille cache sa série')
    await cliquer(page, 'gb', 'button.pick')
    assert.equal(await lire(page, `return !!g('gb').querySelector('[role="menu"]')`), true, 'le menu des formes s\'ouvre')
    await page.waitForTimeout(150)
    await cliquer(page, 'gb', '[role="menuitemradio"]', 3)
    assert.ok(await lire(page, `return g('gb').querySelectorAll('rect.bar').length`) > 0, 'la forme choisie dans le menu est dessinée')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})

// le serveur rend en développement (son réglage par défaut), le navigateur charge un build de production : sans barre écrite, les deux
// ont retiré la barre, et la page servie est reprise sans saut
type Croise = { html: string, hydrateScript: string, fichiers: Map<string, Buffer>, serveur: string }
let croise: Promise<Croise> | null = null
function construireCroise(): Promise<Croise> {
  return (croise ??= (async () => {
    const root   = mjsTmp('graphique-barre-retiree-croise')
    const srcDir = join(root, 'src')
    const ssrDir = join(root, 'ssr')
    const prodDir = join(root, 'prod')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gs-page.mjs'), PAGE(false))
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: ssrDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendu    = await renderer.renderToString('mjs-gs-page', { ssrMode: 'markers' } as any)
    await renderer.close()
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(prodDir, f)))
    const serveur = readdirSync(ssrDir).filter((f) => f.startsWith('core-chart')).map((f) => readFileSync(join(ssrDir, f), 'utf-8')).join('\n')
    return { html: rendu.html, hydrateScript: rendu.hydrateScript, fichiers, serveur }
  })())
}

for (const nom of NAVIGATEURS) describe(`<@@chart> sans barre : serveur en développement, navigateur en production (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await construireCroise()
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('le serveur et le navigateur ont retiré la barre, la page servie est reprise sans saut', async () => {
    const fait   = await construireCroise()
    const client = [...fait.fichiers].filter(([f]) => f.startsWith('core-chart')).map(([, b]) => b.toString('utf-8')).join('\n')
    assert.ok(fait.serveur.length > 5000 && client.length > 5000, 'le module du graphique est compilé des deux côtés')
    assert.equal(fait.serveur.includes('menuitemradio') || client.includes('menuitemradio'), false, 'ni le serveur ni le navigateur n\'emportent la barre')
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 2600 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    // avant tout script : le tracé et le nombre de pièces que le serveur a écrits
    const avant = `<script>(() => { const g = document.querySelector('mjs-gs-page').shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot; window.__avant = { d: g.querySelector('path.line').getAttribute('d'), n: g.querySelectorAll('.chart *').length } })()</script>`
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px">${fait.html}\n${avant}\n${fait.hydrateScript}\n<script type="module" src="/out/bundle.js"></script></body></html>`
    await page.route('http://x.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
      const f = normalize(chemin).slice(normalize(chemin).lastIndexOf('/') + 1)
      if (fait.fichiers.has(f)) return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: fait.fichiers.get(f) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://x.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => { const h = document.querySelector('mjs-gs-page') as any; const c = h?.shadowRoot?.querySelectorAll('mjs-core-chart'); return !!customElements.get('mjs-core-chart') && !!c && c.length === 7 && [...c].every((x: any) => x.shadowRoot?.querySelector('.hit, .ring, .heat, .dial, .calendar, .blank')) }, null, { timeout: 15000 }).catch(() => { throw new Error(`la page servie ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur'} / console : ${avis.join(' | ') || 'rien'}`) })
    await page.waitForTimeout(300)
    const apres = await page.evaluate(() => { const g = (document.querySelector('mjs-gs-page') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot; const w = window as any; return { d: g.querySelector('path.line').getAttribute('d'), dAvant: w.__avant.d, n: g.querySelectorAll('.chart *').length, nAvant: w.__avant.n, lignes: g.querySelectorAll('path.line').length } })
    assert.equal(apres.n, apres.nAvant, 'le graphique a le même nombre de pièces')
    assert.equal(apres.lignes, 1, 'une seule courbe, jamais doublée')
    assert.equal(apres.d, apres.dAvant, 'le tracé ne bouge pas')
    const z = await page.evaluate(() => { const r = (document.querySelector('mjs-gs-page') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot.querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height } })
    await page.mouse.move(z.x + 3, z.y + z.h / 2)
    await page.waitForTimeout(150)
    assert.match(String(await page.evaluate(() => (document.querySelector('mjs-gs-page') as any).shadowRoot.querySelector('mjs-core-chart.g1').shadowRoot.querySelector('.tip b')?.textContent)), /^1\s*sept\.? 2026$/, 'la bulle s\'ouvre après la reprise')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
