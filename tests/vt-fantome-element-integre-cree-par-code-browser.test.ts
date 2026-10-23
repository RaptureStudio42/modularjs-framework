// Dans Chromium réel : le fantôme de la couche de lévitation des transitions de vue (µ._mjs_vtGhost, mjs_vt_presets.ts)
// recopie un élément intégré personnalisé comme un élément ordinaire, pour ne pas le monter une seconde fois. Il le
// reconnaissait à son attribut `is` ; un élément créé par le code (`document.createElement('button', { is: 'x-bouton' })`)
// n'a pas cet attribut, mais sa copie garde sa définition : le fantôme le montait encore une fois (connectedCallback,
// requêtes, minuteries en double à chaque transition). Il est désormais reconnu à sa classe, qui n'est pas celle d'un
// élément ordinaire de sa balise. Le runtime est chargé tel quel dans la page, comme les tests navigateur voisins.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const SCRIPT = `${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\n${lire('mjs_vt_presets.ts')}\nglobalThis.µ = µ;`
const ORIGINE = 'http://mjs.test'
const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body></body></html>'

describe('transitions de vue — le fantôme ne monte pas un élément intégré personnalisé créé par le code (Chromium réel)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip() }
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(10000)
    await page.route(`${ORIGINE}/**`, (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }))
  })

  after(async () => { if (browser) { await browser.close() } })

  it('createElement(\'button\', { is }) dans l\'élément nommé : aucun montage au départ ni à l\'arrivée, son texte reste', async function () {
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
    const n = await page.evaluate(`(() => {
      window.__montes = 0
      customElements.define('x-bouton', class extends HTMLButtonElement { connectedCallback() { window.__montes++ } }, { extends: 'button' })
      document.body.innerHTML = '<div id="carte" style="width:200px;height:80px"><p>titre</p></div>'
      const b = document.createElement('button', { is: 'x-bouton' })
      b.textContent = 'Acheter'
      document.getElementById('carte').appendChild(b)
      document.getElementById('carte').style.viewTransitionName = 'carte'
      const avant = window.__montes
      const etat = µ._mjs_vtHoistStart()
      const pendant = window.__montes
      const couche = document.getElementById('mjs-vt-hoist')
      const g = couche ? couche.querySelector('button') : null
      const fantome = { bouton: g ? g.textContent : null, personnalise: g ? g.constructor !== HTMLButtonElement : null, attribut: b.hasAttribute('is') }
      µ._mjs_vtHoistSwap(etat)
      return { avant, pendant, arrivee: window.__montes, fantome, leves: etat ? etat.hidden.length : 0 }
    })()`)
    assert.equal(n.fantome.attribut, false, 'l\'original n\'a pas d\'attribut is')
    assert.equal(n.leves, 1, 'l\'élément nommé est levé')
    assert.equal(n.pendant, n.avant, 'aucun montage au départ')
    assert.equal(n.arrivee, n.avant, 'aucun montage à l\'arrivée')
    assert.equal(n.fantome.bouton, 'Acheter', 'le texte du bouton reste dans le fantôme')
    assert.equal(n.fantome.personnalise, false, 'le bouton du fantôme est un bouton ordinaire')
  })

  it('l\'élément nommé lui-même créé par createElement(\'div\', { is }) : aucun montage', async function () {
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
    const n = await page.evaluate(`(() => {
      window.__montes = 0
      customElements.define('x-carte', class extends HTMLDivElement { connectedCallback() { window.__montes++ } }, { extends: 'div' })
      const c = document.createElement('div', { is: 'x-carte' })
      c.id = 'carte'
      c.textContent = 'carte'
      c.style.cssText = 'width:200px;height:80px'
      document.body.appendChild(c)
      c.style.viewTransitionName = 'carte'
      const avant = window.__montes
      const etat = µ._mjs_vtHoistStart()
      const pendant = window.__montes
      const couche = document.getElementById('mjs-vt-hoist')
      µ._mjs_vtHoistSwap(etat)
      return { avant, pendant, arrivee: window.__montes, texte: couche ? couche.textContent : '' }
    })()`)
    assert.equal(n.pendant, n.avant, 'aucun montage au départ')
    assert.equal(n.arrivee, n.avant, 'aucun montage à l\'arrivée')
    assert.ok(n.texte.includes('carte'), 'le contenu est recopié')
  })
})
