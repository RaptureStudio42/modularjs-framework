// <@@editor> : Ctrl+Z quand le focus n'est pas dans la zone d'édition, après une frappe dans un titre puis dans l'éditeur.
// - Focus sur un bouton de la barre de l'éditeur, ou sur un lien d'un éditeur en lecture seule : Chromium et Firefox adressent le geste à
//   l'éditeur qui a la dernière frappe, qui la défait par sa propre pile ; le focus reste où il est et le titre garde sa frappe. WebKit
//   n'adresse aucun geste quand le focus n'est pas dans un champ où l'on écrit : rien ne bouge.
// - Une zone éditable de la page (contenteditable) à côté de l'éditeur : Ctrl+Z y défait sa frappe au premier coup, même quand l'éditeur a
//   reçu une frappe après elle, et Ctrl+Maj+Z la refait ; l'éditeur garde sa frappe. Firefox adresse ce geste à la zone de la sélection
//   mais défait l'étape en tête de sa pile commune (celle de l'éditeur) ; Chromium et WebKit l'adressent à l'éditeur.
// Chromium, Firefox et WebKit réels, développement et production : de vraies touches.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, type Build, type Construction } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $c = '<p>Lecture <a href="https://exemple.fr/l">lien</a> fin</p>'
</script>

<form class="f" @noUJS>
  <label>Titre <input class="titre" name="titre"></label>
  <@@editor class="e1" name="a" value="<p>Alpha</p>"></@@editor>
  <@@editor class="e3" name="c" readonly value={$c}></@@editor>
</form>
`

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed  = (c) => __q('.' + c)
  window.__sf  = (c) => __ed(c)._shadow.querySelector('.surface')
  window.__val = (c) => { const i = __ed(c).querySelector(':scope > input[type=hidden]'); return i ? i.value : null }
  window.__btn = (c, t) => __ed(c)._shadow.querySelector('mjs-core-toolbar')._shadow.querySelector('[data-tool="' + t + '"]')
  window.__lien = () => __sf('e3').querySelector('a')
  window.__ce = () => document.querySelector('.ce')
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
  window.__auCe = () => { const c = __ce(); c.focus(); const s = document.getSelection(); s.selectAllChildren(c); s.collapseToEnd() }
})()`

const PRET = `(() => {
  const h  = document.querySelector('mjs-hote')
  const e1 = h && h._shadow && h._shadow.querySelector('.e1')
  const e3 = h && h._shadow && h._shadow.querySelector('.e3')
  const b  = e1 && e1._shadow && e1._shadow.querySelector('mjs-core-toolbar')
  return !!(b && b._shadow && b._shadow.querySelector('[data-tool="bold"]') && e1.querySelector(':scope > input[type=hidden]') && e3 && e3._shadow && e3._shadow.querySelector('.surface a'))
})()`

async function nouvellePage(browser: any, fait: Construction, erreurs: string[]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } })
  await page.addInitScript('window.__name = (f) => f;')
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

for (const build of ['dev', 'prod'] as Build[]) for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> : Ctrl+Z avec le focus hors de la zone d'édition (${nom} réel, ${build === 'dev' ? 'développement' : 'production'})`, function () {
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
      const fait = await construire(build, PAGE, 'editeur-annulation-hors-zone')
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

  it('focus sur un bouton de la barre de l\'éditeur : l\'éditeur défait sa frappe, le focus reste sur le bouton, le titre garde la sienne', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'Mon titre')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' xyz')
    await page.evaluate(`__btn('e1', 'bold').focus()`)
    await pause(page)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre', 'le titre n\'est pas défait')
    assert.equal(await page.evaluate(`__val('e1')`), geste ? '<p>Alpha</p>' : '<p>Alpha xyz</p>', geste ? 'l\'éditeur défait sa frappe' : 'rien ne bouge')
    assert.equal(await page.evaluate(`__focus() === __btn('e1', 'bold')`), true, 'le focus reste sur le bouton')
    assert.deepEqual(erreurs, [])
  })

  it('focus sur un lien d\'un éditeur en lecture seule : l\'éditeur qui a la dernière frappe la défait, le focus reste sur le lien, le titre garde la sienne', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'Mon titre')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' xyz')
    await page.evaluate(`__lien().focus()`)
    await pause(page)
    assert.equal(await page.evaluate(`__focus() === __lien()`), true)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre', 'le titre n\'est pas défait')
    assert.equal(await page.evaluate(`__val('e1')`), geste ? '<p>Alpha</p>' : '<p>Alpha xyz</p>', geste ? 'l\'éditeur défait sa frappe' : 'rien ne bouge')
    assert.equal(await page.evaluate(`__focus() === __lien()`), true, 'le focus reste sur le lien')
    assert.equal(await page.evaluate(`__sf('e3').textContent`), 'Lecture lien fin')
    assert.deepEqual(erreurs, [])
  })

  it('une zone éditable de la page : Ctrl+Z y défait sa frappe au premier coup même quand l\'éditeur a reçu une frappe après elle, Ctrl+Maj+Z la refait, l\'éditeur garde la sienne', async function () {
    await page.evaluate(`document.body.insertAdjacentHTML('afterbegin', '<div class="ce" contenteditable="true">page</div>')`)
    await page.evaluate(`__auCe()`)
    await taper(page, ' abc')
    await page.evaluate(`__fin('e1')`)
    await taper(page, ' xyz')
    await page.evaluate(`__auCe()`)
    await pause(page)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__ce().textContent`), 'page', 'le premier Ctrl+Z défait la frappe de la zone de la page')
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', 'l\'éditeur garde sa frappe')
    assert.equal(await page.evaluate(`__focus() === __ce()`), true, 'le focus reste dans la zone de la page')
    await touche(page, 'Control+Shift+z')
    assert.equal(await page.evaluate(`__ce().textContent`), 'page abc', 'Ctrl+Maj+Z la refait')
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>')
    await page.evaluate(`__fin('e1')`)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha</p>', 'l\'éditeur défait toujours sa frappe par sa pile')
    assert.deepEqual(erreurs, [])
  })
})
