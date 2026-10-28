// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, en développement et en
// production) : la position d'une page que Précédent fait redemander au serveur tient contre l'ancrage de défilement du
// navigateur, et une entrée d'ancre ajoutée garde le défilement coupé de la page.
// - F5 sur une page reçue par un lien de la navigation, puis Précédent vers la page d'avant : le navigateur reste dans
//   le même document, la navigation redemande la page ; sa position revient telle quelle, sous un composant placé
//   au-dessus qui se peint après la reprise (avant : la position revenait d'un coup, puis l'ancrage du navigateur la
//   décalait de la hauteur du composant) ;
// - avec µ._anchorHistory, l'entrée ajoutée par une ancre suivie garde le défilement coupé (`history.scrollRestoration`
//   à `manual`) : Précédent dans la page rend sa position sans que le navigateur défile avant elle, et le retour sur
//   elle par un chargement complet la retrouve (avant, sous WebKit : l'entrée était créée en `auto`, le navigateur
//   défilait lui-même jusqu'à l'ancre avant que la navigation rende la position).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// `boite`, placée au-dessus du contenu, n'y peint ses 3 000 px que 400 ms après son montage (contenu reçu plus tard)
const SOURCES: Record<string, string> = {
  'boite.mjs': '<script>\n  $montre = false\n  µmount =>\n    setTimeout (=> $montre = true), 400\n</script>\n\n<p>boîte</p>\n{if $montre}\n  <div class="h"></div>\n  <div class="h"></div>\n{end}\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
}

const NAV = (prefixe: string) => '<nav style="position:fixed;top:0;right:0;background:#fff;z-index:9;font-size:10px"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a> <a id="lp2" href="' + prefixe + '/p2">p2</a></nav>'
const PAGES: Record<string, (prefixe: string) => string> = {
  '/p1':    (prefixe) => NAV(prefixe) + '<mjs-boite></mjs-boite><div style="height:2000px"></div><h2 id="a">A</h2><div style="height:2000px"></div><h2 id="b">B</h2><div style="height:5000px"></div>',
  '/p2':    () => '<h1 id="titre-p2">P2</h1><div style="height:3000px"></div>',
  '/autre': () => '<h1>Autre</h1><div style="height:2000px"></div>',
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

// haut d'un élément de la page par son id (la production n'expose pas `µ`)
function haut(page: Page, id: string): Promise<number> {
  return page.evaluate((i) => Math.round(document.getElementById(i)!.getBoundingClientRect().top + scrollY), id)
}

async function pose(page: Page, attente = 300): Promise<number> {
  await page.waitForTimeout(attente)
  return page.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

function va(page: Page, y: number) {
  return page.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

describe('mjs_ujs navigateur réel, vrai projet — la position d\'une page redemandée au retour et des entrées d\'ancre ajoutées', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('page-redemandee')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    // les pages viennent du serveur, aucune source ne se sert de la navigation : ses modules sont nommés
    for (const [variante, options] of [['dev', {}], ['prod', { env: 'prod' }]] as const) {
      const sortie  = join(dist, variante)
      const bundler = new Bundler({ sourceDir: src, outputDir: sortie, manifestPath: join(sortie, 'bundle.js'), urlPrefix: (variante === 'prod' ? '/prod' : '') + '/modularjs', runtime: ['ujs', 'router', 'ajax', 'modal'], ...options } as any)
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
          const corps   = PAGES[url.pathname.slice(prefixe.length)]
          // `no-store` : ni cache HTTP ni cache arrière-avant, un retour complet recharge vraiment la page
          if (corps) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="' + prefixe + '/modularjs/bundle.js"></script></head><body style="margin:0">' + corps(prefixe) + '</body></html>')
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

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      // la boîte peinte au-dessus du contenu de /p1
      function peinte(page: Page, chemin: string) {
        return page.waitForFunction((c) => location.pathname === c && document.documentElement.scrollHeight > 11000, chemin, { timeout: 15000 })
      }

      // rechargement par la page (`location.reload()`, une entrée inchangée) : Playwright recharge Firefox par une
      // entrée neuve
      async function recharger(page: Page) {
        await Promise.all([page.waitForEvent('load'), page.evaluate(() => location.reload())])
        await prete(page)
      }

      // Précédent jusqu'à `chemin` : une seconde fois quand la page rechargée a gardé une entrée de plus (Firefox sous
      // Playwright, chargé)
      async function retourVers(page: Page, chemin: string) {
        for (let i = 0; i < 2; i++) {
          await page.evaluate(() => history.back())
          if (await page.waitForFunction((c) => location.pathname === c, chemin, { timeout: 4000 }).then(() => true, () => false)) return
        }
      }

      async function partir(page: Page, chemin: string) {
        await Promise.all([page.waitForURL(u => u.pathname === chemin), page.evaluate((c) => { location.href = c }, chemin)])
        await prete(page)
      }

      for (const prefixe of ['', '/prod']) {
        it(`F5 sur une page reçue par un lien, puis Précédent vers la page d'avant, redemandée au serveur (${prefixe ? 'production' : 'développement'}) : sa position revient telle quelle sous le composant qui se peint après la reprise`, async function () {
          if (!present) return this.skip()
          const { page, erreurs } = await ouvrir(prefixe + '/p1')
          await peinte(page, prefixe + '/p1')
          await page.click('#lb')
          await page.waitForFunction(() => location.hash === '#b')
          await pose(page)
          const b = await haut(page, 'b')
          await page.click('#lp2')
          await page.waitForFunction(() => !!document.getElementById('titre-p2'), null, { timeout: 15000 })
          await pose(page)
          await recharger(page)
          await pose(page)
          await retourVers(page, prefixe + '/p1')
          await peinte(page, prefixe + '/p1')
          const y = await pose(page, 1200)
          assert.deepEqual([await page.evaluate(() => location.pathname + location.hash), y], [prefixe + '/p1#b', b], 'AVANT : la page finissait plus bas de la hauteur de la boîte, l\'ancrage du navigateur décalait la position reprise d\'un coup')
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('avec µ._anchorHistory, l\'entrée ajoutée par une ancre garde le défilement coupé : Précédent dans la page et le retour par un chargement complet rendent sa position', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        await peinte(page, '/p1')
        await page.evaluate(() => { (window as any).µ._anchorHistory = true })
        const a = await haut(page, 'a')
        await page.click('#la')
        await page.waitForFunction(() => location.hash === '#a')
        await pose(page)
        await va(page, a + 300)
        await pose(page, 100)
        const vus = ['#a ' + await page.evaluate(() => history.scrollRestoration)]
        await page.click('#lb')
        await page.waitForFunction(() => location.hash === '#b')
        const b = await pose(page)
        vus.push('#b ' + await page.evaluate(() => history.scrollRestoration))
        // Précédent : la page encore où elle était quand l'entrée revient (lu au `popstate`, avant la position gardée,
        // que la navigation rend à l'image suivante), puis sur la position gardée
        await page.evaluate(() => { const w = window as any; addEventListener('popstate', () => { w.__auRetour = Math.round(scrollY) }, { once: true }); history.back() })
        await page.waitForFunction(() => location.hash === '#a')
        const y = await pose(page, 600)
        vus.push('Précédent ' + await page.evaluate(() => (window as any).__auRetour) + ' puis ' + y)
        await partir(page, '/autre')
        await page.evaluate(() => history.back())
        await peinte(page, '/p1')
        vus.push('retour complet ' + await page.evaluate(() => location.hash) + ' y=' + await pose(page, 1200))
        assert.deepEqual(vus, ['#a manual', '#b manual', 'Précédent ' + b + ' puis ' + (a + 300), 'retour complet #a y=' + (a + 300)], 'AVANT (WebKit) : entrées créées en auto, le navigateur défilait jusqu\'à l\'ancre avant que la navigation rende la position')
        assert.deepEqual(erreurs, [])
        await page.close()
      })
    })
  }
})
