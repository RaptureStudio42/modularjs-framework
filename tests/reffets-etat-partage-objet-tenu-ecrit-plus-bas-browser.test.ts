// Dans un vrai navigateur, cœur minifié de production, cœur de développement et réglage `"proxy": false` : un composant qui tient par une
// variable `$` un objet d'un état partagé (`$lignes = µ$$compte.lignes`, `$ligne = session.lignes[0]`, `$donnees = µ$$feed.data`) voit son
// reffet repartir quand un autre composant écrit, par l'état, plus bas que l'objet tenu (`µ$$compte.lignes[0].q = 3`,
// `session.lignes[0].prix.ht = 4`, `µ$$feed.data.sous.n = 2`) : le reffet qui lit l'objet par sa variable passe, et sa valeur n'est pas
// périmée. Le reffet témoin lit les mêmes champs par l'état lui-même.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ETATS = `export µ$$compte = { lignes: [{ q: 1, prix: { ht: 1 } }] }
export µ$$feed = new µStore(sous: { n: 0 })
export session = µ.state({ lignes: [{ q: 1, prix: { ht: 1 } }] })
`
const IMPORTS = `  @import µ$$compte 'rop-etats.civet.mjs'
  @import µ$$feed 'rop-etats.civet.mjs'
  @import { session } 'rop-etats.civet.mjs'
`
const PANIER = `<script>
${IMPORTS}  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $x = 0
  $lignes = µ$$compte.lignes
  $ligne = session.lignes[0]
  $donnees = µ$$feed.data
  µeffect ->
    vu('total')
    t = 0
    t += l.q * l.prix.ht for l of $lignes
    window.__v.total = [$x, t].join()
  µeffect ->
    vu('prix')
    window.__v.prix = [$x, $ligne.prix.ht].join()
  µeffect ->
    vu('magasin')
    window.__v.magasin = [$x, $donnees.sous.n].join()
  µeffect ->
    vu('temoin')
    window.__v.temoin = [$x, µ$$compte.lignes[0].q, session.lignes[0].prix.ht, µ$$feed.data.sous.n].join()
</script>
<p>{µ$$compte.lignes[0].q} {session.lignes[0].prix.ht} {µ$$feed.data.sous.n}</p>
`
const ECRIT = `<script>
${IMPORTS}  @quantite = (v) -> µ$$compte.lignes[0].q = v
  @prix = (v) -> session.lignes[0].prix.ht = v
  @magasin = (v) -> µ$$feed.data.sous.n = v
</script>
<p>ecrit</p>
`

// un pas : un geste dans la page, le reffet qui doit repartir, les valeurs lues après lui
const PAS: [string, string, string, Record<string, string>][] = [
  ['liste d\'un µ$$x tenue par une variable : quantité d\'une ligne écrite par l\'état', "el('rop-ecrit').quantite(3)", 'total', { total: '0,3', prix: '0,1', magasin: '0,0', temoin: '0,3,1,0' }],
  ['ligne d\'un état de module tenue par une variable : prix écrit par l\'état', "el('rop-ecrit').prix(4)", 'prix', { total: '0,3', prix: '0,4', magasin: '0,0', temoin: '0,3,4,0' }],
  ['données d\'un µ$$x fait d\'un µStore tenues par une variable : champ écrit par l\'état', "el('rop-ecrit').magasin(2)", 'magasin', { total: '0,3', prix: '0,4', magasin: '0,2', temoin: '0,3,4,2' }],
]

type Mode = { nom: string, opts: Record<string, unknown> }
const MODES: Mode[] = [
  { nom: 'prod', opts: { env: 'prod', minify: true } },
  { nom: 'dev', opts: { env: 'dev', minify: false } },
  { nom: 'prod, "proxy": false', opts: { env: 'prod', minify: true, proxy: false } },
]

const construits = new Map<string, Promise<Buffer>>()
const construire = (mode: Mode): Promise<Buffer> => {
  if (!construits.has(mode.nom)) construits.set(mode.nom, (async () => {
    const root   = mjsTmp('reffets-objet-tenu-plus-bas-' + MODES.indexOf(mode))
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'rop-etats.civet.mjs'), ETATS)
    writeFileSync(join(srcDir, 'rop-panier.mjs'), PANIER)
    writeFileSync(join(srcDir, 'rop-ecrit.mjs'), ECRIT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', ...mode.opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(mode.nom)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`reffets devant un état partagé : objet tenu par une variable, écrit plus bas par l'état (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const mode of MODES) it(`${mode.nom} : le reffet qui lit l'objet tenu repart, aucune valeur périmée`, async () => {
    const bundle  = await construire(mode)
    const context = await browser.newContext()
    const page    = await context.newPage()
    const erreurs: string[] = []
    try {
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (chemin === '/out/bundle.js') { await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rop-ecrit></mjs-rop-ecrit><mjs-rop-panier></mjs-rop-panier><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      await page.waitForFunction(() => (window as any).__n.temoin === 1)
      await page.waitForTimeout(120)
      assert.deepEqual(await page.evaluate(() => ({ ...(window as any).__n })), { total: 1, prix: 1, magasin: 1, temoin: 1 })
      const vus: [string, boolean, Record<string, string>][] = []
      for (const [nom, geste, reffet] of PAS) {
        await page.evaluate(() => { for (const k in (window as any).__n) (window as any).__n[k] = 0 })
        await page.evaluate(`(() => { const el = (n) => document.querySelector('mjs-' + n); ${geste} })()`)
        await page.waitForTimeout(150)
        vus.push([nom, await page.evaluate((k: string) => (window as any).__n[k] >= 1, reffet), await page.evaluate(() => ({ ...(window as any).__v }))])
      }
      assert.deepEqual(vus, PAS.map(([nom, , , valeurs]) => [nom, true, valeurs]))
      assert.deepEqual(erreurs, [])
    }
    finally {
      await context.close()
    }
  })
})
