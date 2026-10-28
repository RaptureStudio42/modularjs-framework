// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, en développement et en
// production) : revenir sur une entrée de la page affichée avant l'arrivée de la page demandée abandonne la navigation
// en vol, sous l'adresse de l'entrée et à la position laissée.
// - F5 sur l'ancre d'une page (`/p2#b2`), défilement, Précédent vers une page lente que la navigation redemande au
//   serveur, puis Suivant avant sa réponse : la page reste affichée, à la position laissée (avant : la page lente
//   s'installait sous l'adresse `/p2#b2`, et la page repartait d'abord à la position rangée au départ du
//   rechargement) ;
// - le même geste sans F5, la page lente n'étant jamais archivée (`X-MJS-Cache: no-cache`) ;
// - le même geste sur une route `#/…` de la page ;
// - lien vers une page lente depuis l'ancre d'une page, puis Précédent avant sa réponse : la page reste affichée, à la
//   position laissée (avant : la page lente s'installait sous l'adresse de l'ancre) ; de même pour un formulaire `GET`, et
//   pour un lien depuis une page rechargée, sans fragment (avant : la page repartait à la position rangée au départ du
//   rechargement) ;
// - dans tous les cas, la barre de navigation de la navigation abandonnée ne reste pas à l'écran, et `µ.nav.active`
//   retombe.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'boite.mjs': '<p>boîte</p>\n\n<style>\n  :host\n    display: block\n</style>\n',
}

const NAV = (prefixe: string) => '<nav id="nav" style="position:fixed;top:0;right:0;background:#fff;z-index:9;font-size:10px"><a id="llent" href="' + prefixe + '/lent">lent</a> <a id="lnc" href="' + prefixe + '/nc">nc</a> <a id="lp2" href="' + prefixe + '/p2">p2</a> <a id="lp2b" href="' + prefixe + '/p2#b2">p2#b2</a> <a id="lp2r" href="' + prefixe + '/p2#/r2">p2#/r2</a><form action="' + prefixe + '/nc"><input name="q" value="x" aria-label="q"><button id="envoi">envoi</button></form></nav>'
const PAGES: Record<string, (prefixe: string) => string> = {
  '/p1':   (prefixe) => NAV(prefixe) + '<p id="nom-p1">p1</p><div style="height:3000px"></div>',
  '/lent': (prefixe) => NAV(prefixe) + '<p id="nom-lent">lent</p><div style="height:3000px"></div>',
  '/nc':   (prefixe) => NAV(prefixe) + '<p id="nom-nc">nc</p><div style="height:3000px"></div>',
  '/p2':   (prefixe) => NAV(prefixe) + '<p id="nom-p2">p2</p><mjs-boite></mjs-boite><div style="height:3000px"></div><h2 id="b2">B2</h2><div style="height:3000px"></div>',
}
// `/lent` et `/nc` répondent après le retour du test ; `/nc` n'est jamais archivée par la navigation
const LENT  = 1200
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

async function pose(page: Page, attente = 300): Promise<number> {
  await page.waitForTimeout(attente)
  return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(page: Page, y: number) {
  return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

// adresse (chemin et fragment), pages présentes, barre de navigation à l'écran, `µ.nav.active` (développement : `µ`
// n'est exposé qu'en développement)
function etat(page: Page) {
  return page.evaluate(() => {
    const w = window as any
    return {
      adresse: location.pathname + location.hash,
      p2:      !!document.getElementById('nom-p2'),
      lente:   !!document.getElementById('nom-lent') || !!document.getElementById('nom-nc'),
      barre:   !!document.querySelector('.mjs-nav-progress'),
      active:  !!(w.µ && w.µ.nav && w.µ.nav.active),
    }
  })
}

describe('mjs_ujs navigateur réel, vrai projet — retour sur une entrée de la page affichée avant la réponse de la page demandée', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('retour-page-affichee')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    // les pages viennent du serveur, aucune source ne se sert de la navigation : ses modules sont nommés, avec `vault`
    // pour `µ.nav`
    for (const [variante, options] of [['dev', {}], ['prod', { env: 'prod' }]] as const) {
      const sortie  = join(dist, variante)
      const bundler = new Bundler({ sourceDir: src, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), urlPrefix: (variante === 'prod' ? '/prod' : '') + '/modularjs', runtime: ['ujs', 'router', 'ajax', 'vault'], ...options } as any)
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
          const url     = new URL(req.url || '/', 'http://x')
          const prefixe = url.pathname.startsWith('/prod/') ? '/prod' : ''
          const chemin  = url.pathname.slice(prefixe.length)
          const corps   = PAGES[chemin]
          // `no-store` : ni cache HTTP ni cache arrière-avant
          if (corps) {
            const envoi = () => {
              const entetes: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
              if (chemin === '/nc') entetes['x-mjs-cache'] = 'no-cache'
              res.writeHead(200, entetes)
              res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + prefixe + '/modularjs/bundle.js"></script></head><body style="margin:0">' + corps(prefixe) + '</body></html>')
            }
            if (chemin === '/lent' || chemin === '/nc') setTimeout(envoi, LENT)
            else envoi()
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

      // la navigation chargée (elle coupe le défilement natif des entrées)
      function prete(page: Page) {
        return page.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
      }

      // la page montée par la navigation (`mjs:load` du chargement) : la position qu'elle rend à l'entrée est posée
      function montee(page: Page) {
        return page.waitForFunction(() => (window as any).__monte === true, null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.addInitScript(() => {
          document.addEventListener('mjs:load', (e: any) => { if (e.detail && e.detail.initial) (window as any).__monte = true })
        })
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      // rechargement par la page (`location.reload()`, une entrée inchangée) : Playwright recharge Firefox par une
      // entrée neuve
      async function recharger(page: Page) {
        await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())])
        await prete(page)
        await montee(page)
      }

      async function arrivee(page: Page, id: string) {
        await page.waitForSelector('#' + id, { state: 'attached', timeout: 15000 })
        await pose(page)
      }

      // défilement du test à 2 000, puis un retour (`back`), un lien (`#lnc`) ou un formulaire `GET` (`#envoi`) vers une
      // page lente, jamais arrivée ensuite avant le geste suivant du test
      async function quitter(page: Page, prefixe: string, geste: 'back' | 'lien' | 'form', lente: string) {
        await va(page, 2000)
        assert.equal(await pose(page, 100), 2000, 'défilement du test à 2 000 avant le départ')
        if (geste === 'back') await page.evaluate(() => history.back())
        else await page.click(geste === 'lien' ? '#lnc' : '#envoi')
        await page.waitForFunction((c) => location.pathname === c, prefixe + lente, { timeout: 4000 })
        await page.waitForTimeout(300)
        const avant = await etat(page)
        assert.deepEqual([avant.p2, avant.lente], [true, false], 'la page lente n\'est pas encore arrivée au retour')
      }

      // retour (`forward` ou `back`) sur l'entrée de la page affichée, puis attente au-delà de la réponse de la page
      // lente : la page affichée reste, sous l'adresse de l'entrée, à la position laissée, sans barre de navigation
      async function revenir(page: Page, geste: 'forward' | 'back', adresse: string, message: string) {
        if (geste === 'forward') await page.evaluate(() => history.forward())
        else await page.evaluate(() => history.back())
        await page.waitForFunction((c) => location.pathname + location.hash === c, adresse, { timeout: 4000 })
        const y = await pose(page, LENT + 600)
        assert.deepEqual([await etat(page), y], [{ adresse, p2: true, lente: false, barre: false, active: false }, 2000], message)
      }

      for (const prefixe of ['', '/prod']) {
        const variante = prefixe ? 'production' : 'développement'

        it(`F5 sur l'ancre d'une page, défilement, Précédent vers une page lente redemandée au serveur, puis Suivant avant sa réponse : la page reste affichée, sous l'adresse de l'ancre, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#llent')
          await arrivee(page, 'nom-lent')
          await page.click('#lp2b')
          await arrivee(page, 'nom-p2')
          await recharger(page)
          await pose(page)
          await quitter(page, prefixe, 'back', '/lent')
          await revenir(page, 'forward', prefixe + '/p2#b2', 'AVANT : la page lente s\'installait sous l\'adresse de l\'ancre')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`le même geste sans F5, la page lente n'étant jamais archivée : la page reste affichée, sous l'adresse de l'ancre, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#lnc')
          await arrivee(page, 'nom-nc')
          await page.click('#lp2b')
          await arrivee(page, 'nom-p2')
          await quitter(page, prefixe, 'back', '/nc')
          await revenir(page, 'forward', prefixe + '/p2#b2', 'AVANT : la page lente s\'installait sous l\'adresse de l\'ancre')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`le même geste sur une route #/… de la page, après F5 : la page reste affichée, sous l'adresse de la route, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#llent')
          await arrivee(page, 'nom-lent')
          await page.click('#lp2r')
          await arrivee(page, 'nom-p2')
          await recharger(page)
          await pose(page)
          await quitter(page, prefixe, 'back', '/lent')
          await revenir(page, 'forward', prefixe + '/p2#/r2', 'AVANT : la barre de navigation de la navigation abandonnée restait à l\'écran')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`lien vers une page lente depuis l'ancre d'une page, puis Précédent avant sa réponse : la page reste affichée, sous l'adresse de l'ancre, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#lp2b')
          await arrivee(page, 'nom-p2')
          await quitter(page, prefixe, 'lien', '/nc')
          await revenir(page, 'back', prefixe + '/p2#b2', 'AVANT : la page lente s\'installait sous l\'adresse de l\'ancre')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`F5 sur une page, défilement, lien vers une page lente, puis Précédent avant sa réponse : la page reste affichée, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#lp2')
          await arrivee(page, 'nom-p2')
          await recharger(page)
          await pose(page)
          await quitter(page, prefixe, 'lien', '/nc')
          await revenir(page, 'back', prefixe + '/p2', 'AVANT : la page repartait à la position rangée au départ du rechargement')
          assert.deepEqual(erreurs, [])
          await page.close()
        })

        it(`formulaire GET vers une page lente depuis l'ancre d'une page, puis Précédent avant sa réponse : la page reste affichée, sous l'adresse de l'ancre, à la position laissée (${variante})`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await page.click('#lp2b')
          await arrivee(page, 'nom-p2')
          await quitter(page, prefixe, 'form', '/nc')
          await revenir(page, 'back', prefixe + '/p2#b2', 'AVANT : la page lente s\'installait sous l\'adresse de l\'ancre')
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }
    })
  }
})
