// Un composant traduit d'une page prérendue ne change pas d'aspect au démarrage, dans un vrai Chromium — pourquoi ce test existe.
//
// Le HTML prérendu porte déjà les textes du composant et sa graine `#__mjs_i18n` (la langue du rendu et
// les sections lues). Au premier chargement, le navigateur attendait pourtant le fichier de langue avant
// de savoir quoi afficher : le composant se rendait une fois « en attente », puis une seconde fois avec
// les textes — deux rendus pour un texte qui ne change pas, et un risque de clignotement (squelette,
// vide) sur les connexions lentes.
//
// Ce que le test garde, sur une vraie page prérendue dont le fichier de langue est volontairement
// retardé (700 ms) pour que l'attente se voie : le texte du composant, relevé à chaque image
// (`requestAnimationFrame`), n'a JAMAIS qu'une seule valeur, celle du HTML reçu — ni vide, ni
// squelette (espaces de chiffre), ni autre langue ; son gabarit n'est évalué qu'une fois côté
// navigateur (rouge avant : deux) ; aucune requête de section. Contre-épreuve : un visiteur qui
// demande l'autre langue (`?lang=en`) voit bien l'anglais à la fin, la graine française n'est pas
// affichée à sa place (et le gabarit se rend alors deux fois : attente de la langue, puis textes).

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

describe('composant traduit d\'une page prérendue — un seul rendu, aucun changement visible (Chromium)', function () {
  this.timeout(180000)
  let browser: any = null
  let server: Server | null = null
  let base = ''

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    const root   = mjsTmp('i18n-sans-clignotement')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title' }))
    writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour accueil\n')
    writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ salut: 'Hello home' }))
    writeFileSync(join(srcDir, 'home.mjs'), ["@i18n 'accueil'", '<script>', 'compte = (v) ->', '  window.__rendus = (window.__rendus or 0) + 1', '  v', '</script>', '<h1 class="t">{compte(µt(\'salut\'))}</h1>', ''].join('\n'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      i18n: { default: 'fr', urlParam: true },
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' } } },
    }, null, 2))
    const found = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
    await bundler.close()
    const corps = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
    assert.ok(/id="__mjs_i18n"/.test(corps), 'le prérendu porte sa graine de traduction')
    assert.ok(corps.includes('Bonjour accueil'), 'le prérendu porte déjà le texte')
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`)
        return
      }
      const fichier = join(root, normalize(chemin))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
      const envoyer = () => {
        res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
        res.end(readFileSync(fichier))
      }
      // le fichier de langue traîne : l'attente se voit
      if (/\/mjs_i18n-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 700)
      else envoyer()
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })

  after(async function () {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  // relève le texte du composant à chaque image, depuis la première
  const SONDE = () => {
    const w = window as any
    w.__vus = []
    const lire = () => {
      const h = document.querySelector('mjs-home') as any
      const r = h && (h._shadow || h.shadowRoot)
      const t = r && r.querySelector('h1.t')
      return t ? t.textContent : null
    }
    const tick = () => {
      const v = lire()
      if (v !== null && (w.__vus.length === 0 || w.__vus[w.__vus.length - 1] !== v)) w.__vus.push(v)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  async function ouvrir(chemin: string) {
    const page = await browser.newPage()
    const erreurs: string[] = []
    const sections: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    page.on('request', (r: any) => { const p = new URL(r.url()).pathname; if (SECTION.test(p)) sections.push(p) })
    await page.addInitScript(SONDE)
    try {
      await page.goto(base + chemin, { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.waitForTimeout(1800)
      const vus = await page.evaluate(() => (window as any).__vus)
      const rendus = await page.evaluate(() => (window as any).__rendus ?? 0)
      return { vus, rendus, erreurs, sections }
    }
    finally { await page.close() }
  }

  it('page prérendue en français, fichier de langue retardé : une seule valeur visible, un seul rendu, aucune requête de section', async () => {
    const { vus, rendus, erreurs, sections } = await ouvrir('/')
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(vus, ['Bonjour accueil'], 'le texte du HTML reçu reste le même à chaque image, sans vide ni squelette')
    assert.equal(rendus, 1, 'le gabarit n\'est évalué qu\'une fois côté navigateur')
    assert.deepEqual(sections, [])
  })

  it('contre-épreuve : visiteur qui demande l\'anglais (?lang=en) : l\'anglais à la fin, la graine française n\'est pas imposée', async () => {
    const { vus, rendus, erreurs } = await ouvrir('/?lang=en')
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.equal(vus[vus.length - 1], 'Hello home')
    assert.equal(rendus >= 2, true, `attente de la langue puis textes : ${rendus}`)
  })
})
