// Dans un vrai navigateur, cœur minifié de production et cœur de développement, un composant abonné par son gabarit à un état de module :
// - un reffet qui lit l'état APRÈS son passage par une forme que le relevé de la construction ne voit pas repart quand l'état change, et sa
//   valeur n'est pas périmée : fonction rangée dans une variable `$` (`$lire()`), état rangé sur la fenêtre (`window.appSession.nom`),
//   paramètre qui porte le nom d'une fonction du script (`.then((lire) -> lire())`), fonction du script réaffectée plus tard ;
// - un reffet qui lit puis écrit le même état dans une branche prise plus tard (`if $ouvert then session.ouvertures = session.ouvertures + 1`),
//   dans un composant qui ne lit cet état nulle part ailleurs, passe une fois : le compteur vaut 1, aucune boucle.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ETATS = `export session = µ.state({ nom: 'x', ouvertures: 0 })
export lireNom = -> session.nom
`
const IMPORT = "  @import { session lireNom } 'rlt-etats.civet.mjs'\n"
const LIT = `<script>
${IMPORT}  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $y = 0
  $lire = -> session.nom
  window.appSession = session
  lire = -> 'rien'
  @muet = -> lire()
  relire = -> 'rien'
  µmount -> relire = -> session.nom
  µeffect ->
    vu('fonctionDollar')
    window.__v.y1 = $y
    µafter 5, -> window.__v.fonctionDollar = $lire()
  µeffect ->
    vu('fenetre')
    window.__v.y2 = $y
    µafter 5, -> window.__v.fenetre = window.appSession.nom
  µeffect ->
    vu('homonyme')
    window.__v.y3 = $y
    Promise.resolve(lireNom).then((lire) -> window.__v.homonyme = lire())
  µeffect ->
    vu('reaffectee')
    window.__v.y4 = $y
    µafter 5, -> window.__v.reaffectee = relire()
  µeffect ->
    vu('temoin')
    window.__v.temoin = [$y, session.nom].join()
</script>
<p>{session.nom}</p>
`
const COMPTE = `<script>
${IMPORT}  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $ouvert = false
  @ouvrir = -> $ouvert = true
  µeffect ->
    vu('ouvertures')
    if $ouvert then session.ouvertures = session.ouvertures + 1
</script>
<p>{$ouvert}</p>
`
const ECRIT = `<script>
${IMPORT}  @nom = (v) -> session.nom = v
  @ouvertures = -> session.ouvertures
</script>
<p>ecrit</p>
`
const TARD = ['fonctionDollar', 'fenetre', 'homonyme', 'reaffectee']

const construits = new Map<string, Promise<Buffer>>()
const construire = (env: string): Promise<Buffer> => {
  if (!construits.has(env)) construits.set(env, (async () => {
    const root   = mjsTmp('reffets-lecture-apres-coup-non-vue-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'rlt-etats.civet.mjs'), ETATS)
    writeFileSync(join(srcDir, 'rlt-lit.mjs'), LIT)
    writeFileSync(join(srcDir, 'rlt-compte.mjs'), COMPTE)
    writeFileSync(join(srcDir, 'rlt-ecrit.mjs'), ECRIT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(env)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`reffets devant un état partagé : lecture après coup que le relevé ne voit pas, état lu puis écrit dans une branche prise plus tard (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ['prod', 'dev']) describe(env, () => {
    let context: any, page: any
    const erreurs: string[] = []
    before(async () => {
      const bundle = await construire(env)
      context = await browser.newContext()
      page    = await context.newPage()
      page.setDefaultTimeout(8000)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
      await page.route('http://localhost/**', async (route: any) => {
        const chemin = new URL(route.request().url()).pathname
        if (chemin === '/out/bundle.js') { await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }); return }
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rlt-ecrit></mjs-rlt-ecrit><mjs-rlt-lit></mjs-rlt-lit><mjs-rlt-compte></mjs-rlt-compte><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      await page.waitForFunction(() => (window as any).__n.temoin === 1 && (window as any).__n.ouvertures === 1)
      await page.waitForTimeout(150)
    })
    after(async () => { if (context) await context.close() })

    it('le reffet qui lit l\'état après coup repart quand l\'état change, aucune valeur périmée', async () => {
      const vus: [string, string[], Record<string, string>][] = []
      for (const nom of ['y', 'z']) {
        await page.evaluate(() => { for (const k in (window as any).__n) (window as any).__n[k] = 0 })
        await page.evaluate(`document.querySelector('mjs-rlt-ecrit').nom('${nom}')`)
        await page.waitForTimeout(200)
        const passes  = await page.evaluate((l: string[]) => l.filter((k) => (window as any).__n[k] >= 1), TARD)
        const valeurs = await page.evaluate((l: string[]) => Object.fromEntries(l.map((k) => [k, (window as any).__v[k]])), TARD)
        vus.push([nom, passes, valeurs])
      }
      assert.deepEqual(vus, ['y', 'z'].map((nom) => [nom, TARD, Object.fromEntries(TARD.map((k) => [k, nom]))]))
    })

    it('le reffet qui lit puis écrit l\'état dans une branche prise plus tard passe une fois', async () => {
      await page.evaluate(() => { for (const k in (window as any).__n) (window as any).__n[k] = 0 })
      await page.evaluate(`document.querySelector('mjs-rlt-compte').ouvrir()`)
      await page.waitForTimeout(600)
      const passages   = await page.evaluate(() => (window as any).__n.ouvertures)
      const ouvertures = await page.evaluate(`document.querySelector('mjs-rlt-ecrit').ouvertures()`)
      assert.deepEqual({ passages, ouvertures, erreurs }, { passages: 1, ouvertures: 1, erreurs: [] })
    })
  })
})
