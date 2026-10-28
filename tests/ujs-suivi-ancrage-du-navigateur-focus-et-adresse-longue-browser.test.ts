// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, en développement et en
// production) : la position que la navigation rend ou suit tient contre l'ancrage de défilement du navigateur et cède au
// focus de l'utilisateur.
// - F5 répété, retour et avance par des chargements complets, sur une page dont un composant placé au-dessus se peint
//   après la reprise : la position revient telle quelle (avant : l'ancrage de défilement du navigateur décalait la page
//   de la hauteur du composant, la navigation le prenait pour un défilement étranger et cessait de la tenir) ;
// - arrivée sur une ancre dont la cible se peint tard : un focus déplacé sans défilement (lecteur d'écran) arrête le
//   suivi, la page reste où elle est et l'élément focalisé reste à l'écran (avant : la page sautait sur la cible) ; le
//   focus que la navigation pose elle-même après un échange de page (le titre) ne l'arrête pas ;
// - limite : une adresse de 2 048 caractères (chemin, paramètres et fragment) retrouve sa position au F5, une adresse
//   plus longue repart du haut (avant : la limite comptait aussi le nom que le navigateur donne à l'entrée, une adresse
//   de 2 048 caractères ne la retrouvait pas).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les composants : `boite` (3 000 px) se peint au-dessus du contenu une fois défini, après le cœur ; `tard` ne peint sa
// cible `#tardo`, dans son ombre, qu'après 1,5 s ; `app` porte les routes
const SOURCES: Record<string, string> = {
  'boite.mjs': '<p>boîte <a id="b-autre" href="/autre">autre</a></p>\n<div class="h"></div>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'app.page.mjs': '<routes target="app-view">\n  /       home-page\n  /about  about-page\n</routes>\n\n<@view app-view>\n\n<style>\n  :host\n    display: block\n</style>\n',
  'home-page.mjs': '<h1>Accueil</h1>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'about-page.mjs': '<h1>À propos</h1>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 2500px\n</style>\n',
  'tard.mjs': '<script>\n  $montre = false\n  µmount =>\n    setTimeout (=> $montre = true), 1500\n</script>\n\n<div class="h"></div>\n{if $montre}\n  <h2 id="tardo">Tard</h2>\n{end}\n<div class="h"></div>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
}

const PAGES: Record<string, string> = {
  '/haut':   '<mjs-boite></mjs-boite><div style="height:2000px"></div><h2 id="a">A</h2><div style="height:2000px"></div><h2 id="b">B</h2><div style="height:5000px"></div>',
  '/autre':  '<h1>Autre</h1><div style="height:2000px"></div>',
  '/tard':   '<h1 id="titre">Tard</h1><button id="haut-btn">haut</button><mjs-tard></mjs-tard><div style="height:6000px"></div>',
  '/depart': '<h1>Départ</h1><a id="vers-tard" href="/tard#tardo">tard</a>',
  '/longue': '<h1>Longue</h1><div style="height:5000px"></div>',
  '/r':      '<nav style="position:fixed;top:0;right:0;background:#fff;z-index:9"><a id="lr-about" href="#/about">à propos</a> <a id="lb2" href="#b2">b2</a></nav><mjs-app></mjs-app><div style="height:6000px"></div><h2 id="b2">B2</h2><div style="height:3000px"></div>',
}
// page sans la navigation (aucun bundle)
const SIMPLE = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Simple</h1></body></html>'
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// haut d'un élément par son id, ombres des composants comprises (`_shadow`, même fermée)
function haut(page: Page, id: string): Promise<number | null> {
  return page.evaluate((i) => {
    const t = (window as any).µ._mjs_anchorTarget('#' + i)
    return t && t.el ? Math.round(t.el.getBoundingClientRect().top + scrollY) : null
  }, id)
}

async function pose(page: Page, attente = 300): Promise<number> {
  await page.waitForTimeout(attente)
  return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(page: Page, y: number) {
  return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

describe('mjs_ujs navigateur réel, vrai projet — la position suivie contre l\'ancrage du navigateur et le focus de l\'utilisateur', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('suivi-ancrage-focus')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    for (const [variante, options] of [['dev', {}], ['prod', { env: 'prod' }]] as const) {
      const sortie  = join(dist, variante)
      const bundler = new Bundler({ sourceDir: src, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), urlPrefix: (variante === 'prod' ? '/prod' : '') + '/modularjs', ...options } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
    }
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`${nom}`, function () {
      let browser: Browser | null = null
      let server: Server | null  = null
      let origin  = ''
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        server  = createServer((req, res) => {
          const url   = new URL(req.url || '/', 'http://x')
          const prod  = url.pathname.startsWith('/prod/')
          const corps = PAGES[prod ? url.pathname.slice(5) : url.pathname]
          if (url.pathname === '/simple') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(SIMPLE)
            return
          }
          // `no-store` : ni cache HTTP ni cache arrière-avant, un retour recharge vraiment la page
          if (corps) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + (prod ? '/prod' : '') + '/modularjs/bundle.js"></script></head><body style="margin:0">' + corps + '</body></html>')
            return
          }
          const m       = /^(\/prod)?\/modularjs\/(.+)$/.exec(url.pathname)
          const fichier = m ? join(dist, m[1] ? 'prod' : 'dev', normalize(decodeURIComponent(m[2])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('introuvable'); return }
          res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          res.end(readFileSync(fichier))
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
        origin = 'http://127.0.0.1:' + (server!.address() as any).port
      })

      after(async () => {
        if (browser) await browser.close()
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      // la navigation chargée (elle coupe le défilement natif des entrées) ; la production n'expose pas `µ`
      function prete(page: Page) {
        return page.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      // la boîte peinte au-dessus du contenu
      function peinte(page: Page) {
        return page.waitForFunction(() => document.documentElement.scrollHeight > 12000, null, { timeout: 15000 })
      }

      // rechargement par la page (`location.reload()`, une entrée inchangée) : Playwright recharge Firefox par une
      // entrée neuve
      async function recharger(page: Page) {
        await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())])
        await prete(page)
      }

      async function partir(page: Page, chemin: string) {
        await Promise.all([page.waitForURL(u => u.pathname === chemin), page.evaluate((c) => { location.href = c }, chemin)])
        await prete(page)
      }

      async function parcourir(page: Page, chemin: string, geste: 'back' | 'forward') {
        await Promise.all([page.waitForURL(u => u.pathname === chemin), page.evaluate((g) => (g === 'back' ? history.back() : history.forward()), geste)])
        await prete(page)
      }

      it('F5 répété sur une page dont un composant placé au-dessus se peint après la reprise : la position revient telle quelle', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/haut')
        await peinte(page)
        const vus: number[] = []
        for (let i = 0; i < 3; i++) {
          await va(page, 6000)
          await pose(page, 100)
          await recharger(page)
          vus.push(await pose(page, 1200))
        }
        assert.deepEqual(vus, [6000, 6000, 6000], 'AVANT : la page finissait plus bas de la hauteur de la boîte, l\'ancrage du navigateur arrêtait le suivi')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      for (const prefixe of ['', '/prod']) {
        it(`retour puis avance par des chargements complets sur cette page (${prefixe ? 'production' : 'développement'}) : chaque entrée retrouve sa position`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/autre')
          await partir(page, prefixe + '/haut')
          await peinte(page)
          await va(page, 6000)
          await pose(page, 100)
          await partir(page, prefixe + '/autre')
          await parcourir(page, prefixe + '/haut', 'back')
          const vus = ['retour y=' + await pose(page, 1200)]
          await va(page, 1000)
          await pose(page, 100)
          await parcourir(page, prefixe + '/autre', 'back')
          await parcourir(page, prefixe + '/haut', 'forward')
          vus.push('avance y=' + await pose(page, 1200))
          assert.deepEqual(vus, ['retour y=6000', 'avance y=1000'], 'AVANT : la page finissait plus bas de la hauteur de la boîte')
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('arrivée sur une ancre dont la cible se peint tard : un focus déplacé sans défilement arrête le suivi, la page reste où elle est', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/tard#tardo')
        assert.equal(await haut(page, 'tardo'), null, 'témoin : la cible n\'existe pas encore')
        const avant = await pose(page, 100)
        // un lecteur d'écran en mode navigation déplace le focus sans défiler ni toucher au clavier de la page
        await page.evaluate(() => document.getElementById('haut-btn')!.focus({ preventScroll: true }))
        await page.waitForFunction(() => !!(window as any).µ._mjs_anchorTarget('#tardo'), null, { timeout: 15000 })
        const apres   = await pose(page, 600)
        const visible =await page.evaluate(() => { const r = document.getElementById('haut-btn')!.getBoundingClientRect(); return document.activeElement!.id === 'haut-btn' && r.bottom > 0 && r.top < innerHeight })
        assert.deepEqual([apres, visible], [avant, true], 'AVANT : la page sautait sur la cible (y=' + await haut(page, 'tardo') + '), l\'élément focalisé sortait de l\'écran')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('le focus que la navigation pose elle-même après un échange de page (le titre) n\'arrête pas le suivi : la page reçue va à sa cible peinte tard', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/depart')
        await page.click('#vers-tard')
        await page.waitForFunction(() => location.hash === '#tardo' && !!document.getElementById('titre'), null, { timeout: 15000 })
        await page.waitForFunction(() => !!(window as any).µ._mjs_anchorTarget('#tardo'), null, { timeout: 15000 })
        const y = await pose(page, 600)
        assert.deepEqual([y, await page.evaluate(() => document.activeElement!.id)], [await haut(page, 'tardo'), 'titre'])
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('Précédent jusqu\'à la première entrée de l\'onglet puis Suivant : une route et une ancre de la page retrouvent leur position', async function () {
        if (!present) return this.skip()
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + '/simple')
        await page.goto(origin + '/r')
        await prete(page)
        await page.waitForFunction(() => document.documentElement.scrollHeight > 10000, null, { timeout: 15000 })
        await page.click('#lr-about')
        await page.waitForFunction(() => location.hash === '#/about')
        await pose(page)
        await va(page, 700)
        await pose(page, 100)
        await page.click('#lb2')
        await pose(page)
        const b2 = await haut(page, 'b2')
        // jusqu'à la première entrée de l'onglet (Firefox n'en garde pas avant la première page), puis retour en avant ;
        // une page de la navigation rechargée attend son cœur (WebKit rend ces entrées avec le défilement natif)
        const geste = async (g: 'back' | 'forward') => {
          await page.evaluate((x) => (x === 'back' ? history.back() : history.forward()), g)
          await page.waitForTimeout(900)
          if (await page.evaluate(() => !!(window as any).µ)) { await page.waitForFunction(() => typeof (window as any).µ._mjs_anchorTarget === 'function', null, { timeout: 15000 }) }
          return page.evaluate(() => location.pathname + location.hash)
        }
        let u = ''
        for (let i = 0; i < 5 && u !== 'blank'; i++) {
          const avant = u
          u = await geste('back')
          if (u === avant) break
        }
        for (let i = 0; i < 5 && u !== '/r'; i++) {
          u = await geste('forward')
        }
        const vus: string[] = []
        for (const g of ['forward', 'forward', 'back', 'back'] as const) {
          u = await geste(g)
          vus.push(u + ' y=' + await pose(page, 300))
        }
        assert.deepEqual(vus, ['/r#/about y=700', '/r#b2 y=' + b2, '/r#/about y=700', '/r y=0'], 'AVANT (WebKit) : la route repartait d\'où la page était, le retour sur la page aussi')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('limite : une adresse de 2 048 caractères retrouve sa position au F5, une adresse plus longue repart du haut', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const longueur of [2048, 2049]) {
          const { page, erreurs } = await ouvrir('/longue?l=' + 'x'.repeat(longueur - '/longue?l='.length))
          await va(page, 1500)
          await pose(page, 100)
          await recharger(page)
          vus.push(longueur + ' y=' + await pose(page, 600))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['2048 y=1500', '2049 y=0'], 'AVANT : une adresse de 2 048 caractères repartait du haut')
      })
    })
  }
})
