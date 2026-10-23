// <@@editor> : Ctrl+Z et Ctrl+Maj+Z quand le focus n'est dans aucun champ où l'on écrit, et la zone `contenteditable` de la page.
// - Le focus sur le bouton ou la case d'un composant tiers à ombre fermée (rien où l'on écrit) : Ctrl+Z défait l'éditeur qui a reçu la dernière frappe,
//   le focus reste en place, le titre plus ancien n'est pas touché.
// - Frappes dans e1, puis dans le titre, puis dans e2, focus sur un bouton : Ctrl+Z défait e2, puis rend la saisie du titre au navigateur (Chromium la
//   défait, le focus reste sur le bouton ; Firefox ne défait pas un champ de texte depuis un bouton : rien ne bouge), puis défait e1.
// - Deux éditeurs défaits depuis un bouton : Ctrl+Maj+Z (ou Ctrl+Y) refait e1, puis e2, dans l'ordre inverse.
// - Un éditeur sans ombre (`@lightDom`) n'a pas le focus quand un bouton de la page l'a : l'ordre des frappes est le même qu'avec deux éditeurs à ombre.
// - Focus dans une zone `contenteditable` de la page : Ctrl+Z défait la zone, et aucun `input` ne sort de l'éditeur vers un écouteur de la page (Firefox
//   défaisait d'abord l'étape de l'éditeur, remise aussitôt : la valeur n'a pas changé).
// WebKit n'adresse aucun geste quand le focus n'est pas dans un champ où l'on écrit : rien ne bouge. Chromium, Firefox et WebKit réels, développement
// et production : de vraies touches.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, type Build, type Construction } from './helpers/editeur-riche.js'

const PAGE = `<form class="f" @noUJS>
  <label>Titre <input class="titre" name="titre"></label>
  <@@editor class="e1" name="a" value="<p>Alpha</p>"></@@editor>
  <@@editor class="e2" name="b" value="<p>Beta</p>"></@@editor>
  <button class="pb" type="button">Page</button>
  <x-bouton></x-bouton>
</form>
`

const LEGER = `<form class="f" @noUJS>
  <label>Titre <input class="titre" name="titre"></label>
  <@@editor class="e1" name="a" value="<p>Alpha</p>" @lightDom></@@editor>
  <@@editor class="e2" name="b" value="<p>Beta</p>"></@@editor>
  <button class="pb" type="button">Page</button>
</form>
`

// un composant tiers : un bouton et une case dans une ombre fermée, que la page ne voit pas
const TIERS = `(() => {
  window.__fermes = new WeakMap()
  customElements.define('x-bouton', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<button class="xb" type="button">B</button><input type="checkbox" class="xc" aria-label="c">'; window.__fermes.set(this, r) } })
})()`

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed  = (c) => __q('.' + c)
  window.__sf  = (c) => (__ed(c)._shadow || __ed(c)).querySelector('.surface')
  window.__val = (c) => { const i = __ed(c).querySelector(':scope > input[type=hidden]'); return i ? i.value : null }
  window.__tiers = (s) => window.__fermes.get(__q('x-bouton')).querySelector(s)
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
  window.__etat = () => [__q('.titre').value, __val('e1'), __val('e2')].join(' | ')
  // les \`input\` qui sortent de l'hôte (les éditeurs y vivent) vers un écouteur du document, posé à la capture comme le ferait un script de la page
  window.__sortis = []
  document.addEventListener('input', (e) => { if (e.composedPath().includes(document.querySelector('mjs-hote'))) __sortis.push(e.inputType || e.constructor.name) }, true)
})()`

const PRET = `(() => {
  const h  = document.querySelector('mjs-hote')
  const ok = (c) => { const e = h && h._shadow && h._shadow.querySelector('.' + c); return !!(e && (e._shadow || e).querySelector('.surface') && e.querySelector(':scope > input[type=hidden]')) }
  return ok('e1') && ok('e2') && !!window.__fermes
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

function suite(build: Build, nom: 'chromium' | 'firefox' | 'webkit', source: string, cle: string, titre: string, essais: (ctx: { page: () => any, erreurs: string[], geste: boolean, nom: string }) => void) {
  describe(`<@@editor> : ${titre} (${nom} réel, ${build === 'dev' ? 'développement' : 'production'})`, function () {
    this.timeout(180000)
    let present = false
    let browser: any
    let page: any
    const erreurs: string[] = []

    before(async () => {
      try {
        const playwright = await import('playwright')
        present = existsSync(playwright[nom].executablePath())
        if (!present) return
        const fait = await construire(build, source, cle)
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

    // WebKit n'adresse aucun geste de défaire quand le focus n'est pas dans un champ où l'on écrit
    essais({ page: () => page, erreurs, geste: nom !== 'webkit', nom })
  })
}

for (const build of ['dev', 'prod'] as Build[]) for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  suite(build, nom, PAGE, 'editeur-annulation-depuis-la-page', 'Ctrl+Z et Ctrl+Maj+Z depuis la page, deux éditeurs à ombre', ({ page, erreurs, geste, nom }) => {
    for (const [quoi, sel] of [['le bouton', '.xb'], ['la case', '.xc']]) it(`le focus sur ${quoi} d'un composant tiers à ombre fermée : Ctrl+Z défait l'éditeur qui a reçu la dernière frappe, le focus en place`, async function () {
      const p = page()
      await p.evaluate(`__auTitre()`)
      await taper(p, 'T')
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' a1')
      await p.evaluate(`__tiers('${sel}').focus()`)
      await pause(p)
      await touche(p, 'Control+z')
      assert.equal(await p.evaluate(`__etat()`), geste ? 'T | <p>Alpha</p> | <p>Beta</p>' : 'T | <p>Alpha a1</p> | <p>Beta</p>', 'e1 défait, le titre plus ancien intact')
      assert.equal(await p.evaluate(`window.__fermes.get(__q('x-bouton')).activeElement === __tiers('${sel}')`), true, 'le focus reste dans le composant tiers')
      assert.deepEqual(erreurs, [])
    })

    it('frappes dans e1, puis dans le titre, puis dans e2, focus sur un bouton : Ctrl+Z défait e2, puis rend le titre au navigateur, puis défait e1', async function () {
      const p = page()
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' a1')
      await p.evaluate(`__auTitre()`)
      await taper(p, 'T')
      await p.evaluate(`__fin('e2')`)
      await taper(p, ' b2')
      await p.evaluate(`__q('.pb').focus()`)
      await pause(p)
      // Chromium défait le titre ; Firefox ne défait pas un champ de texte depuis un bouton : rien ne bouge, la saisie du titre a eu son tour
      const titre    = nom === 'chromium' ? '' : 'T'
      const attendus = geste ? ['T | <p>Alpha a1</p> | <p>Beta</p>', titre + ' | <p>Alpha a1</p> | <p>Beta</p>', titre + ' | <p>Alpha</p> | <p>Beta</p>'] : Array(3).fill('T | <p>Alpha a1</p> | <p>Beta b2</p>')
      for (const [i, attendu] of attendus.entries()) {
        await touche(p, 'Control+z')
        assert.equal(await p.evaluate(`__etat()`), attendu, 'Ctrl+Z nº ' + (i + 1))
        assert.equal(await p.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
      }
      assert.deepEqual(erreurs, [])
    })

    for (const k of ['Control+Shift+z', 'Control+y']) it(`deux éditeurs défaits depuis un bouton : ${k.replace('Control', 'Ctrl').replace('Shift', 'Maj')} refait e1, puis e2`, async function () {
      const p = page()
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' a1')
      await p.evaluate(`__fin('e2')`)
      await taper(p, ' b2')
      await p.evaluate(`__q('.pb').focus()`)
      await pause(p)
      await touche(p, 'Control+z')
      await touche(p, 'Control+z')
      assert.equal(await p.evaluate(`__etat()`), geste ? ' | <p>Alpha</p> | <p>Beta</p>' : ' | <p>Alpha a1</p> | <p>Beta b2</p>', 'e2 puis e1 défaits')
      await touche(p, k)
      assert.equal(await p.evaluate(`__etat()`), geste ? ' | <p>Alpha a1</p> | <p>Beta</p>' : ' | <p>Alpha a1</p> | <p>Beta b2</p>', 'le 1er refait e1, défait en dernier')
      await touche(p, k)
      assert.equal(await p.evaluate(`__etat()`), ' | <p>Alpha a1</p> | <p>Beta b2</p>', 'le 2e refait e2')
      assert.equal(await p.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
      assert.deepEqual(erreurs, [])
    })

    it('focus dans une zone contenteditable de la page : Ctrl+Z défait la zone, et aucun input ne sort de l\'éditeur vers un écouteur de la page', async function () {
      const p = page()
      await p.evaluate(`document.body.insertAdjacentHTML('afterbegin', '<div class="ce" contenteditable="true">page</div>')`)
      const auCe = `(() => { const ce = document.querySelector('.ce'); ce.focus(); const s = document.getSelection(); s.selectAllChildren(ce); s.collapseToEnd() })()`
      await p.evaluate(auCe)
      await taper(p, ' abc')
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' xyz')
      await p.evaluate(auCe)
      await pause(p)
      await p.evaluate(`__sortis.length = 0`)
      await touche(p, 'Control+z')
      assert.equal(await p.evaluate(`document.querySelector('.ce').textContent`), 'page', 'la zone de la page est défaite')
      assert.equal(await p.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', 'l\'éditeur garde sa frappe')
      assert.deepEqual(await p.evaluate(`__sortis`), [], 'aucun input venu de l\'éditeur')
      assert.deepEqual(erreurs, [])
    })
  })

  suite(build, nom, LEGER, 'editeur-annulation-depuis-la-page-leger', 'Ctrl+Z depuis la page avec un éditeur sans ombre (@lightDom)', ({ page, erreurs, geste, nom }) => {
    it('frappes dans e1 (sans ombre) puis dans e2, focus sur un bouton : Ctrl+Z défait e2, puis e1', async function () {
      const p = page()
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' a1')
      await p.evaluate(`__fin('e2')`)
      await taper(p, ' b2')
      await p.evaluate(`__q('.pb').focus()`)
      await pause(p)
      const attendus = geste ? [' | <p>Alpha a1</p> | <p>Beta</p>', ' | <p>Alpha</p> | <p>Beta</p>'] : Array(2).fill(' | <p>Alpha a1</p> | <p>Beta b2</p>')
      for (const [i, attendu] of attendus.entries()) {
        await touche(p, 'Control+z')
        assert.equal(await p.evaluate(`__etat()`), attendu, 'Ctrl+Z nº ' + (i + 1))
        assert.equal(await p.evaluate(`__focus() === __q('.pb')`), true, 'le focus reste sur le bouton')
      }
      assert.deepEqual(erreurs, [])
    })

    it('frappes dans e1 (sans ombre), dans le titre, puis dans e2, focus sur un bouton : Ctrl+Z défait e2, puis rend le titre au navigateur, puis défait e1', async function () {
      const p = page()
      await p.evaluate(`__fin('e1')`)
      await taper(p, ' a1')
      await p.evaluate(`__auTitre()`)
      await taper(p, 'T')
      await p.evaluate(`__fin('e2')`)
      await taper(p, ' b2')
      await p.evaluate(`__q('.pb').focus()`)
      await pause(p)
      const titre = nom === 'chromium' ? '' : 'T'
      const attendus = geste ? ['T | <p>Alpha a1</p> | <p>Beta</p>', titre + ' | <p>Alpha a1</p> | <p>Beta</p>', titre + ' | <p>Alpha</p> | <p>Beta</p>'] : Array(3).fill('T | <p>Alpha a1</p> | <p>Beta b2</p>')
      for (const [i, attendu] of attendus.entries()) {
        await touche(p, 'Control+z')
        assert.equal(await p.evaluate(`__etat()`), attendu, 'Ctrl+Z nº ' + (i + 1))
      }
      assert.deepEqual(erreurs, [])
    })
  })
}
