// Matrice de la navigation : le site commun, son serveur et les deux modes de jeu.
// Un vrai projet construit une fois par passage (Bundler, en développement), servi par un serveur local, joué dans
// Chromium, Firefox et WebKit ; chaque cas se joue deux fois : tel quel, et avec `window.navigation` retiré avant tout
// script de la page (un navigateur sans l'API Navigation). Le serveur tient le journal des requêtes : une requête de la
// navigation de MJS porte `X-Requested-With`, celle du navigateur seul (chargement complet, téléchargement) non.

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { mjsTmp } from './tmp.js'

export const ENGINES = ['chromium', 'firefox', 'webkit'] as const
export type Engine = typeof ENGINES[number]

// tel quel, puis sans l'API Navigation
export const MODES = [
  { name: 'tel quel', withoutApi: false },
  { name: 'sans window.navigation', withoutApi: true },
] as const

const SOURCES: Record<string, string> = {
  'ombre.mjs':     '<a id="lo" href="/p2">p2 depuis une ombre</a>\n\n<style>\n  :host\n    display: block\n</style>\n',
  'vues.page.mjs': '<routes target="vue">\n/a  vue-a\n/b  vue-b\n</routes>\n<@view vue>\n',
  'vue-a.mjs':     '<p id="r-a">vue a</p>\n',
  'vue-b.mjs':     '<p id="r-b">vue b</p>\n',
}

// préfixe d'adresse → réglages du projet ; `/ah` : chaque ancre est une entrée d'historique ; `/prod` : le projet construit
// en production (minifié, propriétés internes `_mjs_*` renommées) ; `/ahp` : les deux
const VARIANTS: Record<string, Record<string, unknown>> = {
  '':      { runtime: ['ujs', 'router', 'ajax', 'vault'] },
  '/ah':   { runtime: ['ujs', 'router', 'ajax', 'vault'], anchorHistory: true },
  '/prod': { runtime: ['ujs', 'router', 'ajax', 'vault'], env: 'prod', minify: true },
  '/ahp':  { runtime: ['ujs', 'router', 'ajax', 'vault'], anchorHistory: true, env: 'prod', minify: true },
}

// page lente : elle répond après le geste suivant du cas
export const SLOW = 1500

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

export interface Hit {
  method: string
  path:   string
  mjs:    boolean
  body:   string
  cut:    boolean
}

export interface Site {
  origin: string
  other:  string
  log:    Hit[]
  close(): Promise<void>
}

let built: Promise<string> | null = null

// le projet, construit une fois pour tous les fichiers de la matrice
function build(): Promise<string> {
  built ??= (async () => {
    const root = mjsTmp('navigation-matrice')
    const src  = join(root, 'src')
    const dist = join(root, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [name, content] of Object.entries(SOURCES)) writeFileSync(join(src, name), content)
    for (const [prefix, options] of Object.entries(VARIANTS)) {
      const out     = join(dist, prefix || '/base')
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: prefix + '/modularjs', ...options } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    }
    return dist
  })()
  return built
}

const LINKS = (x: string, other: string) => [['lp1', x + '/p1', ''], ['lp2', x + '/p2', ''], ['lp3', x + '/p3', ''], ['llent', x + '/lent', ''], ['lredir', x + '/redir', ''], ['lboom', x + '/boom', ''], ['lf', x + '/f', ''], ['lp2b', x + '/p2#b', ''], ['la', '#a', ''], ['lb', '#b', ''], ['lext', other + '/ext', ''], ['lblank', x + '/p2', ' target="_blank"'], ['ldl', x + '/fichier.csv', ' download'], ['lnoujs', x + '/p2', ' mjs-no-ujs'], ['ldel', x + '/item', ' mjs-method="delete"'], ['lconf', x + '/p2', ' mjs-confirm="Vraiment ?"'], ['lvt', x + '/p2', ' mjs-vt="on"']]

const NAV = (x: string, other: string) => '<nav id="nav" style="position:fixed;top:0;right:0;width:420px;background:#fff;z-index:9;font-size:10px">'
  + LINKS(x, other).map(([id, href, more]) => '<a id="' + id + '" href="' + href + '"' + more + '>' + id + '</a> ').join('')
  + '<form id="fget" action="' + x + '/rech"><input name="q" value="chat" aria-label="q"><button id="envoiget">get</button></form>'
  + '<form id="fpost" method="post" action="' + x + '/post"><input name="a" value="1" aria-label="a"><button id="envoipost">post</button></form>'
  + '<form id="fdel" method="post" action="' + x + '/item"><input type="hidden" name="_method" value="delete"><input name="b" value="2" aria-label="b"><button id="envoidel">delete</button></form>'
  + '<form id="fconf" method="post" action="' + x + '/post" mjs-confirm="Envoyer ?"><input name="a" value="3" aria-label="c"><button id="envoiconf">confirmer</button></form>'
  + '</nav>'

const TALL = '<div style="height:3000px"></div><h2 id="a">A</h2><div style="height:3000px"></div><h2 id="b">B</h2><div style="height:3000px"></div>'

// corps de chaque page, selon le préfixe de la variante et l'adresse de l'autre origine
const BODIES: Record<string, (x: string, other: string, q: string) => string> = {
  '/p1':   (x, o) => NAV(x, o) + '<p id="nom-p1">p1</p><div id="perma" mjs-permanent>perma</div><mjs-ombre></mjs-ombre>' + TALL,
  '/p2':   (x, o) => NAV(x, o) + '<p id="nom-p2">p2</p><div id="perma" mjs-permanent>perma</div>' + TALL,
  '/p3':   (x, o) => NAV(x, o) + '<p id="nom-p3">p3</p>' + TALL,
  '/lent': (x, o) => NAV(x, o) + '<p id="nom-lent">lent</p>' + TALL,
  '/recu': (x, o) => NAV(x, o) + '<p id="nom-recu">reçu</p>' + TALL,
  '/rech': (x, o, q) => NAV(x, o) + '<p id="nom-rech">' + q.replace(/[<>&"]/g, '') + '</p>' + TALL,
  '/f':    (x, o) => NAV(x, o) + '<h1 id="titre-f">F</h1><p id="nom-f">texte</p>',
  '/app':  (x, o) => NAV(x, o) + '<p id="nom-app">app</p><a id="lvb" href="#/b">#/b</a> <a id="lva" href="#/a">#/a</a><mjs-vues></mjs-vues>' + TALL,
}

function html(x: string, id: string, body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Titre ' + id + '</title><meta name="description" content="desc ' + id + '"><script type="module" src="' + x + '/modularjs/bundle.js"></script></head><body style="margin:0">' + body + '</body></html>'
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body = ''): void {
  if (res.destroyed) return
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(body)
}

// le site sur deux origines : la page et ses fichiers, puis une autre origine (lien externe)
export async function startSite(): Promise<Site> {
  const dist = await build()
  const site = { origin: '', other: '', log: [] as Hit[] } as Site
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url  = new URL(req.url || '/', 'http://x')
    const x    = Object.keys(VARIANTS).find(v => v && url.pathname.startsWith(v + '/')) || ''
    const path = url.pathname.slice(x.length)
    const hit: Hit = { method: req.method || 'GET', path: url.pathname + url.search, mjs: !!req.headers['x-requested-with'], body: '', cut: false }
    if (!path.startsWith('/modularjs/') && path !== '/favicon.ico') site.log.push(hit)
    res.on('close', () => { if (!res.writableEnded) hit.cut = true })
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      hit.body = Buffer.concat(chunks).toString('utf-8')
      if (path === '/redir') return send(res, 302, { location: x + '/p2' })
      if (path === '/boom') return send(res, 500, { 'content-type': 'text/html; charset=utf-8' }, '<!doctype html><html><head><meta charset="utf-8"><title>Erreur</title></head><body><p id="erreur">erreur du serveur</p></body></html>')
      if (path === '/fichier.csv') return send(res, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="fichier.csv"' }, 'a,b\n1,2\n')
      if (path === '/post' && hit.method !== 'GET') return send(res, 303, { location: x + '/recu' })
      if (path === '/item' && hit.method !== 'GET') return send(res, 303, { location: x + '/p3' })
      const body = BODIES[path]
      if (body) {
        const id   = path.slice(1)
        const page = () => send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, html(x, id, body(x, site.other, url.searchParams.get('q') || '')))
        if (path === '/lent') setTimeout(page, SLOW)
        else page()
        return
      }
      const m    = /^\/modularjs\/(.+)$/.exec(path)
      const file = m ? join(dist, x || '/base', normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
      if (!file || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { 'content-type': 'text/plain' }, 'introuvable')
      send(res, 200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }, readFileSync(file) as any)
    })
  }
  const elsewhere = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/favicon.ico') site.log.push({ method: req.method || 'GET', path: 'autre:' + req.url, mjs: !!req.headers['x-requested-with'], body: '', cut: false })
    send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, '<!doctype html><html><head><meta charset="utf-8"><title>Ailleurs</title></head><body><p id="ext">ailleurs</p></body></html>')
  }
  const servers: Server[] = [createServer(handle), createServer(elsewhere)]
  for (const s of servers) await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()))
  site.origin = 'http://127.0.0.1:' + (servers[0].address() as any).port
  site.other  = 'http://127.0.0.1:' + (servers[1].address() as any).port
  site.close  = async () => {
    for (const s of servers) {
      (s as any).closeAllConnections?.()
      await new Promise(resolve => s.close(() => resolve(null)))
    }
  }
  return site
}

// avant tout script de la page : le mode (API retirée ou non), le relevé des événements de la navigation, le compte des
// transitions de vue démarrées
function initScript(withoutApi: boolean): string {
  return (withoutApi ? 'delete window.navigation;' : '')
    + 'window.__evts = [];'
    + '["before-visit", "visit", "before-cache", "load"].forEach(function(n) { document.addEventListener("mjs:" + n, function(e) { var d = e.detail || {}; window.__evts.push(n + " " + (d.via || "-") + (n === "visit" ? (d.cached ? " cache" : " réseau") : "") + " " + (d.path || "")); }); });'
    + 'window.__vt = 0;'
    + 'var __start = document.startViewTransition;'
    + 'if (typeof __start === "function") { document.startViewTransition = function() { window.__vt++; return __start.apply(document, arguments); }; }'
    // un élément par son id, ombres des composants comprises (fermées : `_shadow`, en développement)
    + 'window.__deep = function(id) { var seek = function(root) { var hit = root.getElementById(id), all, i, sr, f; if (hit) { return hit; } all = root.querySelectorAll("*"); for (i = 0; i < all.length; i++) { sr = all[i].shadowRoot || all[i]._shadow; if (sr) { f = seek(sr); if (f) { return f; } } } return null; }; return seek(document); };'
}

export async function engineInstalled(name: Engine): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[name].executablePath())
  } catch {
    return false
  }
}

export interface Run {
  engine:     Engine
  withoutApi: boolean
  ctx:        BrowserContext
  site:       Site
  // les erreurs de la page relevées jusqu'ici : un cas qui en attend une la retire
  errors:     string[]
  // ouvre une page du site, la navigation chargée, le journal vidé ; `init` : un script de la page, joué avant le runtime
  open(path: string, init?: string): Promise<Page>
}

export interface Case {
  name: string
  run:  (r: Run) => Promise<void>
  // raison en clair d'un cas faux aujourd'hui (défaut ancien), sinon rien
  pending?: (engine: Engine, withoutApi: boolean) => string | undefined
}

// la navigation chargée : elle coupe le défilement natif des entrées
export function ready(p: Page) {
  return p.waitForFunction(() => history.scrollRestoration === 'manual', null, { timeout: 15000 })
}

// attend que `fn` rende vrai, à travers un changement de document (chargement complet)
export async function until(p: Page, fn: (arg: any) => unknown, arg: any = null, ms = 10000): Promise<void> {
  const end = Date.now() + ms
  let last: unknown = null
  while (Date.now() < end) {
    try {
      if (await p.evaluate(fn, arg)) return
    } catch (e) {
      last = e
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('attente dépassée (' + ms + ' ms) : ' + fn.toString() + (last ? ' — ' + String(last) : ''))
}

// l'écran posé (deux images), puis la position verticale
export async function settle(p: Page, ms = 300): Promise<number> {
  await p.waitForTimeout(ms)
  return p.evaluate(() => new Promise<number>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(Math.round(scrollY))))))
}

export function scrollToY(p: Page, y: number) {
  return p.evaluate((h) => new Promise(ok => { scrollTo({ left: 0, top: h, behavior: 'instant' }); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
}

// l'ancre d'un clic atteinte : l'adresse, la cible en haut de la vue, et la position tenue deux images — Firefox achève
// le défilement vers la cible d'une ancre en deux pas, à une image d'écart (le premier à un pixel près), que la page ait
// MJS ou non : un défilement posé entre les deux, il le reprend, et l'entrée quittée au clic suivant garde l'ancre au lieu
// de la position voulue
export function reached(p: Page, id: string): Promise<void> {
  return until(p, (i) => new Promise(ok => { const y = scrollY; requestAnimationFrame(() => requestAnimationFrame(() => ok(location.hash === '#' + i && Math.abs(document.getElementById(i)!.getBoundingClientRect().top) <= 2 && scrollY === y))) }), id)
}

export function address(p: Page): Promise<string> {
  return p.evaluate(() => location.pathname + location.search + location.hash)
}

// le document du départ est toujours là (aucun chargement complet)
export function sameDocument(p: Page): Promise<boolean> {
  return p.evaluate(() => (window as any).__doc === 'départ')
}

export function events(p: Page): Promise<string[]> {
  return p.evaluate(() => (window as any).__evts.slice())
}

// haut de l'élément dans la fenêtre (px), ou null s'il manque
export function topOf(p: Page, id: string): Promise<number | null> {
  return p.evaluate((i) => { const e = document.getElementById(i); return e ? Math.round(e.getBoundingClientRect().top) : null }, id)
}

// l'élément actif, ombres comprises : balise et id
export function focused(p: Page): Promise<string> {
  return p.evaluate(() => {
    let a = document.activeElement as any
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement
    return a ? a.tagName + (a.id ? '#' + a.id : '') : 'aucun'
  })
}

// requêtes de pages reçues par le serveur, sous la forme `MÉTHODE chemin mjs|navigateur`
export function hits(site: Site): string[] {
  return site.log.map(h => h.method + ' ' + h.path + ' ' + (h.mjs ? 'mjs' : 'navigateur') + (h.cut ? ' coupée' : ''))
}

// l'élément existe, ombres comprises
export function deepHas(p: Page, id: string): Promise<boolean> {
  return p.evaluate((i) => !!(window as any).__deep(i), id)
}

// clic de souris au centre d'un élément, ombres comprises (un sélecteur ne traverse pas une ombre fermée)
export async function deepClick(p: Page, id: string): Promise<void> {
  await until(p, (i) => !!(window as any).__deep(i), id)
  const box = await p.evaluate((i) => { const r = (window as any).__deep(i).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }, id)
  await p.mouse.click(box[0], box[1])
}

// attend une requête du journal (côté serveur)
export async function waitHit(site: Site, fn: (h: Hit) => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (site.log.some(fn)) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('requête attendue absente du journal (' + ms + ' ms) : ' + hits(site).join(', '))
}

export function back(p: Page) {
  return p.evaluate(() => history.back())
}

export function forward(p: Page) {
  return p.evaluate(() => history.forward())
}

// la matrice d'un fichier : moteur × mode × cas ; un seul navigateur ouvert à la fois
export function matrix(title: string, cases: Case[]): void {
  describe(title, function () {
    this.timeout(600000)
    let site: Site | null = null

    before(async function () {
      this.timeout(240000)
      site = await startSite()
    })

    after(async () => {
      if (site) await site.close()
      await terminateSharedWorkerPool()
    })

    for (const engine of ENGINES) {
      describe(engine, function () {
        let browser: Browser | null = null

        before(async function () {
          if (!(await engineInstalled(engine))) return this.skip()
          browser = await (await import('playwright'))[engine].launch(engine === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        })

        after(async () => {
          if (browser) await browser.close()
        })

        for (const mode of MODES) {
          describe(mode.name, function () {
            let ctx: BrowserContext | null = null
            let errors: string[] = []

            before(async function () {
              ctx = await browser!.newContext({ viewport: { width: 800, height: 600 } })
              await ctx.addInitScript({ content: initScript(mode.withoutApi) })
            })

            after(async () => {
              if (ctx) await ctx.close()
            })

            afterEach(async () => {
              for (const p of ctx!.pages()) await p.close().catch(() => {})
            })

            for (const c of cases) {
              const reason = c.pending?.(engine, mode.withoutApi)
              if (reason) {
                it(c.name + ' — en attente : ' + reason)
                continue
              }
              it(c.name, async function () {
                this.timeout(90000)
                errors = []
                const run: Run = {
                  engine,
                  withoutApi: mode.withoutApi,
                  ctx:        ctx!,
                  site:       site!,
                  errors,
                  open: async (path: string, init?: string) => {
                    const p = await ctx!.newPage()
                    p.on('pageerror', e => errors.push(e.message))
                    if (init) await p.addInitScript({ content: init })
                    await p.goto(site!.origin + path)
                    await ready(p)
                    await p.evaluate(() => { (window as any).__doc = 'départ' })
                    assert.equal(await p.evaluate(() => 'navigation' in window), !mode.withoutApi, 'mode du navigateur : window.navigation ' + (mode.withoutApi ? 'retiré' : 'présent'))
                    site!.log.length = 0
                    return p
                  },
                }
                await c.run(run)
                assert.deepEqual(errors, [], 'aucune erreur dans la page')
              })
            }
          })
        }
      })
    }
  })
}
