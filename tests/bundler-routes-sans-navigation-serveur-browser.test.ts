// Une appli à routes `#/` bâtie sans la modale, ni ajax, ni les rideaux : le parcours reste juste (clic, Précédent, adresse
// tapée) ; avec `:viewTransition.slide`, le rideau joue ; un lien `/x` posé dans la page par un script extérieur (que la
// construction ne lit pas) part par le navigateur, sans exception, et le développement dit une fois quoi ajouter à la liste
// `"runtime"`. Chromium réel, construction de développement et de production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Env = 'dev' | 'prod'

const ROUTES = '<routes target="root">\n  /   page-a\n  /b  page-b\n</routes>\n\n'
const SHELL  = ROUTES + '<nav><a id="va" href="#/">A</a> <a id="vb" href="#/b">B</a></nav>\n<@view root>\n'
const SIMPLE: Record<string, string> = {
  'shell.page.mjs': SHELL,
  'page-a.mjs':     '<p class="a">A</p>\n',
  'page-b.mjs':     '<p class="b">B</p>\n',
}
const RIDEAU: Record<string, string> = { ...SIMPLE, 'page-b.mjs': '<style :viewTransition.slide></style>\n<p class="b">B</p>\n' }

// cherche à travers les racines d'ombre ; relève les valeurs de `data-mjs-vt` posées sur <html>
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__vt = []; new MutationObserver(function() { var v = document.documentElement.getAttribute("data-mjs-vt"); if (v) window.__vt.push(v); }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-mjs-vt"] });',
].join('\n')

const constructions = new Map<string, Promise<{ fichiers: Map<string, Buffer>, coeur: string }>>()

function construire(nom: string, sources: Record<string, string>, env: Env) {
  const cle = nom + ':' + env
  let p = constructions.get(cle)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`routes-sans-nav-${nom}-${env}`)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      for (const [f, c] of Object.entries(sources)) writeFileSync(join(src, f), c)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: 'split', env, minify: false } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
      const fichiers = new Map<string, Buffer>()
      for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
      const coeur = [...fichiers.entries()].filter(([f]) => f.endsWith('.js')).map(([, b]) => b.toString('utf-8')).join('\n')
      return { fichiers, coeur }
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

describe('routes `#/` sans navigation vers le serveur — Chromium', function () {
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

  async function ouvrir(fichiers: Map<string, Buffer>) {
    const page       = await browser.newPage()
    const messages   = [] as string[]
    const exceptions = [] as string[]
    page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') messages.push(m.text()) })
    page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
    await page.addInitScript({ content: SONDE })
    await page.route('http://localhost/**', async (route: any) => {
      const u = new URL(route.request().url())
      if (u.pathname.startsWith('/out/')) {
        const f = fichiers.get(u.pathname.slice(5))
        await route.fulfill(f ? { status: 200, contentType: u.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' })
        return
      }
      if (u.pathname === '/x') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><p id="arrivee">x</p></body></html>' })
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
    return { page, messages, exceptions, attendre }
  }

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : sans modale, ajax ni rideaux, clic, Précédent et adresse tapée restent justes`, async () => {
      const { fichiers, coeur } = await construire('simple', SIMPLE, env)
      assert.equal(coeur.includes('mjs-modal-box'), false)
      assert.equal(coeur.includes('_mjs_ajaxRequest = '), false)
      assert.equal(coeur.includes('_mjs_vtCurtainRun = '), false)
      const o = await ouvrir(fichiers)
      try {
        await o.page.evaluate("__clic('#vb')")
        assert.ok(await o.attendre("__trouve('.b') && location.hash === '#/b'"), 'clic : la route b paraît')
        await o.page.goBack()
        assert.ok(await o.attendre("__trouve('.a') && !__trouve('.b')"), 'Précédent : la route a revient')
        await o.page.evaluate("location.hash = '#/b'")
        assert.ok(await o.attendre("__trouve('.b')"), 'adresse tapée : la route b paraît')
        assert.deepEqual(o.exceptions, [])
      }
      finally { await o.page.close() }
    })

    it(`${env} : avec \`@viewTransition.slide\`, les rideaux sont là et la transition joue au clic`, async () => {
      const { fichiers, coeur } = await construire('rideau', RIDEAU, env)
      assert.ok(coeur.includes('_mjs_vtCurtainRun = '))
      const o = await ouvrir(fichiers)
      try {
        await o.page.evaluate("__clic('#vb')")
        assert.ok(await o.attendre("__trouve('.b')"), 'la route b paraît')
        assert.ok(await o.attendre("window.__vt.includes('slide')"), 'la transition slide est posée sur <html>')
        assert.deepEqual(o.exceptions, [])
      }
      finally { await o.page.close() }
    })

    it(`${env} : un lien \`/x\` ajouté par un script extérieur part par le navigateur, sans exception`, async () => {
      const { fichiers } = await construire('simple', SIMPLE, env)
      const o = await ouvrir(fichiers)
      try {
        await o.page.evaluate("(function() { var a = document.createElement('a'); a.id = 'ext'; a.href = '/x'; a.textContent = 'x'; document.body.appendChild(a); })()")
        await Promise.all([o.page.waitForURL('http://localhost/x', { timeout: 6000 }), o.page.evaluate("__clic('#ext')")])
        assert.ok(await o.attendre("!!document.getElementById('arrivee')"), 'la page /x est chargée par le navigateur')
        assert.deepEqual(o.exceptions, [])
        const dits = o.messages.filter(m => m.includes('"runtime"') && m.includes('ajax'))
        if (env === 'dev') assert.equal(dits.length, 1, 'avertissement attendu une fois : ' + o.messages.join(' | '))
      }
      finally { await o.page.close() }
    })
  }
})
