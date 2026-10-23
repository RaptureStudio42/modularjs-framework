// Preuve navigateur réel : la navigation coupe le défilement natif du navigateur pour toute la page
// (`history.scrollRestoration = 'manual'`, posé pour les échanges de page). Dans une appli à routes
// hash, revenir en arrière d'une fiche vers une liste longue la remettait en haut, là où le
// navigateur seul rendait la position. La position de chaque route quittée (clic sur un lien
// `#/…`, µ.Router.navigate) doit revenir au Précédent.
//
// Page servie : mjs_page_cache + mjs_router + mjs_ujs réels, une page haute de 6000 px.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(__dirname, '..', 'src', 'runtime')
const LIB = ['mjs_page_cache.ts', 'mjs_router.ts', 'mjs_ujs.ts'].map(f => '(function(µ){\n' + readFileSync(join(RUNTIME, f), 'utf-8') + '\n})(window.µ);').join('\n')
const STUB = 'window.µ={log(){},warn(){},error(){},_mjs_txt:(k,p,f)=>f,_mjs_msg:(k,p,f)=>f,_mjs_logger:()=>null,config:{},state:(o)=>o||{}}'
const CORPS = '<a id="lien" href="#/item" style="position:fixed;top:0;left:0">item</a><div style="height:6000px"></div>'

describe('mjs_ujs navigateur réel — Précédent entre deux routes hash : la position revient', () => {
  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''

  before(async function () {
    this.timeout(60000)
    browser = await chromium.launch()
    server = createServer((req, res) => {
      if (req.url === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + CORPS + '<script>' + STUB + '</script><script src="/lib.js"></script></body></html>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
  })

  async function surLaListe(page: Page, y: number) {
    await page.goto(origin + '/app')
    await page.evaluate(() => history.replaceState({}, '', location.pathname + '#/list'))
    await page.evaluate((y) => new Promise(ok => { scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(ok)) }), y)
  }

  async function precedent(page: Page) {
    await page.evaluate(() => new Promise(ok => { scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(ok)) }))
    await page.evaluate(() => history.back())
    await page.waitForFunction(() => location.hash === '#/list', null, { timeout: 5000 })
    await page.waitForFunction(() => scrollY !== 0, null, { timeout: 1500 }).catch(() => {})
    return page.evaluate(() => location.hash + ' y=' + scrollY)
  }

  it('clic sur un lien `#/item` depuis la liste défilée à 2000, puis Précédent : y = 2000', async function () {
    this.timeout(30000)
    const page = await browser!.newPage({ viewport: { width: 800, height: 600 } })
    const erreurs: string[] = []
    page.on('pageerror', e => erreurs.push(e.message))
    await surLaListe(page, 2000)
    await page.click('#lien')
    await page.waitForFunction(() => location.hash === '#/item', null, { timeout: 5000 })
    assert.equal(await precedent(page), '#/list y=2000', 'AVANT : y=0 (scrollRestoration manual, aucune position gardée pour les routes hash)')
    assert.deepEqual(erreurs, [])
    await page.close()
  })

  it('µ.Router.navigate(\'#/item\') depuis la liste défilée à 1500, puis Précédent : y = 1500', async function () {
    this.timeout(30000)
    const page = await browser!.newPage({ viewport: { width: 800, height: 600 } })
    await surLaListe(page, 1500)
    await page.evaluate(() => (window as any).µ.Router.navigate('#/item'))
    await page.waitForFunction(() => location.hash === '#/item', null, { timeout: 5000 })
    assert.equal(await precedent(page), '#/list y=1500')
    await page.close()
  })
})
