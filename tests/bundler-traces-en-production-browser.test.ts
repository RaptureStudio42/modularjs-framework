// Navigateur réel (Chromium) : une appli routée construite en production tourne sans les traces du cœur
//
// au niveau 'warn' (défaut de production) le code envoyé n'a plus aucune trace du routeur : les changements de
// route (par l'adresse, `hashchange` est écouté par UJS) se font comme avant (inscription, navigation, retour sur une vue déjà bâtie) et la console ne reçoit
// rien du routeur. au niveau 'log' les traces sortent, dans la console, comme avant

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' }

const SOURCES: Record<string, string> = {
  'app.page.mjs':   ['<script>', '  @routes =', '    \'main\':', '      \'/\':      \'home-page\'', '      \'/about\': \'about-page\'', '</script>', '', '<@view main>'].join('\n'),
  'home-page.mjs':  '<h1>Accueil</h1>',
  'about-page.mjs': '<h1>A propos</h1>',
}

// le texte de la page, racines fantômes des composants comprises (`_shadow`), cherché dans le navigateur (une chaîne : une fonction du test y arriverait transformée)
const contient = (texte: string) => `(() => { let t = ''; const p = (n) => { const r = n._shadow || n.shadowRoot; if (r && r !== n) p(r); for (const c of n.childNodes) { if (c.nodeType === 3) t += c.textContent; else p(c) } }; p(document.body); return t.includes(${JSON.stringify(texte)}) })()`

describe('traces du cœur en production — navigateur réel', function () {
  this.timeout(180000)

  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''

  before(async () => {
    const root   = mjsTmp('traces-navigateur')
    const srcDir = join(root, 'src')
    const dist   = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
    for (const level of ['warn', 'log']) {
      const sortie  = join(dist, level)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(sortie, 'assets'), manifestPath: join(sortie, 'assets', 'bundle.js'), urlPrefix: `/${level}/assets`, runtime: ['router', 'ujs'], js: 'bundle', env: 'prod', logLevel: level } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
      writeFileSync(join(sortie, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="assets/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>`)
    }
    server = createServer((req, res) => {
      const url     = (req.url ?? '').split('?')[0]
      const fichier = join(dist, url.endsWith('/') ? url + 'index.html' : url)
      if (!fichier.startsWith(dist) || !existsSync(fichier)) { res.writeHead(404); res.end('introuvable'); return }
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    origin  = 'http://127.0.0.1:' + (server!.address() as any).port
    browser = await chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise((resolve) => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  // la visite : accueil, à propos, retour à l'accueil (vue déjà bâtie) ; rend ce que la console a reçu
  async function visite(level: string): Promise<{ logs: string[], erreurs: string[] }> {
    const page   = await browser!.newPage()
    const logs: string[]    = []
    const erreurs: string[] = []
    page.on('console', (m) => { logs.push(m.text()) })
    page.on('pageerror', (e) => { erreurs.push(String(e)) })
    const voir = async (texte: string) => {
      try { await page.waitForFunction(contient(texte), undefined, { timeout: 15000 }) }
      catch { throw new Error(`« ${texte} » n'apparaît pas — erreurs : ${erreurs.join(' | ')} — console : ${logs.join(' | ')}`) }
    }
    await page.goto(`${origin}/${level}/`)
    await voir('Accueil')
    await page.evaluate(() => { location.hash = '#/about' })
    await voir('A propos')
    await page.evaluate(() => { location.hash = '#/' })
    await voir('Accueil')
    await page.close()
    return { logs, erreurs }
  }

  it('niveau warn : la navigation se fait, la console ne reçoit aucune trace du routeur', async () => {
    const { logs, erreurs } = await visite('warn')
    assert.deepEqual(erreurs, [])
    assert.deepEqual(logs.filter((l) => l.includes('[Router]')), [])
  })

  it('niveau log : la navigation se fait, les traces du routeur sortent dans la console', async () => {
    const { logs, erreurs } = await visite('log')
    assert.deepEqual(erreurs, [])
    assert.ok(logs.filter((l) => l.includes('[Router]')).length >= 3, logs.join('\n'))
  })
})
