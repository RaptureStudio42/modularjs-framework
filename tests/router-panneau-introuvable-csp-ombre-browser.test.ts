// Preuve navigateur réel : en mode CSP (`µ._csp`), le panneau « Page introuvable » se pose dans la
// <@view> de l'OMBRE du composant routeur ; sa feuille, adoptée sur `document`, ne traversait pas
// l'ombre — panneau sans aucun style, alors qu'il est habillé hors CSP. La feuille (une seule
// instance partagée) doit être adoptée par la racine où vit le panneau : l'ombre de chaque routeur.
//
// Page servie : mjs_page_cache (CSS du panneau) + mjs_router réels.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium, type Browser } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(__dirname, '..', 'src', 'runtime')
const LIB = ['mjs_page_cache.ts', 'mjs_router.ts'].map(f => '(function(µ){\n' + readFileSync(join(RUNTIME, f), 'utf-8') + '\n})(window.µ);').join('\n')
const STUB = 'window.µ={log(){},warn(){},error(){},_mjs_txt:(k,p,f)=>f,_mjs_logger:()=>null,config:{},state:(o)=>o||{}}'

describe('mjs_router navigateur réel — panneau « Page introuvable » d\'un routeur à ombre sous µ._csp', () => {
  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''

  before(async function () {
    this.timeout(60000)
    browser = await chromium.launch()
    server = createServer((req, res) => {
      if (req.url === '/lib.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(LIB); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="hote1"></div><div id="hote2"></div><script>' + STUB + '</script><script src="/lib.js"></script></body></html>')
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
  })

  // pose un routeur à ombre sur l'hôte, affiche le panneau, rend son habillage calculé
  function scenario([csp, hotes]: [boolean, string[]]) {
    const µ: any = (window as any).µ
    µ._csp = csp
    const out: any = { boites: [], ombresAvecFeuille: 0, feuillesDocument: 0, styleDansOmbre: false }
    for (const id of hotes) {
      const hote: any = document.getElementById(id)
      const ombre = hote.attachShadow({ mode: 'open' })
      ombre.innerHTML = '<metamjs-view id="main"></metamjs-view>'
      Object.assign(hote, { _shadow: ombre, routes: { main: { '/': 'accueil' } } })
      µ.Router._mjs_awareComponents.clear()
      µ.Router._mjs_awareComponents.add(hote)
      µ.Router._mjs_showNoMatch('/introuvable')
      const cs = getComputedStyle(ombre.querySelector('.mjs-route-error'))
      out.boites.push(cs.borderTopStyle + ' ' + cs.borderTopWidth + ' marge=' + cs.marginTop)
      if (ombre.adoptedStyleSheets.length) out.ombresAvecFeuille++
      if (ombre.querySelector('style')) out.styleDansOmbre = true
    }
    out.feuillesDocument = document.adoptedStyleSheets.length
    return out
  }

  it('témoin hors CSP : panneau habillé par un <style> voisin dans l\'ombre', async function () {
    this.timeout(30000)
    const page = await browser!.newPage()
    await page.goto(origin + '/')
    const r = await page.evaluate(scenario, [false, ['hote1']] as [boolean, string[]])
    assert.equal(r.boites[0], 'solid 1px marge=32px')
    assert.equal(r.styleDansOmbre, true)
    await page.close()
  })

  it('µ._csp vrai : panneau habillé dans chaque ombre, feuille partagée adoptée par l\'ombre, rien sur document', async function () {
    this.timeout(30000)
    const page = await browser!.newPage()
    await page.goto(origin + '/')
    const r = await page.evaluate(scenario, [true, ['hote1', 'hote2']] as [boolean, string[]])
    assert.deepEqual(r.boites, ['solid 1px marge=32px', 'solid 1px marge=32px'], 'AVANT : bordure none 0px, marge 0px (feuille adoptée sur document, arrêtée par l\'ombre)')
    assert.equal(r.styleDansOmbre, false, 'sous CSP : jamais de <style> injecté')
    assert.equal(r.ombresAvecFeuille, 2, 'deux routeurs à ombre : la feuille adoptée par chacun')
    assert.equal(r.feuillesDocument, 0)
    const meme = await page.evaluate(() => {
      const a: any = document.getElementById('hote1')!.shadowRoot!.adoptedStyleSheets[0]
      const b: any = document.getElementById('hote2')!.shadowRoot!.adoptedStyleSheets[0]
      return a === b
    })
    assert.equal(meme, true, 'une seule instance de feuille, partagée')
    await page.close()
  })
})
