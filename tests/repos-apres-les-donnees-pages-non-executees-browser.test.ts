// Les deux files du repos (pages d'une table de routes, composants d'un `{if}` fermé) dans un vrai navigateur (Chromium, Firefox,
// WebKit sans fenêtre), construction de production découpée servie en HTTP. Elles partent après l'événement `load`, quand plus rien
// n'est en vol — ni code ni données (`µload` retenu par le serveur d'essai) —, puis au repos : rien ne part avant l'arrivée des
// données, tout part après. Une page préchargée n'est pas exécutée (aucun `customElements.define` avant sa visite) et sa visite ne la
// redemande pas. Une demande de données qui ne finit jamais ne retient la file que jusqu'au plafond (10 s après `load`)

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Demande    = { t: number, u: string }

// fichiers du repos : deux pages de la table, un composant d'un `{if}` fermé
const REPOS = ['page-b', 'page-c', 'tiroir']

// cherche à travers les racines d'ombre ; chaque `customElements.define` compté
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
  'window.__definis = []; var __def = customElements.define.bind(customElements); customElements.define = function(n, c, o) { window.__definis.push(n); return __def(n, c, o); };',
].join('\n')

type Banc = { base: string, server: Server, journal: Demande[], retenir: (mode: 'non' | 'oui' | 'jamais') => void, relacher: () => void }

async function bati(): Promise<Banc> {
  const root   = mjsTmp('repos-apres-les-donnees')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.page.mjs'), [
    '<script>',
    '  $ouvert = false',
    '  @ouvrir = -> $ouvert = true',
    '</script>',
    '<routes target="root">',
    '  /   accueil',
    '  /b  page-b',
    '  /c  page-c',
    '</routes>',
    '',
    '<nav><a id="vb" href="#/b">B</a></nav>',
    '<button id="ouvrir" @click={@ouvrir()}>ouvrir</button>',
    '{if $ouvert}<@tiroir></@tiroir>{end}',
    '<@view root>',
    '',
  ].join('\n'))
  writeFileSync(join(srcDir, 'accueil.mjs'), ['<script>', "  $d = µload('/api/donnees')", '</script>', "<p class=\"accueil\">{$d.data?.n or 'attente'}</p>", ''].join('\n'))
  for (const n of REPOS) writeFileSync(join(srcDir, `${n}.mjs`), `<p class="${n}">${n}</p>\n`)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const page    = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>'
  const journal = [] as Demande[]
  let mode      = 'non' as 'non' | 'oui' | 'jamais'
  let attente   = [] as Array<() => void>
  const server  = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    journal.push({ t: Date.now(), u: req.url ?? '' })
    if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return }
    if (chemin === '/api/donnees') {
      const envoi = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"n":7}') }
      if (mode === 'non') envoi()
      else if (mode === 'oui') attente.push(envoi)
      // « jamais » : la réponse commence et ne finit pas (un blanc par seconde) ; le Firefox piloté ici abandonne de lui-même,
      // vers 5 s, une demande restée sans aucune réponse (NS_ERROR_ABORT), qui ne retiendrait plus la file jusqu'au plafond
      else {
        res.writeHead(200, { 'content-type': 'application/json' })
        const tic = setInterval(() => res.write(' '), 1000)
        res.on('close', () => clearInterval(tic))
      }
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    base:     `http://127.0.0.1:${(server.address() as any).port}`,
    server,
    journal,
    retenir:  (m) => { mode = m; attente = [] },
    relacher: () => { attente.splice(0).forEach((f) => f()) },
  }
}

// l'instant de la première demande du fichier d'un composant (`/out/<nom>-<empreinte>.js`), et leur nombre
const fichier = (j: Demande[], n: string) => j.filter(d => new RegExp(`^/out/${n}-\\w+\\.js`).test(d.u))
const premier = (j: Demande[], n: string) => fichier(j, n)[0]?.t ?? Infinity
const donnees = (j: Demande[]) => j.filter(d => d.u.startsWith('/api/donnees'))
// l'ordre des demandes vu par le serveur, réduit aux données et aux fichiers du repos
const ordre   = (j: Demande[], depuis: number, lache?: number) => j.filter(d => d.t >= depuis).flatMap(d => {
  const n = d.u.startsWith('/api/donnees') ? 'donnees' : REPOS.find(r => new RegExp(`^/out/${r}-\\w+\\.js`).test(d.u))
  return n ? [{ t: d.t, n }] : []
}).concat(lache ? [{ t: lache, n: '(données arrivées)' }] : []).sort((a, b) => a.t - b.t).map(x => x.n).join(', ')

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

describe('files du repos : après l\'arrivée des données, pages préchargées sans être exécutées (navigateurs réels, production)', function () {
  this.timeout(240000)
  let banc: Promise<Banc> | null = null
  const construction = () => banc ?? (banc = bati())

  after(async () => {
    if (banc) { const b = await banc; b.relacher(); b.server.closeAllConnections(); b.server.close() }
    await terminateSharedWorkerPool()
  })

  const ouvrir = async (nom: Navigateur, b: Banc, suite: (page: any, t0: number, fautes: string[]) => Promise<void>) => {
    const playwright = await import('playwright')
    const browser    = await playwright[nom].launch({ headless: true, ...(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {}) })
    try {
      const page   = await browser.newPage()
      const fautes = [] as string[]
      page.on('pageerror', (e: any) => fautes.push(String(e.message)))
      await page.addInitScript({ content: SONDE })
      const t0 = Date.now()
      await page.goto(b.base + '/#/', { waitUntil: 'load' })
      await suite(page, t0, fautes)
    }
    finally {
      await browser.close()
    }
  }
  const attendre = async (cond: () => boolean, ms: number) => {
    const fin = Date.now() + ms
    while (!cond() && Date.now() < fin) await new Promise(r => setTimeout(r, 50))
    return cond()
  }

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    it(`${nom} : données retenues — rien ne part au repos avant leur arrivée, tout part après`, async function () {
      if (!await navigateurPresent(nom)) this.skip()
      const b = await construction()
      b.retenir('oui')
      const depuis = Date.now()
      await ouvrir(nom, b, async (page, _t0, fautes) => {
        assert.ok(await attendre(() => donnees(b.journal.filter(d => d.t >= depuis)).length > 0, 8000), 'les données sont demandées')
        await page.waitForTimeout(3000)
        const avant = REPOS.filter(n => premier(b.journal.filter(d => d.t >= depuis), n) !== Infinity)
        const lache = Date.now()
        b.relacher()
        const j = () => b.journal.filter(d => d.t >= depuis)
        await attendre(() => REPOS.every(n => premier(j(), n) !== Infinity), 10000)
        console.log(`      ordre (${nom}) : ${ordre(b.journal, depuis, lache)}`)
        assert.deepEqual(avant, [], 'aucun fichier du repos avant l\'arrivée des données')
        for (const n of REPOS) assert.ok(premier(j(), n) !== Infinity && premier(j(), n) >= lache, `${n} part après l'arrivée des données`)
        assert.ok(await page.evaluate("__trouve('.accueil')"), 'la page ouverte est là')
        assert.deepEqual(fautes, [])
      })
    })

    it(`${nom} : une page préchargée n'est pas exécutée avant sa visite, et sa visite ne la redemande pas`, async function () {
      if (!await navigateurPresent(nom)) this.skip()
      const b = await construction()
      b.retenir('non')
      const depuis = Date.now()
      const j = () => b.journal.filter(d => d.t >= depuis)
      await ouvrir(nom, b, async (page, _t0, fautes) => {
        assert.ok(await attendre(() => REPOS.every(n => premier(j(), n) !== Infinity), 10000), 'les fichiers du repos sont demandés')
        await page.waitForTimeout(800)
        const definis = await page.evaluate('window.__definis.slice()') as string[]
        assert.deepEqual(REPOS.map(n => 'mjs-' + n).filter(t => definis.includes(t)), [], 'aucun fichier préchargé n\'est exécuté')
        await page.evaluate("__clic('#vb')")
        assert.ok(await page.waitForFunction("__trouve('.page-b')", null, { timeout: 6000 }).then(() => true, () => false), 'la page b paraît à sa visite')
        assert.equal(fichier(j(), 'page-b').length, 1, 'la visite ne redemande pas la page préchargée')
        const apres = await page.evaluate('window.__definis.slice()') as string[]
        assert.equal(apres.filter(t => t === 'mjs-page-b').length, 1, 'la page est définie une fois, à sa visite')
        assert.deepEqual(fautes, [])
      })
    })

    it(`${nom} : une demande de données qui ne finit jamais retient la file jusqu'au plafond, pas au-delà`, async function () {
      if (!await navigateurPresent(nom)) this.skip()
      const b = await construction()
      b.retenir('jamais')
      const depuis = Date.now()
      const j = () => b.journal.filter(d => d.t >= depuis)
      await ouvrir(nom, b, async (page, t0, fautes) => {
        const charge = Date.now()
        assert.ok(await attendre(() => REPOS.some(n => premier(j(), n) !== Infinity), 16000), 'la file part au plafond')
        const t = Math.min(...REPOS.map(n => premier(j(), n)))
        console.log(`      plafond (${nom}) : premier fichier du repos ${t - charge} ms après load (${t - t0} ms après l'ouverture)`)
        assert.ok(t - charge >= 8000, `rien avant le plafond (premier fichier ${t - charge} ms après load)`)
        assert.ok(await page.evaluate("__trouve('.accueil')"), 'la page ouverte est là')
        assert.deepEqual(fautes, [])
      })
    })
  }
})
