// module cœur <@@virtual> dans Chromium, Firefox et WebKit réels, en développement et en production, sur 100 000 lignes (liste µraw, la forme
// de la doc, et liste ordinaire) : un pas de défilement déplace la fenêtre sans refaire les tables de la liste entière (une hauteur et un
// début cumulé par élément, ses clés) — dix pas d'une ligne : aucune table de la taille de la liste, aucune lecture par élément. Une fenêtre
// que la page écrit elle-même (`start`) est ramenée à la zone visible sans attendre le défilement suivant (la mesure de ses lignes la recale)

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, lancer, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $brut      = µraw(Array.from({ length: 100000 }, (_, i)-> ({ id: i, nom: "Produit #{i}" })))
  $ordinaire = Array.from({ length: 100000 }, (_, i)-> ({ id: i, nom: "Article #{i}" }))
  $a         = 0
  $b         = 20
  $c         = 0
  $d         = 20
  @poser = (n)-> $a = n
</script>

<@@virtual class="vl brut" items={$brut} key="id" size="40" start=!{$a} end=!{$b} aria-label="Produits">
  {for p in $brut.slice($a, $b) by id}
    <div class="ligne" data-id={p.id}>{p.nom}</div>
  {end}
</@@virtual>
<@@virtual class="vl ordinaire" items={$ordinaire} key="id" size="40" start=!{$c} end=!{$d} aria-label="Articles">
  {for p in $ordinaire.slice($c, $d) by id}
    <div class="ligne" data-id={p.id}>{p.nom}</div>
  {end}
</@@virtual>

<style>
  :host
    display: block
  .vl
    width: 300px
    height: 400px
  .ligne
    box-sizing: border-box
    height: 40px
</style>
`

// les tables de 100 000 places (`Float64Array`, les octets alloués) et les lectures de table (`Map.prototype.get`), comptées depuis cet appel
const COMPTE = `(() => { window.__n = { tables: 0, octets: 0, lectures: 0 }; if (window.__compte) return; window.__compte = true; const F = window.Float64Array; window.Float64Array = new Proxy(F, { construct(t, a) { __n.tables++; __n.octets += 8 * (typeof a[0] === 'number' ? a[0] : 0); return new t(...a) } }); const mg = Map.prototype.get; Map.prototype.get = function () { __n.lectures++; return mg.apply(this, arguments) } })()`
const AIDES  = `window.__name = function (f) { return f }; window.__page = () => document.querySelector('mjs-vd-page'); window.__vl = (c) => __page()?._shadow?.querySelector('mjs-core-virtual.' + c); window.__vp = (c) => __vl(c)._shadow.querySelector('.viewport'); window.__seenMark = (c) => ({ lignes: __vl(c).children.length, premier: __vl(c).children[0]?.dataset.id ?? null }); window.__images = (n) => new Promise((ok) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : ok()); f() })`

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('virtual-defilement-tables', { 'vd-page.mjs': PAGE }, prod))

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@virtual> 100 000 lignes, le défilement ne refait pas les tables (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    await bati(prod)
    browser = await lancer(nom)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // une page neuve, ses deux listes dessinées, et une image de repos (trois images, 80 ms, trois images)
  const ouvrir = async () => {
    const built = await bati(prod)
    const ctx   = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page  = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.addInitScript(AIDES)
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://vd.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-vd-page></mjs-vd-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://vd.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => ['brut', 'ordinaire'].every((c) => { const h = (window as any).__vl?.(c); return !!h?._shadow?.querySelector('slot') && h.children.length > 0 }), null, { timeout: 60000 })
    const repos = async () => { await page.evaluate('__images(3)'); await page.waitForTimeout(80); await page.evaluate('__images(3)') }
    return { ctx, page, erreurs, repos }
  }

  it('dix pas d\'une ligne au milieu de la liste : aucune table refaite, aucune lecture par élément', async () => {
    const { ctx, page, erreurs, repos } = await ouvrir()
    const ecarts: string[] = []
    for (const c of ['brut', 'ordinaire']) {
      await page.evaluate(`__vp('${c}').scrollTop = 2000000`)
      await repos(); await repos()
      await page.evaluate(COMPTE)
      for (let k = 0; k < 10; k++) { await page.evaluate(`__vp('${c}').scrollTop += 40`); await repos() }
      const fin: any = await page.evaluate(`({ n: __n, vu: __seenMark('${c}') })`)
      if (fin.n.tables > 0 || fin.n.lectures >= 100) ecarts.push(`liste ${c} : ${fin.n.tables} tables refaites en dix pas (${fin.n.octets} octets alloués, ${fin.n.lectures} lectures de table)`)
      if (!(fin.vu.lignes > 0 && Number(fin.vu.premier) > 49990 && Number(fin.vu.premier) < 50020)) ecarts.push(`liste ${c} : la fenêtre ne suit pas le défilement (${JSON.stringify(fin.vu)})`)
    }
    assert.deepEqual(ecarts, [])
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })

  it('une fenêtre écrite par la page est ramenée à la zone visible sans attendre un défilement', async () => {
    const { ctx, page, erreurs, repos } = await ouvrir()
    await page.evaluate('__vp(\'brut\').scrollTop = 2000000')
    await repos(); await repos()
    const avant: any = await page.evaluate('__seenMark(\'brut\')')
    // la page pose un début au-delà de la fin : sa boucle ne dessinerait plus rien, le défilement n'a pas bougé
    await page.evaluate(`__page().poser(${Number(avant.premier) + 500})`)
    await repos()
    const apres: any = await page.evaluate('__seenMark(\'brut\')')
    assert.deepEqual(apres, avant, 'la fenêtre revient à la zone visible')
    assert.deepEqual(erreurs, [])
    await ctx.close()
  })
})
