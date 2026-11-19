// dans Chromium, en développement et en production : `µajax?(…)` appelle µajax quand le même fichier écrit une clé calculée d'un
// magasin (`$$objs.find(…)[k].x = 5`) ; le relevé des briques du cœur garde le module de µajax à côté de cette clé
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' }
const SOURCE = `<script>
  $$objs = [{ id: 1, v: { x: 0 } }]
  $etat = 'attente'
  @ecrire = (k) -> $$objs.find((x) -> x.id == 1)[k].x = 5
  µmount ->
    try
      p = µajax?('/x')
      p?.catch?(->)
      $etat = 'appelé'
    catch e
      $etat = 'erreur: ' + e.message
</script>
<p class="etat">{$etat}</p>
`
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }]]

async function construire(nom: string, opts: any): Promise<string> {
  const root   = mjsTmp('ajax-cle-magasin-nav')
  const srcDir = join(root, 'src')
  const dist   = join(root, 'dist')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ajax-cle.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(dist, 'assets'), manifestPath: join(dist, 'assets', 'bundle.js'), urlPrefix: '/assets', js: 'bundle', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], nom)
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/assets/bundle.js"></script></head><body><mjs-ajax-cle></mjs-ajax-cle></body></html>')
  return dist
}

describe('µajax?(…) à côté d\'une clé calculée du magasin : appelé, en développement comme en production', function () {
  this.timeout(280000)
  let browser: Browser | null = null
  before(async () => { browser = await chromium.launch({ args: ['--no-proxy-server'] }) })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, opts] of REGLAGES) it(nom, async () => {
    const dist    = await construire(nom, opts)
    const page    = await browser!.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 200)))
    await page.route('http://mjs.test/**', (route: any) => {
      const chemin  = new URL(route.request().url()).pathname
      const fichier = join(dist, chemin === '/' ? 'index.html' : chemin)
      if (!fichier.startsWith(dist) || !existsSync(fichier)) return route.fulfill({ status: 404, body: 'introuvable' })
      return route.fulfill({ status: 200, contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
    })
    await page.goto('http://mjs.test/')
    const lire = "(() => { const el = document.querySelector('mjs-ajax-cle'); const r = el && (el._shadow || el.shadowRoot || el); return r?.querySelector('.etat')?.textContent ?? '' })()"
    try { await page.waitForFunction(lire + " !== '' && " + lire + " !== 'attente'", undefined, { timeout: 15000 }) }
    catch { throw new Error(`${nom} : le composant ne répond pas — erreurs : ${erreurs.join(' | ')}`) }
    const etat = await page.evaluate(lire)
    await page.close()
    assert.deepEqual(erreurs, [], `${nom} : erreurs de la page`)
    assert.equal(etat, 'appelé', `${nom} : µajax?(…) doit être appelé`)
  })
})
