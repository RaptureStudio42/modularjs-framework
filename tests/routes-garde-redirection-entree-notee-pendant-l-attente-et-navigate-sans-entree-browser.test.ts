// La redirection d'une garde `µurlChange` prend la place de l'entrée de la page gardée quand la navigation gardée est partie sur sa
// propre entrée, même si une page attend encore son code : ouverte sur `#/h`, l'appli renvoie vers W, qui se garde elle-même et
// renvoie vers B (une seule entrée). `µRouter.navigate('#/g', false)` n'écrit aucune entrée : la redirection de la garde de G ajoute
// la sienne, le retour ramène à A. Construction de développement et de production ; Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Env = 'dev' | 'prod'

const PAGES   = ['a', 'b', 'c', 'g', 'n', 'h', 'w', 'l', 'q', 'v']
// code servi en retard (ms) : garde-l monte pendant l'attente du code de page-l ; page-v se garde et arrive tard
const LENTS: [RegExp, number][] = [[/^garde-l[-.]/, 1200], [/^page-l[-.]/, 1300], [/^page-v[-.]/, 700]]
// garde du shell : /g vers /b, /h vers /w (qui se garde elle-même vers /b) ; garde-n, imbriqué dans page-n ; garde-l, imbriqué dans page-q
const SHELL   = [
  '<routes target="root">',
  '  /    page-a',
  '  /b   page-b',
  '  /c   page-c',
  '  /g   page-g',
  '  /n   page-n',
  '  /h   page-h',
  '  /w   page-w',
  '  /l   page-l',
  '  /q   page-q',
  '  /v   page-v',
  '</routes>',
  '<script>',
  '  window.__to  = (a, b) -> µRouter.to(a, b)',
  '  window.__nav = (a, b) -> µRouter.navigate(a, b)',
  '  µurlChange (path)->',
  "    µRouter.to('/b') if path === '/g'",
  "    µRouter.to('/w') if path === '/h'",
  '</script>',
  '<nav>' + [['vn', '#/n'], ['vh', '#/h'], ['vc', '#/c'], ['vl', '#/l']].map(([i, h]) => `<a id="${i}" href="${h}">${i}</a>`).join(' ') + '</nav>',
  '<@view root>',
  '',
].join('\n')
const SOURCES: Record<string, string> = {
  'shell.page.mjs': SHELL,
  ...Object.fromEntries(['a', 'b', 'c', 'g', 'h', 'l'].map((p) => [`page-${p}.mjs`, `<p class="${p}">${p.toUpperCase()}</p>\n`])),
  'page-n.mjs': '<p class="n">N</p>\n<@garde-n></@garde-n>\n',
  'garde-n.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b') if (path === '/n' or path === '/') and not window.sondeOk\n</script>\n<i></i>\n",
  'page-w.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path === '/w'\n</script>\n<p class=\"w\">W</p>\n",
  'page-q.mjs': '<p class="q">Q</p>\n<@garde-l></@garde-l>\n',
  'garde-l.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path === '/l'\n</script>\n<i></i>\n",
  'page-v.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path === '/v' or path === '/'\n</script>\n<p class=\"v\">V</p>\n",
}
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  `window.__vue = function() { return ${JSON.stringify(PAGES)}.filter(function(k) { return window.__trouve("." + k); }).join(""); };`,
].join('\n')
const HTML   = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{min-height:6000px}</style></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>'
const DEPART = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><p>départ</p></body></html>'
const TYPES: Record<string, string> = { js: 'text/javascript', json: 'application/json', css: 'text/css' }

const constructions = new Map<Env, Promise<Map<string, Buffer>>>()
function construire(env: Env) {
  let p = constructions.get(env)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`garde-attente-${env}`)
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

async function present(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try { return existsSync((await import('playwright') as any)[nom].executablePath()) }
  catch { return false }
}

describe('routes — la redirection d\'une garde suit l\'entrée notée par la navigation gardée, attente du code d\'une page comprise', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      this.timeout(200000)
      let browser: any = null

      before(async function () {
        if (!await present(nom)) { console.log(`  ℹ️  ${nom} non installé : tests sautés`); this.skip() }
        browser = await (await import('playwright') as any)[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () { if (browser) await browser.close() })

      // page de départ, puis l'appli sur `adresse` ; le code des pages lentes arrive en retard
      async function ouvrir(env: Env, adresse: string) {
        const fichiers   = await construire(env)
        const page       = await browser.newPage()
        const exceptions = [] as string[]
        page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
        await page.addInitScript({ content: SONDE })
        await page.route('http://localhost/**', async (route: any) => {
          const u = new URL(route.request().url())
          try {
            if (u.pathname === '/depart.html') { await route.fulfill({ status: 200, contentType: 'text/html', body: DEPART }); return }
            if (!u.pathname.startsWith('/out/')) { await route.fulfill({ status: 200, contentType: 'text/html', body: HTML }); return }
            const rel  = u.pathname.slice(5)
            const f    = fichiers.get(rel)
            const lent = LENTS.find(([re]) => re.test(rel))
            if (lent) await new Promise((r) => setTimeout(r, lent[1]))
            if (!f) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: TYPES[rel.split('.').pop() as string] ?? 'application/octet-stream', body: f })
          }
          catch { /* page partie pendant le vol */ }
        })
        await page.goto('http://localhost/depart.html', { waitUntil: 'load' })
        const depart = await page.evaluate('history.length') as number
        await page.goto('http://localhost/' + adresse, { waitUntil: 'load' })
        await page.waitForFunction("__trouve('.a') || __trouve('.b')", null, { timeout: 8000 }).catch(() => {})
        await page.waitForTimeout(400)
        return { page, exceptions, depart }
      }

      // [adresse, vue, entrées de plus que la page de départ]
      const etat = (o: any) => o.page.evaluate(`[location.hash, __vue(), history.length - ${o.depart}]`)

      async function apres(o: any, ms: number) {
        await o.page.waitForTimeout(ms)
        return etat(o)
      }

      async function retour(o: any) {
        await o.page.goBack({ timeout: 3000 }).catch(() => {})
        return apres(o, 450)
      }

      for (const env of ['dev', 'prod'] as Env[]) {
        it(`${env} : ouverte sur #/h, la garde renvoie vers W, qui se garde elle-même et renvoie vers B : une seule entrée, le retour ramène à la page d'où l'on vient`, async () => {
          const o = await ouvrir(env, '#/h')
          try {
            assert.deepEqual(await etat(o), ['#/b', 'b', 1], 'B prend la place de H')
            await retour(o)
            assert.equal(await o.page.evaluate('location.pathname'), '/depart.html')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : depuis A, µRouter.navigate('#/g', false) n'écrit aucune entrée, la garde de G renvoie vers B : B ajoute la sienne, le retour ramène à A`, async () => {
          const o = await ouvrir(env, '#/')
          try {
            await o.page.evaluate("__nav('#/g', false)")
            assert.deepEqual(await apres(o, 600), ['#/b', 'b', 2], 'l\'entrée de A reste, celle de B s\'ajoute')
            assert.deepEqual(await retour(o), ['#/', 'a', 2])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })
      }
    })
  }
})
