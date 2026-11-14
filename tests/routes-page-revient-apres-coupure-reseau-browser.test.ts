// Une page d'une table de routes dont le fichier n'a pas pu arriver (réseau coupé) s'affiche à la visite suivante, une fois le
// réseau revenu, sans recharger la page du navigateur : le navigateur garde l'échec d'un import() pour une adresse, le fichier
// est redemandé sous une adresse neuve (`?mjs-retry=<n>`). Un module de page qui plante à son démarrage : l'erreur est dite à
// chaque visite, une demande de plus par visite au plus, aucune boucle, aucune définition en double. Sous "on", toutes les
// pages partent à l'ouverture, une fois chacune, et une page visitée avant l'arrivée de son code y est attendue comme ailleurs. Appli à unités séparées bâtie en production, servie par interception, vrais
// import(), sous "idle", "on" et "off". Chromium, Firefox et WebKit ensemble

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { playTogether } from './helpers/engines-together.js'

type Mode   = 'idle' | 'on' | 'off'
type Reponse = 'ok' | 'coupe' | 'plante-avant' | 'plante-apres' | 'lente'

const NOMS    = ['page-a', 'page-b', 'page-c', 'page-d', 'page-g']
const SOURCES: Record<string, string> = {
  // la garde de `/g` (composant posé à côté de la vue) renvoie vers la page que nomme `window.__garde` ; `window.__aller` = `µ.Router.to()`
  'shell.page.mjs': '<routes target="root">\n  /    page-a\n  /b   page-b\n  /c   page-c\n  /d   page-d\n  /g   page-g\n</routes>\n<@garde-x></@garde-x>\n<nav><a id="va" href="#/">A</a> <a id="vb" href="#/b">B</a> <a id="vc" href="#/c">C</a> <a id="vg" href="#/g">G</a></nav>\n<@view root>\n',
  'garde-x.mjs': '<script>\n  window.__aller = (d) -> µRouter.to(d)\n  µurlChange (path)->\n    µRouter.to(\'/\' + window.__garde, { replace: true }) if path === \'/g\' && window.__garde\n</script>\n<i></i>\n',
  ...Object.fromEntries(['a', 'b', 'c', 'd', 'g'].map((p) => [`page-${p}.mjs`, `<p class="${p}">${p.toUpperCase()}</p>\n`])),
}
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__defini = function(t) { return !!customElements.get(t); };',
].join('\n')
const HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-shell></mjs-shell><script type="module" src="/out/bundle.js"></script></body></html>'

const constructions = new Map<Mode, Promise<Map<string, Buffer>>>()
function construire(mode: Mode) {
  let p = constructions.get(mode)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`routes-coupure-${mode}`)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: 'split', env: 'prod', routesPreload: mode } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
      const fichiers = new Map<string, Buffer>()
      for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
      return fichiers
    })()
    constructions.set(mode, p)
  }
  return p
}

async function present(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try { return existsSync((await import('playwright') as any)[nom].executablePath()) }
  catch { return false }
}

describe('routes — une page revient seule après une coupure du réseau', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>) {
    playTogether(describe(nom, function () {
      this.timeout(200000)
      let browser: any = null

      before(async function () {
        if (!await present(nom)) { console.log(`  ℹ️  ${nom} non installé : tests sautés`); this.skip() }
        browser = await (await import('playwright') as any)[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async function () { if (browser) await browser.close() })

      // `reponses` : ce que reçoit chaque fichier de page, modifiable pendant le test ; `scripts` : les imports d'une page
      // (requête comprise), hors des `fetch` de la garde du paquet périmé
      async function ouvrir(mode: Mode, reponses: Record<string, Reponse>, sansRepos = false) {
        const fichiers   = await construire(mode)
        const page       = await browser.newPage()
        const exceptions = [] as string[]
        const erreurs    = [] as string[]
        const scripts    = [] as string[]
        // fichiers servis, quel que soit leur type de demande : sous "idle", les pages sont préchargées sans être exécutées
        const servis     = [] as string[]
        let documents    = 0
        page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
        page.on('console', (m: any) => { if (m.type() === 'error' && /Failed to import/.test(m.text())) erreurs.push(m.text()) })
        await page.addInitScript({ content: SONDE + (sansRepos ? '\nwindow.requestIdleCallback = function() { return 0; };' : '') })
        await page.route('http://localhost/**', async (route: any) => {
          const u = new URL(route.request().url())
          try {
            if (!u.pathname.startsWith('/out/')) { documents++; await route.fulfill({ status: 200, contentType: 'text/html', body: HTML }); return }
            const rel = u.pathname.slice(5)
            const f   = fichiers.get(rel)
            const n   = NOMS.find((x) => rel.startsWith(x + '-'))
            const r   = n ? reponses[n] ?? 'ok' : 'ok'
            if (n && route.request().resourceType() === 'script') scripts.push(n + u.search)
            if (!f) { await route.fulfill({ status: 404, body: '' }); return }
            if (r === 'coupe') { await route.abort('failed'); return }
            if (r === 'lente') await new Promise((res) => setTimeout(res, 800))
            const corps = r === 'plante-avant' ? 'throw new Error("démarrage");\n' + f : r === 'plante-apres' ? f + '\nthrow new Error("démarrage");\n' : f
            await route.fulfill({ status: 200, contentType: rel.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
            if (n) servis.push(n)
          }
          catch { /* page partie pendant le vol */ }
        })
        await page.goto('http://localhost/#/', { waitUntil: 'load' })
        const attendre = async (expr: string, ms = 5000): Promise<boolean> => {
          try { await page.waitForFunction(expr, null, { timeout: ms }); return true }
          catch { return false }
        }
        assert.ok(await attendre("__trouve('.a')", 8000), 'la première route a monté')
        const de = (n: string) => scripts.filter((s) => s === n || s.startsWith(n + '?'))
        // les autres pages arrivées d'avance : servies au repos ("idle", sans être exécutées) ; sous "on", chargées à l'ouverture
        // comme avant, donc définies (vérifié par `__defini` à l'appel)
        const arrivees = async (ms = 15000): Promise<boolean> => {
          const fin = Date.now() + ms
          while (Date.now() < fin && !['page-b', 'page-d', 'page-g'].every((n) => servis.includes(n))) await new Promise((r) => setTimeout(r, 50))
          return ['page-b', 'page-d', 'page-g'].every((n) => servis.includes(n))
        }
        return { page, exceptions, erreurs, scripts, de, attendre, arrivees, documents: () => documents }
      }

      for (const mode of ['idle', 'on', 'off'] as Mode[]) {
        it(`"${mode}" : page coupée, réseau revenu, la visite suivante l'affiche sans recharger`, async () => {
          const reponses: Record<string, Reponse> = { 'page-c': 'coupe' }
          const o = await ouvrir(mode, reponses)
          try {
            if (mode === 'off') {
              await o.page.evaluate("__clic('#vc')")
              await o.page.waitForTimeout(2500)
              assert.ok(o.erreurs.length > 0, 'la visite coupée dit son erreur')
              await o.page.evaluate("__clic('#va')")
              assert.ok(await o.attendre("__trouve('.a')"), 'retour sur A')
            }
            else assert.ok(await (mode === 'on' ? o.attendre("['mjs-page-b', 'mjs-page-d', 'mjs-page-g'].every(__defini)", 15000) : o.arrivees()), 'les autres pages sont arrivées d\'avance')
            assert.ok(o.de('page-c').length >= 1, 'la page coupée a été demandée')
            reponses['page-c'] = 'ok'
            await o.page.evaluate("__clic('#vc')")
            assert.ok(await o.attendre("__trouve('.c')", 5000), `réseau revenu : la page s'affiche (${JSON.stringify(o.scripts)})`)
            assert.deepEqual(o.de('page-c'), ['page-c', 'page-c?mjs-retry=1'], 'la seconde demande part sous une adresse neuve')
            assert.equal(o.documents(), 1, 'aucun rechargement de la page')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`"${mode}" : module qui plante avant sa définition, l'erreur est dite à chaque visite, sans boucle`, async () => {
          const o = await ouvrir(mode, { 'page-c': 'plante-avant' }, true)
          try {
            for (let visite = 1; visite <= 2; visite++) {
              await o.page.evaluate("__clic('#vc')")
              await o.page.waitForTimeout(2500)
              assert.equal(o.erreurs.length >= visite, true, `erreur dite à la visite ${visite} (${o.erreurs.length})`)
              await o.page.evaluate("__clic('#va')")
              assert.ok(await o.attendre("__trouve('.a')"), 'retour sur A')
            }
            const avant = o.de('page-c').length
            await o.page.waitForTimeout(1500)
            assert.equal(o.de('page-c').length, avant, `plus aucune demande sans visite : ${JSON.stringify(o.de('page-c'))}`)
            assert.equal(avant, mode === 'on' ? 3 : 2, `une demande par visite, plus celle de l'ouverture sous "on" : ${JSON.stringify(o.de('page-c'))}`)
            assert.equal(new Set(o.de('page-c')).size, avant, 'chaque demande sous une adresse neuve')
            assert.equal(o.exceptions.filter((e) => /define|defined|déjà/i.test(e)).length, 0, `aucune définition en double : ${JSON.stringify(o.exceptions)}`)
            assert.equal(o.documents(), 1, 'aucun rechargement de la page')
          }
          finally { await o.page.close() }
        })

        it(`"${mode}" : module qui plante après sa définition, la page s'affiche, jamais redemandée`, async () => {
          const o = await ouvrir(mode, { 'page-c': 'plante-apres' }, true)
          try {
            await o.page.evaluate("__clic('#vc')")
            assert.ok(await o.attendre("__trouve('.c')", 5000), 'la page définie s\'affiche')
            await o.page.evaluate("__clic('#va')")
            assert.ok(await o.attendre("__trouve('.a')"), 'retour sur A')
            await o.page.evaluate("__clic('#vc')")
            assert.ok(await o.attendre("__trouve('.c')", 5000), 'seconde visite')
            assert.deepEqual(o.de('page-c'), ['page-c'], 'une seule demande')
            assert.equal(o.exceptions.filter((e) => /define|defined|déjà/i.test(e)).length, 0, `aucune définition en double : ${JSON.stringify(o.exceptions)}`)
          }
          finally { await o.page.close() }
        })

        it(`"${mode}" : page coupée, réseau revenu, un nouveau clic sur le même lien l'affiche, sans entrée d'historique en plus`, async () => {
          const reponses: Record<string, Reponse> = { 'page-c': 'coupe' }
          const o = await ouvrir(mode, reponses)
          try {
            if (mode !== 'off') assert.ok(await (mode === 'on' ? o.attendre("['mjs-page-b', 'mjs-page-d', 'mjs-page-g'].every(__defini)", 15000) : o.arrivees()), 'les autres pages sont arrivées d\'avance')
            await o.page.evaluate("__clic('#vc')")
            await o.page.waitForTimeout(2500)
            assert.equal(await o.page.evaluate('location.hash'), '#/c')
            const historique = await o.page.evaluate('history.length')
            const avant      = o.de('page-c').length
            reponses['page-c'] = 'ok'
            await o.page.evaluate("__clic('#vc')")
            assert.ok(await o.attendre("__trouve('.c')", 5000), `le nouveau clic affiche C (${JSON.stringify(o.scripts)})`)
            assert.equal(o.de('page-c').length, avant + 1, 'une demande de plus')
            assert.match(o.de('page-c')[avant], /\?mjs-retry=\d+$/, 'sous une adresse neuve')
            assert.equal(await o.page.evaluate('history.length'), historique, 'aucune entrée d\'historique en plus')
            assert.equal(o.documents(), 1, 'aucun rechargement de la page')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`"${mode}" : page coupée à sa visite, réseau revenu, une garde qui renvoie vers elle l'affiche`, async () => {
          const reponses: Record<string, Reponse> = { 'page-c': 'coupe' }
          const o = await ouvrir(mode, reponses)
          try {
            if (mode !== 'off') assert.ok(await (mode === 'on' ? o.attendre("['mjs-page-b', 'mjs-page-d', 'mjs-page-g'].every(__defini)", 15000) : o.arrivees()), 'les autres pages sont arrivées d\'avance')
            await o.page.evaluate("__clic('#vc')")
            await o.page.waitForTimeout(2500)
            assert.ok(o.erreurs.length > 0, 'la visite coupée dit son erreur')
            await o.page.evaluate("__clic('#va')")
            assert.ok(await o.attendre("__trouve('.a')"), 'retour sur A')
            reponses['page-c'] = 'ok'
            await o.page.evaluate("window.__garde = 'c', __clic('#vg')")
            assert.ok(await o.attendre("__trouve('.c')", 5000), `la garde renvoie vers C, qui s'affiche (${JSON.stringify(o.scripts)}, adresse ${await o.page.evaluate('location.hash')}, vue ${await o.page.evaluate("['a', 'c', 'g'].filter((k) => __trouve('.' + k)).join('')")}, définie ${await o.page.evaluate("__defini('mjs-page-c')")})`)
            assert.equal(await o.page.evaluate('location.hash'), '#/c')
            assert.equal(await o.page.evaluate("__trouve('.g')"), false, 'la page gardée ne paraît pas')
            assert.equal(o.documents(), 1, 'aucun rechargement de la page')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it(`"${mode}" : page coupée, retour du navigateur pendant l'attente, réseau revenu, l'avance l'affiche`, async () => {
          const reponses: Record<string, Reponse> = { 'page-c': 'coupe' }
          const o = await ouvrir(mode, reponses)
          try {
            if (mode !== 'off') assert.ok(await (mode === 'on' ? o.attendre("['mjs-page-b', 'mjs-page-d', 'mjs-page-g'].every(__defini)", 15000) : o.arrivees()), 'les autres pages sont arrivées d\'avance')
            await o.page.evaluate("__clic('#vc'), new Promise((r) => setTimeout(() => { history.back(); r(0) }, 100))")
            await o.page.waitForTimeout(2000)
            assert.deepEqual([await o.page.evaluate('location.hash'), await o.page.evaluate("['a', 'c'].filter((k) => __trouve('.' + k)).join('')")], ['#/', 'a'], 'retour à A')
            reponses['page-c'] = 'ok'
            await o.page.evaluate('history.forward()')
            assert.ok(await o.attendre("__trouve('.c')", 5000), `l'avance affiche C (${JSON.stringify(o.scripts)})`)
            assert.equal(o.documents(), 1, 'aucun rechargement de la page')
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })
      }

      it('"on" : toutes les pages partent à l\'ouverture, une fois chacune, sans temps de repos', async () => {
        const o = await ouvrir('on', {}, true)
        try {
          assert.ok(await o.attendre("['mjs-page-b', 'mjs-page-c', 'mjs-page-d'].every(__defini)", 8000), 'toutes définies sans repos')
          await o.page.waitForTimeout(300)
          assert.deepEqual([...o.scripts].sort(), NOMS, 'une demande par page')
        }
        finally { await o.page.close() }
      })

      it('"on" : une page visitée avant l\'arrivée de son code est attendue, l\'ancienne page reste à l\'écran', async () => {
        const o = await ouvrir('on', { 'page-c': 'lente' }, true)
        try {
          const pendant = await o.page.evaluate("__clic('#vc'), new Promise((r) => setTimeout(() => r([__trouve('.a'), __trouve('.c')]), 150))")
          assert.deepEqual(pendant, [true, false], 'pendant l\'attente : A à l\'écran, C pas encore')
          assert.ok(await o.attendre("__trouve('.c') && !__trouve('.a')", 5000), 'puis C')
          assert.deepEqual(o.de('page-c'), ['page-c'], 'une seule demande')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      for (const mode of ['idle', 'on'] as Mode[]) it(`"${mode}" : une garde qui renvoie ailleurs agit dans le tour`, async () => {
        const o = await ouvrir(mode, {}, true)
        try {
          if (mode === 'idle') await o.page.evaluate("__clic('#vb')")
          assert.ok(await o.attendre("['mjs-page-b', 'mjs-page-g'].every(__defini) || (__clic('#vg') && false)", 8000), 'pages arrivées')
          await o.page.evaluate("__clic('#va')")
          assert.ok(await o.attendre("__trouve('.a')"), 'sur A')
          const vu = await o.page.evaluate("window.__garde = 'b', __clic('#vg'), [location.hash, ['a', 'b', 'g'].filter((k) => __trouve('.' + k)).join('')]")
          await o.page.waitForTimeout(300)
          const apres = await o.page.evaluate("[location.hash, ['a', 'b', 'g'].filter((k) => __trouve('.' + k)).join('')]")
          assert.deepEqual([vu, apres], [['#/b', 'b'], ['#/b', 'b']], 'B posée dans le même tour, G jamais')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })

      it('"on" : µ.Router.to() vers une page lente, puis retour du navigateur pendant l\'attente : on revient à la page affichée', async () => {
        const o = await ouvrir('on', { 'page-c': 'lente' }, true)
        try {
          await o.page.evaluate("__aller('/c'); history.back()")
          await o.page.waitForTimeout(1200)
          const vue = await o.page.evaluate("['a', 'c'].filter((k) => __trouve('.' + k)).join('')")
          assert.deepEqual([await o.page.evaluate('location.hash'), vue], ['#/', 'a'], 'retour à la page A, affichée au moment de l\'appel')
          assert.deepEqual(o.exceptions, [])
        }
        finally { await o.page.close() }
      })
    }))
  }
})
