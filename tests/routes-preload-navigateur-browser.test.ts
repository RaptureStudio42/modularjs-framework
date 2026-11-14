// Chargement des pages d'une table de routes (`routes.preload`), appli à unités séparées servie en HTTP, vrais `import()`,
// Chromium réel. "idle" (défaut) : aucune page non visitée n'est demandée avant l'événement `load`, puis toutes sont
// préchargées au repos sans visite, sans être exécutées ; un clic vers une page pas encore chargée l'affiche. "off" : rien sans visite, la
// visite charge et affiche. "on" : les pages sont demandées à l'ouverture, sans attendre de repos

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Mode = 'on' | 'idle' | 'off'

const SOURCES: Record<string, string> = {
  'shell.page.mjs': '<routes target="root">\n  /   page-a\n  /b  page-b\n  /c  page-c\n</routes>\n\n<nav><a id="vb" href="#/b">B</a> <a id="vc" href="#/c">C</a></nav>\n<@view root>\n',
  'page-a.mjs':     '<p class="a">A</p>\n',
  'page-b.mjs':     '<p class="b">B</p>\n',
  'page-c.mjs':     '<p class="c">C</p>\n',
}

// cherche à travers les racines d'ombre
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__defini = function(t) { return !!customElements.get(t); };',
  // fichiers de page demandés, et leur départ par rapport à l'événement load de la fenêtre
  'window.__demandes = function(nom) { var n = performance.getEntriesByType("navigation")[0]; return performance.getEntriesByType("resource").filter(function(r) { return r.name.indexOf("/" + nom) >= 0; }).map(function(r) { return { avantLoad: !n.loadEventStart || r.startTime < n.loadEventStart, avantRepos: window.__repos === undefined || r.startTime < window.__repos }; }); };',
  // l'instant du premier temps de repos rendu à la page
  'if (window.requestIdleCallback) { var ric = window.requestIdleCallback.bind(window); window.requestIdleCallback = function(f, o) { return ric(function(d) { if (window.__repos === undefined) window.__repos = performance.now(); f(d); }, o); }; }',
].join('\n')
// aucun temps de repos ne vient jamais
const SANS_REPOS = 'window.requestIdleCallback = function() { return 0; };'

const constructions = new Map<string, Promise<Map<string, Buffer>>>()

function construire(mode: Mode | undefined, env: 'dev' | 'prod') {
  const cle = String(mode) + ':' + env
  let p = constructions.get(cle)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`routes-preload-${mode ?? 'defaut'}-${env}`)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: 'split', env, routesPreload: mode } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
      const fichiers = new Map<string, Buffer>()
      for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
      return fichiers
    })()
    constructions.set(cle, p)
  }
  return p
}

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  }
  catch {
    return false
  }
}

describe('routes.preload — pages d\'une table de routes, Chromium', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    if (!await chromiumPresent()) { console.log('  ℹ️  chromium non installé : test sauté. Activer : `npx playwright install chromium`'); this.skip() }
    browser = await (await import('playwright') as any).chromium.launch()
  })

  after(async function () {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvrir(fichiers: Map<string, Buffer>, sansRepos = false) {
    const page       = await browser.newPage()
    const exceptions = [] as string[]
    page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
    await page.addInitScript({ content: SONDE + (sansRepos ? '\n' + SANS_REPOS : '') })
    await page.route('http://localhost/**', async (route: any) => {
      const u = new URL(route.request().url())
      if (u.pathname.startsWith('/out/')) {
        const f = fichiers.get(u.pathname.slice(5))
        await route.fulfill(f ? { status: 200, contentType: u.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>' })
    })
    await page.goto('http://localhost/#/', { waitUntil: 'load' })
    const attendre = async (expr: string, ms = 4000): Promise<boolean> => {
      try { await page.waitForFunction(expr, null, { timeout: ms }); return true }
      catch { return false }
    }
    assert.ok(await attendre("__trouve('.a')", 8000), 'la première route a monté')
    return { page, exceptions, attendre }
  }

  it('"idle" (défaut, production) : rien avant le load, puis toutes les pages préchargées sans visite, sans être exécutées', async () => {
    const o = await ouvrir(await construire(undefined, 'prod'))
    try {
      assert.ok(await o.attendre("__demandes('page-b').length > 0 && __demandes('page-c').length > 0"), 'pages demandées au repos, sans visite')
      assert.equal(await o.page.evaluate("__defini('mjs-page-b') || __defini('mjs-page-c')"), false, 'préchargées, pas exécutées')
      for (const nom of ['page-b', 'page-c']) {
        const d = await o.page.evaluate(`__demandes(${JSON.stringify(nom)})`)
        assert.equal(d.length, 1, `${nom} demandée une fois`)
        assert.equal(d[0].avantLoad, false, `${nom} demandée après le load`)
        assert.equal(d[0].avantRepos, false, `${nom} demandée après un temps de repos`)
      }
      assert.deepEqual(o.exceptions, [])
    }
    finally { await o.page.close() }
  })

  it('"idle" : un clic vers une page pas encore chargée l\'affiche', async () => {
    const o = await ouvrir(await construire('idle', 'dev'), true)
    try {
      await o.page.waitForTimeout(300)
      assert.equal(await o.page.evaluate("__defini('mjs-page-b')"), false, 'sans repos, la page n\'est pas chargée')
      await o.page.evaluate("__clic('#vb')")
      assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
      assert.deepEqual(o.exceptions, [])
    }
    finally { await o.page.close() }
  })

  it('"off" : rien sans visite ; la visite charge et affiche', async () => {
    const o = await ouvrir(await construire('off', 'dev'))
    try {
      await o.page.waitForTimeout(600)
      assert.equal(await o.page.evaluate("__defini('mjs-page-b') || __defini('mjs-page-c')"), false, 'aucune page non visitée')
      await o.page.evaluate("__clic('#vc')")
      assert.ok(await o.attendre("__trouve('.c')"), 'la page c paraît')
      assert.deepEqual(o.exceptions, [])
    }
    finally { await o.page.close() }
  })

  it('"on" : les pages sont demandées à l\'ouverture, sans attendre de repos', async () => {
    const o = await ouvrir(await construire('on', 'dev'), true)
    try {
      assert.ok(await o.attendre("__defini('mjs-page-b') && __defini('mjs-page-c')"), 'pages définies sans repos ni visite')
      assert.deepEqual(o.exceptions, [])
    }
    finally { await o.page.close() }
  })
})
