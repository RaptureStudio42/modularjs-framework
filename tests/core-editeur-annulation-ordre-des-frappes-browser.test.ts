// <@@editor> : l'ordre de Ctrl+Z quand le focus n'est dans aucun champ où l'on écrit, avec deux éditeurs sur la page, et le champ d'un composant tiers
// caché dans une ombre fermée.
// - Frappes dans le titre, dans e1 puis dans e2, focus sur un bouton de la page : Ctrl+Z défait e2, puis e1, puis le geste revient au navigateur
//   (Chromium y défait le titre ; Firefox ne défait pas un champ de texte depuis un bouton). Frappes croisées e1, e2, e1 : défaites dans l'ordre
//   inverse, d'un éditeur à l'autre. Une frappe dans le titre plus récente que celle de e1 revient au navigateur. WebKit n'adresse aucun geste
//   quand le focus n'est pas dans un champ où l'on écrit : rien ne bouge.
// - Un champ dans l'ombre fermée d'un composant tiers a le focus : Ctrl+Z défait ce champ, jamais l'éditeur qui a reçu une frappe après lui.
// Chromium, Firefox et WebKit réels, développement et production : de vraies touches.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, type Build, type Construction } from './helpers/editeur-riche.js'

const PAGE = `<form class="f" @noUJS>
  <label>Titre <input class="titre" name="titre"></label>
  <@@editor class="e1" name="a" value="<p>Alpha</p>"></@@editor>
  <@@editor class="e2" name="b" value="<p>Beta</p>"></@@editor>
  <button class="pb" type="button">Page</button>
  <x-champ></x-champ>
</form>
`

// un composant tiers : son champ vit dans une ombre fermée, que la page ne voit pas
const TIERS = `(() => {
  window.__fermes = new WeakMap()
  customElements.define('x-champ', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<input class="xi" aria-label="tiers">'; window.__fermes.set(this, r) } })
})()`

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed  = (c) => __q('.' + c)
  window.__sf  = (c) => __ed(c)._shadow.querySelector('.surface')
  window.__val = (c) => { const i = __ed(c).querySelector(':scope > input[type=hidden]'); return i ? i.value : null }
  window.__xi  = () => window.__fermes.get(__q('x-champ')).querySelector('.xi')
  // l'élément qui a le focus, cherché à travers les ombres
  window.__focus = () => { let a = document.activeElement; while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement; return a }
  window.__fin = (c) => {
    const sf = __sf(c); sf.focus()
    const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
    let n, last
    while ((n = w.nextNode())) last = n
    if (last) document.getSelection().setBaseAndExtent(last, last.length, last, last.length)
  }
  window.__auTitre = () => { const t = __q('.titre'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) }
  window.__etat = () => [__q('.titre').value, __val('e1'), __val('e2'), __xi().value].join(' | ')
})()`

const PRET = `(() => {
  const h  = document.querySelector('mjs-hote')
  const e1 = h && h._shadow && h._shadow.querySelector('.e1')
  const e2 = h && h._shadow && h._shadow.querySelector('.e2')
  return !!(e1 && e2 && e1._shadow && e2._shadow && e1._shadow.querySelector('.surface') && e2._shadow.querySelector('.surface') && e1.querySelector(':scope > input[type=hidden]') && e2.querySelector(':scope > input[type=hidden]') && window.__fermes && h._shadow.querySelector('x-champ'))
})()`

async function nouvellePage(browser: any, fait: Construction, erreurs: string[]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } })
  await page.addInitScript('window.__name = (f) => f;')
  await page.addInitScript(TIERS)
  page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
  const corps   = fait.build === 'prod' ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${fait.script.replace(/<\/script/gi, '<\\/script')}</script>`
  const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${corps}</body></html>`
  await page.route('http://editeur.test/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/out/')) {
      const f = fait.fichiers.get(url.pathname.slice(5))
      await route.fulfill(f ? { status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
  })
  return page
}

// une page neuve à chaque essai : la pile commune du navigateur repart vide
async function charger(page: any) {
  await page.goto('http://editeur.test/page', { waitUntil: 'load' })
  await page.waitForFunction(PRET, null, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 150) => page.waitForTimeout(ms)

async function touche(page: any, k: string) {
  await page.keyboard.press(k)
  await pause(page, 400)
}

async function taper(page: any, texte: string) {
  await page.keyboard.type(texte)
  await pause(page)
}

for (const build of ['dev', 'prod'] as Build[]) for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> : l'ordre de Ctrl+Z avec deux éditeurs, et le champ d'une ombre fermée (${nom} réel, ${build === 'dev' ? 'développement' : 'production'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  // WebKit n'adresse aucun geste de défaire quand le focus n'est pas dans un champ où l'on écrit
  const geste = nom !== 'webkit'

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire(build, PAGE, 'editeur-annulation-ordre')
      browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      page    = await nouvellePage(browser, fait, erreurs)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    erreurs.length = 0
    await charger(page)
  })

  it('frappes dans le titre, e1 puis e2, focus sur un bouton de la page : Ctrl+Z défait e2, puis e1, puis le geste revient au navigateur', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'T')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' a1')
    await page.evaluate(`__fin('e2')`)
    await taper(page, ' b2')
    await page.evaluate(`__q('.pb').focus()`)
    await pause(page)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__etat()`), geste ? 'T | <p>Alpha a1</p> | <p>Beta</p> | ' : 'T | <p>Alpha a1</p> | <p>Beta b2</p> | ', 'le 1er Ctrl+Z défait la dernière frappe, celle de e2')
    assert.equal(await page.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__etat()`), geste ? 'T | <p>Alpha</p> | <p>Beta</p> | ' : 'T | <p>Alpha a1</p> | <p>Beta b2</p> | ', 'le 2e Ctrl+Z défait la frappe d\'avant, celle de e1')
    assert.equal(await page.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
    await touche(page, 'Control+z')
    // plus rien dans les éditeurs : le geste revient au navigateur ; Chromium défait le titre, Firefox ne défait pas un champ de texte depuis un bouton
    assert.equal(await page.evaluate(`__etat()`), nom === 'chromium' ? ' | <p>Alpha</p> | <p>Beta</p> | ' : geste ? 'T | <p>Alpha</p> | <p>Beta</p> | ' : 'T | <p>Alpha a1</p> | <p>Beta b2</p> | ', 'le 3e Ctrl+Z revient au navigateur')
    assert.deepEqual(erreurs, [])
  })

  it('frappes croisées e1, e2, e1, focus sur un bouton de la page : Ctrl+Z les défait dans l\'ordre inverse, d\'un éditeur à l\'autre', async function () {
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' a1')
    await page.evaluate(`__fin('e2')`)
    await taper(page, ' b2')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' c3')
    await page.evaluate(`__q('.pb').focus()`)
    await pause(page)
    const attendus = geste ? [' | <p>Alpha a1</p> | <p>Beta b2</p> | ', ' | <p>Alpha a1</p> | <p>Beta</p> | ', ' | <p>Alpha</p> | <p>Beta</p> | '] : Array(3).fill(' | <p>Alpha a1 c3</p> | <p>Beta b2</p> | ')
    for (const [i, attendu] of attendus.entries()) {
      await touche(page, 'Control+z')
      assert.equal(await page.evaluate(`__etat()`), attendu, 'Ctrl+Z nº ' + (i + 1))
      assert.equal(await page.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
    }
    assert.deepEqual(erreurs, [])
  })

  it('une frappe dans le titre après celle de e1, focus sur un bouton de la page : Ctrl+Z revient au navigateur, jamais à e1', async function () {
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' a1')
    await page.evaluate(`__auTitre()`)
    await taper(page, 'T')
    await page.evaluate(`__q('.pb').focus()`)
    await pause(page)
    await touche(page, 'Control+z')
    // Chromium défait le titre ; Firefox ne défait pas un champ de texte depuis un bouton ; WebKit n'envoie aucun geste
    assert.equal(await page.evaluate(`__etat()`), nom === 'chromium' ? ' | <p>Alpha a1</p> | <p>Beta</p> | ' : 'T | <p>Alpha a1</p> | <p>Beta</p> | ', 'la frappe la plus récente, celle du titre, revient au navigateur')
    assert.deepEqual(erreurs, [])
  })

  it('un champ dans l\'ombre fermée d\'un composant tiers a le focus : Ctrl+Z défait ce champ, jamais l\'éditeur', async function () {
    await page.evaluate(`__xi().focus()`)
    await taper(page, 'q')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' a1')
    await page.evaluate(`__xi().focus(); __xi().setSelectionRange(1, 1)`)
    await pause(page)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha a1</p>', 'l\'éditeur garde sa frappe')
    assert.equal(await page.evaluate(`__xi().value`), '', 'le champ du composant tiers est défait')
    assert.deepEqual(erreurs, [])
  })
})
