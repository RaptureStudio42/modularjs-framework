// BANC navigateur RÉEL (Chromium + Firefox, via playwright) — hors de `npm test`. Un effet qui attend
// l'écran (`on: view`) se déclenche aussi sur une balise plus haute que l'écran : une balise de cinq
// écrans ne montre jamais 20 % d'elle-même, elle est vue quand elle couvre une part de l'écran. Sans
// quoi son texte (*tracking, caché en attendant) ou la balise entière (*fade posé directement, tenue
// cachée) restent invisibles pour toujours. Témoin : une balise de taille ordinaire, déclenchée comme
// avant. La page d'essai est écrite à la volée, compilée par bin/mjs en dev puis en prod.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { assertDistFrais } from '../helpers/dist-frais.js'
import { mjsTmp } from '../helpers/tmp.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-grand'

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

function ecrireFixture(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet' }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — grande balise</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-grand></mjs-grand>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'composants', 'grand.mjs'), [
    '<div class="espace"></div>',
    '<p id="haute" class="haute" *tracking>Un très long texte qui court sur cinq écrans</p>',
    '<div class="espace"></div>',
    '<p id="temoin" class="temoin" *tracking>Témoin</p>',
    '<div class="espace"></div>',
    '<div id="fondu" class="fondu" *fade(on: view, duration: 200ms)>Un grand bloc</div>',
    '<div class="espace"></div>',
    '',
    '<style>',
    '  .espace',
    '    height: 1200px',
    '  .haute',
    '    height: 5000px',
    '    margin: 0',
    '  .temoin',
    '    height: 60px',
    '    margin: 0',
    '  .fondu',
    '    height: 7000px',
    '</style>',
  ].join('\n'))
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

describe('banc navigateur réel : on: view sur une balise plus haute que l\'écran (dev + prod)', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-grande-balise')
    port = await freePort()
    ecrireFixture(dir)
    server = await serveDir(dir, port)
  })

  after(async function () {
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
          let page: any = null
          const issues: string[] = []

          before(async function () {
            browser = await engine.launch()
            page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
            await page.addInitScript(() => { (window as any).__root = (el: any) => el._shadow || el.shadowRoot })
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'load' })
            await page.waitForFunction((host: string) => {
              const el: any = document.querySelector(host)
              const sh = el && (el._shadow || el.shadowRoot)
              return !!(sh && sh.querySelector('#haute[mjs-fx~="tracking"]') && sh.querySelector('#fondu[mjs-fx~="fade"]'))
            }, HOST, { timeout: 30000 })
          })

          after(async function () {
            if (browser) await browser.close()
          })

          // amène le haut de la balise `sel` à `part` de la hauteur de l'écran (0 : en haut)
          const amener = (sel: string, part: number) => page.evaluate(({ host, sel, part }: any) => {
            const el: any = (window as any).__root(document.querySelector(host)).querySelector(sel)
            window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - innerHeight * part)
          }, { host: HOST, sel, part })
          const attend = (sel: string) => page.evaluate(({ host, sel }: any) => (window as any).__root(document.querySelector(host)).querySelector(sel).hasAttribute('mjs-fx-wait'), { host: HOST, sel })
          const opacite = (sel: string) => page.evaluate(({ host, sel }: any) => getComputedStyle((window as any).__root(document.querySelector(host)).querySelector(sel)).opacity, { host: HOST, sel })

          it('en haut de la page : les balises plus bas attendent l\'écran', async function () {
            assert.equal(await attend('#haute'), true)
            assert.equal(await attend('#temoin'), true)
          })

          it('témoin de taille ordinaire : déclenché à son arrivée à l\'écran', async function () {
            await amener('#temoin', 0.5)
            await page.waitForFunction(({ host }: any) => !(window as any).__root(document.querySelector(host)).querySelector('#temoin').hasAttribute('mjs-fx-wait'), { host: HOST }, { timeout: 5000 })
          })

          it('*tracking sur une balise de 5 000 px : déclenché quand elle couvre la moitié de l\'écran', async function () {
            await amener('#haute', 0.5)
            await page.waitForTimeout(300)
            await amener('#haute', 0.2)
            await page.waitForFunction(({ host }: any) => !(window as any).__root(document.querySelector(host)).querySelector('#haute').hasAttribute('mjs-fx-wait'), { host: HOST }, { timeout: 5000 })
          })

          it('*fade(on: view) posé sur un bloc de 7 000 px : il finit visible', async function () {
            await amener('#fondu', 0.5)
            await page.waitForTimeout(300)
            await amener('#fondu', 0)
            await page.waitForFunction(({ host }: any) => getComputedStyle((window as any).__root(document.querySelector(host)).querySelector('#fondu')).opacity === '1', { host: HOST }, { timeout: 5000 }).catch(() => {})
            assert.equal(await opacite('#fondu'), '1')
          })

          it('aucune erreur dans la console', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
