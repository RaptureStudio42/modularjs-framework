// module cœur <@@chart> : les heures telles qu'un serveur les écrit, la gouttière des graduations et une couleur refusée, dans une page
// rendue par le serveur dans un processus réglé sur Tokyo (variable TZ), puis reprise dans Chromium, Firefox et WebKit réels réglés sur Los
// Angeles (Playwright `timezoneId`), en développement et en production. Time#to_s de Ruby et de Rails (« 2026-10-19 08:15:00 UTC »,
// « 2026-10-19 23:30:00 +0200 ») et RFC 2822 (« Tue, 20 Oct 2026 22:45:00 GMT ») se lisent comme des instants dans les trois moteurs et au
// serveur : sans `timezone`, l'heure écrite, sans saut à la reprise ; avec une zone IANA, cette zone ; avec `local`, l'heure du visiteur.
// Avec `decimals`, des graduations longues (« 6 000 000,00 ») restent dans le cadre du graphique, dans la page servie comme dans la page
// reprise. Une couleur « 0 » venue d'une variable est refusée au serveur comme au navigateur : la série garde la même teinte à la reprise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const RACINE   = fileURLToPath(new URL('..', import.meta.url))
const SERVEUR  = 'Asia/Tokyo'
const VISITEUR = 'America/Los_Angeles'

// trois instants écrits comme un serveur les écrit : 19 oct. 8 h 15 (Time#to_s d'une heure UTC), 19 oct. 23 h 30 (Time#to_s d'une heure
// locale, +0200), 20 oct. 22 h 45 (RFC 2822, GMT)
const PAGE = `<script>
  $instants = [{ id: 'a', x: '2026-10-19 08:15:00 UTC', v: 2 }, { id: 'b', x: '2026-10-19 23:30:00 +0200', v: 5 }, { id: 'c', x: 'Tue, 20 Oct 2026 22:45:00 GMT', v: 3 }]
  $millions = [{ x: 'a', v: 1200000 }, { x: 'b', v: 5100000 }]
  $zero     = [{ key: 'v', name: 'Valeur', color: '0' }]
  $une      = [{ key: 'v', name: 'Valeur' }]
  $zone     = 'Europe/Paris'
</script>
<@@chart class="z1" rows={$instants} series={$une}></@@chart>
<@@chart class="z2" rows={$instants} series={$une} timezone="Europe/Paris"></@@chart>
<@@chart class="z3" rows={$instants} series={$une} timezone="local"></@@chart>
<@@chart class="z4" rows={$instants} series={$une} shape="heatmap"></@@chart>
<@@chart class="z5" rows={$instants} series={$une} shape="calendar"></@@chart>
<@@chart class="z6" rows={$instants} series={$une} step="day"></@@chart>
<@@chart class="z7" rows={$instants} series={$une} shape="heatmap" timezone={$zone}></@@chart>
<@@chart class="g1" rows={$millions} series={$une} decimals="2"></@@chart>
<@@chart class="c0" rows={$instants} series={$zero}></@@chart>
`
const CLASSES = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7']

// le rendu serveur, dans un processus à part : son fuseau est celui de sa variable TZ, comme sur un serveur
const ENFANT = `import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [racine, mode, src] = process.argv.slice(2)
const { createSSRRenderer } = await import(pathToFileURL(join(src, 'server', 'renderToString.ts')).href)
const { Bundler, terminateSharedWorkerPool } = await import(pathToFileURL(join(src, 'bundler', 'index.ts')).href)
const prod   = mode === 'prod'
const srcDir = join(racine, 'src')
const renderer = await createSSRRenderer({ sourceDir: srcDir, ...(prod ? { env: 'prod' } : { outputDir: join(racine, 'out') }), bundlerOpts: { runtime: ['hydrate'] } })
const rendu = await renderer.renderToString('mjs-tz-page', { ssrMode: 'markers' })
await renderer.close()
if (prod) {
  const prodDir = join(racine, 'prod')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: prodDir, manifestPath: join(prodDir, 'bundle.js'), runtime: ['hydrate'], js: 'split', env: 'prod' })
  const stats = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e) => e.message).join('\\n'))
}
writeFileSync(join(racine, 'rendu.json'), JSON.stringify({ html: rendu.html, hydrateScript: rendu.hydrateScript, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }))
await terminateSharedWorkerPool()
process.exit(0)
`

type Construit = { html: string, hydrateScript: string, tz: string, bundle: string, fichiers: Map<string, Buffer> }
const construits: Record<string, Promise<Construit>> = {}

function construire(prod: boolean): Promise<Construit> {
  return (construits[prod ? 'prod' : 'dev'] ??= (async () => {
    const root = mjsTmp('graphique-heures-serveur-' + (prod ? 'prod' : 'dev'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tz-page.mjs'), PAGE)
    writeFileSync(join(root, 'rendre.mts'), ENFANT)
    const fait = spawnSync(process.execPath, ['--import', 'tsx/esm', join(root, 'rendre.mts'), root, prod ? 'prod' : 'dev', join(RACINE, 'src')], { cwd: RACINE, env: { ...process.env, TZ: SERVEUR }, encoding: 'utf-8', timeout: 170000 })
    assert.equal(fait.status, 0, `le rendu serveur échoue : ${fait.stderr}\n${fait.stdout}`)
    const rendu    = JSON.parse(readFileSync(join(root, 'rendu.json'), 'utf-8'))
    const fichiers = new Map<string, Buffer>()
    if (prod) {
      for (const f of readdirSync(join(root, 'prod'))) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(root, 'prod', f)))
      return { ...rendu, bundle: '', fichiers }
    }
    const outDir = join(root, 'out')
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur  = files.find((f) => /^mjs_core-/.test(f))!
    const autres = files.filter((f) => f !== coeur && f !== 'bundle.js').map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    return { ...rendu, bundle: stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + autres + '\n' + libellesDuManifeste(join(outDir, 'bundle.js')), fichiers }
  })())
}

// ce qu'un graphique écrit : les lignes du tableau, les étiquettes de l'axe x, les cases (niveaux) d'une grille ou d'un calendrier
const LECTURE = `(() => { const h = document.querySelector('mjs-tz-page').shadowRoot; const lu = (c) => { const s = h.querySelector('mjs-core-chart.' + c).shadowRoot; return { lignes: [...s.querySelectorAll('tbody th')].map((t) => t.textContent), x: [...s.querySelectorAll('text.xlabel')].map((t) => t.textContent), cases: [...s.querySelectorAll('rect.cell')].map((r) => /level-(\\d)/.exec(r.getAttribute('class'))[1]) } }; const geo = (c) => { const g = h.querySelector('mjs-core-chart.' + c); const t = [...g.shadowRoot.querySelectorAll('text.ylabel')]; return { bord: g.getBoundingClientRect().left, gauche: Math.min(...t.map((n) => n.getBoundingClientRect().left)), n: t.length } }; return Object.assign(Object.fromEntries(${JSON.stringify(CLASSES)}.map((c) => [c, lu(c)])), { g1: geo('g1'), c0: [...h.querySelector('mjs-core-chart.c0').shadowRoot.querySelectorAll('path.line')].map((p) => p.getAttribute('class')) }) })()`

// le jour et l'heure d'un texte (« 19 oct. 2026, 08:15 » → « 19 08:15 »), quelle que soit la façon d'écrire du moteur
const heure = (s: string) => {
  const j = /(?:^|\D)(\d{1,2})(?=\D|$)/.exec(s)
  const h = /(\d{2}):(\d{2})/.exec(s)
  return [j ? j[1] : '?', h ? h[1] + ':' + h[2] : ''].filter(Boolean).join(' ')
}
const allumees = (cases: string[]) => cases.map((n, i) => (n === '0' ? -1 : i)).filter((i) => i >= 0)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> heures écrites par un serveur, gouttière, couleur refusée : servi à ${SERVEUR}, reprise à ${VISITEUR} (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await construire(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('Time#to_s et RFC 2822 : sans option et avec une zone IANA, rien ne saute à la reprise ; avec local, l\'heure du visiteur ; graduations dans le cadre ; même teinte', async () => {
    const fait = await construire(prod)
    assert.equal(fait.tz, SERVEUR, 'le serveur rend dans son fuseau')
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 900 }, timezoneId: VISITEUR })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const avant   = `<script>window.__avant = ${LECTURE}</script>`
    const charge  = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.bundle}</script>`
    const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px">${fait.html}\n${avant}\n${fait.hydrateScript}\n${charge}</body></html>`
    await page.route('http://tz.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: contenu })
      const f = normalize(chemin).slice(normalize(chemin).lastIndexOf('/') + 1)
      if (prod && fait.fichiers.has(f)) return route.fulfill({ contentType: f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: fait.fichiers.get(f) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://tz.test/', { waitUntil: 'load' })
    assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), VISITEUR)
    await page.waitForFunction((n: number) => { const h = document.querySelector('mjs-tz-page') as any; const c = h?.shadowRoot?.querySelectorAll('mjs-core-chart'); return !!customElements.get('mjs-core-chart') && !!c && c.length === n && [...c].every((x: any) => x.shadowRoot?.querySelector('.hit, .heat, .calendar')) }, CLASSES.length + 2, { timeout: 15000 }).catch(() => { throw new Error(`la page servie ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur'} / console : ${avis.join(' | ') || 'rien'}`) })
    await page.waitForTimeout(400)
    const servi: any = await page.evaluate('window.__avant')
    const repris: any = await page.evaluate(LECTURE)
    // ce que la page servie écrivait, à Tokyo
    assert.deepEqual(servi.z1.lignes.map(heure), ['19 08:15', '19 23:30', '20 22:45'], 'sans option : les heures telles qu\'écrites')
    assert.deepEqual(servi.z2.lignes.map(heure), ['19 10:15', '19 23:30', '21 00:45'], 'Europe/Paris')
    assert.deepEqual(servi.z3.lignes.map(heure), ['19 17:15', '20 06:30', '21 07:45'], 'local, au serveur : l\'heure de Tokyo')
    // reprise à Los Angeles : rien ne bouge, sauf l'heure locale
    // (le choix des étiquettes de l'axe x suit la largeur mesurée après la reprise : leurs heures se comparent, pas leur nombre)
    for (const c of ['z1', 'z2', 'z4', 'z5', 'z6', 'z7']) assert.deepEqual({ lignes: repris[c].lignes, cases: repris[c].cases }, { lignes: servi[c].lignes, cases: servi[c].cases }, `aucun saut à la reprise (${c})`)
    assert.deepEqual(repris.z3.lignes.map(heure), ['19 01:15', '19 14:30', '20 15:45'], 'local : l\'heure de l\'écran du visiteur')
    for (const lu of [servi.z1.x, repris.z1.x]) {
      assert.ok(lu.length >= 2 && lu.every((t: string) => ['19 08:15', '19 23:30', '20 22:45'].includes(heure(t))), `les étiquettes aussi, servies et reprises : ${lu.join(' | ')}`)
    }
    // la grille jour × heure : lundi 8 h, lundi 23 h, mardi 22 h telles qu'écrites ; à Paris, lundi 10 h, lundi 23 h, mercredi 0 h
    assert.deepEqual(allumees(repris.z4.cases), [8, 23, 46])
    assert.deepEqual(allumees(repris.z7.cases), [10, 23, 48])
    // le calendrier et le regroupement par jour : les 19 et 20 octobre
    assert.deepEqual(repris.z5.lignes.map(heure), ['19', '20'])
    assert.deepEqual(repris.z6.lignes.map(heure), ['19', '20'])
    // la bulle, après la reprise : l'heure écrite
    const z = await page.evaluate(() => { const s = (document.querySelector('mjs-tz-page') as any).shadowRoot.querySelector('mjs-core-chart.z1').shadowRoot; const r = s.querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height } })
    await page.mouse.move(z.x + 2, z.y + z.h / 2)
    await page.waitForTimeout(150)
    assert.equal(heure(String(await page.evaluate(() => (document.querySelector('mjs-tz-page') as any).shadowRoot.querySelector('mjs-core-chart.z1').shadowRoot.querySelector('.tip b')?.textContent))), '19 08:15')
    assert.deepEqual(erreurs, [])
    // des graduations longues dans le cadre, servies et reprises ; la couleur « 0 » refusée des deux côtés (une erreur, une fois)
    for (const [quand, g] of [['servie', servi.g1], ['reprise', repris.g1]]) assert.ok(g.n >= 2 && g.gauche >= g.bord - 0.5, `graduations dans le cadre (${quand}) : ${JSON.stringify(g)}`)
    assert.deepEqual({ servi: servi.c0, repris: repris.c0 }, { servi: ['line tone-1'], repris: ['line tone-1'] }, 'la couleur « 0 » : la même teinte servie et reprise')
    assert.equal(avis.filter((a) => /la couleur « 0 »/.test(a)).length, 1)
    assert.deepEqual(avis.filter((a) => /chart/.test(a) && !/la couleur « 0 »/.test(a)), [])
    await ctx.close()
  })
})
