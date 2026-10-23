// Navigateur réel (Chromium) : au niveau de console 'log' d'un build de production, les traces du routeur sortent comme en développement
//
// une appli routée construite en production au niveau 'log' (fichiers séparés, puis fichier unique), ouverte sur une page
// en anglais puis sur une page en français : on charge la page, on change le hash. La console reçoit les traces du routeur
// une seule fois chacune, dans l'ordre, en texte, dans la langue de la page : exactement les lignes que le build de
// développement écrit pour la même visite. Aucune clé de la table des messages (`routerLog…`) n'y paraît, aucun fichier de
// messages n'est demandé

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

const VARIANTES: Record<string, Record<string, unknown>> = {
  'dev':           { env: 'dev' },
  'prod-log':      { env: 'prod', logLevel: 'log' },
  'prod-log-bulk': { env: 'prod', logLevel: 'log', js: 'bundle' },
}

// le texte de la page, racines fantômes des composants comprises (`_shadow`), cherché dans le navigateur (une chaîne : une fonction du test y arriverait transformée)
const contient = (texte: string) => `(() => { let t = ''; const p = (n) => { const r = n._shadow || n.shadowRoot; if (r && r !== n) p(r); for (const c of n.childNodes) { if (c.nodeType === 3) t += c.textContent; else p(c) } }; p(document.body); return t.includes(${JSON.stringify(texte)}) })()`

// une ligne que le routeur écrit : son préfixe, ou la ligne d'une route reconnue
const duRouteur = (ligne: string) => ligne.includes('[Router]') || ligne.trimStart().startsWith('🎯')

describe('traces du routeur au niveau log en production — navigateur réel', function () {
  this.timeout(240000)

  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''

  before(async () => {
    const root   = mjsTmp('traces-langue-navigateur')
    const srcDir = join(root, 'src')
    const dist   = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
    for (const [variante, opts] of Object.entries(VARIANTES)) {
      const sortie  = join(dist, variante)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(sortie, 'assets'), manifestPath: join(sortie, 'assets', 'bundle.js'), urlPrefix: `/${variante}/assets`, ...opts } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
      for (const lang of ['en', 'fr', 'de']) {
        writeFileSync(join(sortie, `${lang}.html`), `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><script type="module" src="assets/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>`)
      }
    }
    server = createServer((req, res) => {
      const url     = (req.url ?? '').split('?')[0]
      const fichier = join(dist, url)
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

  // la visite : la page d'accueil, puis le hash vers « à propos » ; rend ce que la console a reçu, les fichiers demandés et les erreurs
  async function visite(variante: string, lang: string): Promise<{ logs: string[], requetes: string[], erreurs: string[] }> {
    const page = await browser!.newPage()
    const logs: string[]     = []
    const requetes: string[] = []
    const erreurs: string[]  = []
    page.on('console', (m) => { logs.push(m.text()) })
    page.on('request', (r) => { requetes.push(new URL(r.url()).pathname) })
    page.on('pageerror', (e) => { erreurs.push(String(e)) })
    const voir = async (texte: string) => {
      try { await page.waitForFunction(contient(texte), undefined, { timeout: 15000 }) }
      catch { throw new Error(`« ${texte} » n'apparaît pas — erreurs : ${erreurs.join(' | ')} — console : ${logs.join(' | ')}`) }
    }
    await page.goto(`${origin}/${variante}/${lang}.html`)
    await voir('Accueil')
    await page.evaluate(() => { location.hash = '#/about' })
    await voir('A propos')
    // le temps qu'un texte rejoué tard, ou une trace en double, se montre
    await page.waitForTimeout(400)
    await page.close()
    return { logs, requetes, erreurs }
  }

  for (const lang of ['en', 'fr', 'de']) {
    for (const variante of ['prod-log', 'prod-log-bulk']) {
      it(`page ${lang}, ${variante} : les traces du routeur sont celles du développement, une fois chacune, dans l'ordre, en texte`, async () => {
        const dev  = await visite('dev', lang)
        const prod = await visite(variante, lang)
        assert.deepEqual(dev.erreurs, [])
        assert.deepEqual(prod.erreurs, [])
        const attendu = dev.logs.filter(duRouteur)
        assert.ok(attendu.length >= 8, `le développement doit écrire les traces du routeur : ${attendu.join(' | ')}`)
        assert.deepEqual(prod.logs.filter(duRouteur), attendu)
        assert.deepEqual(prod.logs.filter((l) => /routerLog|routerNoRouteLog/.test(l)), [], 'aucune clé de la table des messages dans la console')
        assert.deepEqual(prod.requetes.filter((u) => /mjs_err-/.test(u)), [], 'aucun fichier de messages demandé')
        // la langue de la page : l'anglais pour « en », le français pour « fr », celui du projet (français) pour une langue inconnue
        assert.ok(attendu.some((l) => (lang === 'en' ? /Registering/ : /Enregistrement/).test(l)), attendu.join(' | '))
      })
    }
  }
})
