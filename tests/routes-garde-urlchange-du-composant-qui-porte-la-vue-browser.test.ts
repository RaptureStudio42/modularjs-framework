// Une garde `µurlChange` posée sur le composant qui porte la vue (`<@view root>`) et qui renvoie ailleurs (`µRouter.to('/b')`) :
// la page de destination s'affiche, la page gardée ne reste jamais à l'écran — avec ou sans `replace`, comme quand la garde est
// posée sur un composant à côté de la vue. L'historique suit l'écriture de la garde, au montage comme pendant la navigation : avec
// `replace: true`, le retour du navigateur revient à la page quittée ; avec `replace: false`, `#/b` est empilé derrière `#/g`, et le retour rejoue la
// garde, qui rempile `#/b`. Construction de développement et de production ; Chromium et Firefox.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Env = 'dev' | 'prod'

const SOURCES: Record<string, string> = {
  // la garde de `/g` est dans le composant qui porte la vue ; celle de `/h` dans un composant posé à côté
  'shell.page.mjs': "<routes target=\"root\">\n  /    page-a\n  /b   page-b\n  /g   page-g\n  /h   page-h\n</routes>\n<script>\n  µurlChange (path)->\n    µRouter.to('/b', { replace: !window.__empiler }) if path === '/g'\n</script>\n<@garde-x></@garde-x>\n<nav><a id=\"va\" href=\"#/\">A</a> <a id=\"vg\" href=\"#/g\">G</a> <a id=\"vh\" href=\"#/h\">H</a></nav>\n<@view root>\n",
  'garde-x.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b', { replace: true }) if path === '/h'\n</script>\n<i></i>\n",
  ...Object.fromEntries(['a', 'b', 'g', 'h'].map((p) => [`page-${p}.mjs`, `<p class="${p}">${p.toUpperCase()}</p>\n`])),
}
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__vue = function() { return ["a", "b", "g", "h"].filter(function(k) { return window.__trouve("." + k); }).join(""); };',
].join('\n')
const HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>'
const TYPES: Record<string, string> = { js: 'text/javascript', json: 'application/json', css: 'text/css' }

const constructions = new Map<Env, Promise<Map<string, Buffer>>>()
function construire(env: Env) {
  let p = constructions.get(env)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`garde-vue-racine-${env}`)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
      const fichiers = new Map<string, Buffer>()
      for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json|css)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
      return fichiers
    })()
    constructions.set(env, p)
  }
  return p
}

async function present(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try { return existsSync((await import('playwright') as any)[nom].executablePath()) }
  catch { return false }
}

describe('routes — garde µurlChange sur le composant qui porte la vue', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      this.timeout(200000)
      let browser: any = null

      before(async function () {
        if (!await present(nom)) { console.log(`  ℹ️  ${nom} non installé : tests sautés`); this.skip() }
        browser = await (await import('playwright') as any)[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () { if (browser) await browser.close() })

      async function ouvrir(env: Env, adresse = '#/', empiler = false) {
        const fichiers   = await construire(env)
        const page       = await browser.newPage()
        const exceptions = [] as string[]
        page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
        await page.addInitScript({ content: SONDE + (empiler ? '\nwindow.__empiler = true;' : '') })
        await page.route('http://localhost/**', async (route: any) => {
          const u = new URL(route.request().url())
          try {
            if (!u.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: HTML }); return }
            const rel = u.pathname.slice(5)
            const f   = fichiers.get(rel)
            if (!f) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: TYPES[rel.split('.').pop() as string] ?? 'application/octet-stream', body: f })
          }
          catch { /* page partie pendant le vol */ }
        })
        await page.goto('http://localhost/' + adresse, { waitUntil: 'load' })
        await page.waitForFunction(adresse === '#/' ? "__trouve('.a')" : "__trouve('.b')", null, { timeout: 8000 })
        await page.waitForTimeout(300)
        return { page, exceptions }
      }

      // le lien de la page gardée, puis l'état à l'écran une fois tout posé : [adresse, vue]
      async function visiter(o: any, lien: string, empiler = false) {
        await o.page.evaluate(`window.__empiler = ${empiler}, __clic('${lien}')`)
        await o.page.waitForFunction("__trouve('.b')", null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        return o.page.evaluate('[location.hash, __vue()]')
      }

      for (const env of ['dev', 'prod'] as Env[]) {
        it(`${env} : la garde du composant qui porte la vue renvoie vers B, G ne reste pas à l'écran`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await visiter(o, '#vg'), ['#/b', 'b'])
            await o.page.goBack()
            await o.page.waitForTimeout(300)
            assert.deepEqual(await o.page.evaluate('[location.hash, __vue()]'), ['#/', 'a'], 'avec replace, le retour revient sur A')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : même garde avec replace: false : B à l'écran ; au retour du navigateur, la garde rejoue et rempile #/b, B reste`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await visiter(o, '#vg', true), ['#/b', 'b'])
            const n = await o.page.evaluate('history.length')
            await o.page.goBack()
            await o.page.waitForTimeout(300)
            assert.deepEqual(await o.page.evaluate('[location.hash, __vue(), history.length]'), ['#/b', 'b', n])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : page ouverte sur #/g, garde jouée au montage avec replace: false : B à l'écran ; au retour, elle rejoue et rempile #/b`, async () => {
          const o = await ouvrir(env, '#/g', true)
          try {
            assert.deepEqual(await o.page.evaluate('[location.hash, __vue()]'), ['#/b', 'b'])
            const n = await o.page.evaluate('history.length')
            await o.page.goBack()
            await o.page.waitForTimeout(300)
            assert.deepEqual(await o.page.evaluate('[location.hash, __vue(), history.length]'), ['#/b', 'b', n])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : une garde posée à côté de la vue agit comme avant`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await visiter(o, '#vh'), ['#/b', 'b'])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })
      }
    })
  }
})
