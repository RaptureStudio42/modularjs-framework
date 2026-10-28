// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, en développement et en
// production) : l'ancre de l'adresse et les ancres d'une page faite de composants, comme dans le navigateur seul.
// - arrivée par une adresse dont la cible est dans l'ombre fermée d'un composant monté après le cœur, ou rendue plus tard
//   par un bloc `{if}` : la page y défile dès que la cible existe (avant : jamais, la cible se cherchait avant que les
//   composants soient définis) ; une cible de la page que les composants poussent plus bas reste en vue ;
// - la page ne bouge plus après un geste de l'utilisateur (molette), ni passé 10 s (Chromium seul : la limite est la
//   même minuterie dans les trois moteurs) ;
// - une page reçue par un lien vers l'ancre d'une autre page (`<base href>` qui pointe ailleurs, page déjà en cache
//   compris), ou par un formulaire `action="#b"`, va à son ancre (avant : en haut de la page, à la position gardée, ou
//   sur place) ;
// - un `preventDefault()` posé par l'application sur `document` (après la navigation) ou sur `window` retient l'ancre
//   (avant : l'ancre était suivie quand même) ;
// - le clic sur une ancre garde le `history.state` de l'entrée, `:target` et le parcours au clavier (avant : l'état
//   était effacé sous Chromium et Firefox) ;
// - avec `µ._anchorHistory`, une ancre déjà quittée, rejointe par un lien `mjs-no-ujs` ou par `location.hash`, y défile
//   (avant : la page revenait à la position qu'elle avait au départ de l'ancre).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les composants : la vue routée `home-page` porte ses cibles dans son ombre fermée ; `lent` ouvre son `{if}` après
// `window.delai` ms (400 par défaut)
const SOURCES: Record<string, string> = {
  'app.page.mjs': '<routes target="app-view">\n  /       home-page\n  /about  about-page\n</routes>\n\n<nav>\n  <a id="r-home" href="#/">accueil</a>\n  <a id="r-about" href="#/about">à propos</a>\n</nav>\n<@view app-view>\n\n<style>\n  :host\n    display: block\n  nav\n    position: fixed\n    top: 0\n    right: 0\n    background: #fff\n    z-index: 9\n</style>\n',
  'home-page.mjs': '<h1>Accueil</h1>\n<p><a id="in-sect" href="#sect">vers la section</a></p>\n<div class="h"></div>\n<h2 id="sect">Section</h2>\n<div class="h"></div>\n<h2 id="insh">Dans l\'ombre</h2>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'about-page.mjs': '<h1>À propos</h1>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 2500px\n</style>\n',
  'lent.page.mjs': '<script>\n  $montre = false\n  µmount =>\n    setTimeout (=> $montre = true), window.delai || 400\n</script>\n\n<h1>Lent</h1>\n<div class="h"></div>\n{if $montre}\n  <h2 id="tardive">Tardive</h2>\n{end}\n<div class="h"></div>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
  'hello.mjs': '<script>\n$count = 0\n</script>\n\n<button @click={$count++}>Clic {$count}</button>\n',
}

// les pages servies : le cœur arrive par `bundle.js` (module), les composants montent après lui
const NAV    = '<nav style="position:fixed;top:0;left:0;background:#fff;z-index:9;font-size:10px"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a> <a id="lnoujs" href="#a" mjs-no-ujs>a, sans la navigation</a> <a id="lvers" href="/r1#insh">insh de r1</a></nav>'
const ANCRES = NAV + '<mjs-hello></mjs-hello><form id="fx" action="#b"><button id="fxb">envoi</button></form><div style="height:1500px"></div><h2 id="a">A</h2><button id="apresA">après A</button><div style="height:1500px"></div><h2 id="b">B</h2><button id="apresB">après B</button><div style="height:3000px"></div>'
const PAGES: Record<string, { tete?: string, corps: string }> = {
  '/r1':          { corps: '<mjs-app></mjs-app><div style="height:8000px"></div><h2 id="hors">hors</h2><div style="height:3000px"></div>' },
  '/lent':        { corps: '<mjs-lent></mjs-lent>' },
  '/lent-geste':  { tete: '<script>window.delai = 1500</script>', corps: '<mjs-lent></mjs-lent>' },
  '/lent-limite': { tete: '<script>window.delai = 10500</script>', corps: '<mjs-lent></mjs-lent>' },
  '/ancres':      { corps: ANCRES },
  '/ailleurs':    { corps: ANCRES },
  '/base':        { tete: '<base href="/ailleurs">', corps: ANCRES },
}
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// haut d'un élément par son id, ombres des composants comprises (`_shadow`, même fermée) ; null s'il n'existe pas
function haut(page: Page, id: string): Promise<number | null> {
  return page.evaluate((i) => {
    const f = (n: any, d: number): any => {
      if (!n || d > 60) return null
      if (n.id === i) return n
      for (const c of (n.children || [])) { const r = f(c, d + 1); if (r) return r }
      if (n._shadow && n._shadow !== n) for (const c of n._shadow.children) { const r = f(c, d + 1); if (r) return r }
      return null
    }
    const e = f(document.documentElement, 0)
    return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null
  }, id)
}

async function pose(page: Page, attente = 300): Promise<number> {
  await page.waitForTimeout(attente)
  return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(page: Page, y: number) {
  return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

// la page est-elle sur sa cible (à un pixel près : Firefox défile au sous-pixel) ?
async function surLaCible(page: Page, id: string, attente = 600): Promise<string> {
  await page.waitForFunction((i) => {
    const f = (n: any, d: number): any => {
      if (!n || d > 60) return null
      if (n.id === i) return n
      for (const c of (n.children || [])) { const r = f(c, d + 1); if (r) return r }
      if (n._shadow && n._shadow !== n) for (const c of n._shadow.children) { const r = f(c, d + 1); if (r) return r }
      return null
    }
    return !!f(document.documentElement, 0)
  }, id, { timeout: 15000 })
  const y = await pose(page, attente)
  const h = await haut(page, id)
  return h !== null && Math.abs(y - h) <= 1 ? 'sur #' + id : 'y=' + y + ' (#' + id + ' à ' + h + ')'
}

describe('mjs_ujs navigateur réel, vrai projet — l\'ancre de l\'adresse et le dernier mot de l\'application', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('ancre-vrai-projet')
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
          const url  = new URL(req.url || '/', 'http://x')
          const prod = url.pathname.startsWith('/prod/')
          const p    = PAGES[prod ? url.pathname.slice(5) : url.pathname]
          if (p) {
            res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' })
            res.end('<!doctype html><html><head><meta charset="utf-8">' + (p.tete || '') + '<script type="module" src="' + (prod ? '/prod' : '') + '/modularjs/bundle.js"></script></head><body style="margin:0">' + p.corps + '</body></html>')
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

      // la page ouverte, la navigation chargée (elle coupe le défilement natif des entrées)
      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + chemin)
        await page.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
        return { page, erreurs }
      }

      it('arrivée par une adresse dont la cible est dans l\'ombre fermée d\'un composant monté après le cœur (développement et production) : la page y défile', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const chemin of ['/r1#insh', '/prod/r1#insh']) {
          const { page, erreurs } = await ouvrir(chemin)
          vus.push(chemin + ' ' + await surLaCible(page, 'insh'))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['/r1#insh sur #insh', '/prod/r1#insh sur #insh'], 'AVANT : la cible se cherchait avant que les composants soient définis, la page restait en haut')
      })

      it('arrivée sur une cible rendue plus tard par un bloc `{if}`, ou une cible de la page poussée plus bas par les composants : la page y va et l\'y garde', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const [chemin, id] of [['/lent#tardive', 'tardive'], ['/r1#hors', 'hors']]) {
          const { page, erreurs } = await ouvrir(chemin)
          if (id === 'hors') await page.waitForFunction(() => (window as any).µ && (window as any).µ._mjs_anchorTarget('#insh'), null, { timeout: 15000 })
          vus.push(chemin + ' ' + await surLaCible(page, id))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['/lent#tardive sur #tardive', '/r1#hors sur #hors'], 'AVANT : une cible rendue après le chargement n\'était jamais atteinte')
      })

      it('limite : après un geste de l\'utilisateur (molette), la cible qui apparaît ne fait plus bouger la page', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/lent-geste#tardive')
        await page.mouse.move(400, 300)
        await page.mouse.wheel(0, 400)
        const apresGeste = await pose(page, 500)
        assert.equal(await haut(page, 'tardive'), null, 'témoin : la cible n\'existe pas encore au moment du geste')
        await page.waitForFunction(() => (window as any).µ._mjs_anchorTarget('#tardive'), null, { timeout: 15000 })
        assert.equal(await pose(page, 600), apresGeste, 'la page reste où l\'utilisateur l\'a menée')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      if (nom === 'chromium') {
        it('limite : une cible qui n\'apparaît qu\'après 10 s ne fait plus bouger la page', async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir('/lent-limite#tardive')
          await page.waitForFunction(() => (window as any).µ._mjs_anchorTarget('#tardive'), null, { timeout: 20000 })
          assert.equal(await pose(page, 600), 0)
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('une page reçue par un lien vers l\'ancre d\'une autre page (cible dans l\'ombre d\'un composant, ou `<base href>` qui pointe ailleurs) va à son ancre', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        {
          const { page, erreurs } = await ouvrir('/ancres')
          await va(page, 1000)
          await page.click('#lvers')
          await page.waitForFunction(() => location.pathname === '/r1' && !document.getElementById('a'))
          vus.push('lien /r1#insh : ' + await surLaCible(page, 'insh'))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        {
          const { page, erreurs } = await ouvrir('/base')
          await page.evaluate(() => { document.getElementById('a')!.dataset.depart = '1' })
          await va(page, 1000)
          await page.click('#la')
          await page.waitForFunction(() => { const a = document.getElementById('a'); return location.pathname === '/ailleurs' && a && !a.dataset.depart })
          vus.push('<base> ' + await page.evaluate(() => location.pathname + location.hash) + ' : ' + await surLaCible(page, 'a'))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        {
          // la page quittée est en cache : un lien vers son ancre y va, au lieu de rendre la position qu'elle avait
          const { page, erreurs } = await ouvrir('/ancres')
          await va(page, 1000)
          await page.click('#lvers')
          await page.waitForFunction(() => location.pathname === '/r1' && !document.getElementById('a'))
          await pose(page)
          await page.evaluate(() => { const a = document.createElement('a'); a.id = 'retour'; a.href = '/ancres#b'; a.textContent = 'retour'; document.body.prepend(a) })
          await page.click('#retour')
          await page.waitForFunction(() => location.pathname === '/ancres' && !!document.getElementById('b'))
          vus.push('page en cache /ancres#b : ' + await surLaCible(page, 'b'))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['lien /r1#insh : sur #insh', '<base> /ailleurs#a : sur #a', 'page en cache /ancres#b : sur #b'], 'AVANT : la page reçue s\'ouvrait en haut, ou à la position gardée')
      })

      it('clic sur un lien dans l\'ombre fermée d\'un vrai composant vers une cible de la même ombre : la page y défile, l\'ancre remplace l\'entrée', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/r1')
        await page.waitForFunction(() => (window as any).µ && (window as any).µ._mjs_anchorTarget('#in-sect'), null, { timeout: 15000 })
        const longueur = await page.evaluate(() => history.length)
        const boite    = await page.evaluate(() => { const r = (window as any).µ._mjs_anchorTarget('#in-sect').el.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 } })
        await page.mouse.click(boite.x, boite.y)
        assert.equal(await surLaCible(page, 'sect', 300), 'sur #sect')
        assert.equal(await page.evaluate(() => location.hash), '#sect')
        assert.equal(await page.evaluate(() => history.length), longueur)
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('un formulaire `action="#b"` : la page reçue va à son ancre', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/ancres')
        await page.evaluate(() => { document.getElementById('b')!.dataset.depart = '1' })
        await va(page, 1000)
        await page.click('#fxb')
        await page.waitForFunction(() => { const b = document.getElementById('b'); return b && !b.dataset.depart })
        assert.equal(await page.evaluate(() => location.hash), '#b')
        assert.equal(await surLaCible(page, 'b'), 'sur #b', 'AVANT : la page restait sur place')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('un `preventDefault()` de l\'application sur `document` (posé après la navigation) ou sur `window` retient l\'ancre', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const ou of ['aucun', 'document', 'window']) {
          const { page, erreurs } = await ouvrir('/ancres')
          await page.evaluate((o) => {
            const f = (e: Event) => { if ((e.target as Element).closest('a[href^="#"]')) e.preventDefault() }
            if (o === 'document') document.addEventListener('click', f)
            if (o === 'window') window.addEventListener('click', f)
          }, ou)
          await va(page, 1000)
          await page.click('#lb')
          const y = await pose(page)
          const b = await haut(page, 'b')
          const h = await page.evaluate(() => location.hash)
          vus.push(ou + ' : ' + (h === '#b' && b !== null && Math.abs(y - b) <= 1 ? 'suivie' : h === '' && y === 1000 ? 'retenue' : 'hash=' + h + ' y=' + y))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['aucun : suivie', 'document : retenue', 'window : retenue'], 'AVANT : l\'ancre était suivie malgré le preventDefault() de l\'application')
      })

      it('le clic sur une ancre garde `history.state` de l\'entrée, `:target` et le parcours au clavier', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/ancres')
        const longueur = await page.evaluate(() => history.length)
        await page.evaluate(() => history.replaceState({ filtre: 'x' }, ''))
        await page.click('#la')
        assert.equal(await surLaCible(page, 'a', 300), 'sur #a')
        assert.deepEqual(await page.evaluate(() => history.state), { filtre: 'x' }, 'AVANT : l\'état de l\'entrée était effacé (Chromium, Firefox)')
        assert.equal(await page.evaluate(() => document.querySelector(':target')?.id), 'a')
        assert.equal(await page.evaluate(() => history.length), longueur)
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'apresA')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('avec µ._anchorHistory, une ancre déjà quittée, rejointe par `location.hash` ou par un lien `mjs-no-ujs`, y défile', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const comment of ['location.hash', 'mjs-no-ujs']) {
          const { page, erreurs } = await ouvrir('/ancres')
          await page.evaluate(() => { (window as any).µ._anchorHistory = true })
          await page.click('#la'); await pose(page)
          await page.evaluate(() => scrollBy(0, 600)); await pose(page, 100)
          await page.click('#lb'); await pose(page)
          if (comment === 'location.hash') await page.evaluate(() => { location.hash = '#a' })
          else await page.click('#lnoujs')
          vus.push(comment + ' : ' + await surLaCible(page, 'a', 500))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['location.hash : sur #a', 'mjs-no-ujs : sur #a'], 'AVANT : la page revenait à la position que l\'ancre avait à son départ')
      })
    })
  }
})
