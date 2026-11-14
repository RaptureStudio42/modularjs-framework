// Une page d'une table de routes visitée avant que son code soit arrivé : l'ancienne page reste à l'écran, telle quelle
// (même `µ.url`, mêmes paramètres), jusqu'à ce que la suivante soit définie, au plus 1,5 s ; la vue n'est jamais vide.
// Appli à unités séparées servie en HTTP, vrais `import()`, chargement au repos coupé, fichiers de page retardés par le
// test. Relevés image par image (requestAnimationFrame) du clic à la bascule. Chromium, Firefox et WebKit ensemble

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { playTogether } from './helpers/engines-together.js'

const SOURCES: Record<string, string> = {
  'shell.page.mjs': '<routes target="root">\n  /        page-a\n  /b       page-b\n  /c       page-c\n  /d/:id   page-d\n  /x       page-x\n</routes>\n\n<nav><a id="va" href="#/">A</a> <a id="vb" href="#/b">B</a> <a id="vc" href="#/c">C</a> <a id="vd" href="#/d/7">D</a> <a id="vx" href="#/x">X</a></nav>\n<@view root>\n',
  'page-a.mjs':     '<p class="a">A</p>\n',
  'page-b.mjs':     '<p class="b">B</p>\n',
  'page-c.mjs':     '<p class="c">C</p>\n',
  'page-d.mjs':     '<p class="d">id={&id}</p>\n<div class="haut"></div>\n<style>\n  :host\n    display: block\n  .haut\n    height: 4000px\n</style>\n',
  'page-x.mjs':     '<p class="x">X</p>\n',
}

const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__defini = function(t) { return !!customElements.get(t); };',
  // ce que montre la vue à chaque image ("" = vue vide ; la page de détail avec son texte), jusqu'à `fin` ou 3 s
  'window.__relever = function(fin) { window.__images = []; var t0 = performance.now(); var f = function() { var d = window.__chercher(document, ".d"); window.__images.push(d ? d.textContent : ["a", "b", "c", "x"].filter(function(k) { return window.__trouve("." + k); }).join("")); if (!window.__trouve(fin) && performance.now() - t0 < 3000) requestAnimationFrame(f); }; requestAnimationFrame(f); };',
  // la vue au moment où la transition de vue pose les nouvelles vues
  'if (document.startViewTransition) { var svt = document.startViewTransition.bind(document); document.startViewTransition = function(cb) { return svt(function() { var r = cb && cb(); window.__vtVue = ["a", "b"].filter(function(k) { return window.__trouve("." + k); }).join(""); return r; }); }; }',
  // aucun temps de repos : les pages ne se chargent qu'à la visite
  'window.requestIdleCallback = function() { return 0; };',
].join('\n')

let construction: Promise<Map<string, Buffer>> | null = null
function construire() {
  construction ??= (async () => {
    const root = mjsTmp('routes-ancienne-page')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: 'split', env: 'dev' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
    return fichiers
  })()
  return construction
}

async function present(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try { return existsSync((await import('playwright') as any)[nom].executablePath()) }
  catch { return false }
}

describe('routes — l\'ancienne page reste à l\'écran jusqu\'à ce que la suivante soit prête', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    playTogether(describe(nom, function () {
      this.timeout(120000)
      let browser: any = null

      before(async function () {
        if (!await present(nom)) { console.log(`  ℹ️  ${nom} non installé : tests sautés`); this.skip() }
        browser = await (await import('playwright') as any)[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () { if (browser) await browser.close() })

      // `lents` : fichiers retardés de 400 ms ; `tardifs` : de 3 s, au-delà du plafond ; `absents` : servis en 404
      async function ouvrir(lents: string[] = [], tardifs: string[] = [], absents: string[] = []) {
        const fichiers   = await construire()
        const page       = await browser.newPage()
        const exceptions = [] as string[]
        page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
        await page.addInitScript({ content: SONDE })
        await page.route('http://localhost/**', async (route: any) => {
          const u = new URL(route.request().url())
          if (u.pathname.startsWith('/out/')) {
            const f = fichiers.get(u.pathname.slice(5))
            if (lents.some((n) => u.pathname.indexOf(n) >= 0)) await new Promise((r) => setTimeout(r, 400))
            if (tardifs.some((n) => u.pathname.indexOf(n) >= 0)) await new Promise((r) => setTimeout(r, 3000))
            await route.fulfill(!f || absents.some((n) => u.pathname.indexOf(n) >= 0) ? { status: 404, body: '' } : { status: 200, contentType: u.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f })
            return
          }
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>' })
        })
        await page.goto('http://localhost/#/', { waitUntil: 'load' })
        const attendre = async (expr: string, ms = 5000): Promise<boolean> => {
          try { await page.waitForFunction(expr, null, { timeout: ms }); return true }
          catch { return false }
        }
        assert.ok(await attendre("__trouve('.a')", 8000), 'la première route a monté')
        return { page, exceptions, attendre, images: async (): Promise<string[]> => page.evaluate('window.__images') }
      }

      it('page lente : la vue n\'est vide à aucune image, l\'ancienne page reste jusqu\'à la bascule', async () => {
        const o = await ouvrir(['page-b'])
        try {
          await o.page.evaluate("__relever('.b'); __clic('#vb')")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.waitForTimeout(50)
          const images = await o.images()
          assert.ok(images.length > 3, `images relevées pendant l'attente : ${images.length}`)
          assert.equal(images.indexOf(''), -1, `aucune image à vue vide : ${images.map((x) => x || '_').join(' ')}`)
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('page de détail : pendant l\'attente, elle n\'affiche que son propre id', async () => {
        const o = await ouvrir(['page-b'])
        try {
          await o.page.evaluate("__clic('#vd')")
          assert.ok(await o.attendre("__trouve('.d')"), 'la page de détail paraît')
          await o.page.evaluate("__relever('.b'); __clic('#vb')")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.waitForTimeout(50)
          const vus = [...new Set((await o.images()).filter((x) => x !== 'b'))]
          assert.deepEqual(vus, ['id=7'], `textes vus avant la bascule : ${vus.join(' | ')}`)
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('transition de vue : elle passe de l\'ancienne page à la nouvelle, définie', async function () {
        const o = await ouvrir(['page-b'])
        try {
          if (!await o.page.evaluate('!!document.startViewTransition')) { console.log(`  ℹ️  ${nom} : pas de transition de vue, scène sautée`); this.skip() }
          await o.page.evaluate("window.µ.viewTransition = true; __clic('#vb')")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.waitForTimeout(400)
          assert.equal(await o.page.evaluate('window.__vtVue'), 'b', 'la transition pose la page b, jamais une vue vide')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('deux clics rapides : le second l\'emporte, le premier ne monte jamais', async () => {
        const o = await ouvrir(['page-b'])
        try {
          await o.page.evaluate("__relever('.c'); __clic('#vb'); __clic('#vc')")
          assert.ok(await o.attendre("__trouve('.c')"), 'la page c paraît')
          await o.page.waitForTimeout(700)
          const images = await o.images()
          assert.equal(images.filter((x) => x.indexOf('b') >= 0).length, 0, `la page b ne paraît jamais : ${images.join(' ')}`)
          assert.equal(await o.page.evaluate("__trouve('.b')"), false, 'ni après coup')
          assert.equal(await o.page.evaluate('location.hash'), '#/c')
        }
        finally { await o.page.close() }
      })

      it('page qui tarde au-delà du plafond : l\'ancienne page reste jusqu\'au plafond, puis la navigation se fait, puis la page paraît', async () => {
        const o = await ouvrir([], ['page-x'])
        try {
          await o.page.evaluate("__relever('.nulle-part'); __clic('#vx')")
          assert.ok(await o.attendre("location.hash === '#/x' && !__trouve('.a')", 5000), 'au plafond, la navigation se fait')
          const images = await o.images()
          assert.ok(images.filter((x) => x === 'a').length >= 10, `l'ancienne page reste un moment : ${images.filter((x) => x === 'a').length} images`)
          assert.ok(await o.attendre("__trouve('.x')", 5000), 'la page x paraît à son arrivée')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('page déjà chargée : la bascule se fait dans le même tour, sans attente', async () => {
        const o = await ouvrir()
        try {
          await o.page.evaluate("__clic('#vb')")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.evaluate("__clic('#va')")
          assert.ok(await o.attendre("__trouve('.a')"), 'retour à a')
          assert.equal(await o.page.evaluate("__clic('#vb'), __trouve('.b')"), true, 'page b posée dans le même tour')
        }
        finally { await o.page.close() }
      })

      it('retour arrière vers une page pas encore chargée : sa position revient une fois la page posée', async function () {
        // Firefox piloté : après `reload()`, `history.back()` ne quitte pas l'entrée rechargée (adresse inchangée), avec ou sans attente
        if (nom === 'firefox') { this.skip() }
        const o = await ouvrir()
        try {
          await o.page.evaluate("__clic('#vd')")
          assert.ok(await o.attendre("__trouve('.d')"), 'la page de détail paraît')
          await o.page.evaluate('window.scrollTo(0, 900)')
          await o.page.waitForTimeout(100)
          await o.page.evaluate("__clic('#vb')")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.reload({ waitUntil: 'load' })
          assert.ok(await o.attendre("__trouve('.b')", 8000), 'la page b après rechargement')
          assert.equal(await o.page.evaluate("__defini('mjs-page-d')"), false, 'la page de détail n\'est pas chargée')
          await o.page.waitForTimeout(200)
          await o.page.evaluate('history.back()')
          assert.ok(await o.attendre("__trouve('.d')"), `la page de détail revient (adresse ${await o.page.evaluate('location.hash')}, vue ${await o.page.evaluate("['a', 'b', 'd'].filter((k) => __trouve('.' + k)).join('')")})`)
          await o.page.waitForTimeout(300)
          const y = await o.page.evaluate('Math.round(window.scrollY)')
          assert.ok(y >= 800, `position rendue : ${y}`)
        }
        finally { await o.page.close() }
      })

      it('µ.Router.to() vers une page lente, puis retour du navigateur pendant l\'attente : on revient à la page affichée', async () => {
        const o = await ouvrir(['page-b'])
        try {
          await o.page.evaluate("__clic('#vc')")
          assert.ok(await o.attendre("__trouve('.c')"), 'la page c paraît')
          await o.page.evaluate("window.µ.Router.to('/b'); history.back()")
          await o.page.waitForTimeout(1200)
          const vue = await o.page.evaluate("['a', 'b', 'c'].filter((k) => __trouve('.' + k)).join('')")
          assert.deepEqual([await o.page.evaluate('location.hash'), vue], ['#/c', 'c'], 'retour à la page c, affichée au moment de l\'appel')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('µ.Router.to() vers une page dont le fichier manque : la page du navigateur se recharge sur la destination', async () => {
        const o = await ouvrir([], [], ['page-x'])
        try {
          const recharge = o.page.waitForEvent('load', { timeout: 6000 })
          await o.page.evaluate("window.µ.Router.to('/x')")
          await recharge
          assert.equal(new URL(o.page.url()).hash, '#/x', 'rechargée sur la destination')
        }
        finally { await o.page.close() }
      })

      it('changement d\'adresse vers une page pas chargée : une seule attente (le hashchange ne la relance pas)', async () => {
        const o = await ouvrir(['page-b'])
        try {
          const g0 = await o.page.evaluate('window.µ.Router._mjs_navGen')
          await o.page.evaluate("location.hash = '#/b'")
          assert.ok(await o.attendre("__trouve('.b')"), 'la page b paraît')
          await o.page.waitForTimeout(100)
          const g1 = await o.page.evaluate('window.µ.Router._mjs_navGen')
          assert.equal(g1 - g0, 2, 'une attente, puis la navigation rejouée')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })
    }))
  }
})
