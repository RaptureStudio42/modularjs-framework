// *heatmap dans Chromium réel : une vraie connexion WebSocket, un vrai serveur MJS WS (ws), une vraie en-tête Origin,
// l'effet et la connexion construits depuis src/. La connexion est paresseuse — rien ne l'ouvre avant le premier envoi :
// le premier clic d'une visite l'ouvre et ne se perd pas (un clic unique, puis 20 clics à 110 ms d'écart, sans que
// l'appli ait ouvert quoi que ce soit) ; le jeton d'une adresse (chemin et route) ne quitte pas la page.

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

describe('*heatmap dans Chromium — le premier clic d\'une visite, la connexion paresseuse', function () {
  this.timeout(240000)
  let script   = ''
  let wsPort   = 0
  let httpPort = 0
  let serveur: any
  let app: any
  const recus: any[] = []

  before(async function () {
    if (!(await chromiumPresent())) { this.skip(); return }
    const racine = mjsTmp('chaleur-premier-clic')
    const source = join(racine, 'src')
    const sortie = join(racine, 'out')
    mkdirSync(source, { recursive: true })
    wsPort   = await portLibre()
    httpPort = await portLibre()
    // l'appli pose sa connexion (`@sock`) sans l'ouvrir : le premier envoi de l'effet l'ouvre
    writeFileSync(join(source, 'fx-hm-page.mjs'), `<script>\n@sock = µsocket 'ws://127.0.0.1:${wsPort}'\n</script>\n<@document *heatmap></@document>\n`)
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

  // une page neuve : la balise de l'appli posée, la connexion jamais ouverte
  async function ouvre(browser: any, chemin = '/') {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push('pageerror : ' + e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
    await page.goto('http://127.0.0.1:' + httpPort + chemin, { waitUntil: 'load' })
    await page.evaluate(() => { document.body.appendChild(document.createElement('mjs-fx-hm-page')) })
    await attente(600)
    return { page, erreurs }
  }

  it('un clic unique sur une page neuve : le serveur le reçoit — puis 20 clics à 110 ms d\'écart sur une autre, sans que rien ait ouvert la connexion', async function () {
    const playwright = await import('playwright')
    const navigateur = await playwright.chromium.launch()
    try {
      {
        const { page, erreurs } = await ouvre(navigateur)
        assert.equal(await page.evaluate((u: string) => (window as any).µ._mjs_sockets[u].state, 'ws://127.0.0.1:' + wsPort), 'closed', 'paresseuse : personne ne l\'a ouverte')
        const avant = recus.length
        await page.mouse.click(10, 50)
        await attente(1500)
        assert.equal(recus.length - avant, 1, 'un seul clic, un seul point reçu')
        assert.equal(recus[recus.length - 1].url, 'http://127.0.0.1:' + httpPort + '/')
        assert.deepEqual(erreurs, [])
        await page.close()
      }
      {
        const { page, erreurs } = await ouvre(navigateur)
        const avant = recus.length
        for (let i = 0; i < 20; i++) { await page.mouse.click(10 + i * 5, 50); await attente(110) }
        await attente(1500)
        const places = recus.slice(avant).map((p: any) => p.z[0][1]).sort((a: number, b: number) => a - b)
        const voulues = Array.from({ length: 20 }, (_, i) => Math.round((10 + i * 5) / 2000 * 10000) / 10000)
        assert.deepEqual(places, voulues, `${places.length} points reçus sur 20`)
        assert.deepEqual(erreurs, [])
        await page.close()
      }
    } finally { await navigateur.close() }
  })

  it('une adresse qui porte un jeton, dans le chemin et dans la route : il ne quitte pas la page', async function () {
    const playwright = await import('playwright')
    const navigateur = await playwright.chromium.launch()
    try {
      const { page } = await ouvre(navigateur, '/reset/0123456789abcdef0123456789abcdef?x=1#/reset/AbCd1234EfGh5678')
      const avant = recus.length
      await page.mouse.click(20, 20)
      await attente(1500)
      assert.equal(recus.length - avant, 1)
      assert.equal(recus[recus.length - 1].url, 'http://127.0.0.1:' + httpPort + '/reset/_SECRET_ID_#/reset/_SECRET_ID_')
      await page.close()
    } finally { await navigateur.close() }
  })
})
