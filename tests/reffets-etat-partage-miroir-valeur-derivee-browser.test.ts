// Le miroir vivant d'un composant (`µclone el, mirror: true`) partage ses valeurs dérivées avec l'original. Quand une valeur dérivée est
// faite d'un état partagé (`$page = µurl.path + $suffixe`) et que l'original la refait le premier, le reffet du miroir qui la lit passe
// quand même à chaque changement de cet état : la dernière valeur qu'il a vue est celle de l'écran. Défaut garanti absent : le doute était
// marqué sur le seul composant qui refait la valeur, le reffet du miroir restait sur la valeur d'avant, sans un mot. Chromium, Firefox et
// WebKit, cœur minifié de production et cœur de développement

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CARTE = `<script>
  moi = (window.__seq = (window.__seq or 0) + 1)
  $x = 0
  $suffixe = '!'
  $page = µurl.path + $suffixe
  @ecrireX = (v) -> $x = v
  µeffect ->
    window.__n['page' + moi] = (window.__n['page' + moi] or 0) + 1
    window.__v['page' + moi] = [$x, $page].join()
</script>
<p class="carte">{µurl.path} {$page} {$x}</p>
`
const HOTE = `<script>
  µmount ->
    window.__miroir = -> µclone @@_shadow.querySelector('mjs-rm-carte'), mirror: true
</script>
<@rm-carte></@rm-carte>
`

const construits = new Map<string, Promise<Buffer>>()
const construire = (env: string): Promise<Buffer> => {
  if (!construits.has(env)) construits.set(env, (async () => {
    const root   = mjsTmp('reffets-miroir-valeur-derivee-' + env)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'rm-carte.mjs'), CARTE)
    writeFileSync(join(srcDir, 'rm-hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: env === 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return readFileSync(join(outDir, 'bundle.js'))
  })())
  return construits.get(env)!
}

after(async () => { await terminateSharedWorkerPool() })

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`le reffet d'un miroir suit la valeur dérivée faite d'un état partagé (${moteur})`, function () {
  this.timeout(180000)
  let browser: any = null
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => { if (browser) await browser.close() })

  for (const env of ['prod', 'dev']) it(`${env} : l'original et son miroir voient chaque adresse`, async () => {
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
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-rm-hote></mjs-rm-hote><script>window.__n = {}; window.__v = {}</script><script type="module" src="/out/bundle.js"></script></body></html>' })
      })
      await page.goto('http://localhost/app#/a', { waitUntil: 'load' })
      await page.waitForFunction(() => (window as any).__n.page1 === 1 && typeof (window as any).__miroir === 'function')
      await page.evaluate(() => { const m = (window as any).__miroir(); m.id = 'miroir'; document.body.appendChild(m) })
      await page.waitForFunction(() => (window as any).__n.page2 === 1)
      const vus = () => page.evaluate(() => ({ original: (window as any).__v.page1, miroir: (window as any).__v.page2 }))
      assert.deepEqual(await vus(), { original: '0,/a!', miroir: '0,/a!' })
      for (const adresse of ['/b', '/c']) {
        await page.evaluate((a: string) => { location.hash = '#' + a }, adresse)
        await page.waitForTimeout(120)
        assert.deepEqual(await vus(), { original: `0,${adresse}!`, miroir: `0,${adresse}!` }, `après la navigation vers ${adresse}`)
      }
      // une variable écrite dans le miroir : les deux reffets passent, puis suivent encore l'adresse
      await page.evaluate(() => (document.getElementById('miroir') as any).ecrireX(1))
      await page.waitForTimeout(120)
      assert.deepEqual(await vus(), { original: '1,/c!', miroir: '1,/c!' })
      await page.evaluate(() => { location.hash = '#/d' })
      await page.waitForTimeout(120)
      assert.deepEqual(await vus(), { original: '1,/d!', miroir: '1,/d!' })
      assert.deepEqual(erreurs, [])
    }
    finally {
      await context.close()
    }
  })
})
