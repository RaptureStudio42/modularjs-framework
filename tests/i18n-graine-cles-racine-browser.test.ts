// Page rendue par le serveur : la graine `#__mjs_i18n` porte aussi les textes RACINE (clé hors section) que la page a lus, et ceux-là
// seulement. Un module qui lit une clé racine paraît aussitôt avec tous ses textes et n'en perd aucun le temps que le fichier de langue
// arrive, quel que soit le réglage `placeholder` (`wait`, `*loader`, `*skeleton`) : Chromium, Firefox et WebKit réels.
//
// Le fichier de langue est retardé (700 ms) pour que l'attente se voie ; le texte du module est relevé à chaque image
// (`requestAnimationFrame`), depuis la première. Deux chemins : page prérendue (moteur happy-dom) et page reprise par hydratation
// (HTML du moteur navigateur).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'
const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']

async function lancer(nom: Moteur): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) return null
    return await playwright[nom].launch()
  }
  catch {
    return null
  }
}

const HOME   = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')} / {µt(\'/landing.haut\')}</h1>\n'
const FINAL  = 'Bonjour accueil / Titre / Haut'
const FR     = 'titre: Titre\nautre: Autre texte\nlanding:\n  haut: Haut\n  bas: Bas\n'
const PLACEHOLDERS = [undefined, '*loader(bloom)', '*skeleton'] as const

function projet(nomTmp: string, placeholder: string | undefined, render: any): { root: string, srcDir: string, config: any } {
  const root   = mjsTmp(nomTmp)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), FR)
  writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title', landing: { haut: 'Top', bas: 'Bottom' } }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ salut: 'Hello home' }))
  writeFileSync(join(srcDir, 'home.mjs'), HOME)
  const i18n: any = { default: 'fr', urlParam: true }
  if (placeholder) i18n.placeholder = placeholder
  const config = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n, ...render }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return { root, srcDir, config }
}

// serveur de la page : le fichier de langue traîne, l'attente se voit
function servir(root: string, outDir: string, page: string): Promise<Server> {
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    if (/\/mjs_i18n-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 700)
    else envoyer()
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// relève le texte du module à chaque image, et note tout signe d'attente posé sur l'hôte
async function relever(browser: any, url: string): Promise<{ vus: string[], signes: string[], erreurs: string[] }> {
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
      if (document.querySelector('[mjs-i18n-loader]') && !w.__signes.includes('loader')) w.__signes.push('loader')
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
    await page.waitForTimeout(2500)
    const vus: string[] = await page.evaluate(() => (window as any).__vus)
    const signes: string[] = await page.evaluate(() => (window as any).__signes)
    return { vus, signes, erreurs }
  }
  finally { await page.close() }
}

function graineDe(html: string): any {
  const m = html.match(/<script[^>]*id="__mjs_i18n"[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(m, 'la page porte sa graine de traduction')
  return JSON.parse(m![1])
}

describe('graine : textes racine lus par la page (Chromium, Firefox, WebKit)', function () {
  this.timeout(240000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  for (const placeholder of PLACEHOLDERS) {
    describe(`page prérendue, placeholder ${placeholder ?? 'wait (défaut)'}`, function () {
      let server: Server | null = null
      let base = ''
      let corps = ''

      before(async function () {
        const { root } = projet('i18n-graine-racine-prerendu', placeholder, { render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' } } } })
        const found = findConfig(root)!
        const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
        await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
        await bundler.close()
        corps = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
        server = await servir(root, join(root, 'out'), `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`)
        base = `http://127.0.0.1:${(server.address() as any).port}`
      })

      after(async function () {
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      it('la graine porte les clés racine lues, et elles seules', function () {
        const graine = graineDe(corps)
        assert.deepEqual(graine.root, { fr: { titre: 'Titre', landing: { haut: 'Haut' } } })
        assert.deepEqual(graine.sections, { fr: { accueil: { salut: 'Bonjour accueil' } } })
      })

      for (const m of MOTEURS) {
        it(`${m} : le texte racine ne disparaît jamais`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const { vus, signes, erreurs } = await relever(navigateurs[m], base + '/')
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          assert.deepEqual(signes, [], 'aucun indicateur ni retenue posé sur l\'hôte prérendu')
          assert.deepEqual(vus, [FINAL], `une seule valeur, jamais de trou : ${JSON.stringify(vus)}`)
        })
      }
    })
  }

  for (const placeholder of ['wait', '*skeleton'] as const) {
    describe(`page reprise par hydratation, placeholder ${placeholder}`, function () {
      let server: Server | null = null
      let base = ''
      let renderer: any = null
      let html = ''

      before(async function () {
        const { root, config } = projet('i18n-graine-racine-hydrate', placeholder, {})
        renderer = await createBrowserRenderer(config, { configDir: root })
        const clientConfig = { ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client', runtime: ['hydrate', 'i18n'], js: 'split' }
        const client = new Bundler({ ...resolveBundlerOpts(clientConfig, root), env: 'prod' } as any)
        const stats = await client.compile()
        await client.close()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
        assert.match(res.html.replace(/<!--[^>]*-->/g, ''), new RegExp(FINAL), 'le serveur a rendu les trois textes')
        html = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body>${res.hydrateScript}${res.sharedScript}${res.html}</body></html>`
        server = await servir(root, join(root, 'client'), html)
        base = `http://127.0.0.1:${(server.address() as any).port}`
      })

      after(async function () {
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
        if (renderer) await renderer.close()
      })

      it('la graine porte les clés racine lues, et elles seules', function () {
        const graine = graineDe(html)
        assert.deepEqual(graine.root, { fr: { titre: 'Titre', landing: { haut: 'Haut' } } })
      })

      for (const m of MOTEURS) {
        it(`${m} : le texte racine ne disparaît jamais`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const { vus, signes, erreurs } = await relever(navigateurs[m], base + '/')
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          assert.deepEqual(signes, [], 'aucune retenue posée sur l\'hôte repris')
          assert.deepEqual(vus, [FINAL], `une seule valeur, jamais de trou : ${JSON.stringify(vus)}`)
        })
      }
    })
  }
})
