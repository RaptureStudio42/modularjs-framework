// en production, trois moteurs : la mise à jour d'un <@head> passe par un reffet dont les lectures sont notées au graphe des signaux
// (`$[(µ._mjs_sigCur && µ._mjs_sigRead(_mjsThis, 'titre'), 'titre')]`) ; le titre du document et un <meta> lié suivent leurs
// variables après un changement, le reffet du composant repart une fois, et la page ne lève rien
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = `<@head>
  <title>{$titre}</title>
  <meta name="description" content={$desc}>
</@head>

<script>
$titre = 'Premier'
$desc = 'un'
changer = ->
  $titre = 'Second'
  $desc = 'deux'
µeffect ->
  window.__passages = (window.__passages or 0) + 1
  window.__vu = $titre
</script>
<button class="change" @click={changer}>+</button>
`
let construit: Promise<Map<string, Buffer>> | null = null
const construire = (): Promise<Map<string, Buffer>> => construit ??= (async () => {
  const root = mjsTmp('tete-titre-meta'), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), js: 'split', env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const f of readdirSync(outDir, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
  return fichiers
})()
after(async () => { await terminateSharedWorkerPool() })
for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@head> lié, reffets sur le graphe (${nom})`, function () {
  this.timeout(90000)
  let browser: any = null
  let page: any    = null
  const erreurs: string[] = []
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) { this.skip(); return }
    const fichiers = await construire()
    browser = await playwright[nom].launch()
    page    = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
    await page.route('http://localhost/**', async (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (chemin.startsWith('/out/')) { const f = fichiers.get(chemin.slice(5)); await route.fulfill(f ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>' })
    })
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && h._shadow.querySelector('.change')) })()`, null, { timeout: 30000 })
  })
  after(async () => { if (browser) await browser.close() })
  const lire = () => page.evaluate(`({ titre: document.title, desc: (document.head.querySelector('meta[name="description"]') || {}).content, passages: window.__passages, vu: window.__vu })`)
  it('au montage : titre et <meta> posés, le reffet passe une fois', async () => {
    await page.waitForFunction(`document.title === 'Premier'`, null, { timeout: 5000 }).catch(() => {})
    assert.deepEqual(await lire(), { titre: 'Premier', desc: 'un', passages: 1, vu: 'Premier' })
  })
  it('après un changement : le titre et le <meta> suivent, le reffet repart une fois, aucune erreur', async () => {
    await page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.change').click()`)
    await page.waitForFunction(`document.title === 'Second'`, null, { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(50)
    assert.deepEqual(await lire(), { titre: 'Second', desc: 'deux', passages: 2, vu: 'Second' })
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })
})
