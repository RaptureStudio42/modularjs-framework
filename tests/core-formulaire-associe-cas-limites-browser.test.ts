// les éléments du formulaire du cœur (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@select>, <@@editor>) dans les cas limites d'un
// champ natif :
// - un attribut booléen écrit vide vaut vrai, comme en HTML : `disabled=""` (ou posé par `setAttribute('disabled', '')`, `toggleAttribute`)
//   désactive la case, l'interrupteur ou le radio cochés, et leur valeur ne part plus ; `required=""` les rend obligatoires ; `readonly="false"`
//   est ôté de l'éditeur (il est validé), `readonly=""` le met en lecture seule
// - un bouton facultatif d'un groupe radio obligatoire : sa case native n'est pas obligatoire, le groupe manque
// - `form="id"` hors de la balise <form> : la valeur part avec ce formulaire et `reset()` la remet, pour la case, le nombre et la liste
// - `setCustomValidity` sur la balise, comme sur un champ natif : son message passe devant la validité du module et reste après un geste
// - une `<label for>` donne son nom au vrai champ de l'ombre, sauf quand la balise porte le sien : son `aria-label` passe alors au champ (la
//   balise citée), la prop `label` le nomme sans rien citer
// - la saisie au vol de la liste trouve « Œuf » par « oe », « ﬁn » par « fi », « Straße » par « strass »
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const OPTIONS = '<@@option value="a">A</@@option><@@option value="b">B</@@option>'
const TROIS   = (attrs: string) => [
  `<@@checkbox class="cb" name="cb" ${attrs}>case</@@checkbox>`,
  `<@@switch class="sw" name="sw" ${attrs}>interrupteur</@@switch>`,
  `<@@radio class="ra" name="ra" value="x" ${attrs}>x</@@radio>`
].join('\n  ')

const PAGE = `<form class="f-vide" method="get" action="/envoi" @noUJS>
  ${TROIS('checked disabled=""')}
</form>

<form class="f-pose" method="get" action="/envoi" @noUJS>
  ${TROIS('checked')}
</form>

<form class="f-requis" method="get" action="/envoi" @noUJS>
  ${TROIS('required=""')}
</form>

<form class="f-requis-pose" method="get" action="/envoi" @noUJS>
  ${TROIS('')}
</form>

<form class="f-lecture" method="get" action="/envoi" @noUJS>
  <@@editor class="ed" name="ed" readonly="false" required toolbar="none"></@@editor>
  <@@editor class="ed2" name="ed2" readonly="" toolbar="none"></@@editor>
</form>

<form class="f-groupe" method="get" action="/envoi" @noUJS>
  <@@radio class="g1" name="g" value="1" required>un</@@radio>
  <@@radio class="g2" name="g" value="2">deux</@@radio>
</form>

<form id="f-loin" class="f-loin" method="get" action="/envoi" @noUJS>
  <button type="submit" class="go">envoyer</button>
</form>
<div class="loin">
  <@@checkbox class="xcb" form="f-loin" name="xcb" checked>loin</@@checkbox>
  <@@number class="xnb" form="f-loin" name="xnb" value="3"></@@number>
  <@@select class="xse" form="f-loin" name="xse" value="a">${OPTIONS}</@@select>
</div>

<form class="f-perso" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb">case</@@checkbox>
  <@@number class="nb" name="nb" required></@@number>
</form>

<form class="f-nom" method="get" action="/envoi" @noUJS>
  <label for="n-cb">Accepter les conditions</label>
  <@@checkbox id="n-cb" class="cb" name="cb"></@@checkbox>
  <label for="n-nb">Quantité</label>
  <@@number id="n-nb" class="nb" name="nb"></@@number>
  <label for="n-se">Étiquette ignorée</label>
  <@@select id="n-se" class="se" name="se" aria-label="Pays">${OPTIONS}</@@select>
  <label for="n-nb2">Étiquette ignorée aussi</label>
  <@@number id="n-nb2" class="nb2" name="nb2" label="Quantité exacte"></@@number>
</form>

<div class="z-liste">
  <@@select class="sel" name="sel"><@@option value="a">Abricot</@@option><@@option value="o">Œuf</@@option><@@option value="f">ﬁn</@@option><@@option value="s">Straße</@@option></@@select>
</div>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-select, mjs-core-editor'
const NOMBRE  = 26

// aides de la page : un module d'un bloc, ses données de formulaire, ses modules invalides
const AIDES = `(() => {
  window.__q    = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__m    = (b, c) => __q(b).querySelector(c)
  window.__mods = (b) => Array.from(__q(b).querySelectorAll('${MODULES}'))
  window.__fd   = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__inv  = (b) => __mods(b).filter((m) => m.matches(':invalid')).map((m) => m.className)
  window.__off  = (b) => __mods(b).filter((m) => m.matches(':disabled')).map((m) => m.className)
})()`

let construit: Promise<string> | null = null

// le script de la page (le cœur, les libellés du manifeste, les modules, l'hôte), construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-cas-limites')
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
    const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('${MODULES}')) : []
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.native, .input, .select-btn, .surface'))
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`les éléments du formulaire du cœur dans les cas limites d'un champ natif (${nom} réel)`, function () {
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

  it('disabled="" sur une case, un interrupteur, un radio cochés : désactivés, leur valeur ne part pas — posé plus tard aussi (setAttribute, toggleAttribute)', async function () {
    assert.deepEqual(await page.evaluate(`__off('.f-vide')`), ['cb', 'sw', 'ra'], 'la balise est :disabled')
    assert.deepEqual(await page.evaluate(`__fd('.f-vide')`), [], 'rien ne part, comme une case native cochée et désactivée')
    assert.deepEqual(await page.evaluate(`__fd('.f-pose')`), ['cb=on', 'sw=on', 'ra=x'], 'préalable : actifs et cochés, chacun envoie sa paire')
    await page.evaluate(`__m('.f-pose', '.cb').setAttribute('disabled', ''); __m('.f-pose', '.sw').toggleAttribute('disabled', true); __m('.f-pose', '.ra').toggleAttribute('disabled', true)`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__off('.f-pose')`), ['cb', 'sw', 'ra'])
    assert.deepEqual(await page.evaluate(`__fd('.f-pose')`), [], 'désactivés par la page : plus rien ne part')
    assert.deepEqual(erreurs, [])
  })

  it('required="" écrit dans la balise ou posé par setAttribute(\'required\', \'\') : la case, l\'interrupteur et le radio deviennent obligatoires', async function () {
    assert.deepEqual(await page.evaluate(`__inv('.f-requis')`), ['cb', 'sw', 'ra'], 'non cochés : ils manquent')
    assert.equal(await page.evaluate(`__q('.f-requis').checkValidity()`), false)
    assert.deepEqual(await page.evaluate(`__inv('.f-requis-pose')`), [], 'préalable : facultatifs')
    await page.evaluate(`__mods('.f-requis-pose').forEach((m) => m.setAttribute('required', ''))`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__inv('.f-requis-pose')`), ['cb', 'sw', 'ra'], 'posé par la page : obligatoires')
    await cliquer(page, `__m('.f-requis-pose', '.cb')._shadow.querySelector('.box')`)
    assert.deepEqual(await page.evaluate(`__inv('.f-requis-pose')`), ['sw', 'ra'], 'la case cochée ne manque plus')
    assert.deepEqual(erreurs, [])
  })

  it('readonly="false" est ôté de l\'éditeur, qui reste validé (required le bloque) ; readonly="" le met en lecture seule, et « false » posé plus tard le rend', async function () {
    const etat = (c: string) => page.evaluate(`(() => { const m = __m('.f-lecture', '.${c}'); return [m.hasAttribute('readonly'), m.willValidate, m.matches(':invalid'), m._shadow.querySelector('.surface').getAttribute('contenteditable')] })()`)
    assert.deepEqual(await etat('ed'), [false, true, true, 'true'], '« false » ôté : validé, il manque, saisissable')
    assert.deepEqual(await etat('ed2'), [true, false, false, 'false'], 'readonly="" : en lecture seule, hors de la validation')
    await page.evaluate(`__m('.f-lecture', '.ed2').setAttribute('readonly', 'FALSE')`)
    await pause(page)
    assert.deepEqual(await etat('ed2'), [false, true, false, 'true'], '« FALSE » posé par la page : ôté, de nouveau saisissable et validé')
    assert.deepEqual(erreurs, [])
  })

  it('un groupe radio obligatoire : le bouton facultatif manque avec le groupe, mais sa case native reste facultative', async function () {
    assert.deepEqual(await page.evaluate(`__inv('.f-groupe')`), ['g1', 'g2'], 'aucun bouton coché : le groupe manque')
    assert.deepEqual(await page.evaluate(`['.g1', '.g2'].map((c) => __m('.f-groupe', c)._shadow.querySelector('input').required)`), [true, false], 'chaque case native garde le required de sa balise')
    assert.deepEqual(erreurs, [])
  })

  it('form="id" hors de la balise <form> : la case, le nombre et la liste envoient leur valeur avec ce formulaire, et reset() les remet', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xcb=on', 'xnb=3', 'xse=a'], 'chaque valeur part avec le formulaire visé')
    await cliquer(page, `__q('.xcb')._shadow.querySelector('.box')`)
    await cliquer(page, `__q('.xnb')._shadow.querySelector('.more')`)
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xnb=4', 'xse=a'], 'la case décochée ne part plus, le nombre suit')
    await page.evaluate(`__q('.f-loin').reset()`)
    await pause(page, 300)
    assert.deepEqual(await page.evaluate(`[__q('.xcb')._shadow.querySelector('input').checked, __q('.xnb')._shadow.querySelector('.input').value]`), [true, '3'], 'reset() rend leur départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xcb=on', 'xnb=3', 'xse=a'])
    await cliquer(page, `__q('.f-loin .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?xcb=on&xnb=3&xse=a'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('setCustomValidity sur la balise : son message passe devant la validité du module, reste après un geste, et \'\' le lève', async function () {
    const v = (c: string) => page.evaluate(`(() => { const m = __m('.f-perso', '.${c}'); return [m.validationMessage, m.validity.customError, m.validity.valueMissing, m.matches(':invalid')] })()`)
    assert.equal(await page.evaluate(`typeof __m('.f-perso', '.cb').setCustomValidity`), 'function')
    await page.evaluate(`__m('.f-perso', '.cb').setCustomValidity('Cochez-la, s\\'il vous plaît')`)
    assert.deepEqual(await v('cb'), ['Cochez-la, s\'il vous plaît', true, false, true])
    assert.equal(await page.evaluate(`__q('.f-perso').checkValidity()`), false)
    await cliquer(page, `__m('.f-perso', '.cb')._shadow.querySelector('.box')`)
    await cliquer(page, `__m('.f-perso', '.cb')._shadow.querySelector('.box')`)
    assert.deepEqual(await v('cb'), ['Cochez-la, s\'il vous plaît', true, false, true], 'les gestes du module ne l\'effacent pas')
    await page.evaluate(`__m('.f-perso', '.cb').setCustomValidity('')`)
    assert.deepEqual(await v('cb'), ['', false, false, false], '\'\' le lève')
    await page.evaluate(`__m('.f-perso', '.nb').setCustomValidity('Un nombre, s\\'il vous plaît')`)
    assert.deepEqual(await v('nb'), ['Un nombre, s\'il vous plaît', true, true, true], 'le message de la page, et le manque du module dessous')
    await cliquer(page, `__m('.f-perso', '.nb')._shadow.querySelector('.more')`)
    assert.deepEqual(await v('nb'), ['Un nombre, s\'il vous plaît', true, false, true], 'le geste remplit le nombre : le message de la page reste')
    await page.evaluate(`__m('.f-perso', '.nb').setCustomValidity('')`)
    assert.deepEqual(await v('nb'), ['', false, false, false])
    assert.deepEqual(erreurs, [])
  })

  it('<label for> nomme le vrai champ de l\'ombre (la case, le nombre) ; une balise qui porte son nom (aria-label, label) le garde', async function () {
    const cite = (c: string, champ: string) => page.evaluate(`(() => { const m = __m('.f-nom', '.${c}'); const f = m._shadow.querySelector('${champ}'); return f.ariaLabelledByElements === undefined ? 'sans' : (f.ariaLabelledByElements || []).map((l) => l === m ? 'balise' : l.textContent.trim()).join(' | ') })()`)
    const cb = await cite('cb', 'input')
    if (cb !== 'sans') {
      assert.equal(cb, 'Accepter les conditions | ', 'la case cite son étiquette, puis son propre libellé (vide ici)')
      assert.equal(await cite('nb', '.input'), 'Quantité')
      assert.equal(await cite('se', '.select-btn'), 'balise', 'aria-label de la balise : la balise est citée, son nom passe au champ')
      assert.equal(await cite('nb2', '.input'), '', 'label du module : rien de cité')
    }
    if (nom === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      const noms = nodes.filter((n: any) => !n.ignored && ['checkbox', 'spinbutton', 'combobox'].includes(n.role?.value)).map((n: any) => n.role.value + ':' + (n.name?.value ?? ''))
      for (const attendu of ['checkbox:Accepter les conditions', 'spinbutton:Quantité', 'combobox:Pays', 'spinbutton:Quantité exacte']) assert.ok(noms.includes(attendu), attendu + ' absent de ' + noms.join(', '))
      await cdp.detach()
    }
    assert.deepEqual(erreurs, [])
  })

  it('saisie au vol de la liste : « oe » trouve Œuf, « fi » trouve ﬁn, « strass » trouve Straße', async function () {
    const valeur = () => page.evaluate(`__q('.sel')._state.value`)
    await page.evaluate(`__q('.sel')._shadow.querySelector('.select-btn').focus()`)
    for (const [mot, attendu] of [['oe', 'o'], ['fi', 'f'], ['strass', 's']]) {
      await page.keyboard.type(mot, { delay: 60 })
      await pause(page, 700)
      assert.equal(await valeur(), attendu, mot)
    }
    assert.deepEqual(erreurs, [])
  })
})
