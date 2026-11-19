// Une garde `µurlChange` qui renvoie ailleurs pendant la navigation qu'elle garde, au montage aussi : l'adresse de renvoi prend la
// place de l'entrée de la page gardée, et le retour du navigateur ramène à la page d'avant, sans rejouer la garde. Vu quand la page
// gardée vient d'un lien `#/…` (le navigateur ajoute l'entrée) et de `µRouter.to` (l'entrée ajoutée par l'historique du navigateur),
// au montage, sur une chaîne de gardes et pour `µRouter.navigate`. Écrite `{ replace: false }`, la redirection garde l'entrée de la
// page gardée ; une garde qui attend (`await`) avant de renvoyer arrive la navigation finie : son adresse s'ajoute, sauf
// `{ replace: true }` écrit ; une navigation sans garde ajoute toujours son entrée. La redirection ne prend que la place de l'entrée
// de la page gardée : depuis A, `µRouter.to('/g', false)` (ou `{ push: false }`) n'écrit aucune entrée pour G, celle de A reste et
// celle de B s'ajoute ; `µRouter.to('/g', { replace: true })` fait prendre à G la place de A, puis B prend celle de G. Même règle
// pour une page routée qui se garde elle-même (Z), pour une route à accent ou à espace (`/t/é`, `/t/a b`), et depuis `#/r?x=0`, où
// `µRouter.to('/r?x=1', false)` n'écrit aucune entrée : la redirection ajoute la sienne. Construction de développement et de
// production ; Chromium, Firefox et WebKit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Env = 'dev' | 'prod'

const PAGES = ['a', 'b', 'c', 'g', 'h', 'j', 'k', 'n', 'w', 'x', 'r', 't', 'z']
const SOURCES: Record<string, string> = {
  // `/g` renvoie vers B ; `/h` aussi, en gardant son entrée ; `/j` renvoie vers `/k`, qui renvoie vers B ; `/n` par `navigate` ; `/c` sans garde ; `#tf`, `#tp` et `#tr` vont vers `/g` par `µRouter.to`,
  // sans entrée ou en remplaçant celle de A ; `/r` renvoie vers B quand la page le demande (`window.refus`), `/t/…` toujours
  'shell.page.mjs': "<routes target=\"root\">\n  /    page-a\n  /b   page-b\n  /c   page-c\n  /g   page-g\n  /h   page-h\n  /j   page-j\n  /k   page-k\n  /n   page-n\n  /w   page-w\n  /x   page-x\n  /r   page-r\n  /t/:nom   page-t\n  /z   page-z\n</routes>\n<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path === '/g'\n    µRouter.to('/b', { replace: false }) if path === '/h'\n    µRouter.to('/k') if path === '/j'\n    µRouter.to('/b') if path === '/k'\n    µRouter.navigate('#/b') if path === '/n'\n    µRouter.to('/b') if path === '/r' and window.refus\n    µRouter.to('/b') if path.indexOf('/t/') === 0\n</script>\n<@garde-w></@garde-w>\n<nav><a id=\"vc\" href=\"#/c\">C</a> <a id=\"vg\" href=\"#/g\">G</a> <a id=\"vh\" href=\"#/h\">H</a> <a id=\"vj\" href=\"#/j\">J</a> <a id=\"vn\" href=\"#/n\">N</a> <a id=\"vw\" href=\"#/w\">W</a> <a id=\"vx\" href=\"#/x\">X</a> <a id=\"vr0\" href=\"#/r?x=0\">R</a></nav>\n<button id=\"tg\" @click={µRouter.to('/g')}>G</button> <button id=\"tc\" @click={µRouter.to('/c')}>C</button> <button id=\"tf\" @click={µRouter.to('/g', false)}>F</button> <button id=\"tp\" @click={µRouter.to('/g', { push: false })}>P</button> <button id=\"tr\" @click={µRouter.to('/g', { replace: true })}>R</button> <button id=\"tzf\" @click={µRouter.to('/z', false)}>ZF</button> <button id=\"tzp\" @click={µRouter.to('/z', { push: false })}>ZP</button> <button id=\"tte\" @click={µRouter.to('/t/é')}>TE</button> <button id=\"tts\" @click={µRouter.to('/t/a b')}>TS</button> <button id=\"trq\" @click={µRouter.to('/r?x=1', false)}>RQ</button>\n<@view root>\n",
  // garde qui attend avant de renvoyer : la navigation est finie quand l'adresse de renvoi arrive
  'garde-w.mjs': "<script>\n  µurlChange (path)->\n    if path === '/w'\n      await Promise.resolve()\n      µRouter.to('/b')\n    if path === '/x'\n      await Promise.resolve()\n      µRouter.to('/b', { replace: true })\n</script>\n<i></i>\n",
  ...Object.fromEntries(PAGES.map((p) => [`page-${p}.mjs`, `<p class="${p}">${p.toUpperCase()}</p>\n`])),
  // Z se garde elle-même, sans regarder la route : elle renvoie vers B
  'page-z.mjs': "<script>\n  µurlChange (path)->\n    µRouter.to('/b') if path !== '/b'\n</script>\n<p class=\"z\">Z</p>\n",
}
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  `window.__vue = function() { return ${JSON.stringify(PAGES)}.filter(function(k) { return window.__trouve("." + k); }).join(""); };`,
].join('\n')
const HTML   = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>'
const DEPART = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><p>départ</p></body></html>'
const TYPES: Record<string, string> = { js: 'text/javascript', json: 'application/json', css: 'text/css' }

const constructions = new Map<Env, Promise<Map<string, Buffer>>>()
function construire(env: Env) {
  let p = constructions.get(env)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`garde-remplace-${env}`)
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

describe('routes — la redirection d\'une garde prend la place de la page gardée dans l\'historique', function () {
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

      // page ouverte sur `#/` (A à l'écran) ; avec `adresse`, ouverte d'abord sur une page de départ, puis sur cette adresse, où
      // `vue` s'affiche
      async function ouvrir(env: Env, adresse = '', vue = adresse ? 'b' : 'a') {
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
            const rel = u.pathname.slice(5)
            const f   = fichiers.get(rel)
            if (!f) { await route.fulfill({ status: 404, body: '' }); return }
            await route.fulfill({ status: 200, contentType: TYPES[rel.split('.').pop() as string] ?? 'application/octet-stream', body: f })
          }
          catch { /* page partie pendant le vol */ }
        })
        let depart = 0
        if (adresse) {
          await page.goto('http://localhost/depart.html', { waitUntil: 'load' })
          depart = await page.evaluate('history.length')
        }
        await page.goto('http://localhost/' + (adresse || '#/'), { waitUntil: 'load' })
        await page.waitForFunction(`__trouve('.${vue}')`, null, { timeout: 8000 })
        await page.waitForTimeout(300)
        return { page, exceptions, depart, n: await page.evaluate('history.length') as number }
      }

      // [adresse, vue, nombre d'entrées] une fois tout posé
      const etat = (o: any) => o.page.evaluate('[location.hash, __vue(), history.length]')

      async function aller(o: any, sel: string, vue: string) {
        await o.page.evaluate(`__clic('${sel}')`)
        await o.page.waitForFunction(`__trouve('.${vue}')`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        return etat(o)
      }

      async function retour(o: any) {
        await o.page.goBack()
        await o.page.waitForTimeout(300)
        return etat(o)
      }

      for (const env of ['dev', 'prod'] as Env[]) {
        for (const [sel, comment] of [['#vg', 'par un lien #/g'], ['#tg', 'par µRouter.to(\'/g\')']]) {
          it(`${env} : A puis G ${comment}, la garde renvoie vers B : B prend la place de G, le retour ramène à A`, async () => {
            const o = await ouvrir(env)
            try {
              assert.deepEqual(await aller(o, sel, 'b'), ['#/b', 'b', o.n + 1], 'une seule entrée de plus, celle de B')
              assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
              assert.deepEqual(o.exceptions, [])
            }
            finally { await o.page.close() }
          })
        }

        for (const [sel, comment] of [['#tf', 'µRouter.to(\'/g\', false)'], ['#tp', 'µRouter.to(\'/g\', { push: false })']]) {
          it(`${env} : depuis A, ${comment} n'écrit aucune entrée pour G, la garde renvoie vers B : l'entrée de A reste, celle de B s'ajoute, le retour ramène à A`, async () => {
            const o = await ouvrir(env)
            try {
              assert.deepEqual(await aller(o, sel, 'b'), ['#/b', 'b', o.n + 1], 'l\'entrée de A reste, celle de B s\'ajoute')
              assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
              assert.deepEqual(o.exceptions, [])
            }
            finally { await o.page.close() }
          })
        }

        it(`${env} : depuis A, µRouter.to('/g', { replace: true }) : G prend la place de A, puis B celle de G ; le retour ramène à la page d'où l'on vient`, async () => {
          const o = await ouvrir(env, '#/', 'a')
          try {
            assert.deepEqual(await aller(o, '#tr', 'b'), ['#/b', 'b', o.n], 'aucune entrée de plus')
            await o.page.goBack()
            await o.page.waitForTimeout(300)
            assert.equal(await o.page.evaluate('location.pathname'), '/depart.html')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        for (const [sel, comment] of [['#tzf', 'µRouter.to(\'/z\', false)'], ['#tzp', 'µRouter.to(\'/z\', { push: false })']]) {
          it(`${env} : depuis A, ${comment}, la page Z se garde elle-même et renvoie vers B : l'entrée de A reste, celle de B s'ajoute`, async () => {
            const o = await ouvrir(env)
            try {
              assert.deepEqual(await aller(o, sel, 'b'), ['#/b', 'b', o.n + 1], 'l\'entrée de A reste, celle de B s\'ajoute')
              assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
              assert.deepEqual(o.exceptions, [])
            }
            finally { await o.page.close() }
          })
        }

        for (const [sel, comment] of [['#tte', 'µRouter.to(\'/t/é\')'], ['#tts', 'µRouter.to(\'/t/a b\')']]) {
          it(`${env} : route à accent ou à espace, ${comment}, la garde renvoie vers B : B prend la place de la page gardée, un seul retour ramène à A`, async () => {
            const o = await ouvrir(env)
            try {
              assert.deepEqual(await aller(o, sel, 'b'), ['#/b', 'b', o.n + 1])
              assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
              assert.deepEqual(o.exceptions, [])
            }
            finally { await o.page.close() }
          })
        }

        it(`${env} : depuis #/r?x=0, µRouter.to('/r?x=1', false) n'écrit aucune entrée, la garde refuse R : la redirection ajoute son entrée`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vr0', 'r'), ['#/r?x=0', 'r', o.n + 1])
            await o.page.evaluate('window.refus = true')
            assert.deepEqual(await aller(o, '#trq', 'b'), ['#/b', 'b', o.n + 2], 'l\'entrée de #/r?x=0 reste, celle de B s\'ajoute')
            assert.deepEqual(await retour(o), ['#/b', 'b', o.n + 2], 'revenu sur #/r?x=0, la garde refuse R : B prend sa place')
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 2])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : page ouverte sur #/g, garde jouée au montage : B prend la place de G, le retour ramène à la page d'où l'on vient`, async () => {
          const o = await ouvrir(env, '#/g')
          try {
            assert.deepEqual(await etat(o), ['#/b', 'b', o.depart + 1], 'une seule entrée de plus que la page de départ')
            await o.page.goBack()
            await o.page.waitForTimeout(300)
            assert.equal(await o.page.evaluate('location.pathname'), '/depart.html')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : chaîne de gardes, /j renvoie vers /k qui renvoie vers B : B prend la place de J, le retour ramène à A`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vj', 'b'), ['#/b', 'b', o.n + 1])
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : garde qui renvoie par µRouter.navigate('#/b') : même règle, le retour ramène à A`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vn', 'b'), ['#/b', 'b', o.n + 1])
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : redirection écrite { replace: false } : l'entrée de la page gardée reste, le retour rejoue la garde`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vh', 'b'), ['#/b', 'b', o.n + 2], 'les entrées de H et de B')
            assert.deepEqual(await retour(o), ['#/b', 'b', o.n + 2])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : garde qui attend (await) avant de renvoyer : l'adresse de renvoi s'ajoute, comme hors d'une garde`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vw', 'b'), ['#/b', 'b', o.n + 2], 'les entrées de W et de B')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : garde qui attend puis renvoie avec { replace: true } : B prend la place de X, le retour ramène à A`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vx', 'b'), ['#/b', 'b', o.n + 1])
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`${env} : navigation sans garde, par un lien puis par µRouter.to : une entrée chacune, le retour ramène à A`, async () => {
          const o = await ouvrir(env)
          try {
            assert.deepEqual(await aller(o, '#vc', 'c'), ['#/c', 'c', o.n + 1])
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
            assert.deepEqual(await aller(o, '#tc', 'c'), ['#/c', 'c', o.n + 1], 'l\'entrée de C remplace celle qui suivait A')
            assert.deepEqual(await retour(o), ['#/', 'a', o.n + 1])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })
      }
    })
  }
})
