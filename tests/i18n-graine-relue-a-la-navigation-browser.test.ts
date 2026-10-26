// La graine de traduction du HTML reçu par un lien interne, dans un vrai Chromium — pourquoi ce test existe.
//
// Mesuré sur le build de production du site : le HTML prérendu d'une page porte une graine
// `#__mjs_i18n` avec les sections de traduction dont la page a besoin, mais elle n'était lue qu'au
// démarrage. Arrivé sur la page par un lien interne, le navigateur redemandait chaque section par
// requête (`i18n/<langue>/<nom>.json` ; doc : 4 requêtes, accueil : 14), lancées niveau par niveau à
// mesure que les composants se montaient.
//
// Ce que le test garde : on charge la page A, on suit un lien interne vers B ; aucune requête
// `i18n/…json` ne part pour les sections de B (rouge avant : une par section), et les textes de B
// s'affichent justes — en français, puis en anglais quand la graine de B porte aussi cette langue.
// Contre-épreuve : un chargement complet de B ne fait lui non plus aucune requête de section.
// Tests d'unité de la fonction et de son branchement : i18n-graine-relue-a-la-navigation.test.ts.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'

const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/

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

describe('navigation interne — la graine de traduction du HTML reçu évite les requêtes de section (Chromium)', function () {
  this.timeout(180000)
  let browser: any = null
  let server: Server | null = null
  let base = ''

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    const root   = mjsTmp('i18n-graine-nav')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title' }))
    for (const [nom, fr, en] of [['accueil', 'Bonjour accueil', 'Hello home'], ['autre', 'Bonjour autre', 'Hello other'], ['extra', 'Bonjour extra', 'Hello extra']]) {
      writeFileSync(join(srcDir, 'i18n', 'fr', `${nom}.yml`), `salut: ${fr}\n`)
      writeFileSync(join(srcDir, 'i18n', 'en', `${nom}.json`), JSON.stringify({ salut: en }))
    }
    writeFileSync(join(srcDir, 'extra.mjs'), "@i18n 'extra'\n<i class=\"extra\">{µt('salut')}</i>\n")
    writeFileSync(join(srcDir, 'home.mjs'), "@i18n 'accueil'\n<h1 class=\"t\">{µt('salut')}</h1>\n")
    writeFileSync(join(srcDir, 'other.mjs'), "@i18n 'autre'\n<h2 class=\"o\">{µt('salut')}</h2>\n<button class=\"en\" @click={µlang = 'en'}>en</button>\n<mjs-extra></mjs-extra>\n")
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      i18n: { default: 'fr' },
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' }, '/autre': { component: 'mjs-other' } } },
    }, null, 2))
    const found = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
    await bundler.close()
    const corps = (url: string) => readFileSync(report.generated.find(g => g.url === url)!.file, 'utf-8')
    // la graine de B porte aussi l'anglais : le cas d'une page rendue avec repli de langue
    const avecAnglais = (html: string) => html.replace(/(<script[^>]*id="__mjs_i18n"[^>]*>)([\s\S]*?)(<\/script>)/, (_m, a, json, c) => {
      const g = JSON.parse(json)
      g.sections.en = { autre: { salut: 'Hello other' }, extra: { salut: 'Hello extra' } }
      return a + JSON.stringify(g) + c
    })
    const coquille = (url: string, enPlus = false) => {
      const c = corps(url)
      return `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><a id="lien" href="/autre">vers autre</a>${enPlus ? avecAnglais(c) : c}</body></html>`
    }
    assert.ok(/id="__mjs_i18n"/.test(corps('/autre')), 'le prérendu de B porte sa graine de traduction')
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/' || chemin === '/autre') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        // la page `/` est servie normalement ; `/autre` reçue par un lien interne porte en plus l'anglais
        res.end(coquille(chemin, chemin === '/autre'))
        return
      }
      const fichier = join(root, normalize(chemin))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
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

  async function observer(parcours: (page: any, sections: string[]) => Promise<void>) {
    const page = await browser.newPage()
    const erreurs: string[] = []
    const sections: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    page.on('request', (r: any) => { const p = new URL(r.url()).pathname; if (SECTION.test(p)) sections.push(p) })
    try { await parcours(page, sections) } finally { await page.close() }
    return { erreurs, sections }
  }
  const texte = (page: any, sel: string) => page.evaluate((s: string) => {
    const o = document.querySelector('mjs-other') as any
    return (o && o._shadow ? o._shadow : o?.shadowRoot)?.querySelector(s)?.textContent?.trim() ?? null
  }, sel)

  it('lien interne de A vers B : aucune requête de section pour B, textes français affichés', async () => {
    const { erreurs, sections } = await observer(async (page, vues) => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.waitForTimeout(400)
      vues.length = 0
      await page.click('#lien')
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.waitForTimeout(600)
      assert.equal(await texte(page, 'h2.o'), 'Bonjour autre')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(sections, [], `aucune section redemandée, vues : ${sections.join(' ')}`)
  })

  it('lien interne puis bascule en anglais : la graine de B portait l\'anglais, aucune requête, textes anglais', async () => {
    const { erreurs, sections } = await observer(async (page, vues) => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.waitForTimeout(400)
      vues.length = 0
      await page.click('#lien')
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.waitForTimeout(600)
      await page.evaluate(() => { ((document.querySelector('mjs-other') as any)._shadow.querySelector('button.en') as HTMLElement).click() })
      await page.waitForTimeout(800)
      assert.equal(await texte(page, 'h2.o'), 'Hello other')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(sections, [], `aucune section demandée, vues : ${sections.join(' ')}`)
  })

  it('contre-épreuve : un chargement complet de B ne demande aucune section non plus', async () => {
    const { erreurs, sections } = await observer(async page => {
      await page.goto(base + '/autre', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.waitForTimeout(600)
      assert.equal(await texte(page, 'h2.o'), 'Bonjour autre')
    })
    assert.deepEqual(erreurs, [])
    assert.deepEqual(sections, [])
  })
})
