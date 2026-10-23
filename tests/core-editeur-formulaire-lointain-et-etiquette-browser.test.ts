// <@@editor> comme une zone de texte native, dans deux cas du formulaire :
// - `form="id"` sur un éditeur placé hors de la balise <form> : sa valeur part avec le formulaire visé (le champ caché du module le suit,
//   comme un `<textarea form="id">`), en mode « répondre » aussi (un champ par case cochée), la frappe la change, `reset()` la remet, et
//   le vrai envoi la porte
// - une `<label for>` qui vise l'éditeur nomme sa zone d'édition, le vrai champ pour un lecteur d'écran (la zone cite l'étiquette, placée
//   avant ou après l'éditeur) ; une balise qui porte son propre nom (`aria-label`, la prop `label`) le garde ; le clic sur l'étiquette met
//   toujours le focus dans la zone, au curseur qu'on y avait laissé
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire ; l'arbre d'accessibilité de Chromium

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $texte  = '<p>Bonjour</p>'
  $modele = '<ul data-checklist><li>Un</li><li>Deux</li></ul>'
</script>

<form id="f-loin" class="f-loin" method="get" action="/envoi" @noUJS>
  <button type="submit" class="go">envoyer</button>
</form>
<div class="loin">
  <@@editor class="xed" form="f-loin" name="xed" toolbar="none" value={$texte}></@@editor>
  <@@editor class="xre" form="f-loin" name="reps[]" answer value={$modele} checked={[1]}></@@editor>
  <textarea class="nat" form="f-loin" name="nat">natif</textarea>
</div>

<form class="f-nom" method="get" action="/envoi" @noUJS>
  <label class="l-ned" for="n-ed">Corps du message</label>
  <@@editor id="n-ed" class="ned" name="ned" toolbar="none"></@@editor>
  <@@editor id="n-ap" class="nap" name="nap" toolbar="none"></@@editor>
  <label for="n-ap">Étiquette placée après</label>
  <label for="n-ar">Étiquette ignorée</label>
  <@@editor id="n-ar" class="nar" name="nar" toolbar="none" aria-label="Résumé"></@@editor>
  <label for="n-pr">Étiquette ignorée aussi</label>
  <@@editor id="n-pr" class="npr" name="npr" toolbar="none" label="Remarques"></@@editor>
  <@@editor class="nsans" name="nsans" toolbar="none"></@@editor>
</form>
<button type="button" class="ailleurs">ailleurs</button>
`

const NOMBRE = 7

// aides de la page : un élément de l'hôte, un éditeur, sa zone, sa valeur, les données d'un formulaire, l'élément qui a le focus (à travers les ombres)
const AIDES = `(() => {
  window.__q    = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__ed   = (c) => __q('.' + c)
  window.__sf   = (c) => __ed(c)._shadow.querySelector('.surface')
  window.__fd   = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__deep = () => { let a = document.activeElement; while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement; return a ? a.localName + '.' + a.classList[0] : 'rien' }
  window.__fin  = (c) => {
    const sf = __sf(c); sf.focus()
    const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
    let n, last
    while ((n = w.nextNode())) last = n
    if (last) document.getSelection().setBaseAndExtent(last, last.length, last, last.length)
  }
})()`

let construit: Promise<string> | null = null

// le script de la page (le cœur, les libellés du manifeste, les modules, l'hôte), construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('editeur-formulaire-lointain')
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
async function nouvellePage(browser: any, script: string, envois: string[], erreurs: string[]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript('window.__name = (f) => f;')
  page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
  const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
  await page.route('http://formulaire.test/**', async (route: any) => {
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
  await page.goto('http://formulaire.test/page', { waitUntil: 'load' })
  await page.waitForFunction(`(() => {
    const h = document.querySelector('mjs-hote')
    const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-editor')) : []
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.surface'))
  })()`, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 200) => page.waitForTimeout(ms)

// un vrai clic au centre de l'élément que donne l'expression
async function cliquer(page: any, expr: string) {
  const point = await page.evaluate(`(() => {
    const el = ${expr}
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.mouse.click(point.x, point.y)
  await pause(page, 150)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@editor> lié à un formulaire lointain (form="id") et nommé par sa <label for> (${nom} réel)`, function () {
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

  it('form="id" hors de la balise <form> : la valeur de l\'éditeur part avec le formulaire visé, comme celle d\'une <textarea form="id">, la frappe la change, reset() la remet', async function () {
    const depart = ['xed=<p>Bonjour</p>', 'reps[]=1', 'nat=natif']
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), depart, 'chaque valeur part avec le formulaire visé, celles des éditeurs aussi')
    assert.deepEqual(await page.evaluate(`['xed', 'xre'].map((c) => __ed(c).form === __q('.f-loin'))`), [true, true], 'la balise appartient au formulaire visé')
    await page.evaluate(`__fin('xed')`)
    await page.keyboard.type(' ici')
    await pause(page)
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xed=<p>Bonjour ici</p>', 'reps[]=1', 'nat=natif'], 'la frappe change la valeur envoyée')
    await page.evaluate(`__q('.f-loin').reset()`)
    await pause(page, 300)
    assert.equal(await page.evaluate(`__sf('xed').textContent`), 'Bonjour', 'reset() rend le texte de départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), depart, 'et la valeur de départ')
    await cliquer(page, `__q('.f-loin .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?' + new URLSearchParams(depart.map((p) => p.split('=') as [string, string])).toString()], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('<label for> nomme la zone d\'édition (étiquette avant ou après l\'éditeur) ; une balise qui porte son nom (aria-label, label) le garde ; le clic sur l\'étiquette met le focus dans la zone', async function () {
    const cite = (c: string) => page.evaluate(`(() => { const f = __sf('${c}'); return f.ariaLabelledByElements === undefined ? 'sans' : (f.ariaLabelledByElements || []).map((l) => l.textContent.trim()).join(' | ') })()`)
    if (await cite('ned') !== 'sans') {
      assert.equal(await cite('ned'), 'Corps du message', 'la zone cite son étiquette')
      assert.equal(await cite('nap'), 'Étiquette placée après', 'une étiquette écrite après l\'éditeur aussi')
      assert.equal(await cite('nar'), '', 'aria-label de la balise : rien de cité')
      assert.equal(await cite('npr'), '', 'label du module : rien de cité')
      assert.equal(await cite('nsans'), '', 'aucune étiquette : rien de cité')
    }
    if (nom === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      const noms = nodes.filter((n: any) => !n.ignored && n.role?.value === 'textbox').map((n: any) => n.role.value + ':' + (n.name?.value ?? ''))
      for (const attendu of ['textbox:Corps du message', 'textbox:Étiquette placée après', 'textbox:Résumé', 'textbox:Remarques', 'textbox:Éditeur de texte']) assert.ok(noms.includes(attendu), attendu + ' absent de ' + noms.join(', '))
      assert.ok(!noms.some((n: string) => n.includes('ignorée')), 'une étiquette ignorée ne nomme rien : ' + noms.join(', '))
      await cdp.detach()
    }
    await page.evaluate(`__fin('ned')`)
    await page.keyboard.type('abc')
    await pause(page)
    await cliquer(page, `__q('.ailleurs')`)
    assert.notEqual(await page.evaluate(`__deep()`), 'div.surface', 'préalable : le focus a quitté la zone')
    await cliquer(page, `__q('.l-ned')`)
    assert.equal(await page.evaluate(`__deep()`), 'div.surface', 'le clic sur l\'étiquette met le focus dans la zone d\'édition')
    assert.equal(await page.evaluate(`__ed('ned')._shadow.activeElement === __sf('ned')`), true, 'celle de cet éditeur')
    await page.keyboard.type('d')
    await pause(page)
    assert.deepEqual(await page.evaluate(`__fd('.f-nom')`).then((l: string[]) => l.filter((p) => p.startsWith('ned='))), ['ned=<p>abcd</p>'], 'la frappe reprend au curseur laissé dans la zone')
    assert.deepEqual(erreurs, [])
  })
})
