// Preuve navigateur réel : une page en cache `revalidate` est affichée depuis le cache au Précédent,
// puis redemandée en fond. Sa fraîcheur se jugeait sur le HTML du DOM VIVANT : un composant qui pose
// un attribut sur sa balise (prop reflétée, `theme`) rendait la comparaison toujours fausse, et la
// page entière était remontée à chaque retour (état local perdu). La comparaison porte désormais sur
// la page reçue la fois précédente ; une page qui a vraiment changé est toujours remontée.
//
// Page servie : mjs_page_cache + mjs_ajax + mjs_ujs réels ; `x-reflet` pose un attribut à sa connexion,
// comme un composant.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium, type Browser } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(__dirname, '..', 'src', 'runtime')
const LIB = ['mjs_page_cache.ts', 'mjs_ajax.ts', 'mjs_ujs.ts'].map(f => '(function(µ){\n' + readFileSync(join(RUNTIME, f), 'utf-8') + '\n})(window.µ);').join('\n')
const STUB = 'window.µ={log(){},warn(){},error(){},_mjs_txt:(k,p,f)=>f,_mjs_msg:(k,p,f)=>f,_mjs_logger:()=>null,config:{},state:(o)=>o||{}}'
const ELEMENT = 'customElements.define("x-reflet", class extends HTMLElement { connectedCallback() { this.setAttribute("theme", "or") } })'

describe('mjs_ujs navigateur réel — revalidation : comparée à la page reçue, pas au DOM vivant', () => {
  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''
  const visites: Record<string, number> = {}

  before(async function () {
    this.timeout(60000)
    browser = await chromium.launch({ args: ['--no-proxy-server'] })
    server = createServer((req, res) => {
      const u = req.url || ''
      if (u === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
      visites[u] = (visites[u] || 0) + 1
      let corps = ''
      const entetes: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
      if (u === '/fixe' || u === '/change') {
        entetes['x-mjs-cache'] = 'revalidate'
        corps = '<a id="suite" href="/b">b</a><x-reflet></x-reflet><p id="v">' + (u === '/change' ? 'version ' + visites[u] : 'stable') + '</p>'
      } else if (u === '/b') {
        corps = '<p id="pageb">b</p>'
      } else {
        corps = '<a id="fixe" href="/fixe">fixe</a> <a id="change" href="/change">change</a><script>' + STUB + '</script><script src="/lib.js"></script><script>' + ELEMENT + '</script>'
      }
      res.writeHead(200, entetes)
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + corps + '</body></html>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
  })

  // départ → page `chemin` (revalidate) → /b → Précédent ; rend la page une fois la revalidation traitée
  async function allerRetour(chemin: string) {
    const page = await browser!.newPage()
    const erreurs: string[] = []
    page.on('pageerror', e => erreurs.push(e.message))
    await page.goto(origin + '/depart')
    await page.click('#' + chemin.slice(1))
    await page.waitForFunction(() => !!document.querySelector('x-reflet'), null, { timeout: 5000 })
    await page.evaluate(() => { (document.querySelector('x-reflet') as any)._marque = 1 })
    await page.click('#suite')
    await page.waitForFunction(() => !!document.getElementById('pageb'), null, { timeout: 5000 })
    const avant = visites[chemin]
    await page.evaluate(() => history.back())
    await page.waitForFunction(() => !!document.querySelector('x-reflet'), null, { timeout: 5000 })
    for (let i = 0; i < 50 && visites[chemin] === avant; i++) await page.waitForTimeout(50)
    assert.equal(visites[chemin], avant + 1, 'la revalidation en fond est bien partie')
    await page.waitForTimeout(400)
    return { page, erreurs }
  }

  it('page inchangée, composant qui pose un attribut : rien n\'est remonté au retour', async function () {
    this.timeout(30000)
    const { page, erreurs } = await allerRetour('/fixe')
    assert.equal(await page.evaluate(() => (document.querySelector('x-reflet') as any)._marque), 1, 'AVANT : la balise du composant était remplacée (page remontée)')
    assert.deepEqual(erreurs, [])
    await page.close()
  })

  it('page qui a changé au serveur : remontée, la nouvelle version s\'affiche', async function () {
    this.timeout(30000)
    const { page, erreurs } = await allerRetour('/change')
    assert.equal(await page.evaluate(() => document.getElementById('v')!.textContent), 'version 2')
    assert.deepEqual(erreurs, [])
    await page.close()
  })
})
