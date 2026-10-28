// Preuve navigateur réel (Chromium, Firefox, WebKit) sur un vrai projet construit (Bundler, développement) : ce que la
// navigation reprend d'une page préchargée et ce qu'elle envoie pour un formulaire.
// - page servie depuis le préchargement au survol : le jeton CSRF de son en-tête `X-CSRF-Token` devient celui de la
//   page quand elle s'affiche (avant : jamais, la rotation du jeton était perdue) ; jamais au survol, ni quand la
//   réponse préchargée n'affiche rien (`X-MJS-Method: none`) ;
// - un formulaire `enctype="multipart/form-data"` sans fichier part en `multipart/form-data`, comme le navigateur
//   seul, de même pour le bouton qui le déclare par `formenctype` (avant : en `application/x-www-form-urlencoded`) ; un
//   formulaire qui ne le déclare pas part en `application/x-www-form-urlencoded`.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { Browser, Page } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'hello.mjs': '<script>\n  $n = 0\n</script>\n\n<button @click={$n++}>clic {$n}</button> <a href="/p7">p7</a>\n',
}

const P1 = '<h1 id="nom-p1">P1</h1><mjs-hello></mjs-hello>'
  + '<a id="lp6" href="/p6" data-mjs-preload="hover">p6</a> <a id="lp8" href="/p8" data-mjs-preload="hover">p8</a>'
  + '<form id="fmp" action="/poster" method="post" enctype="multipart/form-data"><input type="hidden" name="t" value="mp"><button id="fmp-b">mp</button></form>'
  + '<form id="fbt" action="/poster" method="post"><input type="hidden" name="t" value="bt"><button id="fbt-mp" formenctype="multipart/form-data">bt-mp</button><button id="fbt-u">bt-u</button></form>'
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

describe('mjs_ujs navigateur réel, vrai projet — le jeton d\'une page préchargée et le format d\'un formulaire multipart', function () {
  this.timeout(240000)
  let dist = ''

  before(async function () {
    const racine = mjsTmp('jeton-precharge-multipart')
    const src    = join(racine, 'src')
    dist = join(racine, 'dist')
    mkdirSync(src, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
    const bundler = new Bundler({ sourceDir: src, outputDir: dist, manifestPath: join(dist, 'bundle.js'), urlPrefix: '/modularjs' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`${nom}`, function () {
      let browser: Browser | null = null
      let server: Server | null  = null
      let origin  = ''
      let present = false
      // requêtes reçues : verbe, chemin, format du corps, corps
      const recues: { m: string, u: string, ct: string, corps: string }[] = []

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) return this.skip()
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        server  = createServer((req, res) => {
          const url = new URL(req.url || '/', 'http://x')
          let corps = ''
          req.on('data', (c) => { corps += c })
          req.on('end', () => {
            const page = (nomPage: string, tete: string, entetes: Record<string, string> = {}) => {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...entetes })
              res.end('<!doctype html><html><head><meta charset="utf-8">' + tete + '<script type="module" src="/modularjs/bundle.js"></script></head><body style="margin:0">' + (nomPage === 'p1' ? P1 : '<h1 id="nom-' + nomPage + '">' + nomPage + '</h1>') + '</body></html>')
            }
            if (!url.pathname.startsWith('/modularjs/')) recues.push({ m: req.method || '', u: url.pathname, ct: (req.headers['content-type'] || '').split(';')[0], corps })
            switch (url.pathname) {
              case '/p1': return page('p1', '<meta name="csrf-param" content="authenticity_token"><meta name="csrf-token" content="meta-p1">')
              // page sans balise du jeton : le serveur le donne par l'en-tête
              case '/p6': return page('p6', '', { 'X-CSRF-Token': 'tok-p6' })
              // réponse qui n'installe rien
              case '/p8': return page('p8', '', { 'X-CSRF-Token': 'tok-p8', 'X-MJS-Method': 'none' })
              case '/p7': return page('p7', '')
              case '/poster':
                res.writeHead(303, { location: '/p7', 'cache-control': 'no-store' })
                res.end()
                return
            }
            const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
            const fichier = m ? join(dist, normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
            if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('introuvable'); return }
            res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
            res.end(readFileSync(fichier))
          })
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
        origin = 'http://127.0.0.1:' + (server!.address() as any).port
      })

      after(async () => {
        if (browser) await browser.close()
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      function prete(page: Page) {
        return page.waitForFunction(() => history.scrollRestoration === 'manual' && !!(window as any).µ && typeof (window as any).µ._mjs_anchorTarget === 'function', null, { timeout: 15000 })
      }

      async function ouvrir(chemin: string) {
        const page    = await browser!.newPage({ viewport: { width: 800, height: 600 } })
        const erreurs: string[] = []
        page.on('pageerror', e => erreurs.push(e.message))
        await page.goto(origin + chemin)
        await prete(page)
        return { page, erreurs }
      }

      function jeton(page: Page): Promise<string | null> {
        return page.evaluate(() => { const m = document.querySelector('meta[name="csrf-token"]'); return m ? m.getAttribute('content') : null })
      }

      const demandes = (chemin: string) => recues.filter(r => r.u === chemin).length

      it('page servie depuis le préchargement : le jeton de son en-tête `X-CSRF-Token` devient celui de la page quand elle s\'affiche, jamais au survol', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        const avant = demandes('/p6')
        await page.hover('#lp6')
        await page.waitForTimeout(700)
        const survol = [await jeton(page), demandes('/p6') - avant]
        await page.click('#lp6')
        await page.waitForSelector('#nom-p6', { state: 'attached', timeout: 15000 })
        await page.waitForTimeout(200)
        assert.deepEqual([survol, await jeton(page), demandes('/p6') - avant], [['meta-p1', 1], 'tok-p6', 1], 'AVANT : le jeton de la page préchargée n\'était jamais repris (meta-p1)')
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('une réponse préchargée qui n\'affiche rien (`X-MJS-Method: none`) ne change pas le jeton', async function () {
        if (!present) return this.skip()
        const { page, erreurs } = await ouvrir('/p1')
        const avant = demandes('/p8')
        await page.hover('#lp8')
        await page.waitForTimeout(700)
        await page.click('#lp8')
        await page.waitForTimeout(600)
        assert.deepEqual([demandes('/p8') - avant, await page.evaluate(() => location.pathname + ' ' + !!document.getElementById('nom-p1')), await jeton(page)], [1, '/p1 true', 'meta-p1'])
        assert.deepEqual(erreurs, [])
        await page.close()
      })

      it('un formulaire qui déclare `multipart/form-data` (`enctype`, ou `formenctype` du bouton) part dans ce format, même sans fichier ; les autres en `application/x-www-form-urlencoded`', async function () {
        if (!present) return this.skip()
        const vus: string[] = []
        for (const bouton of ['fmp-b', 'fbt-mp', 'fbt-u']) {
          const { page, erreurs } = await ouvrir('/p1')
          const deja = recues.length
          await page.click('#' + bouton)
          await page.waitForSelector('#nom-p7', { state: 'attached', timeout: 15000 })
          const envoi = recues.slice(deja).find(r => r.u === '/poster')
          // le champ du formulaire voyage dans les deux formats
          vus.push(bouton + ' ' + (envoi ? envoi.m + ' ' + envoi.ct + ' champ=' + (/name="t"\r\n\r\n(mp|bt)\r\n/.test(envoi.corps) || /(^|&)t=(mp|bt)(&|$)/.test(envoi.corps)) : 'aucun envoi'))
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        assert.deepEqual(vus, ['fmp-b POST multipart/form-data champ=true', 'fbt-mp POST multipart/form-data champ=true', 'fbt-u POST application/x-www-form-urlencoded champ=true'], 'AVANT : les deux premiers partaient en application/x-www-form-urlencoded')
      })
    })
  }
})
