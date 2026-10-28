// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, en développement et en
// production, avec et sans routeur) : une page du cache suivie pendant qu'une navigation est en vol abandonne cette
// navigation proprement, comme un retour vers elle.
// - lien vers une page lente, puis lien vers une page gardée avant sa réponse : la page gardée s'affiche,
//   `µnav.active` retombe à `false` et la barre de navigation ne vient pas (avant : `µnav.active` restait à `true`, et
//   la barre arrivait au bout de son délai pour rester à l'écran sans routeur) ; de même pour un lien vers la page
//   affichée elle-même ;
// - le même geste, la barre de navigation déjà à l'écran : elle part, et ne revient pas avec la page quittée quand le
//   cache la sert ensuite (avant : la photo de la page quittée la gardait, elle revenait à l'écran avec elle) ; de
//   même après un retour de deux entrées puis Suivant ;
// - formulaire `GET` vers une page gardée pendant une navigation en vol : il part au serveur, sa page s'installe,
//   `µnav.active` retombe, la barre part et ne revient pas avec la page quittée (avant : elle revenait) ;
// - préchargement au survol pendant une navigation en vol : la navigation continue, puis s'installe et s'éteint ; le
//   lien préchargé, suivi pendant la navigation en vol, l'abandonne comme un autre, et la barre ne revient pas avec la
//   page quittée (avant : elle revenait).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// `µnav.active` affiché par la page elle-même, lisible aussi en production (où `µ` n'est pas exposé) : un composant
// sans ombre, posé dans chaque page
const SOURCES: Record<string, string> = {
  'temoin.mjs': '{if µnav.active}<i class="en-vol">en vol</i>{end}\n',
}

const LIENS = ['p1', 'p2', 'lent']
const NAV   = (x: string) => '<nav id="nav"><mjs-temoin mjs-light></mjs-temoin> '
  + LIENS.map(n => '<a id="l' + n + '" href="' + x + '/' + n + '">' + n + '</a> ').join('')
  + '<a id="lsurvol" data-mjs-preload="hover" href="' + x + '/p4">p4</a>'
  + '<form id="fget" action="' + x + '/p1"><button id="envoiget">get</button></form></nav>'
const PAGES = ['/p1', '/p2', '/p4', '/lent']
// la page lente répond bien après le délai de la barre de navigation (500 ms), après le geste suivant du test
const LENT  = 2000
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }
// variantes construites : développement, production, et les deux sans routeur (la barre de navigation n'y est
// retirée que par la navigation elle-même)
const VARIANTES: Record<string, any> = {
  '':        { runtime: ['ujs', 'router', 'ajax', 'vault'] },
  '/prod':   { runtime: ['ujs', 'router', 'ajax', 'vault'], env: 'prod' },
  '/nr':     { runtime: ['ujs', 'ajax', 'vault'] },
  '/prodnr': { runtime: ['ujs', 'ajax', 'vault'], env: 'prod' },
}
const NOMS: Record<string, string> = { '': 'développement', '/prod': 'production', '/nr': 'développement, sans routeur', '/prodnr': 'production, sans routeur' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

async function pose(p: Page, attente = 300): Promise<void> {
  await p.waitForTimeout(attente)
  await p.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))))
}

// adresse, pages présentes, barres de navigation à l'écran, `µnav.active` affiché par le témoin de la page et lu sur
// `µ` (exposé en développement seulement)
function etat(p: Page) {
  return p.evaluate(() => {
    const w = window as any
    return {
      adresse: location.pathname + location.hash,
      pages:   Array.from(document.querySelectorAll('[id^="nom-"]')).map(e => e.id.slice(4)).join(','),
      barre:   document.querySelectorAll('.mjs-nav-progress').length,
      temoin:  !!document.querySelector('mjs-temoin .en-vol'),
      active:  !!(w.µ && w.µ.nav && w.µ.nav.active),
    }
  })
}
const repos = (adresse: string, pages: string) => ({ adresse, pages, barre: 0, temoin: false, active: false })

describe('mjs_ujs navigateur réel, vrai projet — une page du cache suivie pendant une navigation en vol l\'abandonne proprement', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('clic-vers-page-gardee')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
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
      // pages demandées au serveur (GET), et pages lentes dont la réponse est partie
      const demandes: Record<string, number> = {}
      const servies: Record<string, number>  = {}
      const ouvertes: Page[] = []

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        server  = createServer((req, res) => {
          const url    = new URL(req.url || '/', 'http://x')
          const x      = Object.keys(VARIANTES).find(v => v && url.pathname.startsWith(v + '/')) || ''
          const chemin = url.pathname.slice(x.length)
          if (PAGES.includes(chemin)) {
            if (req.method === 'GET') demandes[chemin] = (demandes[chemin] || 0) + 1
            // `no-store` : ni cache HTTP ni cache arrière-avant
            const envoi = () => {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
              res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + x + '/modularjs/bundle.js"></script></head><body>' + NAV(x) + '<p id="nom-' + chemin.slice(1) + '">' + chemin.slice(1) + '</p></body></html>')
              servies[chemin] = (servies[chemin] || 0) + 1
            }
            if (chemin === '/lent') setTimeout(envoi, LENT)
            else envoi()
            return
          }
          const m       = /^\/modularjs\/(.+)$/.exec(chemin)
          const fichier = m ? join(dist, x || '/dev', normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('introuvable'); return }
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

      // la navigation chargée (elle coupe le défilement natif des entrées), et le témoin de `µnav.active` défini
      function prete(p: Page) {
        return p.waitForFunction(() => history.scrollRestoration === 'manual' && !!customElements.get('mjs-temoin'), null, { timeout: 15000 })
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

      // lien vers la page lente : la navigation en vol, `µnav.active` affiché par le témoin de la page
      async function enVol(p: Page, x: string) {
        await p.click('#llent')
        await adresse(p, x + '/lent')
        await p.waitForSelector('mjs-temoin .en-vol', { state: 'attached', timeout: 5000 })
      }

      // la barre de navigation à l'écran
      function barre(p: Page) {
        return p.waitForSelector('.mjs-nav-progress', { state: 'attached', timeout: 5000 })
      }

      // la réponse de la page lente partie du serveur, puis le temps de la traiter si la page l'attendait encore
      async function lenteServie(p: Page, avant: number) {
        while ((servies['/lent'] || 0) <= avant) await p.waitForTimeout(50)
        await pose(p)
      }

      // la page quittée, servie par le cache (sans nouvelle demande au serveur)
      async function retourParLeCache(p: Page, x: string, id: string) {
        const avant = demandes['/' + id] || 0
        await p.click('#l' + id)
        await adresse(p, x + '/' + id)
        await arrivee(p, id)
        assert.equal(demandes['/' + id] || 0, avant, 'la page quittée revient du cache')
      }

      for (const x of ['', '/prod', '/nr', '/prodnr']) {
        it(`lien vers une page lente, puis lien vers une page gardée avant sa réponse : la page gardée s'affiche, µnav.active retombe, la barre de navigation ne vient pas (${NOMS[x]})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          await p.click('#lp2')
          await arrivee(p, 'p2')
          const avant = servies['/lent'] || 0
          await enVol(p, x)
          await p.click('#lp1')
          await adresse(p, x + '/p1')
          await lenteServie(p, avant)
          assert.deepEqual(await etat(p), repos(x + '/p1', 'p1'), 'AVANT : µnav.active restait à true, et la barre de navigation arrivait au bout de son délai sans routeur')
          assert.deepEqual(erreurs, [])
        })
      }

      for (const x of ['', '/prodnr']) {
        it(`lien vers une page lente, puis, la barre de navigation à l'écran, lien vers une page gardée : la barre part, et ne revient pas avec la page quittée servie ensuite par le cache (${NOMS[x]})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          await p.click('#lp2')
          await arrivee(p, 'p2')
          const avant = servies['/lent'] || 0
          await enVol(p, x)
          await barre(p)
          await p.click('#lp1')
          await adresse(p, x + '/p1')
          await lenteServie(p, avant)
          assert.deepEqual(await etat(p), repos(x + '/p1', 'p1'), 'AVANT : µnav.active restait à true')
          await retourParLeCache(p, x, 'p2')
          assert.deepEqual(await etat(p), repos(x + '/p2', 'p2'), 'AVANT : la barre de navigation revenait à l\'écran avec la page quittée')
          assert.deepEqual(erreurs, [])
        })
      }

      it('lien vers une page lente, puis, la barre de navigation à l\'écran, retour de deux entrées vers une page gardée, puis Suivant : la page quittée revient du cache sans la barre de navigation', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        await p.click('#lp2')
        await arrivee(p, 'p2')
        const avant = servies['/lent'] || 0
        await enVol(p, '')
        await barre(p)
        await p.evaluate(() => history.go(-2))
        await adresse(p, '/p1')
        await lenteServie(p, avant)
        assert.deepEqual(await etat(p), repos('/p1', 'p1'), 'le retour abandonne la navigation en vol')
        const servi = demandes['/p2'] || 0
        await p.evaluate(() => history.forward())
        await adresse(p, '/p2')
        await arrivee(p, 'p2')
        assert.equal(demandes['/p2'] || 0, servi, 'la page quittée revient du cache')
        assert.deepEqual(await etat(p), repos('/p2', 'p2'), 'AVANT : la barre de navigation revenait à l\'écran avec la page quittée')
        assert.deepEqual(erreurs, [])
      })

      for (const x of ['', '/nr']) {
        it(`lien vers une page lente, puis lien vers la page affichée avant sa réponse : la page reste, µnav.active retombe, la barre de navigation ne vient pas (${NOMS[x]})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          const avant = servies['/lent'] || 0
          await enVol(p, x)
          await p.click('#lp1')
          await adresse(p, x + '/p1')
          await lenteServie(p, avant)
          assert.deepEqual(await etat(p), repos(x + '/p1', 'p1'), 'AVANT : µnav.active restait à true, et la barre de navigation arrivait au bout de son délai sans routeur')
          assert.deepEqual(erreurs, [])
        })
      }

      for (const x of ['', '/nr']) {
        it(`formulaire GET vers une page gardée pendant une navigation en vol, la barre de navigation à l'écran : il part au serveur, sa page s'installe, µnav.active retombe, la barre part et ne revient pas avec la page quittée (${NOMS[x]})`, async function () {
          if (!present) return this.skip()
          const { p, erreurs } = await ouvrir(x + '/p1')
          await p.click('#lp2')
          await arrivee(p, 'p2')
          const avant = servies['/lent'] || 0
          const envoi = demandes['/p1'] || 0
          await enVol(p, x)
          await barre(p)
          await p.click('#envoiget')
          await adresse(p, x + '/p1')
          await lenteServie(p, avant)
          assert.equal(demandes['/p1'], envoi + 1, 'le formulaire GET part au serveur, même vers une page gardée')
          assert.deepEqual(await etat(p), repos(x + '/p1', 'p1'), 'la page du formulaire installée, la navigation s\'éteint')
          await retourParLeCache(p, x, 'p2')
          assert.deepEqual(await etat(p), repos(x + '/p2', 'p2'), 'AVANT : la barre de navigation revenait à l\'écran avec la page quittée')
          assert.deepEqual(erreurs, [])
        })
      }

      it('survol d\'un lien préchargé pendant une navigation en vol : la navigation continue, sa page s\'installe, µnav.active retombe, la barre de navigation part', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        const vu = demandes['/p4'] || 0
        await enVol(p, '')
        await p.hover('#lsurvol')
        await p.waitForFunction((h) => (window as any).µ._mjs_preloadCache.has(h), origin + '/p4', { timeout: 5000 })
        assert.equal(demandes['/p4'], vu + 1, 'le survol précharge la page')
        const { barre: _b, ...enCours } = await etat(p)
        assert.deepEqual(enCours, { adresse: '/lent', pages: 'p1', temoin: true, active: true }, 'le préchargement n\'abandonne ni n\'éteint la navigation en vol')
        await arrivee(p, 'lent')
        assert.deepEqual(await etat(p), repos('/lent', 'lent'), 'la page demandée installée, la navigation s\'éteint')
        assert.deepEqual(erreurs, [])
      })

      it('lien préchargé au survol, suivi pendant une navigation en vol, la barre de navigation à l\'écran : sa page s\'installe sans nouvelle demande, µnav.active retombe, la barre part et ne revient pas avec la page quittée', async function () {
        if (!present) return this.skip()
        const { p, erreurs } = await ouvrir('/p1')
        const vu    = demandes['/p4'] || 0
        const avant = servies['/lent'] || 0
        await enVol(p, '')
        await p.hover('#lsurvol')
        await p.waitForFunction((h) => (window as any).µ._mjs_preloadCache.has(h), origin + '/p4', { timeout: 5000 })
        await barre(p)
        await p.click('#lsurvol')
        await arrivee(p, 'p4')
        await lenteServie(p, avant)
        assert.equal(demandes['/p4'], vu + 1, 'la page préchargée sert le clic, sans nouvelle demande')
        assert.deepEqual(await etat(p), repos('/p4', 'p4'), 'la page préchargée installée, la navigation s\'éteint')
        await retourParLeCache(p, '', 'p1')
        assert.deepEqual(await etat(p), repos('/p1', 'p1'), 'AVANT : la barre de navigation revenait à l\'écran avec la page quittée')
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
