// Preuve navigateur réel (Chromium) sur un vrai projet construit (Bundler, développement), serveur qui parle le
// protocole de navigation (fiche JSON sur `X-MJS-Nav`) :
// - un lien vers l'ancre d'une page que le serveur redirige (`/redir#b` → 302 → `/cible`), en HTML comme en JSON : le
//   fragment demandé suit la redirection, la page reçue va à son ancre (avant : `response.url` n'a jamais de fragment,
//   l'adresse le perdait et la page restait en haut) ;
// - un formulaire GET dont l'action porte une ancre, réponse en JSON : la page reçue va à son ancre (avant : sur place) ;
// - le jeton CSRF qu'une réponse JSON porte en en-tête (`X-CSRF-Token`, après une connexion ou une déconnexion faite par
//   la navigation, lien `@method` redirigé compris) devient celui de la page : µ.ajax.post part avec lui (avant : avec
//   l'ancien, que seule une page HTML savait remplacer — 422 sous Rails).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'cible.mjs': '<h1>Cible</h1>\n<div class="h"></div>\n<h2 id="b">B</h2>\n<div class="h"></div>\n\n<style>\n  :host\n    display: block\n  .h\n    height: 1500px\n</style>\n',
}

const DEPART = '<a id="l-redir-html" href="/redir-html#b">html</a> <a id="l-redir-json" href="/redir-json#b">json</a> <a id="l-connexion" href="/connexion">connexion</a> <a id="l-sortie" href="/sortie" mjs-method="post">sortie</a>'
  + '<form id="fget" action="/cherche-json#b"><input name="q" value="x"><button id="fgetb">chercher</button></form><div style="height:4000px"></div>'
const CIBLE_HTML = '<h1>Cible</h1><div style="height:1500px"></div><h2 id="b">B</h2><div style="height:3000px"></div>'
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

function page(corps: string, jeton = 'T1'): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="' + jeton + '"><script type="module" src="/modularjs/bundle.js"></script></head><body style="margin:0">' + corps + '</body></html>'
}

describe('mjs_ujs navigateur réel, vrai projet — le fragment suit la redirection, le jeton CSRF suit la fiche JSON', function () {
  this.timeout(120000)
  let dist = ''
  let browser: Browser | null = null
  let server: Server | null  = null
  let origin  = ''
  let present = false

  before(async function () {
    present = await navigateurPresent()
    if (!present) return this.skip()
    const racine = mjsTmp('redirection-fragment')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    // les pages et leurs liens sont écrits par le serveur du test, hors des sources compilées : rien ne révèle la navigation au repérage, 'all' rend le cœur complet
    const bundler = new Bundler({ sourceDir: src, outputDir: dist, manifestPath: join(dist, 'bundle.js'), urlPrefix: '/modularjs', runtime: 'all' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-proxy-server'] })
    server  = createServer((req, res) => {
      const url  = new URL(req.url || '/', 'http://x')
      const nav  = !!req.headers['x-mjs-nav']
      const html = (corps: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page(corps)) }
      // la fiche du protocole ; `jeton` : celui de la session, en en-tête (une fiche n'a pas de <head>)
      const fiche = (jeton?: string) => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(jeton ? { 'x-csrf-token': jeton } : {}) })
        res.end(JSON.stringify({ module: 'mjs-cible', props: {}, url: url.pathname, title: null }))
      }
      if (url.pathname === '/depart') return html(DEPART)
      if (url.pathname === '/redir-html' || url.pathname === '/redir-json') { res.writeHead(302, { location: url.pathname === '/redir-html' ? '/cible-html' : '/cible-json' }); res.end(); return }
      if (url.pathname === '/cible-html') return html(CIBLE_HTML)
      if (url.pathname === '/cible-json' || url.pathname === '/cherche-json') return nav ? fiche() : html('<mjs-cible></mjs-cible>')
      if (url.pathname === '/connexion') return nav ? fiche('T2') : html('<mjs-cible></mjs-cible>')
      if (url.pathname === '/sortie' && req.method === 'POST') { res.writeHead(303, { location: '/apres-sortie' }); res.end(); return }
      if (url.pathname === '/apres-sortie') return nav ? fiche('T3') : html('<mjs-cible></mjs-cible>')
      if (url.pathname === '/echo') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jeton: req.headers['x-csrf-token'] || null })); return }
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
    await terminateSharedWorkerPool()
  })

  async function ouvrir() {
    const p       = await browser!.newPage({ viewport: { width: 800, height: 600 } })
    const erreurs: string[] = []
    p.on('pageerror', e => erreurs.push(e.message))
    await p.goto(origin + '/depart')
    await p.waitForFunction(() => history.scrollRestoration === 'manual' && !!(window as any).µ && !!(window as any).µ.ajax, null, { timeout: 15000 })
    return { p, erreurs }
  }

  // adresse affichée, et la page sur sa cible `#b` (ombre du composant comprise) ou sa position
  async function etat(p: Page): Promise<string> {
    await p.waitForFunction(() => !!(window as any).µ._mjs_anchorTarget('#b') && !document.getElementById('l-connexion'), null, { timeout: 15000 })
    await p.waitForTimeout(500)
    return p.evaluate(() => new Promise<string>(ok => requestAnimationFrame(() => requestAnimationFrame(() => {
      const t = (window as any).µ._mjs_anchorTarget('#b'), h = Math.round(t.el.getBoundingClientRect().top + scrollY), y = Math.round(scrollY)
      ok(location.pathname + location.search + location.hash + ' ' + (Math.abs(y - h) <= 1 ? 'sur #b' : 'y=' + y + ' (#b à ' + h + ')'))
    }))))
  }

  it('un lien vers l\'ancre d\'une page redirigée par le serveur, réponse HTML ou JSON : le fragment suit, la page va à son ancre', async function () {
    if (!present) return this.skip()
    const vus: string[] = []
    for (const lien of ['l-redir-html', 'l-redir-json']) {
      const { p, erreurs } = await ouvrir()
      await p.click('#' + lien)
      vus.push(lien + ' : ' + await etat(p))
      assert.deepEqual(erreurs, [])
      await p.close()
    }
    assert.deepEqual(vus, ['l-redir-html : /cible-html#b sur #b', 'l-redir-json : /cible-json#b sur #b'], 'AVANT : /cible-… sans fragment, en haut de la page')
  })

  it('un formulaire GET dont l\'action porte une ancre, réponse JSON : la page reçue va à son ancre', async function () {
    if (!present) return this.skip()
    const { p, erreurs } = await ouvrir()
    await p.evaluate(() => scrollTo(0, 1000))
    await p.click('#fgetb')
    assert.equal(await etat(p), '/cherche-json?q=x#b sur #b', 'AVANT : la page restait sur place')
    assert.deepEqual(erreurs, [])
    await p.close()
  })

  it('le jeton CSRF porté en en-tête par une fiche JSON devient celui de la page (lien, lien @method redirigé) : µ.ajax.post part avec lui', async function () {
    if (!present) return this.skip()
    const vus: string[] = []
    for (const lien of ['l-connexion', 'l-sortie']) {
      const { p, erreurs } = await ouvrir()
      await p.click('#' + lien)
      await p.waitForFunction(() => !document.getElementById('l-connexion') && !!(window as any).µ._mjs_anchorTarget('#b'), null, { timeout: 15000 })
      await p.waitForTimeout(200)
      const envoye = await p.evaluate(() => new Promise(ok => (window as any).µ.ajax.post('/echo', {}, (r: any) => ok(r && r.jeton), (e: any) => ok('échec ' + (e && e.message)))))
      const balise = await p.evaluate(() => document.querySelector('meta[name="csrf-token"]')!.getAttribute('content'))
      vus.push(lien + ' : page ' + balise + ', envoyé ' + envoye)
      assert.deepEqual(erreurs, [])
      await p.close()
    }
    assert.deepEqual(vus, ['l-connexion : page T2, envoyé T2', 'l-sortie : page T3, envoyé T3'], 'AVANT : la page gardait T1, µ.ajax.post partait avec le jeton périmé')
  })
})
