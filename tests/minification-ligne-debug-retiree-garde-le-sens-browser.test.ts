// dans Chromium et Firefox, production minifiée : seule une instruction qui est exactement `µ.debug = …` est retirée, sur toute son étendue
// (`void 0;` à sa place) ; une affectation prise dans une expression, un ternaire ou une suite `µ.debug = true, s = 1` reste en place
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, firefox, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' }
const js    = (lignes: string[]) => ['<script lang="js">', ...lignes.map((l) => '  ' + l), '</script>', '<p class="etat">ok</p>', ''].join('\n')
const civet = (lignes: string[]) => ['<script lang="civet">', ...lignes.map((l) => '  ' + l), '</script>', '<p class="etat">ok</p>', ''].join('\n')
const FAUX  = "if (location.pathname === '/zzz')"
// forme, source, valeurs lues dans la page : n (la ligne d'après a tourné), a, t, s (ce que la forme écrit)
const CAS: Array<[string, Record<string, string>, Record<string, unknown>]> = [
  ['if sans accolades', { 'demarre.mjs': js([FAUX, '  µ.debug = true', 'window.__n = 1']) }, { n: 1 }],
  ['else sans accolades', { 'demarre.mjs': js(["if (location.pathname === '/')", '  window.__a = 1', 'else', '  µ.debug = true', 'window.__n = 1']) }, { n: 1, a: 1 }],
  ['for sans accolades', { 'demarre.mjs': js(['for (const k of [])', '  µ.debug = k', 'window.__n = 1']) }, { n: 1 }],
  ['suivie d\'un commentaire', { 'demarre.mjs': js([FAUX, '  µ.debug = true // trace', 'window.__n = 1']) }, { n: 1 }],
  ['sans espaces', { 'demarre.mjs': js([FAUX, '  µ.debug=true', 'window.__n = 1']) }, { n: 1 }],
  ['deux fois de suite', { 'demarre.mjs': js([FAUX, '  µ.debug = true', 'µ.debug = false', 'window.__n = 1']) }, { n: 1 }],
  ['à la fin d\'un module importé', { 'fin.js.mjs': "export const marque = 1\nif (globalThis.location.pathname === '/zzz')\n  µ.debug = true", 'demarre.mjs': js(["@import marque 'fin.js.mjs'", 'window.__n = marque']) }, { n: 1 }],
  ['appel chaîné à la ligne suivante', { 'demarre.mjs': js(["const cfg = { lire: (k) => k === 'debug' };", 'µ.debug = cfg', "  .lire('debug')", 'window.__n = 1']) }, { n: 1 }],
  ['appel chaîné à la ligne suivante, Civet', { 'demarre.mjs': civet(["cfg := { lire: (k) => k == 'debug' }", 'µ.debug = cfg', "  .lire 'debug'", 'window.__n = 1']) }, { n: 1 }],
  ['dans un ternaire', { 'demarre.mjs': js(["window.__t = location.pathname === '/' ?", '  µ.debug = 7', '  : 0', 'window.__n = 1']) }, { n: 1, t: 7 }],
  ['dans un ternaire, deux-points en fin de ligne', { 'demarre.mjs': js(["window.__t = location.pathname === '/' ?", '  µ.debug = 7 :', '  0', 'window.__n = 1']) }, { n: 1, t: 7 }],
  ['ternaire aux lignes suivantes', { 'demarre.mjs': js(['window.__a = 0;', "µ.debug = location.pathname === '/'", '  ? (window.__a = 1)', '  : (window.__a = 2)', 'window.__n = 1']) }, { n: 1, a: 0 }],
  ['ternaire aux lignes suivantes, Civet', { 'demarre.mjs': civet(['window.__a = 0', "µ.debug = location.pathname == '/'", '  ? (window.__a = 1)', '  : (window.__a = 2)', 'window.__n = 1']) }, { n: 1, a: 0 }],
  ['suite µ.debug = true, s = 1', { 'demarre.mjs': js(['µ.debug = true, window.__s = 1', 'window.__n = 1']) }, { n: 1, s: 1 }],
]

async function construire(files: Record<string, string>): Promise<{ dist: string, erreurs: string[] }> {
  const root   = mjsTmp('ligne-debug-nav')
  const srcDir = join(root, 'src')
  const dist   = join(root, 'dist')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(files)) writeFileSync(join(srcDir, f), s)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(dist, 'assets'), manifestPath: join(dist, 'assets', 'bundle.js'), urlPrefix: '/assets', js: 'bundle', env: 'prod', minify: true } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/assets/bundle.js"></script></head><body><mjs-demarre></mjs-demarre></body></html>')
  return { dist, erreurs: stats.errors.map((e: any) => String(e.message).replace(/\s+/g, ' ').slice(0, 200)) }
}

describe('production minifiée : seule l\'instruction `µ.debug = …` est retirée, le sens du code est gardé', function () {
  this.timeout(280000)
  const moteurs: Array<[string, Browser]> = []
  before(async () => { moteurs.push(['chromium', await chromium.launch({ args: ['--no-proxy-server'] })], ['firefox', await firefox.launch()]) })
  after(async () => {
    for (const [, b] of moteurs) await b.close()
    await terminateSharedWorkerPool()
  })

  // valeurs écrites par la page une fois le composant monté, et erreurs de la page
  async function ouvrir(browser: Browser, dist: string): Promise<{ valeurs: unknown, erreurs: string[] }> {
    const page    = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e).replace(/\s+/g, ' ').slice(0, 160)))
    await page.route('http://mjs.test/**', (route: any) => {
      const chemin  = new URL(route.request().url()).pathname
      const fichier = join(dist, chemin === '/' ? 'index.html' : chemin)
      if (!fichier.startsWith(dist) || !existsSync(fichier)) return route.fulfill({ status: 404, body: 'introuvable' })
      return route.fulfill({ status: 200, contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
    })
    await page.goto('http://mjs.test/')
    try { await page.waitForFunction("(() => { const el = document.querySelector('mjs-demarre'); const r = el && (el._shadow || el.shadowRoot); return !!r?.querySelector('.etat') })()", undefined, { timeout: 5000 }) }
    catch { erreurs.push('composant non monté') }
    const valeurs = JSON.parse(await page.evaluate('JSON.stringify({ n: window.__n, a: window.__a, t: window.__t, s: window.__s })') as string)
    await page.close()
    return { valeurs, erreurs }
  }

  for (const [nom, files, attendu] of CAS) it(nom, async () => {
    const { dist, erreurs } = await construire(files)
    assert.deepEqual(erreurs, [], 'la construction de production doit passer')
    for (const [moteur, browser] of moteurs) assert.deepEqual(await ouvrir(browser, dist), { valeurs: attendu, erreurs: [] }, `${nom}, ${moteur}`)
  })
})
