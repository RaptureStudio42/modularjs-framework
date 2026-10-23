// <@@editor> : refaire (Ctrl+Maj+Z, Ctrl+Y, Cmd+Maj+Z) quand le focus n'est pas dans la zone d'édition, après un Ctrl+Z que l'éditeur a pris par
// sa propre pile (le navigateur le lui adresse, voir core-editeur-annulation-focus-hors-de-la-zone-browser.test.ts).
// - Focus sur un bouton de la barre de l'éditeur, ou sur un lien d'un éditeur en lecture seule : le navigateur n'a rien à refaire, son geste de
//   défaire ayant été refusé ; le même geste de refaire, avec le même focus, refait l'éditeur par sa pile, le focus reste où il est et le titre
//   garde sa frappe. WebKit n'adresse aucun geste de défaire quand le focus n'est pas dans un champ où l'on écrit : rien ne bouge, ni pour
//   défaire ni pour refaire.
// - Une saisie ailleurs dans la page après le Ctrl+Z (une étape nouvelle, qui vide la pile à refaire du navigateur) : le geste de refaire, le
//   focus revenu sur le bouton, ne refait plus rien ; avec le focus dans un champ où l'on écrit, le geste reste à ce champ. Le bouton
//   « refaire » de la barre refait toujours l'éditeur.
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
})()`

const PRET = `(() => {
  const h  = document.querySelector('mjs-hote')
  const e1 = h && h._shadow && h._shadow.querySelector('.e1')
  const e3 = h && h._shadow && h._shadow.querySelector('.e3')
  const b  = e1 && e1._shadow && e1._shadow.querySelector('mjs-core-toolbar')
  return !!(b && b._shadow && b._shadow.querySelector('[data-tool="bold"]') && b._shadow.querySelector('[data-tool="redo"]') && e1.querySelector(':scope > input[type=hidden]') && e3 && e3._shadow && e3._shadow.querySelector('.surface a'))
})()`

// les trois gestes de refaire : Ctrl+Maj+Z, Ctrl+Y, et Cmd+Maj+Z, celui du Mac
const REFAIRE = ['Control+Shift+z', 'Control+y', 'Meta+Shift+z']

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

// une frappe dans le titre, puis une dans l'éditeur : l'étape de l'éditeur est la dernière
async function frappes(page: any) {
  await page.evaluate(`__auTitre()`)
  await taper(page, 'Mon titre')
  await page.evaluate(`__fin('e1')`)
  await taper(page, ' xyz')
}

for (const build of ['dev', 'prod'] as Build[]) for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> : refaire avec le focus hors de la zone d'édition (${nom} réel, ${build === 'dev' ? 'développement' : 'production'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  // WebKit n'adresse aucun geste de défaire quand le focus n'est pas dans un champ où l'on écrit
  const geste  = nom !== 'webkit'
  const defait = geste ? '<p>Alpha</p>' : '<p>Alpha xyz</p>'

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire(build, PAGE, 'editeur-refaire-hors-zone')
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

  it('focus sur un bouton de la barre de l\'éditeur : Ctrl+Maj+Z, Ctrl+Y et Cmd+Maj+Z refont par la pile de l\'éditeur ce que Ctrl+Z a défait, le focus reste sur le bouton', async function () {
    await frappes(page)
    await page.evaluate(`__btn('e1', 'bold').focus()`)
    await pause(page)
    for (const k of REFAIRE) {
      await touche(page, 'Control+z')
      assert.equal(await page.evaluate(`__val('e1')`), defait, geste ? 'Ctrl+Z défait la frappe de l\'éditeur' : 'rien ne bouge')
      await touche(page, k)
      assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', geste ? k + ' refait la frappe de l\'éditeur' : 'rien ne bouge')
      assert.equal(await page.evaluate(`__focus() === __btn('e1', 'bold')`), true, 'le focus reste sur le bouton (' + k + ')')
      assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre', 'le titre garde sa frappe')
    }
    await touche(page, 'Control+Shift+z')
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', 'plus rien à refaire : rien ne bouge')
    assert.deepEqual(erreurs, [])
  })

  it('focus sur un lien d\'un éditeur en lecture seule : le geste de refaire refait l\'éditeur qui a défait sa frappe, le focus reste sur le lien', async function () {
    await frappes(page)
    await page.evaluate(`__lien().focus()`)
    await pause(page)
    assert.equal(await page.evaluate(`__focus() === __lien()`), true)
    for (const k of REFAIRE) {
      await touche(page, 'Control+z')
      assert.equal(await page.evaluate(`__val('e1')`), defait, geste ? 'Ctrl+Z défait la frappe de l\'éditeur' : 'rien ne bouge')
      await touche(page, k)
      assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', geste ? k + ' refait la frappe de l\'éditeur' : 'rien ne bouge')
      assert.equal(await page.evaluate(`__focus() === __lien()`), true, 'le focus reste sur le lien (' + k + ')')
      assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre', 'le titre garde sa frappe')
    }
    assert.equal(await page.evaluate(`__sf('e3').textContent`), 'Lecture lien fin')
    assert.deepEqual(erreurs, [])
  })

  it('une saisie dans le titre après le Ctrl+Z : le geste de refaire, revenu sur le bouton, ne refait plus rien ; dans le titre, il reste au titre ; le bouton « refaire » refait l\'éditeur', async function () {
    await frappes(page)
    await page.evaluate(`__btn('e1', 'bold').focus()`)
    await pause(page)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__val('e1')`), defait)
    await page.evaluate(`__auTitre()`)
    await pause(page)
    await touche(page, 'Control+Shift+z')
    assert.equal(await page.evaluate(`__val('e1')`), defait, 'le focus dans le titre : le geste reste au titre')
    assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre')
    await taper(page, ' bis')
    await page.evaluate(`__btn('e1', 'bold').focus()`)
    await pause(page)
    await touche(page, 'Control+Shift+z')
    assert.equal(await page.evaluate(`__val('e1')`), defait, 'une saisie ailleurs vide la pile à refaire du navigateur : le geste ne refait plus l\'éditeur')
    assert.equal(await page.evaluate(`__q('.titre').value`), 'Mon titre bis')
    assert.equal(await page.evaluate(`__focus() === __btn('e1', 'bold')`), true)
    await page.evaluate(`__btn('e1', 'redo').click()`)
    await pause(page, 400)
    assert.equal(await page.evaluate(`__val('e1')`), '<p>Alpha xyz</p>', 'le bouton « refaire » de la barre refait l\'éditeur')
    assert.deepEqual(erreurs, [])
  })
})
