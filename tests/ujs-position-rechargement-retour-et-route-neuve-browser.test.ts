// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, développement) : la position
// de la page et des routes, comme dans le navigateur seul.
// - rechargement (F5) d'une page défilée, page faite de composants peinte après le chargement comprise : la position
//   revient (avant : en haut, la navigation coupe le défilement natif et ne gardait ses positions qu'en mémoire) ;
// - F5 sur une adresse à ancre défilée ailleurs : la position gardée de l'entrée passe avant l'ancre ; une entrée neuve
//   de la même adresse (adresse tapée) va à l'ancre ;
// - retour sur une page quittée par une navigation complète, ou par un lien de la navigation puis par une navigation
//   complète : chaque page retrouve sa position (avant : en haut) ;
// - une route `#/…` neuve (lien, µ.Router.to) part du haut de la page, le retour arrière rend la position de la route
//   quittée (avant : la page restait où elle était) ; µ.url.hash suit une ancre ordinaire (avant : périmé) ;
// - avec µ._anchorHistory, chaque entrée garde sa position : #a, #b, #a puis quatre retours arrière rendent celles du
//   navigateur seul (avant : la première entrée de #a prenait la position de la seconde).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les composants : `app` porte les routes, `home-page` une ancre de son ombre ; `lent` ne grandit qu'après 400 ms
const SOURCES: Record<string, string> = {
  'app.page.mjs': '<routes target="app-view">\n  /       home-page\n  /about  about-page\n</routes>\n\n<nav>\n  <a id="r-home" href="#/">accueil</a>\n  <a id="r-about" href="#/about">à propos</a>\n</nav>\n<@view app-view>\n\n<style>\n  :host\n    display: block\n  nav\n    position: fixed\n    top: 0\n    right: 0\n    background: #fff\n    z-index: 9\n</style>\n',
  'home-page.mjs': '<h1>Accueil</h1>\n<p><a id="in-sect" href="#sect">vers la section</a></p>\n<div class="h"></div>\n<h2 id="sect">Section</h2>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'about-page.mjs': '<h1>À propos</h1>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 2500px\n</style>\n',
  'lent.page.mjs': '<script>\n  $montre = false\n  µmount =>\n    setTimeout (=> $montre = true), 400\n</script>\n\n<h1>Lent</h1>\n{if $montre}\n  <div class="h"></div>\n  <div class="h"></div>\n  <div class="h"></div>\n{end}\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
}

const NAV   = '<nav style="position:fixed;top:0;left:0;background:#fff;z-index:9;font-size:10px"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a> <a id="lhaut" href="#">haut</a> <a id="lail" href="/ailleurs">ailleurs</a></nav>'
const PAGES: Record<string, string> = {
  '/longue':   NAV + '<div style="height:1500px"></div><h2 id="a">A</h2><div style="height:1500px"></div><h2 id="b">B</h2><div style="height:3000px"></div>',
  '/ailleurs': '<h1>Ailleurs</h1><div style="height:4000px"></div>',
  '/autre':    '<h1>Autre</h1>',
  '/lent':     '<mjs-lent></mjs-lent>',
  '/r1':       '<mjs-app></mjs-app><div style="height:8000px"></div>',
}
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

// clic au pointeur sur un élément de la page, ombre fermée d'un composant comprise
async function clique(page: Page, id: string) {
  await page.waitForFunction((i) => !!(window as any).µ._mjs_anchorTarget('#' + i), id, { timeout: 15000 })
  const boite = await page.evaluate((i) => { const r = (window as any).µ._mjs_anchorTarget('#' + i).el.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 3 } }, id)
  await page.mouse.click(boite.x, boite.y)
}

describe('mjs_ujs navigateur réel, vrai projet — la position au rechargement, au retour et aux routes neuves', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('position-rechargement')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    const bundler = new Bundler({ sourceDir: src, outputDir: dist, manifestPath: join(dist, 'bundle.js'), urlPrefix: '/modularjs' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
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
          const url    = new URL(req.url || '/', 'http://x')
          const corps  = PAGES[url.pathname]
          // `no-store` : ni cache HTTP ni cache arrière-avant, un retour recharge vraiment la page
          if (corps) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body style="margin:0">' + corps + '</body></html>')
            return
          }
          const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
          const fichier = m ? join(dist, normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
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

      // la navigation chargée (elle coupe le défilement natif des entrées)
      function prete(page: Page) {
        return page.waitForFunction(() => history.scrollRestoration === 'manual' && !!(window as any).µ && typeof (window as any).µ._mjs_anchorTarget === 'function', null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      // rechargement par la page (`location.reload()`, une entrée inchangée) : Playwright recharge Firefox par une
      // entrée neuve
      async function recharger(page: Page) {
        await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())])
        await prete(page)
      }

      // navigation complète vers une autre page, chargée avant d'en repartir (un départ pendant le chargement coupe ses
      // fichiers en route, ce que Firefox écrit en erreur de page)
      async function partir(page: Page, chemin: string) {
        await Promise.all([page.waitForURL(u => u.pathname === chemin), page.evaluate((c) => { location.href = c }, chemin)])
        await prete(page)
      }

      async function retour(page: Page, chemin: string) {
        await Promise.all([page.waitForURL(u => u.pathname === chemin), page.evaluate(() => history.back())])
        await prete(page)
      }

      it('F5 sur une page défilée, et sur une page de composants peinte après le chargement : la position revient', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        {
          const { page, erreurs } = await ouvrir('/longue')
          await va(page, 1200)
          await recharger(page)
          vus.push('/longue y=' + await pose(page, 600))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        {
          const { page, erreurs } = await ouvrir('/lent')
          await page.waitForFunction(() => document.documentElement.scrollHeight > 4000, null, { timeout: 15000 })
          await va(page, 3000)
          await recharger(page)
          vus.push('/lent y=' + await pose(page, 1200))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['/longue y=1200', '/lent y=3000'], 'AVANT : y=0, la position n\'était gardée qu\'en mémoire')
      })

      it('F5 sur une adresse à ancre défilée ailleurs : la position gardée de l\'entrée passe avant l\'ancre ; une entrée neuve de la même adresse va à l\'ancre', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/longue#a')
        const a = await haut(page, 'a')
        assert.equal(await pose(page, 600), a, 'témoin : l\'arrivée va à l\'ancre')
        await va(page, 2500)
        await recharger(page)
        assert.equal(await pose(page, 600), 2500, 'AVANT : la page revenait sur l\'ancre')
        await page.goto(origin + '/autre')
        await prete(page)
        await page.goto(origin + '/longue#a')
        await prete(page)
        assert.equal(await pose(page, 600), a, 'une entrée neuve va à son ancre, jamais à la position d\'une autre entrée')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('retour sur une page quittée par une navigation complète : la position revient', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/longue')
        await va(page, 1400)
        await partir(page, '/autre')
        await retour(page, '/longue')
        assert.equal(await pose(page, 600), 1400, 'AVANT : y=0')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('retour sur des pages quittées par un lien de la navigation puis par une navigation complète : chacune retrouve sa position', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/longue')
        await va(page, 1000)
        await page.click('#lail')
        await page.waitForFunction(() => location.pathname === '/ailleurs' && !document.getElementById('a'))
        await va(page, 600)
        await partir(page, '/autre')
        await retour(page, '/ailleurs')
        const ailleurs = await pose(page, 600)
        await retour(page, '/longue')
        const longue = await pose(page, 600)
        assert.deepEqual(['/ailleurs y=' + ailleurs, '/longue y=' + longue], ['/ailleurs y=600', '/longue y=1000'], 'AVANT : y=0 aux deux retours')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une route `#/…` neuve (lien, µ.Router.to) part du haut de la page ; le retour arrière rend la position de la route quittée', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/r1#/')
        await page.waitForFunction(() => !!(window as any).µ._mjs_anchorTarget('#sect'), null, { timeout: 15000 })
        const vus: string[] = []
        await va(page, 900)
        await clique(page, 'r-about')
        await page.waitForFunction(() => location.hash === '#/about' && !!(window as any).µ._mjs_anchorTarget('#r-about'))
        vus.push('lien ' + await page.evaluate(() => location.hash) + ' y=' + await pose(page))
        await page.evaluate(() => history.back())
        await page.waitForFunction(() => location.hash === '#/')
        vus.push('retour ' + await page.evaluate(() => location.hash) + ' y=' + await pose(page))
        await page.evaluate(() => (window as any).µ.Router.to('/about'))
        await page.waitForFunction(() => location.hash === '#/about')
        vus.push('µ.Router.to ' + await page.evaluate(() => location.hash) + ' y=' + await pose(page))
        assert.deepEqual(vus, ['lien #/about y=0', 'retour #/ y=900', 'µ.Router.to #/about y=0'], 'AVANT : la route neuve restait à y=900')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('µ.url.hash et µ.url.href suivent une ancre ordinaire suivie depuis une route', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/r1#/')
        await clique(page, 'in-sect')
        await page.waitForFunction(() => location.hash === '#sect')
        await page.waitForTimeout(200)
        const url = await page.evaluate(() => { const µ = (window as any).µ; return [µ.url.hash, µ.url.href === location.href] })
        assert.deepEqual(url, ['#sect', true], 'AVANT : µ.url.hash restait sur #/ et µ.url.href sur l\'adresse de la route')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('avec µ._anchorHistory : #a, #b, #a, haut puis quatre retours arrière et une avance rendent la position de chaque entrée', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/longue')
        await page.evaluate(() => { (window as any).µ._anchorHistory = true })
        const a = (await haut(page, 'a'))!
        const b = (await haut(page, 'b'))!
        await va(page, 400)
        await page.click('#la'); await pose(page)
        await page.evaluate(() => scrollBy(0, 600)); await pose(page, 100)
        await page.click('#lb'); await pose(page)
        await page.click('#la'); await pose(page)
        await page.click('#lhaut'); await pose(page)
        const vus: string[] = []
        for (const geste of ['back', 'back', 'back', 'back', 'forward']) {
          await page.evaluate((g) => (g === 'back' ? history.back() : history.forward()), geste)
          const y = await pose(page, 400)
          vus.push(geste + ' ' + await page.evaluate(() => location.hash) + ' y=' + y)
        }
        assert.deepEqual(vus, ['back #a y=' + a, 'back #b y=' + b, 'back #a y=' + (a + 600), 'back  y=400', 'forward #a y=' + (a + 600)], 'AVANT : la première entrée de #a rendait la position de la seconde (y=' + a + ')')
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
