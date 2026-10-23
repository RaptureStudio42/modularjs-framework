// BANC navigateur RÉEL de `*cursors` (Chromium + Firefox, via playwright) — hors de `npm test`,
// lancé par `npm run test:browser`. Deux visiteurs (deux pages) sur la même page d'appli, reliés
// par un vrai serveur temps réel MJS-WS (WsTransport, paquet `cursorsPackage`) — la connexion ouverte
// par l'appli (`µsocket`), que `*cursors` prend sans adresse, réglé par défaut (tout montré) : la
// souris de l'un apparaît chez l'autre, au même endroit du contenu, avec son nom ; son clic y bat ; sa
// sélection de texte aussi (bandes + curseur de texte) ; dans un champ, le champ entouré (la balise
// active) et le curseur au bon rang ; un visiteur parti, son curseur disparaît. En build de dev puis
// de prod.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { mjsWs, cursorsPackage, WsTransport } from '../../src/mjs-ws/index.js'
import { assertDistFrais } from '../helpers/dist-frais.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const FIXTURE_DIR    = join(__dirname, 'fixture-curseurs')
const OUT_DIR        = join(FIXTURE_DIR, 'sortie')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-curseurs'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.on('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address()
      const port = a && typeof a === 'object' ? a.port : 0
      srv.close(() => ok(port))
    })
  })
}

function serveFixture(port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(FIXTURE_DIR, rel)
    if (!file.startsWith(FIXTURE_DIR) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

function buildFixture(mode: 'dev' | 'prod'): void {
  rmSync(OUT_DIR, { recursive: true, force: true })
  const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', FIXTURE_DIR, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
  assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
  mkdirSync(OUT_DIR, { recursive: true })
  copyFileSync(join(FIXTURE_DIR, 'index.html'), join(OUT_DIR, 'index.html'))
}

describe('banc navigateur réel : *cursors, deux visiteurs par le serveur temps réel (dev + prod)', function () {
  this.timeout(600000)

  let server: any = null
  let port = 0
  let app: any = null
  let wsPort = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    port   = await freePort()
    server = await serveFixture(port)
    wsPort = await freePort()
    let n  = 0
    app = mjsWs({ transport: new WsTransport({ port: wsPort, host: '127.0.0.1' }), heartbeat: 0, onLog: () => {}, auth: () => { n++; return { id: 'v' + n, name: 'Visiteur ' + n } } })
    app.use(cursorsPackage())
    await app.listen()
  })

  after(async function () {
    if (app) await app.stop()
    if (server) await new Promise<void>((r) => server.close(() => r()))
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () { buildFixture(mode) })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let a: any = null
          let b: any = null
          const issues: string[] = []

          const ouvrir = async () => {
            const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
            await page.addInitScript(() => { (window as any).__root = (el: any) => el._shadow || el.shadowRoot })
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html#${encodeURIComponent(`ws://127.0.0.1:${wsPort}`)}`, { waitUntil: 'load' })
            await page.waitForFunction((host: string) => {
              const el: any = document.querySelector(host)
              const sh = el && (el._shadow || el.shadowRoot)
              return !!(sh && sh.querySelector('.zone[mjs-fx~="cursors"]'))
            }, HOST, { timeout: 30000 })
            return page
          }
          // la boîte d'une balise de la zone, à l'écran
          const boite = (page: any, sel: string) => page.evaluate(([host, sel]: [string, string]) => {
            const r = (window as any).__root(document.querySelector(host)).querySelector(sel).getBoundingClientRect()
            return { left: r.left, top: r.top, width: r.width, height: r.height }
          }, [HOST, sel])
          const attendre = async (page: any, pred: string, quoi: string, ms = 5000) => {
            try { await page.waitForFunction(pred, null, { timeout: ms }) }
            catch { assert.fail(`délai dépassé (${ms} ms) : ${quoi}`) }
          }

          before(async function () {
            browser = await engine.launch()
            a = await ouvrir()
            b = await ouvrir()
            // les deux visiteurs dans le salon
            await a.waitForTimeout(400)
          })

          after(async function () {
            if (browser) await browser.close()
          })

          it('la souris du visiteur A apparaît chez B, au même endroit du contenu, avec son nom', async function () {
            const p = await boite(a, '#texte')
            await a.mouse.move(p.left + p.width * 0.3, p.top + p.height * 0.5)
            await attendre(b, `(() => { const c = document.querySelector('[mjs-fx-cursor]'); return !!(c && !c.hidden && /translate/.test(c.style.transform)) })()`, 'le curseur de A chez B')
            const vu = await b.evaluate(() => {
              const c: any = document.querySelector('[mjs-fx-cursor]')
              const m = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(c.style.transform)
              return { x: Number(m![1]), y: Number(m![2]), nom: c.querySelector('b').textContent }
            })
            const q = await boite(b, '#texte')
            assert.ok(Math.abs(vu.x - (q.left + q.width * 0.3)) <= 2 && Math.abs(vu.y - (q.top + q.height * 0.5)) <= 2, `le curseur chez B (${vu.x}, ${vu.y}) au lieu de (${(q.left + q.width * 0.3).toFixed(1)}, ${(q.top + q.height * 0.5).toFixed(1)})`)
            assert.match(vu.nom, /^Visiteur \d+$/)
          })

          it('un clic de A : chez B, une onde bat là où il a cliqué', async function () {
            const p = await boite(a, '#texte')
            await a.mouse.click(p.left + p.width * 0.6, p.top + p.height * 0.5)
            await attendre(b, `!!document.querySelector('[mjs-fx-cursor-pulse]')`, 'l\'onde du clic de A chez B')
            const vu = await b.evaluate(() => {
              const o = document.querySelector('[mjs-fx-cursor-pulse]')!.getBoundingClientRect()
              return { x: o.left + o.width / 2, y: o.top + o.height / 2 }
            })
            const q = await boite(b, '#texte')
            assert.ok(Math.abs(vu.x - (q.left + q.width * 0.6)) <= 4 && Math.abs(vu.y - (q.top + q.height * 0.5)) <= 4, `l'onde chez B (${vu.x.toFixed(1)}, ${vu.y.toFixed(1)}) au lieu de (${(q.left + q.width * 0.6).toFixed(1)}, ${(q.top + q.height * 0.5).toFixed(1)})`)
            await a.evaluate(() => window.getSelection()!.removeAllRanges())
          })

          it('la sélection de texte de A : chez B, des bandes sur les mêmes mots et le curseur de texte', async function () {
            await a.evaluate((host: string) => {
              const t = (window as any).__root(document.querySelector(host)).querySelector('#texte').firstChild
              window.getSelection()!.setBaseAndExtent(t, 20, t, 31)
            }, HOST)
            await attendre(b, `document.querySelectorAll('[mjs-fx-cursor-sel]').length > 0 && !!document.querySelector('[mjs-fx-cursor-caret]')`, 'la sélection de A chez B')
            const vu = await b.evaluate((host: string) => {
              const t = (window as any).__root(document.querySelector(host)).querySelector('#texte').firstChild
              const r = document.createRange()
              r.setStart(t, 20)
              r.setEnd(t, 31)
              const mots  = r.getBoundingClientRect()
              const bande = document.querySelector('[mjs-fx-cursor-sel]')!.getBoundingClientRect()
              const caret = document.querySelector('[mjs-fx-cursor-caret]')!.getBoundingClientRect()
              return { mots: { left: mots.left, right: mots.right }, bande: { left: bande.left, right: bande.right }, caret: caret.left }
            }, HOST)
            assert.ok(Math.abs(vu.bande.left - vu.mots.left) <= 2 && Math.abs(vu.bande.right - vu.mots.right) <= 2, `la bande (${vu.bande.left.toFixed(1)} → ${vu.bande.right.toFixed(1)}) ne couvre pas les mots (${vu.mots.left.toFixed(1)} → ${vu.mots.right.toFixed(1)})`)
            assert.ok(Math.abs(vu.caret - vu.mots.right) <= 3, `le curseur de texte (${vu.caret.toFixed(1)}) à la fin de la sélection (${vu.mots.right.toFixed(1)})`)
            await a.evaluate(() => window.getSelection()!.removeAllRanges())
          })

          it('dans un champ : chez B, le champ entouré (la balise active) et le curseur au même rang', async function () {
            await b.evaluate((host: string) => { (window as any).__root(document.querySelector(host)).querySelector('#champ').value = 'Bonjour' }, HOST)
            const c = await boite(a, '#champ')
            await a.mouse.click(c.left + 10, c.top + c.height / 2)
            await a.keyboard.type('Bonjour')
            await a.keyboard.press('ArrowLeft')
            await a.keyboard.press('ArrowLeft')
            await a.keyboard.press('ArrowLeft')
            await a.keyboard.press('ArrowLeft')
            await attendre(b, `!!document.querySelector('[mjs-fx-cursor-focus]')`, 'le champ entouré chez B')
            await b.waitForTimeout(300)
            const vu = await b.evaluate((host: string) => {
              const f: any = (window as any).__root(document.querySelector(host)).querySelector('#champ')
              const cadre  = document.querySelector('[mjs-fx-cursor-focus]')!.getBoundingClientRect()
              const caret  = document.querySelector('[mjs-fx-cursor-caret]')!.getBoundingClientRect()
              const champ  = f.getBoundingClientRect()
              // la largeur de « Bon » dans la police du champ
              const cs = getComputedStyle(f)
              const cv = document.createElement('canvas').getContext('2d')!
              cv.font  = cs.fontSize + ' ' + cs.fontFamily
              return { cadre: { left: cadre.left, width: cadre.width }, champ: { left: champ.left, width: champ.width }, caret: caret.left, attendu: champ.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + cv.measureText('Bon').width }
            }, HOST)
            assert.ok(Math.abs(vu.cadre.left - (vu.champ.left - 3)) <= 1 && Math.abs(vu.cadre.width - (vu.champ.width + 6)) <= 1, `l'anneau entoure le champ, 3 px autour (${vu.cadre.left.toFixed(1)}/${vu.cadre.width.toFixed(1)} pour ${vu.champ.left.toFixed(1)}/${vu.champ.width.toFixed(1)})`)
            assert.ok(Math.abs(vu.caret - vu.attendu) <= 3, `le curseur de texte (${vu.caret.toFixed(1)}) après « Bon » (${vu.attendu.toFixed(1)})`)
          })

          it('A s\'en va : son curseur disparaît chez B', async function () {
            await a.close()
            await attendre(b, `!document.querySelector('[mjs-fx-cursor]')`, 'le curseur de A retiré chez B', 6000)
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
