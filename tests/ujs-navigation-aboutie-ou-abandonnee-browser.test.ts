// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler) : une navigation qui arrive,
// ou que le visiteur abandonne, ne laisse rien derrière elle.
// - lien que le serveur redirige vers la page affichée, formulaire GET renvoyé à la même adresse, lien vers une page
//   lente puis lien vers la page affichée avant sa réponse : la navigation arrivée, un retour sur l'ancre de la page y
//   ramène (avant : il passait pour l'abandon d'une navigation en vol, la page restait où elle était) ; de même pour la
//   position d'une entrée sans fragment de la page, rendue au retour (avant : sautée) ;
// - focus d'après l'échange : un champ `autofocus` qui ne peut pas prendre le focus (dans un `<dialog>` fermé, un
//   `popover` caché, une partie `inert` ou `hidden`, désactivé) n'est pas choisi (avant : le focus restait sur
//   `<body>`) ; à défaut, le premier titre `<h1>` du contenu reçu qui peut le prendre, où qu'il s'y trouve (avant : il
//   n'était cherché que dans le premier élément reçu, une barre `<nav>` avant le titre prenait le focus) ;
// - départ refusé puis navigation de la page : la marque du départ tombe, un module introuvable recharge de nouveau la
//   page (avant : jamais) ;
// - formulaire `POST` en vol puis retour sur l'ancre de la page : l'envoi est abandonné, sa page ne s'installe pas sous
//   l'adresse de l'ancre (avant : elle s'y installait), et une page gardée est ensuite redemandée au serveur, que
//   l'envoi a pu modifier ;
// - retour sur une page gardée pendant une navigation en vol (trois Précédent de suite, retour de deux entrées) :
//   `µ.nav.active` retombe (avant : il restait à `true`) et la barre de navigation ne reste pas à l'écran (avant : elle
//   y restait sans routeur).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'boite.mjs':  '<p>boîte</p>\n\n<style>\n  :host\n    display: block\n</style>\n',
  // dans le manifeste, jamais servi : un bundle périmé
  'tardif.mjs': '<p>tardif</p>\n\n<style>\n  :host\n    display: block\n</style>\n',
}

const LIENS = ['lent', 's1', 's2', 's3', 'p1', 'p2', 'redir', 'fd', 'fpop', 'fx', 'fh', 'fn']
const NAV   = (x: string) => '<nav id="nav" style="position:fixed;top:0;right:0;background:#fff;z-index:9;font-size:10px">'
  + LIENS.map(n => '<a id="l' + n + '" href="' + x + '/' + n + '">' + n + '</a> ').join('')
  + '<a id="lp2b" href="' + x + '/p2#b2">p2#b2</a> <a id="lp2r" href="' + x + '/p2#/r2">p2#/r2</a> <a id="lautre" mjs-no-ujs href="' + x + '/autre">autre</a>'
  + '<form id="fpost" method="post" action="' + x + '/post"><input name="a" value="1" aria-label="a"><button id="envoipost">post</button></form>'
  + '<form id="fsame" action="' + x + '/p2"><button id="envoisame">même</button></form></nav>'
const page  = (x: string, id: string) => NAV(x) + '<p id="nom-' + id + '">' + id + '</p><div style="height:3000px"></div>'
const PAGES: Record<string, (x: string) => string> = {
  '/p1':   (x) => page(x, 'p1'),
  '/lent': (x) => page(x, 'lent'),
  '/s1':   (x) => page(x, 's1'),
  '/s2':   (x) => page(x, 's2'),
  '/s3':   (x) => page(x, 's3'),
  '/p2':   (x) => NAV(x) + '<p id="nom-p2">p2</p><mjs-boite></mjs-boite><div style="height:3000px"></div><h2 id="b2">B2</h2><div style="height:3000px"></div>',
  '/fd':   (x) => NAV(x) + '<h1 id="titre-fd">FD</h1><p>texte</p><dialog id="dlg"><input id="dlgIn" autofocus aria-label="d"></dialog>',
  '/fpop': (x) => NAV(x) + '<h1 id="titre-fpop">FP</h1><p>texte</p><div popover id="pop"><input id="popIn" autofocus aria-label="p"></div>',
  // titres qui ne peuvent pas prendre le focus avant le vrai, puis aucun titre qui le peut
  '/fh':   (x) => NAV(x) + '<dialog><h1 id="h-dlg">D</h1></dialog><div popover><h1 id="h-pop">P</h1></div><div hidden><h1 id="h-cache">C</h1></div><div inert><h1 id="h-inerte">I</h1></div><p>texte</p><h1 id="titre-fh">FH</h1>',
  '/fn':   (x) => NAV(x) + '<dialog><h1 id="h-seul">S</h1></dialog><p id="titre-fn">fn</p>',
  '/fx':   (x) => NAV(x) + '<h1 id="titre-fx">FX</h1><div inert><input id="fx1" autofocus aria-label="1"></div><div hidden><input id="fx2" autofocus aria-label="2"></div><input id="fx3" autofocus disabled aria-label="3"><dialog><input id="fx4" autofocus aria-label="4"></dialog><div popover><input id="fx5" autofocus aria-label="5"></div><input id="vrai" autofocus aria-label="vrai">',
  // page d'entrée dont le champ `autofocus` a pris le focus au chargement : le navigateur ne pose plus lui-même celui
  // d'un contenu reçu ensuite
  '/fa':   (x) => NAV(x) + '<p id="nom-fa">fa</p><input id="initial" autofocus aria-label="i">',
  '/conf': (x) => NAV(x) + '<p id="nom-conf">conf</p><script>addEventListener("beforeunload", function(e) { e.preventDefault(); e.returnValue = "" })</script>',
}
// pages lentes : elles répondent après le geste suivant du test ; `/s1`, `/s2`, `/s3` ne sont jamais archivées par la navigation
const LENT   = 1200
const LENTES = ['/lent', '/s1', '/s2', '/s3']
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }
// variantes construites : développement, production, développement sans routeur (la barre de navigation n'y est
// retirée que par la navigation elle-même)
const VARIANTES: Record<string, any> = {
  '':      { runtime: ['ujs', 'router', 'ajax', 'vault'] },
  '/prod': { runtime: ['ujs', 'router', 'ajax', 'vault'], env: 'prod' },
  '/nr':   { runtime: ['ujs', 'ajax', 'vault'] },
}

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

async function pose(p: Page, attente = 300): Promise<number> {
  await p.waitForTimeout(attente)
  return p.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(p: Page, y: number) {
  return p.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

// adresse (chemin et fragment), pages présentes, barre de navigation à l'écran, `µ.nav.active` (`µ` n'est exposé qu'en
// développement)
function etat(p: Page) {
  return p.evaluate(() => {
    const w = window as any
    return {
      adresse: location.pathname + location.hash,
      pages:   Array.from(document.querySelectorAll('[id^="nom-"]')).map(e => e.id.slice(4)).join(','),
      barre:   !!document.querySelector('.mjs-nav-progress'),
      active:  !!(w.µ && w.µ.nav && w.µ.nav.active),
    }
  })
}

// l'élément actif, ombres comprises : balise et id
function actif(p: Page) {
  return p.evaluate(() => {
    let a = document.activeElement as any
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement
    return a ? a.tagName + (a.id ? '#' + a.id : '') : 'aucun'
  })
}

describe('mjs_ujs navigateur réel, vrai projet — une navigation arrivée ou abandonnée ne laisse rien derrière elle', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('navigation-aboutie-ou-abandonnee')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    // les pages viennent du serveur, aucune source ne se sert de la navigation : ses modules sont nommés, avec `vault`
    // pour `µ.nav`
    for (const [x, options] of Object.entries(VARIANTES)) {
      const sortie  = join(dist, x || '/dev')
      const bundler = new Bundler({ sourceDir: src, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), urlPrefix: x + '/modularjs', ...options } as any)
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
      const demandes: Record<string, number> = {}
      const ouvertes: Page[] = []

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        server  = createServer((req, res) => {
          const url    = new URL(req.url || '/', 'http://x')
          const x      = Object.keys(VARIANTES).find(v => v && url.pathname.startsWith(v + '/')) || ''
          const chemin = url.pathname.slice(x.length)
          const html   = (corps: string) => '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + x + '/modularjs/bundle.js"></script></head><body style="margin:0">' + corps + '</body></html>'
          if (req.method === 'GET') demandes[url.pathname] = (demandes[url.pathname] || 0) + 1
          if (chemin === '/redir') { res.writeHead(302, { location: x + '/p2' }); res.end(); return }
          if (chemin === '/autre') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><p id="autre">autre</p>'); return }
          if (chemin === '/post' && req.method === 'POST') {
            req.resume()
            setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html(page(x, 'post'))) }, LENT)
            return
          }
          const corps = PAGES[chemin]
          // `no-store` : ni cache HTTP ni cache arrière-avant
          if (corps) {
            const envoi = () => {
              const entetes: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
              if (/^\/s\d$/.test(chemin)) entetes['x-mjs-cache'] = 'no-cache'
              res.writeHead(200, entetes)
              res.end(html(corps(x)))
            }
            if (LENTES.includes(chemin)) setTimeout(envoi, LENT)
            else envoi()
            return
          }
          const m       = /^\/modularjs\/(.+)$/.exec(chemin)
          const fichier = m ? join(dist, x || '/dev', normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || /tardif/.test(fichier) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('introuvable'); return }
          res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          res.end(readFileSync(fichier))
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
        origin = 'http://127.0.0.1:' + (server!.address() as any).port
      })

      // une page laissée ouverte par un cas en échec ne s'accumule pas
      afterEach(async () => {
        for (const p of ouvertes.splice(0)) await p.close().catch(() => {})
      })

      after(async () => {
        if (browser) await browser.close()
        if (server) { (server as any).closeAllConnections?.(); await new Promise(resolve => server!.close(() => resolve(null))) }
      })

      // la navigation chargée (elle coupe le défilement natif des entrées)
      function prete(p: Page) {
        return p.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const p       = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        ouvertes.push(p)
        p.on('pageerror', e => erreurs.push(e.message))
        await p.goto(origin + chemin)
        await prete(p)
        return { p, erreurs }
      }

      async function arrivee(p: Page, id: string) {
        await p.waitForSelector('#nom-' + id, { state: 'attached', timeout: 15000 })
        await pose(p)
      }

      function adresse(p: Page, a: string) {
        return p.waitForFunction((c) => location.pathname + location.hash === c, a, { timeout: 5000 })
      }

      // la page `p2` affichée marquée, puis l'arrivée d'une page `p2` neuve sous l'adresse sans fragment
      function marquer(p: Page) {
        return p.evaluate(() => { (document.getElementById('nom-p2') as any).__ancien = 1 })
      }
      async function neuve(p: Page, a: string) {
        await p.waitForFunction((c) => { const e = document.getElementById('nom-p2') as any; return location.pathname === c && !location.hash && !!e && !e.__ancien }, a, { timeout: 8000 })
        await pose(p)
      }

      // retour de `n` entrées, rendu une fois l'événement `popstate` traité par la navigation
      function retour(p: Page, n: number) {
        return p.evaluate((d) => new Promise(ok => { addEventListener('popstate', () => setTimeout(ok, 0), { once: true }); history.go(d) }), -n)
      }

      // défilement à 500 sur la page arrivée, puis retour sur une entrée de la même page : elle revient à `attendu`
      async function revient(p: Page, n: number, a: string, attendu: number, message: string) {
        await va(p, 500)
        await retour(p, n)
        await adresse(p, a)
        const y = await pose(p, 800)
        assert.ok(Math.abs(y - attendu) <= 2, message + ' — y=' + y + ' au lieu de ' + attendu)
        assert.equal((await etat(p)).pages, 'p2', 'la page reste celle de l\'entrée')
      }

      for (const x of ['', '/prod']) {
        const variante = x ? 'production' : 'développement'

        it(`lien que le serveur redirige vers la page affichée, puis Précédent sur l'ancre d'où il est parti : la page revient à l'ancre (${variante})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          await p.click('#lp2b')
          await arrivee(p, 'p2')
          const y1 = await pose(p)
          assert.ok(y1 > 2500, 'la page reçue est à son ancre : y=' + y1)
          await marquer(p)
          await p.click('#lredir')
          await neuve(p, x + '/p2')
          await revient(p, 1, x + '/p2#b2', y1, 'AVANT : le retour passait pour l\'abandon d\'une navigation en vol, la page restait où elle était')
          assert.deepEqual(erreurs, [])
          await p.close()
        })
      }

      it('formulaire GET renvoyé à l\'adresse de la page affichée, puis Précédent sur l\'ancre d\'où il est parti : la page revient à l\'ancre', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        await p.click('#lp2b')
        await arrivee(p, 'p2')
        const y1 = await pose(p)
        await marquer(p)
        await p.click('#envoisame')
        await neuve(p, '/p2')
        await revient(p, 1, '/p2#b2', y1, 'AVANT : le retour passait pour l\'abandon d\'une navigation en vol')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('lien vers une page lente, puis lien vers la page affichée avant sa réponse, puis retour sur l\'ancre de la page : la page revient à l\'ancre', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        await p.click('#lp2b')
        await arrivee(p, 'p2')
        const y1 = await pose(p)
        await p.click('#llent')
        await adresse(p, '/lent')
        await p.click('#lp2')
        await adresse(p, '/p2')
        await pose(p)
        await revient(p, 2, '/p2#b2', y1, 'AVANT : le retour passait pour l\'abandon d\'une navigation en vol')
        await pose(p, LENT)
        assert.equal((await etat(p)).pages, 'p2', 'la page lente, abandonnée, ne s\'installe pas')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('route de la page, lien redirigé vers la page affichée, puis retour sur l\'entrée sans fragment : la position de cette entrée revient', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        await p.click('#lp2')
        await arrivee(p, 'p2')
        await va(p, 2000)
        assert.equal(await pose(p, 100), 2000, 'défilement du test à 2 000 avant la route')
        await p.click('#lp2r')
        await adresse(p, '/p2#/r2')
        await pose(p)
        await marquer(p)
        await p.click('#lredir')
        await neuve(p, '/p2')
        await revient(p, 2, '/p2', 2000, 'AVANT : la position de l\'entrée était sautée')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('focus après l\'échange : le champ autofocus d\'un dialog fermé ou d\'un popover caché, hors du premier élément, n\'est pas choisi, le titre <h1> qui suit la barre <nav> l\'a', async function () {
        if (!present) return this.skip()
        const res: Record<string, string> = {}
        for (const n of ['fd', 'fpop']) {
          const { p } = await ouvrir('/p1')
          await p.click('#l' + n)
          await p.waitForSelector('#titre-' + n, { state: 'attached', timeout: 8000 })
          await pose(p)
          res[n] = await actif(p)
          await p.close()
        }
        assert.deepEqual(res, { fd: 'H1#titre-fd', fpop: 'H1#titre-fpop' }, 'AVANT : le focus allait à la barre <nav>, premier élément reçu')
      })

      it('focus après l\'échange : le premier titre <h1> qui peut prendre le focus (ni dans un dialog fermé, ni dans un popover caché, ni hidden, ni inert) ; aucun : le premier élément reçu', async function () {
        if (!present) return this.skip()
        const res: Record<string, string> = {}, poses: Record<string, string[]> = {}
        for (const n of ['fh', 'fn']) {
          const { p } = await ouvrir('/p1')
          await p.click('#l' + n)
          await p.waitForSelector('#titre-' + n, { state: 'attached', timeout: 8000 })
          await pose(p)
          res[n]   = await actif(p)
          poses[n] = await p.evaluate(() => Array.from(document.querySelectorAll('h1[tabindex]')).map(h => h.id))
          await p.close()
        }
        assert.deepEqual(res, { fh: 'H1#titre-fh', fn: 'NAV#nav' }, 'AVANT : la barre <nav> dans les deux cas')
        assert.deepEqual(poses, { fh: ['titre-fh'], fn: [] }, 'un titre qui ne prend pas le focus ne garde pas de tabindex')
      })

      it('focus après l\'échange : les champs autofocus qui ne peuvent pas le prendre (inert, hidden, désactivé, dialog fermé, popover caché) cèdent la place au premier qui le peut', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/fa')
        assert.equal(await actif(p), 'INPUT#initial', 'le champ autofocus de la page d\'entrée a pris le focus au chargement')
        await p.click('#lfx')
        await p.waitForSelector('#titre-fx', { state: 'attached', timeout: 8000 })
        await pose(p)
        assert.equal(await actif(p), 'INPUT#vrai', 'AVANT : le focus restait sur <body>')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('départ refusé, puis navigation de la page : la marque du départ tombe, un module introuvable recharge de nouveau la page', async function () {
        if (!present) return this.skip()
        const { p } = await ouvrir('/conf')
        const questions: string[] = []
        let refuser = true
        let charges = 0
        p.on('dialog', d => { questions.push(d.type()); (refuser ? d.dismiss() : d.accept()).catch(() => {}) })
        p.on('load', () => { charges++ })
        await p.click('#nom-conf')
        await p.evaluate(() => { (document.getElementById('lautre') as HTMLAnchorElement).click() })
        for (let t = Date.now(); !questions.length && Date.now() - t < 4000;) await p.waitForTimeout(100)
        await pose(p)
        refuser = false
        const refus = await p.evaluate(() => ({ url: location.pathname, left: (window as any).µ._mjs_left() }))
        assert.deepEqual([questions, refus], [['beforeunload'], { url: '/conf', left: true }], 'départ annoncé puis refusé, la page reste')
        await p.click('#lp2')
        await arrivee(p, 'p2')
        assert.equal(await p.evaluate(() => (window as any).µ._mjs_left()), false, 'AVANT : la marque du départ refusé restait après la navigation')
        const c0 = charges
        await p.evaluate(() => { document.body.appendChild(document.createElement('mjs-tardif')) })
        for (let t = Date.now(); charges === c0 && Date.now() - t < 8000;) await p.waitForTimeout(100)
        assert.ok(charges > c0, 'AVANT : un module introuvable ne rechargeait plus jamais la page')
        await p.close()
      })

      it('formulaire POST en vol, puis Précédent sur l\'ancre de la page : l\'envoi est abandonné, puis une page gardée est redemandée au serveur', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        await p.click('#lp2b')
        await arrivee(p, 'p2')
        await p.click('#lp2r')
        await adresse(p, '/p2#/r2')
        await pose(p)
        await p.click('#envoipost')
        await p.waitForTimeout(200)
        assert.equal((await etat(p)).active, true, 'l\'envoi est en vol au retour')
        await p.evaluate(() => history.back())
        await adresse(p, '/p2#b2')
        await pose(p, LENT + 800)
        assert.deepEqual(await etat(p), { adresse: '/p2#b2', pages: 'p2', barre: false, active: false }, 'AVANT : la page de la réponse s\'installait sous l\'adresse de l\'ancre')
        const avant = demandes['/p1']
        await p.evaluate(() => history.back())
        await adresse(p, '/p1')
        await arrivee(p, 'p1')
        assert.equal(demandes['/p1'], avant + 1, 'la page gardée d\'avant l\'envoi abandonné est redemandée au serveur')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('trois Précédent de suite avant toute réponse, vers une page gardée : µ.nav.active retombe', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        for (const n of ['s1', 's2', 's3']) { await p.click('#l' + n); await arrivee(p, n) }
        await va(p, 2000)
        for (const a of ['/s2', '/s1', '/p1']) { await p.evaluate(() => history.back()); await adresse(p, a) }
        await pose(p, LENT + 800)
        assert.deepEqual(await etat(p), { adresse: '/p1', pages: 'p1', barre: false, active: false }, 'AVANT : µ.nav.active restait à true')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      it('trois Précédent de suite avant toute réponse, vers la page d\'arrivée gardée : µ.nav.active retombe', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/s1')
        for (const n of ['s2', 's3', 'p2']) { await p.click('#l' + n); await arrivee(p, n) }
        await va(p, 2000)
        for (const a of ['/s3', '/s2', '/s1']) { await p.evaluate(() => history.back()); await adresse(p, a) }
        await pose(p, LENT + 800)
        assert.deepEqual(await etat(p), { adresse: '/s1', pages: 's1', barre: false, active: false }, 'AVANT : µ.nav.active restait à true')
        assert.deepEqual(erreurs, [])
        await p.close()
      })

      for (const x of ['', '/nr']) {
        const variante = x ? 'sans routeur' : 'avec routeur'

        it(`lien vers une page lente, puis retour de deux entrées vers une page gardée : µ.nav.active retombe, la barre de navigation s'en va (${variante})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          await p.click('#lp2')
          await arrivee(p, 'p2')
          await p.click('#llent')
          await adresse(p, x + '/lent')
          await p.evaluate(() => history.go(-2))
          await adresse(p, x + '/p1')
          await pose(p, LENT + 800)
          assert.deepEqual(await etat(p), { adresse: x + '/p1', pages: 'p1', barre: false, active: false }, 'AVANT : µ.nav.active restait à true, et la barre à l\'écran sans routeur')
          assert.deepEqual(erreurs, [])
          await p.close()
        })
      }
    })
  }
})
