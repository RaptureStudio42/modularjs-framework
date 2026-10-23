// <@@editor> à côté d'un champ natif, et la saisie par composition (méthode de saisie).
// - Un titre (<input>) et un éditeur dans le même formulaire : le Ctrl+Z du titre défait le titre au premier coup, que l'éditeur ait reçu la
//   dernière frappe ou qu'il vienne de défaire la sienne par sa propre pile, et Ctrl+Maj+Z le refait ; pendant ce temps la zone de l'éditeur n'est
//   jamais touchée (aucune mutation : le navigateur ne défait rien dans l'éditeur, même pour un instant) et sa valeur reste. Avec deux éditeurs, le
//   titre se défait aussi au premier coup. Ctrl+Z dans l'éditeur ne défait que lui.
//   Chromium et WebKit adressent ce geste à l'éditeur dont une étape est en tête de leur pile commune, même quand le focus est dans le titre ;
//   Firefox donne sa propre pile à chaque champ natif. Le geste rendu au titre ne retire et ne remet chaque éditeur qu'une fois, ne change pas
//   le défilement d'un éditeur qui n'a pas le focus, et un script de la page qui défait (execCommand) laisse le focus dans l'éditeur qui l'a.
// - Une composition (« nihon » → 日本) est une seule étape, comme une frappe continue : un Ctrl+Z la défait entière (jamais « にほ », « に »…),
//   Ctrl+Maj+Z la refait entière. Composition réelle par le protocole de Chromium (Input.imeSetComposition) : Chromium seul, Firefox et WebKit
//   n'offrent aucun moyen de jouer une méthode de saisie.
// Chromium, Firefox et WebKit réels, développement et production : de vraies touches.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, type Build, type Construction } from './helpers/editeur-riche.js'

const PAGE = `<form class="f" @noUJS>
  <label>Titre <input class="titre" name="titre"></label>
  <@@editor class="ea" name="a" value="<p>Alpha</p>" toolbar="none"></@@editor>
  <@@editor class="eb" name="b" value="<p>Beta</p>" toolbar="none"></@@editor>
  <@@editor class="ec" name="c" value="${Array.from({ length: 40 }, (_, i) => '<p>ligne ' + i + '</p>').join('')}" toolbar="none"></@@editor>
</form>
`

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed  = (c) => __q('.' + c)
  window.__sf  = (c) => __ed(c)._shadow.querySelector('.surface')
  window.__val = (c) => { const i = __ed(c).querySelector(':scope > input[type=hidden]'); return i ? i.value : null }
  window.__titre = () => __q('.titre').value
  window.__auFocus = () => document.querySelector('mjs-hote')._shadow.activeElement === __q('.titre')
  window.__fin = (c) => {
    const sf = __sf(c); sf.focus()
    const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
    let n, last
    while ((n = w.nextNode())) last = n
    if (last) document.getSelection().setBaseAndExtent(last, last.length, last, last.length)
  }
  // le focus dans le titre, le curseur au bout
  window.__auTitre = () => { const t = __q('.titre'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) }
  // les mutations de la zone d'un éditeur (texte, nœuds), comptées à partir d'ici
  window.__mut = {}
  window.__guetter = (c) => { __mut[c] = 0; new MutationObserver((l) => { __mut[c] += l.length }).observe(__sf(c), { childList: true, subtree: true, characterData: true }) }
  // les retraits des éditeurs (un par geste rendu au champ du focus), comptés à partir d'ici
  window.__retraits = 0
  document.addEventListener('mjs-editor-unstick', () => { __retraits++ })
  // la zone de l'éditeur a-t-elle le focus ?
  window.__dans = (c) => __ed(c)._shadow.activeElement === __sf(c)
})()`

// la page (le cœur, les libellés du manifeste, les modules, l'hôte) construite une fois par mode pour les trois navigateurs : en développement un
// script, en production les morceaux du build
const construction = (build: Build) => construire(build, PAGE, 'editeur-champ-natif')

function ouvrir(nom: string, playwright: any) {
  return playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
}

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
  await page.waitForFunction(`(() => {
    const h = document.querySelector('mjs-hote')
    const pret = (c) => { const e = h && h._shadow && h._shadow.querySelector('.' + c); return !!(e && e._shadow && e._shadow.querySelector('.surface') && e.querySelector(':scope > input[type=hidden]')) }
    return pret('ea') && pret('eb') && pret('ec')
  })()`, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 150) => page.waitForTimeout(ms)

async function touche(page: any, k: string) {
  await page.keyboard.press(k)
  await pause(page)
}

async function taper(page: any, texte: string) {
  await page.keyboard.type(texte)
  await pause(page)
}

const MODE = { dev: 'développement', prod: 'production' }

for (const build of ['dev', 'prod'] as Build[]) for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> à côté d'un champ natif : chacun sa pile d'annulation (${nom} réel, ${MODE[build]})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  const etat = () => page.evaluate(`[__titre(), __val('ea'), __val('eb')]`)

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construction(build)
      browser = await ouvrir(nom, playwright)
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

  it('titre puis corps : Ctrl+Z dans l\'éditeur ne défait que lui ; Ctrl+Z dans le titre défait le titre au premier coup, Ctrl+Maj+Z le refait, la zone n\'est jamais touchée', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'Mon titre')
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' et le corps')
    assert.deepEqual(await etat(), ['Mon titre', '<p>Alpha et le corps</p>', '<p>Beta</p>'])
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['Mon titre', '<p>Alpha</p>', '<p>Beta</p>'], 'Ctrl+Z dans l\'éditeur défait sa frappe, et rien d\'autre')
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['Mon titre', '<p>Alpha</p>', '<p>Beta</p>'], 'l\'éditeur n\'a plus rien à défaire : le titre reste')
    await page.evaluate(`__guetter('ea'); __guetter('eb'); __auTitre()`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alpha</p>', '<p>Beta</p>'], 'le premier Ctrl+Z du titre défait le titre')
    assert.equal(await page.evaluate(`__auFocus()`), true, 'le focus reste dans le titre')
    await touche(page, 'Control+Shift+z')
    assert.deepEqual(await etat(), ['Mon titre', '<p>Alpha</p>', '<p>Beta</p>'], 'Ctrl+Maj+Z refait le titre')
    assert.deepEqual(await page.evaluate(`__mut`), { ea: 0, eb: 0 }, 'le navigateur n\'a rien défait dans les éditeurs, même pour un instant')
    assert.equal(await page.evaluate(`__sf('ea').textContent`), 'Alpha')
    assert.deepEqual(erreurs, [])
  })

  it('l\'éditeur a reçu la dernière frappe : le Ctrl+Z du titre ne défait que la dernière étape du titre, puis la précédente, sans toucher l\'éditeur', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'abc')
    await touche(page, 'Home')
    await taper(page, 'Z')
    await page.evaluate(`__fin('ea')`)
    await taper(page, 'xyz')
    assert.deepEqual(await etat(), ['Zabc', '<p>Alphaxyz</p>', '<p>Beta</p>'])
    await page.evaluate(`__guetter('ea'); __auTitre()`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['abc', '<p>Alphaxyz</p>', '<p>Beta</p>'], 'le premier Ctrl+Z défait la dernière étape du titre, une seule')
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alphaxyz</p>', '<p>Beta</p>'], 'le second, l\'étape d\'avant')
    assert.deepEqual(await page.evaluate(`__mut`), { ea: 0 }, 'la zone de l\'éditeur n\'est jamais touchée')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alpha</p>', '<p>Beta</p>'], 'l\'éditeur défait toujours sa frappe par sa pile')
    assert.deepEqual(erreurs, [])
  })

  it('deux éditeurs après le titre : le premier Ctrl+Z du titre le défait, les deux éditeurs gardent leur frappe, chaque éditeur n\'est retiré et remis qu\'une fois', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'Mon titre')
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    await page.evaluate(`__fin('eb')`)
    await taper(page, ' deux')
    await page.evaluate(`__guetter('ea'); __guetter('eb'); __auTitre(); __retraits = 0`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alpha un</p>', '<p>Beta deux</p>'], 'le titre se défait au premier coup')
    assert.ok(await page.evaluate(`__retraits`) <= 1, 'un seul retrait des éditeurs pour le geste, quel que soit le nombre d\'éditeurs qui ont une étape')
    assert.equal(await page.evaluate(`__auFocus()`), true, 'le focus reste dans le titre')
    assert.deepEqual(await page.evaluate(`__mut`), { ea: 0, eb: 0 }, 'aucune zone d\'éditeur n\'est touchée')
    assert.deepEqual(await page.evaluate(`[__sf('ea').textContent, __sf('eb').textContent]`), ['Alpha un', 'Beta deux'])
    await page.evaluate(`__fin('eb')`)
    await touche(page, 'Control+z')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alpha</p>', '<p>Beta</p>'], 'chaque éditeur défait encore sa frappe par sa pile')
    assert.deepEqual(erreurs, [])
  })

  it('le geste du titre rendu à son champ ne change pas le défilement d\'un éditeur qui n\'a pas le focus', async function () {
    await page.evaluate(`__auTitre()`)
    await taper(page, 'Mon titre')
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    await page.evaluate(`__sf('ec').scrollTop = 300`)
    await pause(page)
    const avant = await page.evaluate(`__sf('ec').scrollTop`)
    assert.ok(avant > 200, 'la zone du troisième éditeur défile')
    await page.evaluate(`__auTitre()`)
    await touche(page, 'Control+z')
    assert.deepEqual(await etat(), ['', '<p>Alpha un</p>', '<p>Beta</p>'], 'le titre se défait')
    assert.equal(await page.evaluate(`__sf('ec').scrollTop`), avant, 'le troisième éditeur garde son défilement')
    assert.deepEqual(erreurs, [])
  })

  it('un script de la page qui défait (execCommand) pendant que le focus est dans un éditeur : l\'autre éditeur garde sa frappe, le focus reste où il est', async function () {
    await page.evaluate(`__fin('eb')`)
    await taper(page, ' deux')
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    await page.evaluate(`__fin('eb')`)
    await pause(page)
    await page.evaluate(`document.execCommand('undo')`)
    await pause(page, 400)
    assert.equal(await page.evaluate(`__val('ea')`), '<p>Alpha un</p>', 'l\'éditeur sans le focus garde sa frappe')
    // Chromium défait sans rien annoncer avant l'étape en tête de sa pile, celle de l'autre éditeur, et y pose la sélection : son texte revient
    if (nom !== 'chromium') assert.equal(await page.evaluate(`__dans('eb')`), true, 'le focus reste dans l\'éditeur qui l\'avait')
    assert.deepEqual(erreurs, [])
  })
})

for (const build of ['dev', 'prod'] as Build[]) describe(`<@@editor> : une composition (méthode de saisie) est une seule étape (chromium réel, Input.imeSetComposition, ${MODE[build]})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let cdp: any
  const erreurs: string[] = []
  const val = () => page.evaluate(`__val('ea')`)

  // « nihon » tapé à la romaine : le texte provisoire change à chaque touche, puis la conversion 日本 est validée
  async function composer() {
    for (const t of ['n', 'に', 'にh', 'にほ', 'にほn', 'にほん']) {
      await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length })
      await page.waitForTimeout(60)
    }
    await cdp.send('Input.insertText', { text: '日本' })
    await pause(page)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright.chromium.executablePath())
      if (!present) return
      const fait = await construction(build)
      browser = await ouvrir('chromium', playwright)
      page    = await nouvellePage(browser, fait, erreurs)
      cdp     = await page.context().newCDPSession(page)
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

  it('composée à la suite d\'une frappe : un Ctrl+Z défait la frappe et la composition entières, Ctrl+Maj+Z les refait', async function () {
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' ')
    await composer()
    assert.equal(await val(), '<p>Alpha 日本</p>')
    await touche(page, 'Control+z')
    assert.equal(await val(), '<p>Alpha</p>', 'un seul Ctrl+Z, aucun état de la composition en cours')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val(), '<p>Alpha 日本</p>', 'refaite entière')
    assert.deepEqual(erreurs, [])
  })

  it('composée seule : un Ctrl+Z la défait entière, le suivant ne défait plus rien', async function () {
    await page.evaluate(`__fin('ea')`)
    await composer()
    assert.equal(await val(), '<p>Alpha日本</p>')
    await touche(page, 'Control+z')
    assert.equal(await val(), '<p>Alpha</p>', 'un seul Ctrl+Z, jamais « にほん », « に » ni « n »')
    await touche(page, 'Control+z')
    assert.equal(await val(), '<p>Alpha</p>')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val(), '<p>Alpha日本</p>')
    assert.deepEqual(erreurs, [])
  })
})
