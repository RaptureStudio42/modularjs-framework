// `blocks.preload` dans un vrai navigateur (Chromium, Firefox, WebKit sans fenêtre), construction de production découpée (un fichier par
// composant) servie en HTTP. `"idle"` (défaut, réglage absent compris) : au démarrage, seuls partent les composants affichés et ceux d'un
// `{for}` (même vide) ou d'un `{await}` (même en attente) ; un composant écrit seulement sous un `{if}` faux ou un `{else}` non pris part
// après l'événement `load`, au repos, sans être exécuté ni affiché, et l'ouverture de sa branche ne le redemande pas — pas même quand
// elle s'ouvre pendant qu'il est en route ; un préchargement raté au réseau n'empêche pas l'ouverture (le fichier est redemandé sous
// une adresse neuve, le navigateur gardant l'échec à la première) ; un composant qui importe un module (`@import`) ou porte un effet
// part à l'ouverture de sa branche, jamais au repos : une coupure du réseau pendant le repos ne l'empêche pas de paraître. `"off"` : ce composant n'est demandé qu'à l'ouverture de sa branche. `"on"` : tous partent au
// démarrage avec leur parent. Sous `"idle"`, un `{if}` dont la valeur de départ est écrite en clair (`$onglet = 'profil'`) se décide à la
// construction : sa branche vraie part au démarrage, l'autre part au repos. La page d'une autre route suit `routes.preload` (défaut `idle`)

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const NOMS   = ['vu', 'si', 'sinon', 'attente', 'boucle', 'autre-page', 'accueil', 'profil', 'reglages']
const FERMES = ['reglages', 'si', 'sinon']

// `lent` : le fichier de `si` part avec une seconde et demie de retard, pour ouvrir sa branche pendant son vol
// `variante` 'module' : un composant qui importe un module et un composant à effet, chacun sous un `{if}` fermé, plus un composant simple
async function bati(blocksPreload: string, lent: boolean, variante = ''): Promise<{ base: string, server: Server }> {
  const root   = mjsTmp(`blocs-fermes-${blocksPreload}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'app.page.mjs'), [
    '<script>',
    '  $faux    = false',
    '  $vrai    = true',
    "  $onglet  = 'profil'",
    '  $liste   = []',
    '  $jamais  = new Promise(->)',
    '  @routes  =',
    "    'main':",
    "      '/':      'accueil'",
    "      '/autre': 'autre-page'",
    '  @ouvrir = -> $faux = true',
    '</script>',
    '<button id="ouvrir" @click={@ouvrir()}>ouvrir</button>',
    '<@vu></@vu>',
    '{if $faux}<@si></@si>{end}',
    '{if $vrai}<p>pris</p>{else}<@sinon></@sinon>{end}',
    "{if $onglet is 'profil'}<@profil></@profil>{else}<@reglages></@reglages>{end}",
    '{await $jamais}<i>...</i>{success v}<@attente></@attente>{end}',
    '{for x in $liste}<@boucle></@boucle>{end}',
    '<@view main>',
    '',
  ].join('\n'))
  for (const n of NOMS) writeFileSync(join(srcDir, `${n}.mjs`), `<p class="${n}">${n}</p>\n`)
  if (variante === 'module') {
    writeFileSync(join(srcDir, 'app.page.mjs'), ['<script>', '  $m = false', '  $e = false', '  $s = false', '  @ouvrirM = -> $m = true', '  @ouvrirE = -> $e = true', '</script>', '<button id="m" @click={@ouvrirM()}>m</button>', '<button id="e" @click={@ouvrirE()}>e</button>', '<@vu></@vu>', '{if $m}<@avecmodule></@avecmodule>{end}', '{if $e}<@aveceffet></@aveceffet>{end}', '{if $s}<@simple></@simple>{end}', ''].join('\n'))
    writeFileSync(join(srcDir, 'avecmodule.mjs'), ["@import bump 'outil.module.civet.mjs'", '', '<p class="avecmodule">avecmodule {bump(1)}</p>', ''].join('\n'))
    writeFileSync(join(srcDir, 'outil.module.civet.mjs'), 'export bump := (x) -> x + 1\n')
    writeFileSync(join(srcDir, 'aveceffet.mjs'), '<h1 class="aveceffet" *neon(#f0f)>aveceffet</h1>\n')
    writeFileSync(join(srcDir, 'simple.mjs'), '<p class="simple">simple</p>\n')
  }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', ...(blocksPreload === 'defaut' ? {} : { blocks: { preload: blocksPreload } }) }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const page   = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoi = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : extname(fichier) === '.css' ? 'text/css' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    lent && /\/out\/si-\w+\.js$/.test(chemin) ? setTimeout(envoi, 1500) : envoi()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

// noms des composants dont le fichier est parti (`/out/<nom>-<empreinte>.js`), et combien de fois
const demandes = (urls: string[]) => NOMS.filter(n => urls.some(u => new RegExp(`/out/${n}-[\\w]+\\.js`).test(u))).sort()
const fois     = (urls: string[], n: string) => urls.filter(u => new RegExp(`/out/${n}-[\\w]+\\.js`).test(u)).length
// les fichiers partis avant l'événement load, lus dans la page (côté Playwright, Firefox livre `load` avant les demandes)
const AVANT_LOAD = "(() => { const n = performance.getEntriesByType('navigation')[0]; return performance.getEntriesByType('resource').filter(e => e.startTime < n.loadEventStart).map(e => e.name) })()"

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

describe('blocks.preload : composants des blocs fermés au démarrage (navigateurs réels, production)', function () {
  this.timeout(240000)
  const constructions = new Map<string, Promise<{ base: string, server: Server }>>()
  const construction  = (mode: string, lent = false, variante = '') => {
    const cle = mode + (lent ? '-lent' : '') + variante
    if (!constructions.has(cle)) constructions.set(cle, bati(mode, lent, variante))
    return constructions.get(cle)!
  }

  after(async () => {
    for (const c of constructions.values()) (await c).server.close()
    await terminateSharedWorkerPool()
  })

  const ouvrir = async (nom: Navigateur, base: string, suite: (page: any, urls: string[], fautes: string[]) => Promise<void>) => {
    const playwright = await import('playwright')
    const browser    = await playwright[nom].launch({ headless: true, ...(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {}) })
    try {
      const page   = await browser.newPage()
      const urls: string[]   = []
      const fautes: string[] = []
      page.on('request', (r: any) => urls.push(r.url()))
      page.on('pageerror', (e: any) => fautes.push(String(e)))
      page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()) })
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction("!!document.querySelector('mjs-app')?._shadow?.querySelector('mjs-vu')?._shadow?.querySelector('.vu')")
      await suite(page, urls, fautes)
    }
    finally {
      await browser.close()
    }
  }

  for (const nom of ['chromium', 'firefox', 'webkit'] as Navigateur[]) {
    for (const mode of ['idle', 'defaut', 'off', 'on']) {
      it(`${nom}, blocks.preload ${mode === 'defaut' ? 'absent (défaut idle)' : mode}`, async function () {
        if (!(await navigateurPresent(nom))) { this.skip(); return }
        const c = await construction(mode)
        await ouvrir(nom, c.base, async (page, urls, fautes) => {
          const repos = mode === 'idle' || mode === 'defaut'
          if (repos) await page.waitForFunction(`performance.getEntriesByType('resource').filter(e => /\\/out\\/(reglages|si|sinon)-\\w+\\.js$/.test(e.name)).length === 3`, null, { timeout: 15000 })
          await page.waitForTimeout(1500)
          const auDemarrage = demandes(urls)
          const avantLoad   = demandes(await page.evaluate(AVANT_LOAD))
          // ni exécutés ni affichés : le fichier est arrivé, la balise n'est pas définie
          const definis = await page.evaluate(`${JSON.stringify(FERMES)}.filter(n => !!customElements.get('mjs-' + n))`)
          await page.evaluate("document.querySelector('mjs-app')._shadow.querySelector('#ouvrir').click()")
          await page.waitForFunction("document.querySelector('mjs-app')._shadow.querySelector('mjs-si')?._shadow?.querySelector('.si')?.textContent === 'si'")
          await page.waitForTimeout(500)
          const tous = ['accueil', 'attente', 'autre-page', 'boucle', 'profil', 'reglages', 'si', 'sinon', 'vu']
          assert.deepEqual(auDemarrage, mode === 'off' ? ['accueil', 'attente', 'autre-page', 'boucle', 'profil', 'vu'] : tous)
          // la branche vraie au départ part avec son parent, avant l'événement load (sous "off", la devinette ne joue pas)
          if (mode !== 'off') assert.ok(avantLoad.includes('profil'), `profil avant load : ${avantLoad.join(', ')}`)
          if (mode === 'on') assert.deepEqual(avantLoad.filter(n => FERMES.includes(n)), FERMES)
          else assert.deepEqual(avantLoad.filter(n => FERMES.includes(n)), [], `rien des branches fermées avant load : ${avantLoad.join(', ')}`)
          if (repos) assert.deepEqual(definis, [])
          assert.equal(fois(urls, 'si'), 1, `si demandé ${fois(urls, 'si')} fois`)
          assert.deepEqual(fautes, [])
        })
      })
    }

    it(`${nom}, blocks.preload idle : la branche ouverte pendant le vol de son fichier ne le redemande pas`, async function () {
      if (!(await navigateurPresent(nom))) { this.skip(); return }
      const c = await construction('idle', true)
      await ouvrir(nom, c.base, async (page, urls, fautes) => {
        await page.waitForFunction("performance.getEntriesByType('resource').some(e => /\\/out\\/reglages-\\w+\\.js$/.test(e.name) && e.responseEnd > 0)", null, { timeout: 15000 })
        await page.waitForTimeout(300)
        assert.equal(fois(urls, 'si'), 1, 'le fichier de si est en route au repos')
        assert.equal(await page.evaluate("!!customElements.get('mjs-si')"), false, 'pas encore arrivé')
        await page.evaluate("document.querySelector('mjs-app')._shadow.querySelector('#ouvrir').click()")
        await page.waitForFunction("document.querySelector('mjs-app')._shadow.querySelector('mjs-si')?._shadow?.querySelector('.si')?.textContent === 'si'", null, { timeout: 15000 })
        await page.waitForTimeout(500)
        assert.equal(fois(urls, 'si'), 1, `si demandé ${fois(urls, 'si')} fois`)
        assert.deepEqual(fautes, [])
      })
    })

    it(`${nom}, blocks.preload idle : un préchargement raté au réseau n'empêche pas l'ouverture de la branche`, async function () {
      if (!(await navigateurPresent(nom))) { this.skip(); return }
      const c = await construction('idle')
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch({ headless: true, ...(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {}) })
      try {
        const page = await browser.newPage()
        const vues: string[]   = []
        const fautes: string[] = []
        page.on('pageerror', (e: any) => fautes.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) fautes.push(m.text()) })
        await page.route(/\/out\/si-\w+\.js/, (route: any) => { vues.push(route.request().url()); return vues.length === 1 ? route.abort('failed') : route.continue() })
        await page.goto(c.base + '/', { waitUntil: 'load' })
        await page.waitForFunction("performance.getEntriesByType('resource').some(e => /\\/out\\/sinon-\\w+\\.js$/.test(e.name))", null, { timeout: 15000 })
        assert.equal(vues.length, 1, 'le préchargement de si a échoué au repos')
        await page.evaluate("document.querySelector('mjs-app')._shadow.querySelector('#ouvrir').click()")
        await page.waitForFunction("document.querySelector('mjs-app')._shadow.querySelector('mjs-si')?._shadow?.querySelector('.si')?.textContent === 'si'", null, { timeout: 15000 })
        assert.equal(vues.length, 2, `demandes de si : ${vues.join(' ')}`)
        assert.match(vues[1], /\?mjs-retry=1$/)
        assert.deepEqual(fautes, [])
      }
      finally {
        await browser.close()
      }
    })

    it(`${nom}, blocks.preload idle : un composant qui importe un module ou porte un effet paraît après une coupure du réseau au repos`, async function () {
      if (!(await navigateurPresent(nom))) { this.skip(); return }
      const c = await construction('idle', false, 'module')
      const playwright = await import('playwright')
      const browser    = await playwright[nom].launch({ headless: true, ...(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {}) })
      try {
        const page = await browser.newPage()
        const fautes: string[] = []
        let   coupe = true
        await page.addInitScript("window.__defs = []; const d = CustomElementRegistry.prototype.define; CustomElementRegistry.prototype.define = function (n, c, o) { window.__defs.push(n); return d.call(this, n, c, o) }")
        page.on('pageerror', (e: any) => fautes.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) fautes.push(m.text()) })
        // le réseau tombe pour le module et l'effet pendant tout le repos, puis revient avant l'ouverture
        await page.route(/\/out\/(outil\.module|mjs_fx_neon)-\w+\.js/, (route: any) => coupe ? route.abort('failed') : route.continue())
        await page.goto(c.base + '/', { waitUntil: 'load' })
        await page.waitForFunction("performance.getEntriesByType('resource').some(e => /\\/out\\/simple-\\w+\\.js$/.test(e.name))", null, { timeout: 15000 })
        await page.waitForTimeout(1000)
        coupe = false
        for (const [bouton, n] of [['m', 'avecmodule'], ['e', 'aveceffet']]) {
          await page.evaluate(`document.querySelector('mjs-app')._shadow.querySelector('#${bouton}').click()`)
          await page.waitForFunction(`!!document.querySelector('mjs-app')._shadow.querySelector('mjs-${n}')?._shadow?.querySelector('.${n}')`, null, { timeout: 8000 })
          assert.equal(await page.evaluate(`window.__defs.filter((d) => d === 'mjs-${n}').length`), 1, `${n} défini une fois`)
        }
        await page.waitForTimeout(300)
        assert.deepEqual(fautes, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
