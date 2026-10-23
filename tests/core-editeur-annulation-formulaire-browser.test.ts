// <@@editor> a sa propre pile d'annulation, et il est un élément du formulaire.
// - Deux éditeurs sur la même page : la frappe dans A, Ctrl+Z dans B (ou le bouton « défaire » de B, ou un `execCommand('undo')` de la page
//   pendant que B a le focus) ne touche pas A ; le bouton de B reste grisé tant que B n'a rien à défaire ; défaire et refaire dans A au clavier
//   (Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y) et par les boutons de SA barre, grisés quand il n'y a rien à défaire ou à refaire.
// - Les étapes : une frappe continue en est une, un curseur déplacé, Entrée ou l'effacement en ouvrent une autre ; une mise en forme (même faite
//   de plusieurs commandes, comme « effacer la mise en forme ») et un collage en font une chacun, la sélection revient avec le texte ; la pile
//   garde au plus 100 étapes ; défaire ne décoche pas une case.
// - `form.reset()` ramène le contenu de départ et vide la pile.
// - `required` : un contenu vide (après nettoyage des balises vides) manque — checkValidity(), reportValidity() et la bulle sur la zone
//   d'édition, :invalid / :valid, le message du navigateur pour une zone de texte native, l'envoi bloqué puis permis.
// - `<label for>` donne le focus à la zone d'édition ; `<fieldset disabled>` rend l'éditeur non modifiable (sa balise porte :disabled, sa
//   validité ne compte plus, rien n'est envoyé) et le lui rend.
// Ce qui ne change pas : les paires envoyées (une par éditeur, le HTML propre), l'éditeur hors formulaire, les rôles et `aria-*` de la zone, et
// un navigateur sans attachInternals (repli : required sans effet, aucune étiquette ne vise l'éditeur, la pile propre à chaque éditeur reste).
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $a = '<p>Alpha</p>'
  $b = '<p>Beta</p>'
  $l = '<ul data-checklist><li>Un</li><li>Deux</li></ul>'
  $r = ''
  $h = '<p>Hors</p>'

  µmount ->
    window.__poserR = (v)-> $r = v
</script>

<form class="f-pile" method="get" action="/envoi" @noUJS>
  <@@editor class="ea" name="a" value=!{$a}></@@editor>
  <@@editor class="eb" name="b" value=!{$b}></@@editor>
  <@@editor class="el" name="l" toolbar="none" value=!{$l}></@@editor>
</form>

<form class="f-oblig" method="get" action="/envoi" @noUJS>
  <@@editor class="er" id="er" name="r" required toolbar="none" value=!{$r}></@@editor>
  <label class="l-er" for="er">étiquette de l'éditeur</label>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-fieldset" method="get" action="/envoi" @noUJS>
  <fieldset class="fs" disabled>
    <@@editor class="ef" name="f" required></@@editor>
  </fieldset>
</form>

<div class="hors">
  <@@editor class="eh" name="h" required value=!{$h}></@@editor>
</div>

<textarea class="natif" required></textarea>
`

const EDITEURS = ['ea', 'eb', 'el', 'er', 'ef', 'eh']

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed  = (c) => __q('.' + c)
  window.__sf  = (c) => __ed(c)._shadow.querySelector('.surface')
  window.__btn = (c, t) => __ed(c)._shadow.querySelector('mjs-core-toolbar')._shadow.querySelector('[data-tool="' + t + '"]')
  window.__gris = (c) => ['undo', 'redo'].map((t) => __btn(c, t).getAttribute('aria-disabled'))
  window.__val = (c) => { const i = __ed(c).querySelector(':scope > input[type=hidden]'); return i ? i.value : null }
  window.__fd  = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__fin = (c) => {
    const sf = __sf(c); sf.focus()
    const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
    let n, last
    while ((n = w.nextNode())) last = n
    if (last) document.getSelection().setBaseAndExtent(last, last.length, last, last.length)
  }
  window.__selText = (c, txt) => {
    const sf = __sf(c); sf.focus()
    const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(txt); if (i >= 0) { document.getSelection().setBaseAndExtent(n, i, n, i + txt.length); return true } }
    return false
  }
  // le texte sélectionné dans la zone d'un éditeur (la sélection lue à travers son ombre)
  window.__choisi = (c) => {
    const sf = __sf(c), s = document.getSelection()
    let r
    if (s.getComposedRanges) { try { r = s.getComposedRanges({ shadowRoots: [sf.getRootNode()] })[0] } catch (e) { r = s.getComposedRanges(sf.getRootNode())[0] } }
    else r = s.rangeCount ? s.getRangeAt(0) : null
    if (!r) return null
    const rr = document.createRange()
    rr.setStart(r.startContainer, r.startOffset)
    rr.setEnd(r.endContainer, r.endOffset)
    return rr.toString()
  }
  window.__coller = (c, html, text) => {
    const dt = new DataTransfer()
    if (html) dt.setData('text/html', html)
    if (text) dt.setData('text/plain', text)
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    __sf(c).dispatchEvent(ev)
  }
  // l'élément qui a vraiment le focus, à travers les ombres
  window.__deep = () => { let a = document.activeElement; while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement; return a ? a.localName + '.' + a.classList[0] : 'rien' }
})()`

let construit: Promise<string> | null = null

// le script de la page (le cœur, les libellés du manifeste, les modules, l'hôte), construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('editeur-annulation')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const manifeste = join(root, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return assembler(outDir, manifeste)
  })()
  return construit
}

function ouvrir(nom: string, playwright: any) {
  return playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
}

// une page servie sous une adresse interceptée (un vrai envoi y navigue), le script chargé après la balise de l'hôte
async function nouvellePage(browser: any, script: string, envois: string[], erreurs: string[], avant = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } })
  await page.addInitScript('window.__name = (f) => f;' + avant)
  page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
  const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
  await page.route('http://editeur.test/**', async (route: any) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/envoi') {
      envois.push(url.pathname + url.search)
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
  })
  return page
}

async function charger(page: any) {
  await page.goto('http://editeur.test/page', { waitUntil: 'load' })
  await page.waitForFunction(`(() => {
    const h = document.querySelector('mjs-hote')
    const q = (c) => h && h._shadow && h._shadow.querySelector('.' + c)
    const pret = (c) => { const e = q(c); return !!(e && e._mjs_is_mounted && e._shadow && e._shadow.querySelector('.surface')) }
    const barre = (c) => { const b = q(c)._shadow.querySelector('mjs-core-toolbar'); return !!(b && b._shadow && b._shadow.querySelector('[data-tool="undo"]')) }
    return ${JSON.stringify(EDITEURS)}.every(pret) && barre('ea') && barre('eb')
  })()`, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 120) => page.waitForTimeout(ms)

async function touche(page: any, k: string) {
  await page.keyboard.press(k)
  await pause(page)
}

async function taper(page: any, texte: string) {
  await page.keyboard.type(texte)
  await pause(page)
}

// un vrai clic au centre d'un élément que donne l'expression (un bouton de barre, une étiquette)
async function cliquer(page: any, expr: string) {
  const { x, y } = await page.evaluate(`(() => {
    const el = ${expr}
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.mouse.click(x, y)
  await pause(page, 150)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> : une pile d'annulation par éditeur, et un élément du formulaire (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const envois: string[]  = []
  const erreurs: string[] = []
  const val = (c: string) => page.evaluate(`__val('${c}')`)

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const script = await construire()
      browser = await ouvrir(nom, playwright)
      page    = await nouvellePage(browser, script, envois, erreurs)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    envois.length  = 0
    erreurs.length = 0
    await charger(page)
  })

  it('deux éditeurs : la frappe dans A, Ctrl+Z dans B ne touche pas A, le bouton de B reste grisé ; A défait et refait au clavier et par ses boutons', async function () {
    assert.deepEqual(await page.evaluate(`[__gris('ea'), __gris('eb')]`), [['true', 'true'], ['true', 'true']], 'au départ, rien à défaire ni à refaire : boutons grisés')
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    assert.equal(await val('ea'), '<p>Alpha un</p>', 'préalable : la frappe dans A')
    assert.deepEqual(await page.evaluate(`[__gris('ea'), __gris('eb')]`), [['false', 'true'], ['true', 'true']], 'A peut défaire, B toujours rien')
    await page.evaluate(`__fin('eb')`)
    await touche(page, 'Control+z')
    assert.deepEqual([await val('ea'), await val('eb')], ['<p>Alpha un</p>', '<p>Beta</p>'], 'Ctrl+Z dans B ne touche pas A')
    await cliquer(page, `__btn('eb', 'undo')`)
    assert.deepEqual([await val('ea'), await val('eb')], ['<p>Alpha un</p>', '<p>Beta</p>'], 'le bouton « défaire » de B (grisé) ne touche pas A')
    await page.evaluate(`__fin('eb'); document.execCommand('undo')`)
    await pause(page)
    assert.deepEqual([await val('ea'), await val('eb')], ['<p>Alpha un</p>', '<p>Beta</p>'], 'la pile du navigateur ne touche pas A (execCommand de la page, focus dans B)')
    assert.equal(await page.evaluate(`__sf('ea').textContent`), 'Alpha un', 'la zone de A garde son texte')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'Ctrl+Z dans A défait sa frappe')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['true', 'false'], 'plus rien à défaire, de quoi refaire')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val('ea'), '<p>Alpha un</p>', 'Ctrl+Maj+Z refait')
    await touche(page, 'Control+z')
    await touche(page, 'Control+y')
    assert.equal(await val('ea'), '<p>Alpha un</p>', 'Ctrl+Y refait')
    await cliquer(page, `__btn('ea', 'undo')`)
    assert.equal(await val('ea'), '<p>Alpha</p>', 'le bouton « défaire » de A')
    await cliquer(page, `__btn('ea', 'redo')`)
    assert.equal(await val('ea'), '<p>Alpha un</p>', 'le bouton « refaire » de A')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['false', 'true'])
    await page.evaluate(`__fin('eb')`)
    await taper(page, ' deux')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    assert.deepEqual([await val('ea'), await val('eb')], ['<p>Alpha</p>', '<p>Beta deux</p>'], 'chacun sa pile : A défait la sienne, B garde sa frappe')
    await page.evaluate(`__fin('eb')`)
    await touche(page, 'Control+z')
    assert.deepEqual([await val('ea'), await val('eb')], ['<p>Alpha</p>', '<p>Beta</p>'])
    assert.deepEqual(erreurs, [])
  })

  it('les frappes se regroupent : une frappe continue est une étape ; un curseur déplacé, l\'effacement, Entrée en ouvrent une autre', async function () {
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' abc def')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'une frappe continue : une seule étape')
    await taper(page, ' abc')
    await touche(page, 'ArrowLeft')
    await taper(page, 'X')
    assert.equal(await val('ea'), '<p>Alpha abXc</p>')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha abc</p>', 'le curseur déplacé a ouvert une étape')
    assert.equal(await page.evaluate(`__choisi('ea')`), '', 'le curseur revient où il était, sans sélection')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>')
    await taper(page, ' abc')
    await touche(page, 'Backspace')
    await touche(page, 'Backspace')
    assert.equal(await val('ea'), '<p>Alpha a</p>')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha abc</p>', 'l\'effacement est une étape à part')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>')
    await taper(page, ' x')
    await touche(page, 'Enter')
    await taper(page, 'y')
    assert.equal(await val('ea'), '<p>Alpha x</p><p>y</p>')
    await touche(page, 'Control+z')
    assert.deepEqual([await val('ea'), await page.evaluate(`__sf('ea').children.length`)], ['<p>Alpha x</p>', 2], 'la frappe après Entrée part seule, la ligne reste')
    await touche(page, 'Control+z')
    assert.deepEqual([await val('ea'), await page.evaluate(`__sf('ea').children.length`)], ['<p>Alpha x</p>', 1], 'Entrée est une étape')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['true', 'false'], 'tout est défait')
    assert.deepEqual(erreurs, [])
  })

  it('une mise en forme et un collage se défont en une étape, la sélection revient avec le texte ; la pile garde au plus 100 étapes', async function () {
    await page.evaluate(`__selText('ea', 'Alpha')`)
    await touche(page, 'Control+b')
    assert.equal(await val('ea'), '<p><strong>Alpha</strong></p>')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'Ctrl+B défait')
    assert.equal(await page.evaluate(`__choisi('ea')`), 'Alpha', 'la sélection d\'avant revient')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val('ea'), '<p><strong>Alpha</strong></p>', 'et refait')
    await touche(page, 'Control+z')
    await page.evaluate(`__selText('ea', 'Alpha')`)
    await cliquer(page, `__btn('ea', 'h2')`)
    assert.equal(await val('ea'), '<h2>Alpha</h2>')
    await page.evaluate(`__selText('ea', 'Alpha')`)
    await cliquer(page, `__btn('ea', 'clear')`)
    assert.equal(await val('ea'), '<p>Alpha</p>', '« effacer la mise en forme » : trois commandes')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<h2>Alpha</h2>', 'une seule étape pour les trois commandes')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'le titre défait')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['true', 'false'], 'plus rien à défaire : la mise en forme refaite puis défaite n\'a laissé qu\'une étape')
    await page.evaluate(`__fin('ea'); __coller('ea', '<p>un <b>gras</b></p><p>deux</p>', 'un gras\\n\\ndeux')`)
    await pause(page)
    const colle = await val('ea')
    assert.ok(colle.includes('<strong>gras</strong>') && colle.includes('deux'), 'préalable : le collage est entré — ' + colle)
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'le collage défait en une étape')
    await touche(page, 'Control+y')
    assert.equal(await val('ea'), colle, 'et refait')
    const n = await page.evaluate(`(() => {
      const ed = __ed('ea')
      __selText('ea', 'Alpha')
      for (let i = 0; i < 110; i++) ed._mjsExec('bold')
      let k = 0
      while (ed._mjsState().undo && k < 500) { ed._mjsExec('undo'); k++ }
      return k
    })()`)
    assert.equal(n, 100, 'la pile est bornée : 100 étapes')
    assert.equal(await val('ea'), colle, 'défaire les 100 dernières étapes rend l\'état d\'après les dix premières (un nombre pair de bascules)')
    assert.deepEqual(erreurs, [])
  })

  it('défaire ne décoche pas une case : la frappe défaite, la ligne cochée le reste', async function () {
    await page.evaluate(`(() => { const sf = __sf('el'); sf.focus(); const t = sf.querySelector('li').firstChild; document.getSelection().setBaseAndExtent(t, t.length, t, t.length) })()`)
    await taper(page, ' plus')
    const { x, y } = await page.evaluate(`(() => { const li = __sf('el').querySelectorAll('li')[1]; li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } })()`)
    await page.mouse.click(x, y)
    await pause(page, 150)
    assert.equal(await val('el'), '<ul data-checklist><li>Un plus</li><li data-checked>Deux</li></ul>', 'préalable : la frappe, puis la case cochée')
    await page.evaluate(`(() => { const sf = __sf('el'); const t = sf.querySelector('li').firstChild; document.getSelection().setBaseAndExtent(t, t.length, t, t.length) })()`)
    await touche(page, 'Control+z')
    assert.equal(await val('el'), '<ul data-checklist><li>Un</li><li data-checked>Deux</li></ul>', 'la frappe est défaite, la case reste cochée')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val('el'), '<ul data-checklist><li>Un plus</li><li data-checked>Deux</li></ul>')
    assert.deepEqual(erreurs, [])
  })

  it('form.reset() ramène le contenu de départ et vide la pile', async function () {
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    await touche(page, 'ArrowLeft')
    await taper(page, 'X')
    await touche(page, 'Control+z')
    assert.equal(await val('ea'), '<p>Alpha un</p>')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['false', 'false'], 'préalable : de quoi défaire et refaire')
    await page.evaluate(`__q('.f-pile').reset()`)
    await pause(page, 400)
    assert.equal(await val('ea'), '<p>Alpha</p>', 'le contenu de départ')
    assert.deepEqual(await page.evaluate(`__gris('ea')`), ['true', 'true'], 'la pile est vide : boutons grisés')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    await touche(page, 'Control+y')
    await touche(page, 'Control+Shift+z')
    assert.equal(await val('ea'), '<p>Alpha</p>', 'rien à défaire ni à refaire après la remise à zéro')
    assert.equal(await page.evaluate(`__sf('ea').textContent`), 'Alpha')
    assert.deepEqual(erreurs, [])
  })

  it('required : vide, l\'éditeur manque — checkValidity(), :invalid, le message du navigateur, la bulle sur la zone, l\'envoi bloqué puis permis', async function () {
    const vu = await page.evaluate(`(() => {
      const f = __q('.f-oblig'), er = __ed('er')
      return {
        element: Array.from(f.elements).includes(er),
        valide: f.checkValidity(),
        invalide: er.matches(':invalid'),
        manque: er.validity && er.validity.valueMissing,
        message: er.validationMessage,
        natif: __q('.natif').validationMessage
      }
    })()`)
    assert.ok(vu.natif, 'préalable : le navigateur donne un message pour une zone de texte native vide')
    assert.deepEqual(vu, { element: true, valide: false, invalide: true, manque: true, message: vu.natif, natif: vu.natif }, 'élément du formulaire, manquant, le message d\'une zone de texte native')
    assert.equal(await page.evaluate(`__sf('er').getAttribute('aria-required')`), 'true', 'la zone se dit obligatoire, comme une zone de texte native')
    await page.evaluate(`window.__ev = []; __q('.f-oblig').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-oblig').reportValidity()`), false)
    assert.deepEqual(await page.evaluate(`__ev`), ['er'], 'invalid sur l\'éditeur')
    assert.equal(await page.evaluate(`__deep()`), 'div.surface', 'la bulle met le focus dans la zone d\'édition')
    await cliquer(page, `__q('.f-oblig .go')`)
    await pause(page, 300)
    assert.deepEqual(envois, [], 'l\'envoi est bloqué')
    if (nom !== 'firefox') assert.equal(await page.evaluate(`__deep()`), 'div.surface', 'la bulle de l\'envoi met aussi le focus dans la zone d\'édition (Firefox le laisse au bouton)')
    await page.evaluate(`__fin('er')`)
    await taper(page, 'abc')
    assert.equal(await val('er'), '<p>abc</p>', 'la bulle encore là, la frappe entre dans la zone, dans l\'ordre')
    await page.evaluate(`window.__poserR('<p> </p><p><br></p><ul><li></li></ul>')`)
    await pause(page, 200)
    assert.equal(await page.evaluate(`__ed('er').matches(':invalid')`), true, 'des balises vides : toujours vide')
    await page.evaluate(`__fin('er')`)
    await taper(page, 'texte')
    assert.deepEqual(await page.evaluate(`[__ed('er').matches(':valid'), __ed('er').matches(':invalid'), __q('.f-oblig').checkValidity()]`), [true, false, true], 'un texte : valide')
    await page.evaluate(`__selText('er', 'texte')`)
    await touche(page, 'Backspace')
    assert.deepEqual(await page.evaluate(`[__ed('er').matches(':invalid'), __q('.f-oblig').checkValidity()]`), [true, false], 'tout effacé : manque de nouveau')
    await taper(page, 'envoyé')
    await cliquer(page, `__q('.f-oblig .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?r=' + encodeURIComponent('<p>envoyé</p>').replace(/%20/g, '+')], 'le vrai envoi, le HTML propre')
    assert.deepEqual(erreurs, [])
  })

  it('<label for> vise l\'éditeur : un clic sur l\'étiquette met le focus dans sa zone d\'édition', async function () {
    assert.equal(await page.evaluate(`__q('.l-er').control === __ed('er')`), true, 'label.control est la balise de l\'éditeur')
    await cliquer(page, `__q('.l-er')`)
    assert.equal(await page.evaluate(`__deep()`), 'div.surface', 'le focus est dans la zone d\'édition')
    assert.equal(await page.evaluate(`__ed('er')._shadow.activeElement === __sf('er')`), true, 'celle de cet éditeur')
    await taper(page, 'abc')
    assert.equal(await val('er'), '<p>abc</p>', 'la frappe y entre')
    assert.deepEqual(erreurs, [])
  })

  it('<fieldset disabled> : l\'éditeur ne s\'édite plus, sa balise porte :disabled, sa validité ne compte plus, rien n\'est envoyé ; le fieldset réactivé le lui rend', async function () {
    const etat = () => page.evaluate(`[__ed('ef').matches(':disabled'), __sf('ef').getAttribute('contenteditable'), !!__ed('ef')._shadow.querySelector('mjs-core-toolbar'), __q('.f-fieldset').checkValidity(), __fd('.f-fieldset').length]`)
    assert.deepEqual(await etat(), [true, 'false', false, true, 0], ':disabled, non éditable, sans barre, la validité ne compte plus, rien n\'est envoyé')
    await page.evaluate(`__sf('ef').focus()`)
    await taper(page, 'x')
    assert.equal(await page.evaluate(`__sf('ef').textContent`), '', 'la frappe n\'entre pas')
    await page.evaluate(`__q('.f-fieldset .fs').disabled = false`)
    await pause(page, 250)
    assert.deepEqual(await etat(), [false, 'true', true, false, 1], 'réactivé : éditable, sa barre, required compte de nouveau, le champ revient')
    await page.evaluate(`__fin('ef')`)
    await taper(page, 'y')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['f=<p>y</p>'])
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), true)
    await page.evaluate(`__q('.f-fieldset .fs').disabled = true`)
    await pause(page, 250)
    assert.deepEqual(await etat(), [true, 'false', false, true, 0], 'de nouveau désactivé')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change : les paires envoyées, l\'éditeur hors formulaire, les rôles et aria-* de la zone', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-pile')`), ['a=<p>Alpha</p>', 'b=<p>Beta</p>', 'l=<ul data-checklist><li>Un</li><li>Deux</li></ul>'], 'une paire par éditeur, le HTML propre')
    assert.deepEqual(await page.evaluate(`['ea', 'eb', 'el'].map((c) => __ed(c).querySelectorAll(':scope > input[type=hidden]').length)`), [1, 1, 1], 'un champ caché par éditeur, jamais deux')
    const a11y = await page.evaluate(`['ea', 'eh'].map((c) => {
      const sf = __sf(c)
      const balise = Array.from(__ed(c).attributes).map((a) => a.name).filter((a) => a === 'role' || a.startsWith('aria-'))
      return [sf.getAttribute('role'), sf.getAttribute('aria-multiline'), sf.getAttribute('aria-label'), sf.hasAttribute('aria-disabled'), sf.hasAttribute('aria-readonly'), sf.getAttribute('aria-required'), balise.join(',')].join('|')
    })`)
    assert.deepEqual(a11y, ['textbox|true|Éditeur de texte|false|false||', 'textbox|true|Éditeur de texte|false|false|true|'], 'la zone garde son rôle et ses aria-* (obligatoire seulement avec required), rien sur la balise')
    assert.equal(await page.evaluate(`__ed('eh').form`), null, 'hors formulaire : aucun formulaire')
    await page.evaluate(`__fin('eh')`)
    await taper(page, ' ici')
    assert.equal(await val('eh'), '<p>Hors ici</p>')
    await touche(page, 'Control+z')
    assert.equal(await val('eh'), '<p>Hors</p>', 'hors formulaire, sa pile aussi')
    assert.deepEqual(erreurs, [])
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> sans attachInternals : le comportement d'avant, et sa propre pile (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const envois: string[]  = []
  const erreurs: string[] = []

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const script = await construire()
      browser = await ouvrir(nom, playwright)
      page    = await nouvellePage(browser, script, envois, erreurs, 'delete HTMLElement.prototype.attachInternals;')
      await charger(page)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('required sans effet, aucune étiquette ne vise l\'éditeur, les paires d\'avant, une pile par éditeur, aucune erreur', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.attachInternals`), 'undefined', 'préalable : le navigateur simulé n\'a pas attachInternals')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true, 'le formulaire ne voit pas l\'éditeur')
    assert.equal(await page.evaluate(`__q('.l-er').control`), null, 'l\'étiquette ne vise rien, comme avant')
    assert.deepEqual(await page.evaluate(`__fd('.f-pile')`), ['a=<p>Alpha</p>', 'b=<p>Beta</p>', 'l=<ul data-checklist><li>Un</li><li>Deux</li></ul>'])
    await page.evaluate(`__fin('ea')`)
    await taper(page, ' un')
    await page.evaluate(`__fin('eb')`)
    await touche(page, 'Control+z')
    assert.deepEqual(await page.evaluate(`[__val('ea'), __val('eb'), __gris('eb')]`), ['<p>Alpha un</p>', '<p>Beta</p>', ['true', 'true']], 'Ctrl+Z dans B ne touche pas A')
    await page.evaluate(`__fin('ea')`)
    await touche(page, 'Control+z')
    assert.equal(await page.evaluate(`__val('ea')`), '<p>Alpha</p>')
    assert.deepEqual(erreurs, [])
  })
})
