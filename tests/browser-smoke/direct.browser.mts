// BANC navigateur RÉEL des effets « en direct » reliés par le serveur temps réel (Chromium + Firefox,
// via playwright) — hors de `npm test`, lancé par `npm run test:browser`. Deux visiteurs (deux pages)
// sur la même page d'appli, un vrai serveur MJS-WS (WsTransport) avec les paquets `reactionsPackage`,
// `followPackage`, `heatmapPackage` ; l'appli ouvre sa connexion (`µsocket`), les effets la prennent
// sans adresse, *follow réglé par défaut (tout montré) :
//   - *react chez A : l'émoji monte chez B (par la scène *react de <@document>) ;
//   - *follow : A mène (?lead=1), il fait défiler sa zone, celle de B arrive à la même partie ; sa
//     souris, ses clics (une onde), la balise active et sa sélection apparaissent chez B ;
//   - *heatmap sur <@document> : un clic de A dans un composant imbriqué part au serveur avec
//     l'adresse de la page (sans sa requête : `?lead=1` n'y est pas, un identifiant n'y serait pas),
//     sa place dans la page, et dans chaque composant traversé (le shadow DOM fermé des composants
//     n'y fait pas obstacle).
// La page d'essai est écrite à la volée (l'adresse du serveur, fixe, dans le script), compilée par
// bin/mjs en dev puis en prod.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { mjsWs, reactionsPackage, followPackage, heatmapPackage, WsTransport } from '../../src/mjs-ws/index.js'
import { assertDistFrais } from '../helpers/dist-frais.js'
import { mjsTmp } from '../helpers/tmp.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-direct'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.on('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address()
      const p = a && typeof a === 'object' ? a.port : 0
      srv.close(() => ok(p))
    })
  })
}

// la page d'essai : trois effets reliés au serveur, une zone qui défile, un composant imbriqué
function ecrireFixture(dir: string, ws: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet' }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — en direct</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-direct></mjs-direct>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'composants', 'direct.mjs'), [
    '<script>',
    "  $mene = new URLSearchParams(location.search).get('lead') is '1'",
    `  @sock = µsocket '${ws}'`,
    '</script>',
    '',
    '<@document *react(duration: 3s) *heatmap></@document>',
    '',
    '<button id="bravo" class="bravo" *react(🎉)>🎉</button>',
    '<div id="lecture" class="lecture" *follow(lead: $mene, ease: 1)>',
    '  {for n in [1..12]}<section class="partie" data-n={n}><h2>Partie {n}</h2><p>Un paragraphe pour que la zone défile.</p><button class="lire">Lire</button></section>{end}',
    '</div>',
    '<@carte id="carte"></@carte>',
    '',
    '<style>',
    '  .lecture',
    '    height: 240px',
    '    overflow: auto',
    '    margin: 10px 0',
    '  .partie',
    '    height: 160px',
    '    margin: 0 0 12px',
    '    padding: 8px',
    '    box-sizing: border-box',
    '</style>',
  ].join('\n'))
  writeFileSync(join(dir, 'composants', 'carte.mjs'), '<div class="dedans"><button id="dans" class="dans">Dans la carte</button></div>\n\n<style>\n  :host\n    display: block\n    width: 300px\n    height: 120px\n  .dedans\n    display: grid\n    place-items: center\n    height: 120px\n</style>\n')
}

function serveDir(dir: string, port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

describe('banc navigateur réel : réactions, suivre, carte de chaleur, par le serveur temps réel (dev + prod)', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0
  let app: any = null

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-direct')
    port = await freePort()
    const wsPort = await freePort()
    ecrireFixture(dir, `ws://127.0.0.1:${wsPort}`)
    server = await serveDir(dir, port)
    let n  = 0
    app = mjsWs({ transport: new WsTransport({ port: wsPort, host: '127.0.0.1' }), heartbeat: 0, onLog: () => {}, auth: () => { n++; return { id: 'v' + n, name: 'Visiteur ' + n } } })
    app.use(reactionsPackage()).use(followPackage({ canLead: () => true })).use(heatmapPackage({ origins: ['http://127.0.0.1:' + port] }))
    await app.listen()
  })

  after(async function () {
    if (app) await app.stop()
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () {
        rmSync(join(dir, 'sortie'), { recursive: true, force: true })
        const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
        assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
        copyFileSync(join(dir, 'index.html'), join(dir, 'sortie', 'index.html'))
      })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let a: any = null
          let b: any = null
          const issues: string[] = []

          const ouvrir = async (lead: boolean) => {
            const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
            await page.addInitScript(() => { (window as any).__root = (el: any) => el._shadow || el.shadowRoot })
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html${lead ? '?lead=1' : ''}`, { waitUntil: 'load' })
            await page.waitForFunction((host: string) => {
              const el: any = document.querySelector(host)
              const sh = el && (el._shadow || el.shadowRoot)
              return !!(sh && sh.querySelector('#lecture[mjs-fx~="follow"]') && document.querySelector('[mjs-fx-react-stage]'))
            }, HOST, { timeout: 30000 })
            return page
          }

          before(async function () {
            browser = await engine.launch()
            a = await ouvrir(true)
            b = await ouvrir(false)
            await a.waitForTimeout(500)
          })

          after(async function () {
            if (browser) await browser.close()
          })

          it('*react chez A : l\'émoji monte chez B', async function () {
            await a.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#bravo').click(), HOST)
            await b.waitForFunction(() => Array.from(document.querySelectorAll('[mjs-fx-react-emoji]')).some((e: any) => e.textContent === '🎉'), null, { timeout: 5000 })
            const chezA = await a.evaluate(() => document.querySelectorAll('[mjs-fx-react-emoji]').length)
            assert.ok(chezA >= 1, 'et chez A, tout de suite')
          })

          it('*follow : A mène et fait défiler sa zone jusqu\'à la partie 7 ; chez B, la zone arrive à la même partie', async function () {
            await a.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              z.scrollTop = z.querySelectorAll('.partie')[6].offsetTop - z.offsetTop + 40
            }, HOST)
            const haut = (page: any) => page.evaluate((host: string) => {
              const z: any  = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const zt      = z.getBoundingClientRect().top
              const parties: any[] = Array.from(z.querySelectorAll('.partie'))
              const p       = parties.find((s) => s.getBoundingClientRect().bottom > zt + 1)
              return { n: Number(p.dataset.n), coupe: Math.round(zt - p.getBoundingClientRect().top) }
            }, HOST)
            const vuA = await haut(a)
            assert.deepEqual(vuA, { n: 7, coupe: 40 })
            await b.waitForFunction(({ host }: any) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              return z.scrollTop > 900
            }, { host: HOST }, { timeout: 5000 })
            await b.waitForTimeout(200)
            const vuB = await haut(b)
            assert.equal(vuB.n, 7, `chez B, la partie en haut : ${JSON.stringify(vuB)}`)
            assert.ok(Math.abs(vuB.coupe - 40) <= 2, `coupée au même endroit : ${JSON.stringify(vuB)}`)
          })

          it('*follow : le haut de la zone de A tombe dans l\'espace entre deux parties ; chez B, la zone arrive au même endroit', async function () {
            const vise = await a.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              z.scrollTop = z.querySelectorAll('.partie')[8].offsetTop - z.offsetTop - 6
              return z.scrollTop
            }, HOST)
            await b.waitForFunction(({ host, vise }: any) => Math.abs((window as any).__root(document.querySelector(host)).querySelector('#lecture').scrollTop - vise) <= 2, { host: HOST, vise }, { timeout: 5000 })
          })

          it('*follow(cursor: pulse) : la souris de A (qui mène) apparaît chez B, avec son nom, sur la même partie ; un clic de A y bat ; rien dans l\'autre sens', async function () {
            const cible = await a.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const p: any = Array.from(z.querySelectorAll('.partie')).find((s: any) => s.getBoundingClientRect().top >= z.getBoundingClientRect().top)
              const r = p.getBoundingClientRect()
              return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5, n: Number(p.dataset.n) }
            }, HOST)
            await a.mouse.move(cible.x, cible.y, { steps: 3 })
            await b.waitForFunction(() => {
              const c: any = document.querySelector('[mjs-fx-cursor]')
              return !!c && !c.hidden && /translate/.test(c.style.transform)
            }, null, { timeout: 5000 })
            const vu = await b.evaluate(({ host, n }: any) => {
              const c: any = document.querySelector('[mjs-fx-cursor]')
              const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(c.style.transform)
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const p: any = z.querySelector('.partie[data-n="' + n + '"]')
              const r = p.getBoundingClientRect()
              return { nom: c.textContent, dedans: !!m && +m[1] >= r.left && +m[1] <= r.right && +m[2] >= r.top && +m[2] <= r.bottom }
            }, { host: HOST, n: cible.n })
            assert.ok(vu.nom.length > 0, 'avec son nom')
            assert.ok(vu.dedans, 'sur la même partie : ' + JSON.stringify(vu))
            // un clic de A : une onde bat chez B, là où est sa souris
            await a.mouse.down()
            await a.mouse.up()
            await b.waitForFunction(() => !!document.querySelector('[mjs-fx-cursor-pulse]'), null, { timeout: 5000 })
            const onde = await b.evaluate(() => {
              const o: any = document.querySelector('[mjs-fx-cursor-pulse]')
              const c: any = document.querySelector('[mjs-fx-cursor]')
              const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(c.style.transform)
              const r = o.getBoundingClientRect()
              return { dx: Math.abs(r.left + r.width / 2 - +m![1]), dy: Math.abs(r.top + r.height / 2 - +m![2]) }
            })
            assert.ok(onde.dx <= 3 && onde.dy <= 3, 'l\'onde bat sous la souris de A : ' + JSON.stringify(onde))
            await b.waitForFunction(() => !document.querySelector('[mjs-fx-cursor-pulse]'), null, { timeout: 5000 })
            await b.mouse.move(20, 20, { steps: 2 })
            await b.mouse.down()
            await b.mouse.up()
            await a.waitForTimeout(400)
            const chezA = await a.evaluate(() => document.querySelectorAll('[mjs-fx-cursor], [mjs-fx-cursor-pulse]').length)
            assert.equal(chezA, 0, 'qui suit n\'envoie ni sa souris ni ses clics')
          })

          it('*follow(focus: true) : la balise active de A s\'entoure chez B — la même, au même endroit', async function () {
            // Firefox ne donne le focus qu'à la fenêtre de devant : celle de A, qui mène
            await a.bringToFront()
            const n = await a.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const p: any = Array.from(z.querySelectorAll('.partie')).find((s: any) => s.getBoundingClientRect().top >= z.getBoundingClientRect().top)
              p.querySelector('.lire').focus()
              return Number(p.dataset.n)
            }, HOST)
            await b.waitForFunction(() => !!document.querySelector('[mjs-fx-cursor-focus]'), null, { timeout: 5000 })
            const vu = await b.evaluate(({ host, n }: any) => {
              const f: any = document.querySelector('[mjs-fx-cursor-focus]').getBoundingClientRect()
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const r: any = z.querySelector('.partie[data-n="' + n + '"] .lire').getBoundingClientRect()
              return { l: Math.round(r.left - f.left), t: Math.round(r.top - f.top), w: Math.round(f.width - r.width), h: Math.round(f.height - r.height) }
            }, { host: HOST, n })
            assert.deepEqual(vu, { l: 3, t: 3, w: 6, h: 6 }, 'l\'anneau entoure le même bouton, à 3 px')
            // A remonte tout en haut : chez B, le bouton sort de la zone — rien n'en déborde sur la page
            const avantB = await b.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#lecture').scrollTop, HOST)
            await a.evaluate((host: string) => { (window as any).__root(document.querySelector(host)).querySelector('#lecture').scrollTop = 0 }, HOST)
            await b.waitForFunction(({ host, avantB }: any) => (window as any).__root(document.querySelector(host)).querySelector('#lecture').scrollTop < avantB - 600, { host: HOST, avantB }, { timeout: 5000 })
            await b.waitForTimeout(200)
            const decoupe = await b.evaluate((host: string) => {
              const l: any = document.querySelector('[mjs-fx-cursors-layer]')
              const f: any = document.querySelector('[mjs-fx-cursor-focus]')
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture').getBoundingClientRect()
              const r = f ? f.getBoundingClientRect() : null
              // inset(haut droite bas gauche), abrégé par le navigateur comme en CSS (1 à 4 valeurs)
              const m = /inset\(([^)]*)\)/.exec(getComputedStyle(l).clipPath)
              const v = m ? m[1].split(/[\s,]+/).filter(Boolean).map(parseFloat) : []
              const lu = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]]
              const attendu = [z.top, document.documentElement.clientWidth - z.right, document.documentElement.clientHeight - z.bottom, z.left].map((n) => Math.max(0, Math.round(n)))
              return { dehors: !!r && (r.bottom <= z.top || r.top >= z.bottom), clip: getComputedStyle(l).clipPath, juste: v.length > 0 && lu.every((n, i) => Math.abs(n - attendu[i]) <= 1) }
            }, HOST)
            assert.ok(decoupe.dehors, 'le bouton est sorti de la zone de B')
            assert.ok(decoupe.juste, 'le calque est découpé à la zone : ' + decoupe.clip)
            // le bouton lui-même perd le focus (Firefox ne le retire pas par l'hôte du composant)
            await a.evaluate(() => {
              let e: any = document.activeElement
              while (e && (e._shadow || e.shadowRoot) && (e._shadow || e.shadowRoot).activeElement) e = (e._shadow || e.shadowRoot).activeElement
              e?.blur()
            })
            await b.waitForFunction(() => !document.querySelector('[mjs-fx-cursor-focus]'), null, { timeout: 5000 })
          })

          it('*follow(selection: true) : le texte que A sélectionne se surligne chez B, avec son curseur de texte', async function () {
            await a.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#lecture')
              const p: any = Array.from(z.querySelectorAll('.partie')).find((s: any) => s.getBoundingClientRect().top >= z.getBoundingClientRect().top)
              const t: any = p.querySelector('p').firstChild
              document.getSelection()!.setBaseAndExtent(t, 3, t, 13)
            }, HOST)
            await b.waitForFunction(() => document.querySelectorAll('[mjs-fx-cursor-sel]').length > 0 && !!document.querySelector('[mjs-fx-cursor-caret]'), null, { timeout: 5000 })
            await a.evaluate(() => document.getSelection()!.removeAllRanges())
            await b.waitForFunction(() => document.querySelectorAll('[mjs-fx-cursor-sel]').length === 0, null, { timeout: 5000 })
          })

          it('*heatmap sur <@document> : un clic de A dans le composant imbriqué — la page, son adresse sans requête, la place du clic dans chaque composant traversé', async function () {
            const avant = JSON.stringify(app.heatmap())
            const r = await a.evaluate((host: string) => {
              const c: any = (window as any).__root(document.querySelector(host)).querySelector('#carte')
              c.scrollIntoView({ block: 'center' })
              const b0 = c.getBoundingClientRect()
              return { x: b0.left + b0.width * 0.25, y: b0.top + b0.height * 0.75, url: location.origin + location.pathname }
            }, HOST)
            await a.mouse.click(r.x, r.y)
            const fin = Date.now() + 5000
            while (JSON.stringify(app.heatmap()) === avant && Date.now() < fin) await new Promise((ok) => setTimeout(ok, 50))
            const pageVue = app.heatmap().pages.find((p: any) => p.url === r.url)
            assert.ok(pageVue, `la page ${r.url} dans la carte : ${JSON.stringify(app.heatmap().pages.map((p: any) => p.url))}`)
            const zones = Object.fromEntries(pageVue.zones.map((z: any) => [z.zone, z]))
            assert.ok(zones.document && zones['mjs-direct'] && zones['mjs-carte'], `les zones : ${Object.keys(zones)}`)
            const dernier = zones['mjs-carte'].pts[zones['mjs-carte'].pts.length - 1]
            assert.ok(Math.abs(dernier[0] - 0.25) < 0.02 && Math.abs(dernier[1] - 0.75) < 0.02, `la place du clic dans la carte : ${dernier}`)
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
