// Une réponse que le serveur redirige (302, 303) vers une AUTRE origine, et que cette origine ouvre par CORS : `fetch` la
// suit. Le navigateur seul quitterait le site pour elle ; la navigation de MJS ne doit jamais l'installer dans la page du
// site, où ses gestionnaires en ligne (`<img onerror>`) s'exécuteraient avec l'origine du site, ni poser sa fiche JSON
// (titre, props). Chaque voie est jouée dans un vrai projet construit, dans les trois moteurs : lien, formulaire `GET` et
// `POST`, fiche JSON, préchargement au survol, rafraîchissement de fond d'une page `revalidate`. Avant le correctif, la
// page du tiers s'installait dans le site sur chacune. Témoin : une redirection vers la MÊME origine reste un échange de
// contenu, sans rechargement
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }
const PIEGE = '<!doctype html><html><head><title>tiers</title></head><body><p id="tiers">page du tiers</p><img src="/absent.png" onerror="document.documentElement.setAttribute(\'data-joue\', location.origin)"></body></html>'
const FICHE = JSON.stringify({ module: 'mjs-temoin', title: 'tiers', props: {} })
const LIENS = '<a id="lien" href="/sortie">sortie</a><a id="lien-json" href="/sortie-json">fiche</a><a id="survol" href="/survol" data-mjs-preload="hover">survol</a><a id="vers-local" href="/vers-local">local</a><a id="vers-revalide" href="/revalide">revalide</a>'
const FORMULAIRES = '<form id="fget" method="get" action="/cherche"><input name="q" value="x"><button id="envoi-get">chercher</button></form><form id="f" method="post" action="/poste"><button id="envoi">envoi</button></form>'

async function present(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try { const pw = await import('playwright'); return existsSync(pw[nom].executablePath()) } catch { return false }
}
const ecoute = (s: Server) => new Promise<string>(ok => s.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + (s.address() as any).port)))
const ferme  = (s: Server | null) => s ? new Promise(ok => { (s as any).closeAllConnections?.(); s.close(() => ok(null)) }) : null
const page   = (tete: string, corps: string) => '<!doctype html><html><head><meta charset="utf-8"><title>site</title>' + tete + '<script type="module" src="/modularjs/bundle.js"></script></head><body>' + corps + '</body></html>'

describe('navigation — une réponse redirigée vers une autre origine ne s\'installe jamais dans le site', function () {
  this.timeout(120000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('redirection-autre-origine')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'temoin.mjs'), '<i class="temoin">témoin</i>\n')
    const bundler = new Bundler({ sourceDir: src, outputDir: dist, manifestPath: join(dist, 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'router', 'ajax', 'vault'] } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let browser: Browser | null = null, site: Server | null = null, tiers: Server | null = null, origine = '', ailleurs = '', renvoyer = false
      const vues: string[] = []

      before(async function () {
        if (!(await present(nom))) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        // le tiers : ouvert à toute origine (CORS), comme un serveur que tient un attaquant ; une demande de la navigation
        // de MJS (en-tête X-MJS-Nav) reçoit une fiche JSON quand l'adresse le dit, toute autre sa page piégée
        tiers = createServer((req, res) => {
          const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': String(req.headers['access-control-request-headers'] || '*'), 'access-control-allow-methods': 'GET, POST, OPTIONS' }
          vues.push(req.method + ' ' + req.url)
          if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
          if (req.url === '/fiche' && req.headers['x-mjs-nav']) {
            res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(FICHE)
            return
          }
          res.writeHead(200, { ...cors, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(PIEGE)
        })
        ailleurs = await ecoute(tiers)
        const renvoi = (res: any, ou: string, statut = 302) => { res.writeHead(statut, { location: ou, 'cache-control': 'no-store' }); res.end() }
        const html   = (res: any, corps: string, entetes: Record<string, string> = {}) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...entetes }); res.end(corps) }
        site = createServer((req, res) => {
          const url = new URL(req.url || '/', 'http://x')
          if (url.pathname === '/accueil') { html(res, page('', '<mjs-temoin mjs-light></mjs-temoin><p id="site">site</p>' + LIENS + FORMULAIRES)); return }
          if (url.pathname === '/sortie' || url.pathname === '/survol' || url.pathname === '/cherche') { renvoi(res, ailleurs + '/piege'); return }
          if (url.pathname === '/sortie-json') { renvoi(res, ailleurs + '/fiche'); return }
          if (url.pathname === '/poste') { req.resume(); renvoi(res, ailleurs + '/piege', 303); return }
          if (url.pathname === '/vers-local') { renvoi(res, '/local'); return }
          if (url.pathname === '/local') { html(res, page('', '<p id="local">local</p>')); return }
          if (url.pathname === '/autre') { html(res, page('', '<p id="autre">autre</p>')); return }
          if (url.pathname === '/revalide') {
            // le rafraîchissement de fond, une fois la page quittée puis rendue : le serveur la renvoie au même chemin d'une
            // autre origine
            if (renvoyer) { renvoi(res, ailleurs + '/revalide'); return }
            html(res, page('<meta name="mjs-cache" content="revalidate">', '<p id="revalide">revalide</p><a id="vers-autre" href="/autre">autre</a>'), { 'x-mjs-cache': 'revalidate' })
            return
          }
          const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
          const fichier = m ? join(dist, normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('introuvable'); return }
          res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          res.end(readFileSync(fichier))
        })
        origine = await ecoute(site)
      })
      after(async () => { if (browser) await browser.close(); await ferme(site); await ferme(tiers) })
      beforeEach(() => { vues.length = 0; renvoyer = false })

      async function ouvrir(): Promise<Page> {
        const p = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        await p.goto(origine + '/accueil')
        await p.waitForFunction(() => history.scrollRestoration === 'manual' && !!customElements.get('mjs-temoin'), null, { timeout: 15000 })
        return p
      }
      // le tiers a reçu cette demande (vue côté serveur)
      async function attendreVue(vue: string) {
        const fin = Date.now() + 15000
        while (!vues.includes(vue)) {
          if (Date.now() > fin) throw new Error('le tiers n\'a jamais reçu ' + vue + ' (' + vues.join(', ') + ')')
          await new Promise(ok => setTimeout(ok, 20))
        }
      }
      // la page du tiers est quelque part : chargée par le navigateur (adresse du tiers), ou posée dans la page du site
      async function verdict(p: Page) {
        await p.waitForFunction(() => !!document.getElementById('tiers') && document.documentElement.hasAttribute('data-joue'), null, { timeout: 15000 })
        return p.evaluate(() => ({ origine: location.origin, joue: document.documentElement.getAttribute('data-joue') }))
      }
      const message = (v: any) => 'la page du tiers s\'est installée dans le site (' + JSON.stringify(v) + ' ; site = ' + origine + ')'

      it('lien du site redirigé (302) vers une autre origine : le navigateur y part, rien du tiers ne joue avec l\'origine du site', async () => {
        const p = await ouvrir()
        await p.click('#lien')
        const v = await verdict(p)
        await p.close()
        assert.deepEqual(v, { origine: ailleurs, joue: ailleurs }, message(v))
      })

      it('formulaire GET redirigé (302) vers une autre origine : de même', async () => {
        const p = await ouvrir()
        await p.click('#envoi-get')
        const v = await verdict(p)
        await p.close()
        assert.deepEqual(v, { origine: ailleurs, joue: ailleurs }, message(v))
      })

      it('formulaire GET redirigé vers une autre origine, puis Précédent : retour à la page du site, comme sans MJS', async () => {
        const p = await ouvrir()
        await p.click('#envoi-get')
        await verdict(p)
        await p.goBack({ waitUntil: 'load', timeout: 15000 }).catch(() => null)
        await p.waitForTimeout(1000)
        const v = await p.evaluate(() => ({ origine: location.origin, chemin: location.pathname }))
        await p.close()
        assert.deepEqual(v, { origine, chemin: '/accueil' }, 'Précédent ne ramène pas à la page du site (' + JSON.stringify(v) + ')')
      })

      it('formulaire POST redirigé (303) vers une autre origine : le navigateur va à la page d\'arrivée, sans renvoyer le formulaire', async () => {
        const p = await ouvrir()
        await p.click('#envoi')
        const v = await verdict(p)
        await p.close()
        assert.deepEqual(v, { origine: ailleurs, joue: ailleurs }, message(v))
        assert.equal(vues.filter(x => x.startsWith('POST')).length, 0, 'aucun POST ne part vers le tiers : ' + vues.join(', '))
      })

      it('fiche JSON servie par l\'autre origine : ni son titre ni son module ne se posent dans le site', async () => {
        const p = await ouvrir()
        await p.click('#lien-json')
        await p.waitForFunction(() => document.title === 'tiers', null, { timeout: 15000 })
        const v = await p.evaluate(() => ({ origine: location.origin, titre: document.title }))
        await p.close()
        assert.deepEqual(v, { origine: ailleurs, titre: 'tiers' }, 'la fiche du tiers s\'est posée dans le site (' + JSON.stringify(v) + ' ; site = ' + origine + ')')
      })

      it('lien préchargé au survol puis cliqué : la page préchargée de l\'autre origine n\'est jamais servie au clic', async () => {
        const p = await ouvrir()
        await p.hover('#survol')
        await attendreVue('GET /piege')
        // le préchargement a fini : gardé dans le cache, ou écarté (sa clé retirée)
        await p.waitForFunction(() => {
          const µ = (window as any).µ, href = (document.getElementById('survol') as HTMLAnchorElement).href
          return µ._mjs_preloadCache.has(href) || !µ._mjs_preloaded.has('page:' + href)
        }, null, { timeout: 15000 })
        await p.click('#survol')
        const v = await verdict(p)
        await p.close()
        assert.deepEqual(v, { origine: ailleurs, joue: ailleurs }, message(v))
      })

      it('rafraîchissement de fond d\'une page revalidate, renvoyé au même chemin d\'une autre origine : rien ne s\'installe', async () => {
        const p = await ouvrir()
        await p.click('#vers-revalide')
        await p.waitForSelector('#revalide')
        await p.click('#vers-autre')
        await p.waitForSelector('#autre')
        renvoyer = true
        await p.evaluate(() => history.back())
        await p.waitForSelector('#revalide')
        await attendreVue('GET /revalide')
        await p.waitForFunction(() => document.documentElement.hasAttribute('data-joue'), null, { timeout: 2000 }).catch(() => null)
        const v = await p.evaluate(() => ({ origine: location.origin, joue: document.documentElement.getAttribute('data-joue'), tiers: !!document.getElementById('tiers'), revalide: !!document.getElementById('revalide') }))
        await p.close()
        assert.deepEqual(v, { origine, joue: null, tiers: false, revalide: true }, 'la page du tiers a remplacé la page rendue (' + JSON.stringify(v) + ')')
      })

      it('témoin : une redirection vers la même origine reste un échange de contenu, sans rechargement', async () => {
        const p = await ouvrir()
        await p.evaluate(() => { (window as any).__marque = 1 })
        await p.click('#vers-local')
        await p.waitForSelector('#local')
        const v = await p.evaluate(() => ({ marque: (window as any).__marque, chemin: location.pathname, origine: location.origin }))
        await p.close()
        assert.deepEqual(v, { marque: 1, chemin: '/local', origine }, 'la page a été rechargée, ou l\'adresse ne suit pas la redirection')
      })
    })
  }
})
