// un composant placé dans un lien `<a href>` qui lit un contexte (`§clé`, `§§clé`) une fois ce lien retiré de la page (dans `µsleep`, comme
// plus tard dans un minuteur ou une réponse réseau) : la remontée s'arrête au lien détaché et la lecture rend `undefined`, comme sous un
// `<div>` — aucune erreur. Le `host` d'un lien est l'hôte de son adresse, une chaîne : la remontée ne passe par `host` que depuis la racine
// d'une ombre. Chromium, Firefox et WebKit réels, en développement comme avec un vrai build de production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const HOTE = `<script>
  $montre   = true
  §theme    = 'sombre'
  §§reglage = { ton: 'doux' }
</script>

{if $montre}
  <a href="http://lien.test/ailleurs" class="lien"><@lecteur class="sous-lien"></@lecteur></a>
  <div class="bloc"><@lecteur class="sous-div"></@lecteur></div>
{end}
`

const LECTEUR = `<script>
  $vu = §theme

  µsleep ->
    try
      window.__lu = (window.__lu or []).concat([String(§theme) + '/' + String(§§reglage?.ton)])
    catch e
      window.__lu = (window.__lu or []).concat(['ERREUR ' + e.message])
</script>

<span class="t">{$vu}</span>
`

type Construit = { dev: string, prod: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement et les morceaux du build de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('contexte-sous-lien')
    const compiler = async (nom: string, opts: Record<string, unknown>, manifeste: string) => {
      const srcDir = join(root, nom, 'src')
      const outDir = join(root, nom, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
      writeFileSync(join(srcDir, 'lecteur.mjs'), LECTEUR)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste || join(outDir, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    }
    const manifeste = join(root, 'dev', 'bundle.js')
    const dev       = assembler(await compiler('dev', {}, manifeste), manifeste)
    const prodDir   = await compiler('prod', { js: 'split', env: 'prod' }, '')
    const prod      = new Map<string, Buffer>()
    for (const f of readdirSync(prodDir)) if (/\.(js|json)$/.test(f)) prod.set(f, readFileSync(join(prodDir, f)))
    assert.ok(prod.has('bundle.js'), 'le build de production a son manifeste')
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`contexte lu sous un lien retiré de la page (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit
  let build: 'dev' | 'prod' = 'dev'
  const erreurs: string[] = []

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage()
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route('http://lien.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod.get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      const script = build === 'dev' ? `<script>${fait.dev.replace(/<\/script/gi, '<\\/script')}</script>` : '<script type="module" src="/out/bundle.js"></script>'
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${script}</body></html>` })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const b of ['dev', 'prod'] as const) describe(b === 'dev' ? 'développement' : 'production', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      build          = b
      erreurs.length = 0
      await page.goto('http://lien.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => {
        const h = document.querySelector('mjs-hote')
        const l = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-lecteur')) : []
        return l.length === 2 && l.every((x) => x._shadow && x._shadow.querySelector('.t') && x._shadow.querySelector('.t').textContent === 'sombre')
      })()`, undefined, { timeout: 60000 })
    })

    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => b === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('le lien et le bloc retirés, le lecteur sous le lien lit `undefined` comme celui sous le bloc, sans erreur', async function () {
      const lu = await page.evaluate(`(async () => {
        window.__lu = []
        document.querySelector('mjs-hote')._set('montre', false)
        await new Promise((r) => setTimeout(r, 400))
        return window.__lu
      })()`)
      assert.deepEqual(lu, ['undefined/undefined', 'undefined/undefined'], 'deux lectures, aucune erreur')
    })
  })
})
