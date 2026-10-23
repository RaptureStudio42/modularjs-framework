// Preuve navigateur réel : la navigation coupe le défilement natif du navigateur pour toute la page
// (`history.scrollRestoration = 'manual'`, posé pour les échanges de page). Entre les ancres ordinaires
// d'une même page (`<a href="#section">`, suivies par le navigateur lui-même), Précédent et Suivant
// laissaient alors la page là où elle était : l'adresse changeait, l'écran non. Ils doivent rendre la
// position de chaque entrée, comme le navigateur seul.
//
// Page servie : mjs_page_cache + mjs_router + mjs_ujs réels ; la même page sans eux sert de témoin.

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
const CORPS = '<nav style="position:fixed;top:0;left:0"><a id="la" href="#a">a</a> <a id="lb" href="#b">b</a></nav><div style="height:1500px"></div><h2 id="a">A</h2><div style="height:1500px"></div><h2 id="b">B</h2><div style="height:3000px"></div>'

describe('mjs_ujs navigateur réel — Précédent et Suivant entre ancres d\'une même page : la position revient', () => {
  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''

  before(async function () {
    this.timeout(60000)
    browser = await chromium.launch({ args: ['--no-proxy-server'] })
    server = createServer((req, res) => {
      if (req.url === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
      const avecMjs = (req.url || '').startsWith('/mjs')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' + CORPS + (avecMjs ? '<script>' + STUB + '</script><script src="/lib.js"></script>' : '') + '</body></html>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
  })

  async function pose(page: Page) {
    await page.waitForTimeout(300)
    return page.evaluate(() => new Promise<string>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(location.hash + ' y=' + Math.round(scrollY))))))
  }

  async function parcours(chemin: string) {
    const page = await browser!.newPage({ viewport: { width: 800, height: 600 } })
    const erreurs: string[] = []
    page.on('pageerror', e => erreurs.push(e.message))
    await page.goto(origin + chemin)
    await page.evaluate(() => new Promise(ok => { scrollTo(0, 400); requestAnimationFrame(() => requestAnimationFrame(ok)) }))
    const vus: string[] = []
    await page.click('#la'); vus.push('clic #a → ' + await pose(page))
    await page.click('#lb'); vus.push('clic #b → ' + await pose(page))
    await page.evaluate(() => history.back()); vus.push('Précédent → ' + await pose(page))
    await page.evaluate(() => history.back()); vus.push('Précédent → ' + await pose(page))
    await page.evaluate(() => history.forward()); vus.push('Suivant → ' + await pose(page))
    await page.evaluate(() => history.forward()); vus.push('Suivant → ' + await pose(page))
    await page.close()
    return { vus, erreurs }
  }

  it('clic #a, clic #b, deux Précédent, deux Suivant : mêmes positions que le navigateur seul', async function () {
    this.timeout(30000)
    const natif = await parcours('/natif')
    const mjs = await parcours('/mjs')
    assert.deepEqual(mjs.erreurs, [])
    assert.deepEqual(mjs.vus, natif.vus, 'AVANT : après le clic #b, la page restait à la position de #b à chaque Précédent/Suivant')
  })
})
