// Dans un vrai navigateur, cœur minifié de production et cœur de développement : un reffet qui, après son passage, passe un état partagé en
// valeur (`JSON.stringify(session)` dans une minuterie), appelle une fonction importée qui le lit ou passe une méthode qui le lit est dans
// le doute, il passe à chaque rendu demandé par un état partagé ; un composant qui tient par une variable `$` la liste d'un `µStore` fait
// passer tous ses reffets quand ce magasin écrit dans cette liste ; un rappel qui lit le document sort de la liste blanche du relevé : doute
// aussi ; un état lu pour la première fois dans une branche prise plus tard n'abonne pas son composant. Le reffet qui ne lit qu'une clé du
// magasin, et dont le code différé ne fait qu'écrire une variable `$`, ne passe pas.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const VU    = `vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
`
const ETATS = `export session = µ.state({ nom: 'x' })
export panier = new µStore(total: 0, lignes: [])
export nomCourant = -> session.nom
`
const COQUILLE = `<script>
  @import { session panier nomCourant } 'rdn-etats.civet.mjs'
  ${VU}  $x = 0
  $pret = false
  $lignes = panier.data.lignes
  @afficher = -> window.__v.methode = session.nom
  @ecrireNom = (v) -> session.nom = v
  @pousser = (v) -> panier.data.lignes.push(v)
  @ecrireRel = (v) -> $$rel = v
  µeffect ->
    vu('valeur')
    v = $x
    µafter 5, -> window.__v.valeur = [v, JSON.stringify(session)].join()
  µeffect ->
    vu('importee')
    v = $x
    await Promise.resolve()
    window.__v.importee = [v, nomCourant()].join()
  µeffect ->
    vu('methode')
    v = $x
    µafter 5, @@afficher
  µeffect ->
    vu('tenu')
    window.__v.tenu = [$x, $lignes.length].join()
  µeffect ->
    vu('theme')
    window.__v.theme = $$rel
    papier = -> document.title
    requestAnimationFrame(-> window.__v.themeImage = papier())
  µeffect ->
    vu('sobre')
    window.__v.sobre = $$rel
    µafter 5, -> $pret = true
  µeffect ->
    vu('local')
    window.__v.local = $x
</script>
<p>{session.nom} {panier.data.lignes.length}</p>
`
const TARD = `<script>
  @import { session } 'rdn-etats.civet.mjs'
  ${VU}  $mode = false
  @ecrireMode = (v) -> $mode = v
  µeffect ->
    vu('tard')
    window.__v.tard = if $mode then session.nom else 'non prise'
</script>
<p>{$mode}</p>
`

// un pas : un geste dans la page, et les reffets qui passent
const DOUTE = ['importee', 'methode', 'theme', 'valeur']
const PAS: [string, string, string[]][] = [
  ['état de module écrit', "el('rdn-coquille').ecrireNom('y')", DOUTE],
  ['liste du µStore tenue par une variable : ligne ajoutée', "el('rdn-coquille').pousser('l1')", [...DOUTE, 'local', 'sobre', 'tenu'].sort()],
  ['branche prise plus tard', "el('rdn-tard').ecrireMode(true)", ['tard']],
  ['état de module écrit ensuite', "el('rdn-coquille').ecrireNom('z')", DOUTE],
  ['clé du magasin écrite', "el('rdn-coquille').ecrireRel('r')", ['sobre', 'theme']],
]

const construits = new Map<string, Promise<Buffer>>()
const construire = (env: string): Promise<Buffer> => {
  if (!construits.has(env)) construits.set(env, (async () => {
    const root   = mjsTmp('reffets-doute-apres-coup-navigateur-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'rdn-etats.civet.mjs'), ETATS)
    writeFileSync(join(srcDir, 'rdn-coquille.mjs'), COQUILLE)
    writeFileSync(join(srcDir, 'rdn-tard.mjs'), TARD)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(env)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`reffets devant un état partagé : doute après coup, objet d'un magasin tenu, branche prise plus tard (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ['prod', 'dev']) it(`${env} : reffets passés pas à pas, aucune valeur périmée`, async () => {
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
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rdn-coquille></mjs-rdn-coquille><mjs-rdn-tard></mjs-rdn-tard><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/', { waitUntil: 'load' })
      await page.waitForFunction(() => (window as any).__n.local === 1 && (window as any).__n.tard === 1)
      await page.waitForTimeout(120)
      assert.deepEqual(await page.evaluate(() => ({ ...(window as any).__n })), { valeur: 1, importee: 1, methode: 1, tenu: 1, theme: 1, sobre: 1, local: 1, tard: 1 })
      const vus: [string, string[]][] = []
      for (const [nom, geste] of PAS) {
        await page.evaluate(() => { for (const k in (window as any).__n) (window as any).__n[k] = 0 })
        await page.evaluate(`(() => { const el = (n) => document.querySelector('mjs-' + n); ${geste} })()`)
        await page.waitForTimeout(150)
        vus.push([nom, await page.evaluate(() => Object.keys((window as any).__n).filter((k) => (window as any).__n[k] !== 0).sort())])
      }
      assert.deepEqual(vus, PAS.map(([nom, , attendu]) => [nom, attendu]))
      const { valeur, importee, methode, tenu, tard, theme } = await page.evaluate(() => (window as any).__v)
      assert.deepEqual({ valeur, importee, methode, tenu, tard, theme }, { valeur: '0,{"nom":"z"}', importee: '0,z', methode: 'z', tenu: '0,1', tard: 'y', theme: 'r' })
      assert.deepEqual(erreurs, [])
    }
    finally {
      await context.close()
    }
  })
})
