// Fichier de page et navigation interne, dans un vrai Chromium — pourquoi ce test existe.
//
// Mesuré sur le build de production du site : à l'arrivée sur une page par un lien interne, le
// fichier de page (`mjs_page-<slug>-….js`, préchargé par le lien du HTML reçu) était téléchargé mais
// jamais exécuté, et les composants de la page étaient redemandés un par un, en cascade (doc : 4
// niveaux ; accueil : 28 fichiers sur 7 niveaux). La fiche `__mjs_page` n'était lue qu'au démarrage.
//
// Ce que le test garde : on charge la page A (fichier de page de A), on suit un lien interne vers B ;
// les composants de B arrivent par le fichier de page de B, jamais par leurs fichiers séparés, et
// s'affichent sans erreur. Contre-épreuve : le même parcours par un chargement complet de B donne
// le même ensemble de requêtes de composants (le fichier de page seul).
// Tests d'unité de la fonction et de son branchement : navigation-interne-fichier-de-page.test.ts.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'

const SEPARES = /\/out\/(card|badge|home|extra|zebre|other)-[0-9a-z]{5}\.js$/

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

describe('navigation interne — le fichier de page de la page d\'arrivée est celui qui charge ses composants (Chromium)', function () {
  this.timeout(180000)
  let browser: any = null
  let server: Server | null = null
  let base = ''
  let pageA = ''
  let pageB = ''

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    const root   = mjsTmp('nav-fichier-de-page')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'card.mjs'), '<p class="card">carte</p>\n')
    writeFileSync(join(srcDir, 'badge.mjs'), '<b class="badge">neuf</b>\n')
    writeFileSync(join(srcDir, 'extra.mjs'), '<i class="extra">plus</i>\n')
    writeFileSync(join(srcDir, 'zebre.mjs'), '<u class="zebre">rayé</u>\n')
    writeFileSync(join(srcDir, 'home.mjs'), '<h1 class="t">accueil</h1>\n<mjs-card></mjs-card>\n<mjs-badge></mjs-badge>\n')
    writeFileSync(join(srcDir, 'other.mjs'), '<h2 class="o">autre</h2>\n<mjs-extra></mjs-extra>\n<mjs-zebre></mjs-zebre>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' }, '/autre': { component: 'mjs-other' } } },
    }, null, 2))
    const found = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
    await bundler.close()
    const pages = readdirSync(outDir).filter(f => /^mjs_page-/.test(f))
    pageA = pages.find(f => /^mjs_page-index-/.test(f))!
    pageB = pages.find(f => /^mjs_page-autre-/.test(f))!
    assert.ok(pageA && pageB, `un fichier de page par route, vus : ${pages.join(', ')}`)
    const corps = (url: string) => readFileSync(report.generated.find(g => g.url === url)!.file, 'utf-8')
    const coquille = (url: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><a id="lien" href="/autre">vers autre</a>${corps(url)}</body></html>`
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/' || chemin === '/autre') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(coquille(chemin))
        return
      }
      const fichier = join(root, normalize(chemin))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })

  after(async function () {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  async function observer(parcours: (page: any) => Promise<void>) {
    const page = await browser.newPage()
    const erreurs: string[] = []
    const js: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    page.on('request', (r: any) => { if (/\.js$/.test(new URL(r.url()).pathname)) js.push(new URL(r.url()).pathname) })
    try { await parcours(page) } finally { await page.close() }
    return { erreurs, js }
  }
  const definis = (page: any) => page.evaluate(() => ['mjs-extra', 'mjs-zebre', 'mjs-other'].filter(t => !!customElements.get(t)))

  it('lien interne de A vers B : les composants de B viennent du fichier de page de B, aucun fichier séparé redemandé', async () => {
    let apres: string[] = []
    const { erreurs, js } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.waitForTimeout(300)
      await page.evaluate(() => { (window as any).__marque = 'meme-document' })
      await page.click('#lien')
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.waitForTimeout(300)
      apres = await definis(page)
      assert.equal(new URL(page.url()).pathname, '/autre', 'l\'adresse a changé sans rechargement complet')
      assert.equal(await page.evaluate(() => (window as any).__marque), 'meme-document', 'échange par UJS, pas un nouveau document')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(apres, ['mjs-extra', 'mjs-zebre', 'mjs-other'])
    assert.ok(js.includes(`/out/${pageB}`), `le fichier de page de B doit être demandé (vues : ${js.join(' ')})`)
    const separes = js.filter(u => SEPARES.test(u))
    assert.deepEqual(separes, [], `aucun fichier séparé de composant, vus : ${separes.join(' ')}`)
  })

  it('contre-épreuve : un chargement complet de B demande les mêmes fichiers (le fichier de page seul)', async () => {
    const { erreurs, js } = await observer(async page => {
      await page.goto(base + '/autre', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
    })
    assert.deepEqual(erreurs, [])
    assert.ok(js.includes(`/out/${pageB}`))
    assert.deepEqual(js.filter(u => SEPARES.test(u)), [])
  })

  it('A puis B puis retour à A : tout reste défini, aucune erreur, pas de fichier séparé', async () => {
    const { erreurs, js } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.click('#lien')
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.goBack()
      await page.waitForTimeout(500)
      assert.equal(new URL(page.url()).pathname, '/')
      assert.equal(await page.evaluate(() => !!document.querySelector('mjs-home')), true, 'la page A est revenue')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(js.filter(u => SEPARES.test(u)), [], 'aucun fichier séparé non plus au retour')
    assert.equal(js.filter(u => u === `/out/${pageA}`).length, 1, 'le fichier de A n\'est pas redemandé au retour')
    assert.ok(basename(pageA) !== basename(pageB))
  })
})
