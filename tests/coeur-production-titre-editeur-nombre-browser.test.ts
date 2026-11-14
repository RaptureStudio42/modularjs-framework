// en production, trois moteurs : µt à paramètre (%{a}) dans <@head><title>, puis réactif ; <@@editor autofocus> au bas d'une page
// haute (aucun défilement de la fenêtre) ; <@@number step="1" decimals="2"> après une saisie au clavier (7,25)
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = `<@head>
  <title>{µt('titre', { a: $n })}</title>
</@head>

<script>
$n = 1
$q = 7.5
</script>
<button class="plus" @click={$n++}>+</button>
<form class="f" :noUJS>
  <@@number class="pas" name="pas" value=!{$q} min="0" max="999999999" step="1" decimals="2"></@@number>
</form>
<div class="haut"></div>
<@@editor class="ed" autofocus></@@editor>

<style>
.haut
  height: 2400px
</style>
`
let construit: Promise<Map<string, Buffer>> | null = null
const construire = (): Promise<Map<string, Buffer>> => construit ??= (async () => {
  const root = mjsTmp('variante-d707'), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n'), { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: "Bienvenue %{a}"\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), js: 'split', env: 'prod', i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const f of readdirSync(outDir, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
  return fichiers
})()
after(async () => { await terminateSharedWorkerPool() })
for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`variante D707 (${nom})`, function () {
  this.timeout(90000)
  let browser: any = null
  let page: any    = null
  const erreurs: string[] = []
  before(async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) { this.skip(); return }
    const fichiers = await construire()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
    await page.route('http://localhost/**', async (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (chemin.startsWith('/out/')) { const f = fichiers.get(chemin.slice(5)); await route.fulfill(f ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>' })
    })
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => { const h = document.querySelector('mjs-hote'); const r = h && h._shadow; return !!(r && r.querySelector('.pas') && r.querySelector('.pas')._shadow && r.querySelector('.pas')._shadow.querySelector('input') && r.querySelector('.ed') && r.querySelector('.ed')._shadow) })()`, null, { timeout: 30000 })
    await page.evaluate(`window.__hote = () => document.querySelector('mjs-hote')._shadow; window.__champ = (c) => __hote().querySelector('.' + c)._shadow.querySelector('input')`)
  })
  after(async () => { if (browser) await browser.close() })
  it('titre : le paramètre arrive dans le texte (Bienvenue 1), puis suit $n (Bienvenue 2)', async () => {
    await page.waitForFunction(`document.title === 'Bienvenue 1'`, null, { timeout: 5000 }).catch(() => {})
    assert.equal(await page.title(), 'Bienvenue 1')
    await page.evaluate(`__hote().querySelector('.plus').click()`)
    await page.waitForFunction(`document.title === 'Bienvenue 2'`, null, { timeout: 5000 }).catch(() => {})
    assert.equal(await page.title(), 'Bienvenue 2')
  })
  it('éditeur autofocus au bas d\'une page haute : focus dedans, la fenêtre n\'a pas défilé', async () => {
    await page.waitForFunction(`__hote().activeElement === __hote().querySelector('.ed')`, null, { timeout: 5000 }).catch(() => {})
    const etat = await page.evaluate(`({ focus: __hote().activeElement === __hote().querySelector('.ed'), page: Math.round(window.scrollY) })`)
    assert.deepEqual(etat, { focus: true, page: 0 })
  })
  it('step="1" decimals="2" : 7,25 tapé au clavier reste valide', async () => {
    await page.evaluate(`(() => { const i = __champ('pas'); i.focus({ preventScroll: true }); i.select() })()`)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('7,25')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(80)
    const etat = await page.evaluate(`(() => { const n = __hote().querySelector('.pas'); return { montre: __champ('pas').value, pas: n.validity.stepMismatch, invalide: n.matches(':invalid'), formulaire: __hote().querySelector('.f').checkValidity() } })()`)
    assert.deepEqual(etat, { montre: '7,25', pas: false, invalide: false, formulaire: true })
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })
})
