// Dans un vrai navigateur, cœur minifié de production et cœur de développement : un composant redessiné parce qu'un état partagé a changé
// (un champ d'un `µ$$x`, une clé d'un `µStore`) ne fait passer que les reffets qui ont lu cet état à leur dernier
// passage (au nom près pour un `µ$$x`), ceux du doute (état nommé dans une minuterie) et ceux qui n'ont lu ni variable ni clé du magasin. Le reffet qui
// ne lit qu'une clé du magasin, le reffet d'avant l'écran et celui qui ne lit qu'une variable `$` ne passent pas. Les états sont écrits par
// une méthode du composant ; `µonline`, que le composant affiche, ne change pas ici (un événement `offline` envoyé à la main ne le change pas
// dans Chromium) : ses lecteurs ne passent que pour le doute ou pour leur règle.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ETATS = `export µ$$compte = { a: 0, b: 0 }
export µ$$feed = new µStore(version: 0)
`
const COQUILLE = `<script>
  @import µ$$compte 'nb-etats.civet.mjs'
  @import µ$$feed 'nb-etats.civet.mjs'
  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $x = 0
  @ecrireX = (v) -> $x = v
  @ecrireA = (v) -> µ$$compte.a = v
  @ecrireB = (v) -> µ$$compte.b = v
  @ecrireVersion = (v) -> µ$$feed.data.version = v
  @ecrireRel = (v) -> $$rel = v
  µeffect ->
    vu('rel')
    window.__v.rel = $$rel
  µeffect.before ->
    vu('avant')
    window.__v.avant = $$rel
  µeffect ->
    vu('local')
    window.__v.local = $x
  µeffect ->
    vu('reseau')
    window.__v.reseau = [$x, µonline].join()
  µeffect ->
    vu('cleA')
    window.__v.cleA = [$x, µ$$compte.a].join()
  µeffect ->
    vu('cleB')
    window.__v.cleB = [$x, µ$$compte.b].join()
  µeffect ->
    vu('magasin')
    window.__v.magasin = [$x, µ$$feed.data.version].join()
  µeffect ->
    vu('apres')
    v = $x
    µafter 5, -> window.__v.apres = [v, µonline].join()
  µeffect ->
    vu('seul')
    window.__v.seul = µonline
</script>
<p>{µonline} {$x} {µ$$compte.a} {µ$$compte.b} {µ$$feed.data.version}</p>
`

// un pas : un geste dans la page, et ce qui passe
const PAS: [string, string, Record<string, number>][] = [
  ['clé b écrite', 'el.ecrireB(1)', { cleA: 1, cleB: 1, apres: 1, seul: 1 }],
  ['clé a écrite', 'el.ecrireA(1)', { cleA: 1, cleB: 1, apres: 1, seul: 1 }],
  ['µStore écrit', 'el.ecrireVersion(1)', { magasin: 1, apres: 1, seul: 1 }],
  ['clé du magasin écrite', 'el.ecrireRel("rouge")', { rel: 1, avant: 1, seul: 1 }],
  ['variable $x écrite', 'el.ecrireX(1)', { local: 1, reseau: 1, cleA: 1, cleB: 1, magasin: 1, apres: 1, seul: 1 }],
]

const construits = new Map<string, Promise<Buffer>>()
const construire = (env: string): Promise<Buffer> => {
  if (!construits.has(env)) construits.set(env, (async () => {
    const root   = mjsTmp('reffets-etat-lu-navigateur-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'nb-etats.civet.mjs'), ETATS)
    writeFileSync(join(srcDir, 'nb-coquille.mjs'), COQUILLE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(env)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`composant redessiné par un état partagé : seuls passent les reffets qui l'ont lu (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ['prod', 'dev']) it(`${env} : passages comptés pas à pas`, async () => {
    const bundle  = await construire(env)
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
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-nb-coquille></mjs-nb-coquille><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      await page.waitForFunction(() => { const e: any = document.querySelector('mjs-nb-coquille'); return !!e && !!(e._shadow || e).querySelector('p') && (window as any).__n.seul === 1 })
      await page.waitForTimeout(60)
      const montage = await page.evaluate(() => ({ ...(window as any).__n }))
      assert.deepEqual(montage, { rel: 1, avant: 1, local: 1, reseau: 1, cleA: 1, cleB: 1, magasin: 1, apres: 1, seul: 1 })
      const vus: [string, Record<string, number>][] = []
      for (const [nom, geste] of PAS) {
        await page.evaluate(() => { for (const k in (window as any).__n) (window as any).__n[k] = 0 })
        await page.evaluate(`(() => { const el = document.querySelector('mjs-nb-coquille'); ${geste} })()`)
        await page.waitForTimeout(80)
        vus.push([nom, await page.evaluate(() => { const d: Record<string, number> = {}; for (const k in (window as any).__n) if ((window as any).__n[k] !== 0) d[k] = (window as any).__n[k]; return d })])
      }
      assert.deepEqual(vus, PAS.map(([nom, , attendu]) => [nom, attendu]))
      // `reseau`, `apres` et `seul` portent la valeur de `µonline`, propre au moteur : seules les autres sont comparées
      const { rel, avant, local, cleA, cleB, magasin } = await page.evaluate(() => (window as any).__v)
      assert.deepEqual({ rel, avant, local, cleA, cleB, magasin }, { rel: 'rouge', avant: 'rouge', local: 1, cleA: '1,1', cleB: '1,1', magasin: '1,1' })
      assert.deepEqual(erreurs, [])
    }
    finally {
      await context.close()
    }
  })
})
