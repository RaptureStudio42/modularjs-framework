// Navigateur réel (Chromium) : en production, le fichier des messages de la console ne se télécharge
// pas au chargement de la page ; au premier message, le texte court sort tout de suite, une seule
// requête part, puis le texte complet s'écrit dans la console, dans la langue de la page. L'appli
// est servie sous un sous-dossier (`/mjs/app/`), construite en fichier unique, avec un préfixe
// d'adresses `/assets` qui n'existe pas à la racine du serveur.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' }

describe('messages de la console en production — navigateur réel, appli sous /mjs/app/', function () {
  this.timeout(120000)

  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''
  const requetes: string[] = []

  before(async () => {
    const root = mjsTmp('messages-navigateur')
    const srcDir = join(root, 'src')
    const dist = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sain.mjs'), '<p id="sain">tout va bien</p>\n')
    writeFileSync(join(srcDir, 'fautif.mjs'), '<div id="carte" *flipcard><b>recto seul</b></div>\n')
    // production au niveau 'warn' : l'avertissement du framework dont on suit le texte reste dans le code envoyé (le défaut 'error' le retire)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(dist, 'assets'), manifestPath: join(dist, 'assets', 'bundle.js'), urlPrefix: '/assets', runtime: 'core', js: 'bundle', env: 'prod', logLevel: 'warn' })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const page = (lang: string, corps: string) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><script type="module" src="assets/bundle.js"></script></head><body>${corps}</body></html>`
    writeFileSync(join(dist, 'sain.html'), page('fr', '<mjs-sain></mjs-sain>'))
    writeFileSync(join(dist, 'fautif-fr.html'), page('fr', '<mjs-sain></mjs-sain><mjs-fautif></mjs-fautif>'))
    writeFileSync(join(dist, 'fautif-en.html'), page('en', '<mjs-sain></mjs-sain><mjs-fautif></mjs-fautif>'))

    server = createServer((req, res) => {
      const url = (req.url ?? '').split('?')[0]
      requetes.push(url)
      const base = '/mjs/app/'
      const fichier = url.startsWith(base) ? join(dist, url.slice(base.length)) : ''
      if (!fichier || !existsSync(fichier) || fichier.endsWith('/')) { res.writeHead(404); res.end('introuvable'); return }
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port + '/mjs/app/'
    browser = await chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise((resolve) => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  async function ouvrir(nom: string): Promise<{ console: string[]; fichiers: string[] }> {
    const page = await browser!.newPage()
    const sortie: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') sortie.push(m.text()) })
    requetes.length = 0
    await page.goto(origin + nom)
    await page.waitForFunction(() => (window as any).__mjsBundleReady !== undefined)
    await page.evaluate(() => (window as any).__mjsBundleReady)
    await page.waitForTimeout(800)
    const fichiers = requetes.filter((u) => /mjs_err-/.test(u))
    await page.close()
    return { console: sortie, fichiers }
  }

  it('page sans message : le fichier de messages n\'est jamais téléchargé', async () => {
    const { console: sortie, fichiers } = await ouvrir('sain.html')
    assert.deepEqual(sortie, [])
    assert.deepEqual(fichiers, [])
  })

  it('page en français : texte court tout de suite, une seule requête (sous /mjs/app/assets/), texte complet ensuite', async () => {
    const { console: sortie, fichiers } = await ouvrir('fautif-fr.html')
    assert.equal(fichiers.length, 1, fichiers.join(', '))
    assert.match(fichiers[0], /^\/mjs\/app\/assets\/mjs_err-fr-[0-9a-z]{5}\.json$/)
    const court = sortie.findIndex((m) => m.startsWith('[ModularJS] flipcard'))
    const complet = sortie.findIndex((m) => m.startsWith('[ModularJS] ' + RUNTIME_LABELS.fr.err.flipcard))
    assert.ok(court >= 0, `texte court absent :\n${sortie.join('\n')}`)
    assert.ok(complet > court, `texte complet absent, ou avant le court :\n${sortie.join('\n')}`)
  })

  it('page en anglais : le fichier anglais, texte complet en anglais', async () => {
    const { console: sortie, fichiers } = await ouvrir('fautif-en.html')
    assert.equal(fichiers.length, 1, fichiers.join(', '))
    assert.match(fichiers[0], /^\/mjs\/app\/assets\/mjs_err-en-[0-9a-z]{5}\.json$/)
    assert.ok(sortie.some((m) => m.startsWith('[ModularJS] flipcard')))
    assert.ok(sortie.some((m) => m.startsWith('[ModularJS] ' + RUNTIME_LABELS.en.err.flipcard)), `texte complet absent :\n${sortie.join('\n')}`)
  })
})
