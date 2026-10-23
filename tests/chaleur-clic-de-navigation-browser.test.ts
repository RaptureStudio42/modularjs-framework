// *heatmap dans Chromium réel : le clic de navigation. Un clic qui change de vue retire l'effet (la vue qui le porte part)
// avant même que la connexion paresseuse, ouverte par ce premier clic, soit établie : le point ne meurt pas avec l'effet,
// il part à l'ouverture. Avec `server:`, la connexion est celle de l'effet seul : elle reste ouverte le temps d'envoyer le
// point, puis se ferme. Une vraie connexion WebSocket, un vrai serveur MJS WS (ws), une vraie en-tête Origin, l'effet et
// la connexion construits depuis src/.

import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsWs, heatmapPackage, WsTransport } from '../src/mjs-ws/index.js'

const portLibre = () => new Promise<number>((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => ok(p)) }) })
const attente   = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('*heatmap dans Chromium — un clic de navigation : le point ne meurt pas avec l\'effet', function () {
  this.timeout(240000)
  let script   = ''
  let wsPort   = 0
  let httpPort = 0
  let serveur: any
  let app: any
  const recus: any[] = []

  before(async function () {
    if (!(await chromiumPresent())) { this.skip(); return }
    const racine = mjsTmp('chaleur-clic-navigation')
    const source = join(racine, 'src')
    const sortie = join(racine, 'out')
    mkdirSync(source, { recursive: true })
    wsPort   = await portLibre()
    httpPort = await portLibre()
    // la vue qui porte `*heatmap` sur la connexion de l'appli (`@sock`, jamais ouverte) — et celle qui porte sa propre connexion (`server`)
    writeFileSync(join(source, 'fx-nav-appli.mjs'), `<script>\n@sock = µsocket 'ws://127.0.0.1:${wsPort}'\n</script>\n<@document *heatmap></@document>\n`)
    writeFileSync(join(source, 'fx-nav-seule.mjs'), `<@document *heatmap(server: 'ws://127.0.0.1:${wsPort}')></@document>\n`)
    const bundler = new Bundler({ sourceDir: source, outputDir: sortie, manifestPath: join(racine, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const fichiers = readdirSync(sortie).filter((f) => f.endsWith('.js'))
    const rang     = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...fichiers].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(sortie, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    serveur = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div style="height:2000px;width:2000px">page</div><script>${script}</script></body></html>`)
    })
    await new Promise<void>((ok) => serveur.listen(httpPort, '127.0.0.1', () => ok()))
    app = mjsWs({ transport: new WsTransport({ port: wsPort, host: '127.0.0.1' }), heartbeat: 0, onLog: () => {} })
    app.use(heatmapPackage({ origins: ['http://127.0.0.1:' + httpPort], onPoint: (p: any) => recus.push(p) }))
    await app.listen()
  })

  after(async () => {
    await terminateSharedWorkerPool()
    if (app) await app.stop()
    if (serveur) await new Promise<void>((r) => serveur.close(() => r()))
  })

  // une page neuve, la vue posée ; le clic et le retrait de la vue partent dans le même tour : la connexion n'a pas encore pu s'ouvrir
  async function clicEtPart(navigateur: any, balise: string) {
    const page = await navigateur.newPage({ viewport: { width: 900, height: 600 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await page.goto('http://127.0.0.1:' + httpPort + '/', { waitUntil: 'load' })
    await page.evaluate((b: string) => { document.body.appendChild(document.createElement(b)) }, balise)
    await attente(600)
    await page.evaluate((b: string) => {
      document.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 50, bubbles: true, composed: true }))
      document.querySelector(b)!.remove()
    }, balise)
    return { page, erreurs }
  }

  it('la connexion de l\'appli (@sock), paresseuse : un clic puis le retrait de la vue, le serveur reçoit le point', async function () {
    const playwright = await import('playwright')
    const navigateur = await playwright.chromium.launch()
    try {
      const avant = recus.length
      const { page, erreurs } = await clicEtPart(navigateur, 'mjs-fx-nav-appli')
      const fin = Date.now() + 10000
      while (recus.length === avant && Date.now() < fin) await attente(100)
      assert.equal(recus.length - avant, 1, 'un clic, un point reçu')
      assert.equal(recus[recus.length - 1].url, 'http://127.0.0.1:' + httpPort + '/')
      assert.deepEqual(erreurs, [])
      await page.close()
    } finally { await navigateur.close() }
  })

  it('`server:` : la connexion de l\'effet seul reste ouverte le temps d\'envoyer le point, puis se ferme', async function () {
    const playwright = await import('playwright')
    const navigateur = await playwright.chromium.launch()
    try {
      const avant = recus.length
      const { page, erreurs } = await clicEtPart(navigateur, 'mjs-fx-nav-seule')
      const fin = Date.now() + 10000
      while (recus.length === avant && Date.now() < fin) await attente(100)
      assert.equal(recus.length - avant, 1, 'un clic, un point reçu')
      // la connexion de l'effet seul se ferme (et sort du registre du cœur) une fois le point parti
      const url   = 'ws://127.0.0.1:' + wsPort
      const reste = () => page.evaluate((u: string) => Object.keys((window as any).µ._mjs_sockets).filter((k) => k.indexOf(u) === 0).length, url)
      const limite = Date.now() + 5000
      while ((await reste()) > 0 && Date.now() < limite) await attente(100)
      assert.equal(await reste(), 0, 'la connexion de l\'effet est fermée')
      assert.deepEqual(erreurs, [])
      await page.close()
    } finally { await navigateur.close() }
  })
})
