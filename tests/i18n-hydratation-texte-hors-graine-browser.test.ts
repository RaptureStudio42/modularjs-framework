// Page rendue par le serveur puis reprise par hydratation (le HTML reçu est adopté, pas vidé) : un texte absent de la graine
// (clé racine que seul le navigateur lit) ne disparaît pas pour rien, et le texte final est juste, dans un vrai Chromium.
//
// Le fichier de langue est retardé (700 ms) pour que l'attente se voie ; le texte du module est relevé à chaque image.
// Le module ne reçoit ni retenue ni indicateur, et son texte final est juste. Le texte que la graine ne porte pas (la clé racine,
// que le serveur ne lit pas ici) arrive avec le fichier de langue ; le texte de la graine, lui, reste affiché tout du long. Les textes
// racine que le serveur lit sont dans la graine (voir i18n-graine-cles-racine-browser.test.ts).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { resolveBundlerOpts } from '../src/bundler/config.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

for (const mode of ['markers', 'positional', 'diff'] as const) for (const placeholder of ['wait', '*skeleton'] as const) describe(`hydratation ${mode}, texte hors graine, placeholder ${placeholder} (Chromium)`, function () {
  this.timeout(180000)
  let browser: any = null
  let server: Server | null = null
  let base = ''
  let renderer: any = null
  let htmlServeur = ''

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    const root   = mjsTmp('i18n-hydratation-hors-graine')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'client')
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour accueil\n')
    writeFileSync(join(srcDir, 'home.mjs'), '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {if not µ.server}{µt(\'/titre\')}{end}</h1>\n')
    const config: any = {
      sourceDir: 'src', outputDir: 'out',
      i18n: { default: 'fr', placeholder },
    }
    // le HTML vient du moteur navigateur, le client est un build à part qui porte la reprise
    renderer = await createBrowserRenderer(config, { configDir: root })
    const clientConfig = { ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client', runtime: ['hydrate', 'i18n'], js: 'split' }
    const client = new Bundler({ ...resolveBundlerOpts(clientConfig, root), env: 'prod' } as any)
    const stats = await client.compile()
    await client.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: mode })
    assert.match(res.html.replace(/<!--[^>]*-->/g, ''), /Bonjour accueil \/ /, 'le serveur a rendu le texte de la section')
    assert.match(res.hydrateScript, /__mjs_ssrHydrate/, 'la page demande la reprise par hydratation')
    htmlServeur = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body>${res.hydrateScript}${res.sharedScript}${res.html}</body></html>`
    server = createServer((req, resp) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/') {
        resp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        resp.end(htmlServeur)
        return
      }
      const fichier = join(root, normalize(chemin))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { resp.writeHead(404); resp.end(); return }
      const envoyer = () => {
        resp.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
        resp.end(readFileSync(fichier))
      }
      if (/\/mjs_i18n-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 700)
      else envoyer()
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })

  after(async function () {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    if (renderer) await renderer.close()
    await terminateSharedWorkerPool()
  })

  it('le texte du serveur ne disparaît pas pour rien, le texte final est juste', async function () {
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    await page.addInitScript(() => {
      const w = window as any
      w.__vus = []
      w.__signes = []
      const tick = () => {
        const h = document.querySelector('mjs-home') as any
        const r = h && (h._shadow || h.shadowRoot)
        const t = r && r.querySelector('h1.t')
        if (t) {
          const v = t.textContent
          if (w.__vus.length === 0 || w.__vus[w.__vus.length - 1] !== v) w.__vus.push(v)
        }
        if (h && h.hasAttribute('mjs-loading') && !w.__signes.includes('mjs-loading')) w.__signes.push('mjs-loading')
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    try {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.waitForTimeout(2500)
      const vus: string[] = await page.evaluate(() => (window as any).__vus)
      const signes: string[] = await page.evaluate(() => (window as any).__signes)
      assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
      assert.equal(vus[vus.length - 1], 'Bonjour accueil / Titre', `texte final : ${JSON.stringify(vus)}`)
      assert.equal(vus.every(v => v.startsWith('Bonjour accueil')), true, `le texte de la graine ne disparaît jamais : ${JSON.stringify(vus)}`)
      assert.deepEqual(signes, [], 'aucune retenue posée sur l\'hôte repris')
    }
    finally { await page.close() }
  })
})
