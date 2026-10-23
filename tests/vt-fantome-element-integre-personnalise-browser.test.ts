// Dans Chromium réel : le fantôme de la couche de lévitation des transitions de vue (µ._mjs_vtGhost, mjs_vt_presets.ts)
// recopie l'élément nommé sans monter une seconde fois ce qu'il contient. Les composants (balise à tiret) l'étaient déjà,
// pas un élément intégré personnalisé (`<button is="x-bouton">`, d'une bibliothèque tierce) : le fantôme le recréait avec
// sa définition et son connectedCallback repartait (requêtes, minuteries en double à chaque transition). Il est désormais
// recopié comme un élément ordinaire de la même balise, sans sa définition : rien n'est monté, son texte reste visible.
// Le runtime est chargé tel quel dans la page, comme les tests navigateur voisins.

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

describe('transitions de vue — le fantôme ne monte pas un élément intégré personnalisé (Chromium réel)', function () {
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

  it('<button is="x-bouton"> dans l\'élément nommé : aucun montage au départ ni à l\'arrivée, son texte reste dans le fantôme', async function () {
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
    const n = await page.evaluate(`(() => {
      window.__montes = 0
      customElements.define('x-bouton', class extends HTMLButtonElement { connectedCallback() { window.__montes++ } }, { extends: 'button' })
      document.body.innerHTML = '<div id="carte" style="width:200px;height:80px"><p>titre</p><button is="x-bouton" class="achat">Acheter</button></div>'
      document.getElementById('carte').style.viewTransitionName = 'carte'
      const avant = window.__montes
      const etat = µ._mjs_vtHoistStart()
      const pendant = window.__montes
      const couche = document.getElementById('mjs-vt-hoist')
      const b = couche ? couche.querySelector('button') : null
      const fantome = { bouton: b ? b.textContent : null, personnalise: b ? b.constructor !== HTMLButtonElement : null, is: b ? b.outerHTML.includes(' is=') : null }
      µ._mjs_vtHoistSwap(etat)
      const arrivee = window.__montes
      return { avant, pendant, arrivee, fantome, leves: etat ? etat.hidden.length : 0 }
    })()`)
    assert.equal(n.leves, 1, 'l\'élément nommé est levé')
    assert.equal(n.pendant, n.avant, 'aucun montage au départ')
    assert.equal(n.arrivee, n.avant, 'aucun montage à l\'arrivée')
    assert.equal(n.fantome.bouton, 'Acheter', 'le texte du bouton reste dans le fantôme')
    assert.equal(n.fantome.personnalise, false, 'le bouton du fantôme est un bouton ordinaire')
    assert.equal(n.fantome.is, false)
  })

  it('l\'élément nommé lui-même est un élément intégré personnalisé : aucun montage', async function () {
    await page.goto(ORIGINE + '/')
    await page.evaluate(SCRIPT)
    const n = await page.evaluate(`(() => {
      window.__montes = 0
      customElements.define('x-carte', class extends HTMLDivElement { connectedCallback() { window.__montes++ } }, { extends: 'div' })
      document.body.innerHTML = '<div is="x-carte" id="carte" style="width:200px;height:80px">carte</div>'
      document.getElementById('carte').style.viewTransitionName = 'carte'
      const avant = window.__montes
      const etat = µ._mjs_vtHoistStart()
      const pendant = window.__montes
      const couche = document.getElementById('mjs-vt-hoist')
      return { avant, pendant, texte: couche ? couche.textContent : '' }
    })()`)
    assert.equal(n.pendant, n.avant)
    assert.ok(n.texte.includes('carte'), 'le contenu est recopié')
  })
})
