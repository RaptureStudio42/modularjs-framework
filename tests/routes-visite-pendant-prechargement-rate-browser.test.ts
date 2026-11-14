// Une visite qui tombe PENDANT le préchargement au repos de sa page (lien `modulepreload`), et ce préchargement échoue (503) :
// la page paraît à CETTE visite — redemandée aussitôt sous une adresse neuve (`?mjs-retry=<n>`), une seule fois, définie une
// seule fois, sans erreur du chargeur. Trois navigateurs réels, construction de production
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Demande    = { t: number, u: string }
type Banc       = { base: string, server: Server, journal: Demande[], tenir: Set<string>, lacher: () => void }

// cherche aussi dans les ombres des composants ; compte les définitions
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__definis = []; var __def = customElements.define.bind(customElements); customElements.define = function(n, c, o) { window.__definis.push(n); return __def(n, c, o); };',
].join('\n')

const estPageC = (u: string) => /^\/out\/page-c-\w+\.js/.test(u)

async function bati(): Promise<Banc> {
  const root   = mjsTmp('visite-prechargement-rate')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.page.mjs'), [
    '<routes target="root">',
    '  /   accueil',
    '  /c  page-c',
    '</routes>',
    '',
    '<nav><a id="va" href="#/">A</a> <a id="vc" href="#/c">C</a></nav>',
    '<@view root>',
    '',
  ].join('\n'))
  writeFileSync(join(srcDir, 'accueil.mjs'), '<p class="accueil">accueil</p>\n')
  writeFileSync(join(srcDir, 'page-c.mjs'), '<p class="page-c">page-c</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const page    = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>'
  const journal = [] as Demande[]
  const tenir   = new Set<string>()
  const attente = [] as Array<() => void>
  // la première demande du fichier de page-c est retenue, puis rendue en 503 au lâcher : le préchargement échoue
  const server  = createServer((req, res) => {
    const u      = req.url ?? '/'
    const chemin = decodeURIComponent(u.split('?')[0])
    journal.push({ t: Date.now(), u })
    if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    if (estPageC(u) && tenir.has('page-c')) { tenir.delete('page-c'); attente.push(() => { res.writeHead(503); res.end() }); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : extname(fichier) === '.css' ? 'text/css' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server, journal, tenir, lacher: () => { attente.splice(0).forEach((f) => f()) } }
}

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

describe('routes : une visite pendant le préchargement de sa page, qui échoue, affiche la page (navigateurs réels, production)', function () {
  this.timeout(240000)
  let banc: Promise<Banc> | null = null
  const construction = () => banc ?? (banc = bati())

  after(async () => {
    if (banc) { const b = await banc; b.lacher(); b.server.closeAllConnections(); b.server.close() }
    await terminateSharedWorkerPool()
  })

  const attendre = async (cond: () => boolean, ms: number) => {
    const fin = Date.now() + ms
    while (!cond() && Date.now() < fin) await new Promise(r => setTimeout(r, 50))
    return cond()
  }
  const voir = (page: any, sel: string, ms: number) => page.waitForFunction(`__trouve(${JSON.stringify(sel)})`, null, { timeout: ms }).then(() => true, () => false)

  for (const nom of ['chromium', 'firefox', 'webkit'] as Navigateur[]) {
    it(`${nom} : la page paraît à cette visite, redemandée une fois, définie une fois`, async function () {
      if (!await navigateurPresent(nom)) this.skip()
      const b = await construction()
      b.tenir.clear()
      b.tenir.add('page-c')
      const t0         = Date.now()
      const demandesC  = () => b.journal.filter(d => d.t >= t0 && estPageC(d.u)).map(d => d.u)
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch({ headless: true, ...(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {}) })
      try {
        const page    = await browser.newPage()
        const fautes  = [] as string[]
        page.on('pageerror', (e: any) => fautes.push('exception : ' + String(e.message)))
        page.on('console', (m: any) => { if (m.type() === 'error' && /Autoloader/.test(m.text())) fautes.push('console : ' + m.text().slice(0, 160)) })
        await page.addInitScript({ content: SONDE })
        await page.goto(b.base + '/#/', { waitUntil: 'load' })
        assert.ok(await voir(page, '.accueil', 8000), 'l\'accueil paraît')
        // le préchargement au repos de page-c est parti, et le serveur le retient
        assert.ok(await attendre(() => demandesC().length > 0, 15000), 'le préchargement de page-c part au repos')
        assert.ok(await page.evaluate("__clic('#vc')"), 'le lien vers page-c est cliqué pendant le vol')
        await page.waitForTimeout(400)
        b.lacher()
        assert.ok(await voir(page, '.page-c', 6000), 'page-c paraît à CETTE visite, sans second clic')
        await page.waitForTimeout(800)
        const demandes = demandesC()
        assert.equal(demandes.length, 2, 'le fichier raté, puis une seule reprise : ' + demandes.join(' '))
        assert.match(demandes[1], /[?&]mjs-retry=\d+/, 'la reprise part sous une adresse neuve')
        const definis = (await page.evaluate('window.__definis.slice()') as string[]).filter(t => t === 'mjs-page-c')
        assert.equal(definis.length, 1, 'page-c définie une seule fois')
        assert.deepEqual(fautes, [], 'aucune exception ni erreur du chargeur')
      }
      finally {
        await browser.close()
      }
    })
  }
})
