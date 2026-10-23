// Le nombre, le bouton rotatif et la jauge du cœur reconnus par le formulaire : <@@number>, <@@knob>, <@@gauge> sont des éléments associés
// au formulaire, chacun comme le champ natif dont il tient la place.
// - <@@number> comme `<input type="number">` : vide et `required`, il manque ; une valeur hors de `min` / `max`, ou hors du pas (`step`,
//   compté depuis `min`, sinon depuis la valeur de départ), est invalide — form.checkValidity() et reportValidity(), l'envoi bloqué (la bulle
//   du navigateur, le focus dans la saisie), `:invalid` / `:valid` sur la balise, `validity` et le message du navigateur, ceux d'un champ
//   nombre natif aux mêmes règles.
// - <@@knob> et <@@gauge> comme `<input type="range">` : toujours une valeur, `required` sans effet, toujours valides.
// - Une `<label for>` vise chaque module : un clic sur l'étiquette met le focus dans sa saisie (le champ du nombre, le cadran, le compteur),
//   comme l'étiquette d'un champ natif, sans rien changer ; un clic dans le module fait un pas, jamais deux.
// - Un `<fieldset disabled>` désactive les trois modules (aucun geste ne les change, la validité ne compte plus, rien ne part), et les réactive.
// - `form.reset()` les ramène à leur départ, et leur validité suit.
// Ce qui ne change pas : les paires envoyées (une par module, jamais deux), `disabled="false"` écrit sur la balise (le module reste actif et
// part avec le formulaire, l'attribut ôté de la balise), un module hors formulaire, les rôles et `aria-*`, et un navigateur sans
// attachInternals (repli silencieux).
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<form class="f-oblig" method="get" action="/envoi" @noUJS>
  <@@number class="nb" name="nb" required></@@number>
  <@@knob class="kn" name="kn" required></@@knob>
  <@@gauge class="ga" name="ga" required></@@gauge>
  <button type="submit" class="go">envoyer</button>
  <button type="reset" class="rz">remise à zéro</button>
</form>

<form class="f-bornes" method="get" action="/envoi" @noUJS>
  <@@number class="haut" name="haut" min="0" max="10" value="15"></@@number>
  <@@number class="bas" name="bas" min="5" max="20" value="2"></@@number>
  <@@number class="pas" name="pas" min="0" step="5" value="10"></@@number>
  <@@number class="base" name="base" step="5" value="2"></@@number>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-etiquette" method="get" action="/envoi" @noUJS>
  <@@number class="nb" id="e-nb" name="nb" value="3"></@@number>
  <@@knob class="kn" id="e-kn" name="kn"></@@knob>
  <@@gauge class="ga" id="e-ga" name="ga"></@@gauge>
  <label class="l-nb" for="e-nb">étiquette du nombre</label>
  <label class="l-kn" for="e-kn">étiquette du bouton rotatif</label>
  <label class="l-ga" for="e-ga">étiquette de la jauge</label>
</form>

<form class="f-fieldset" method="get" action="/envoi" @noUJS>
  <fieldset class="fs" disabled>
    <@@number class="nb" name="nb" required></@@number>
    <@@knob class="kn" name="kn" value="20"></@@knob>
    <@@gauge class="ga" name="ga" value="4"></@@gauge>
  </fieldset>
</form>

<form class="f-libre" method="get" action="/envoi" @noUJS>
  <@@number class="nb" name="nb" value="3"></@@number>
  <@@knob class="kn" name="kn" value="20"></@@knob>
  <@@gauge class="ga" name="ga" value="4"></@@gauge>
  <@@number class="nf" name="nf" value="6" disabled="false"></@@number>
  <@@knob class="kf" name="kf" value="30" disabled="false"></@@knob>
  <@@gauge class="gf" name="gf" value="5" disabled="false"></@@gauge>
  <button type="submit" class="go">envoyer</button>
</form>

<div class="hors">
  <@@number class="nb" name="hnb" value="1"></@@number>
  <@@knob class="kn" name="hkn" value="10"></@@knob>
  <@@gauge class="ga" name="hga" value="2"></@@gauge>
</div>

<input class="natif-oblig" type="number" required>
<input class="natif-haut" type="number" min="0" max="10" value="15">
<input class="natif-bas" type="number" min="5" max="20" value="2">
<input class="natif-pas" type="number" min="0" step="5" value="7">
<input class="natif-base" type="number" step="5" value="2">
<input class="natif-range" type="range" required>
`

const MODULES = 'mjs-core-number, mjs-core-knob, mjs-core-gauge'
const NOMBRE  = 22

// le « + » de chaque module qui en a un : le bouton du nombre, celui de la jauge
const PLUS: Record<string, string> = { number: '.more', gauge: 'button[aria-label="+"]' }

// aides de la page : un module d'un bloc, sa saisie (le champ du nombre, le cadran, le compteur), la valeur montrée de chacun, ses défauts,
// les données du formulaire
const AIDES = `(() => {
  const SAISIE = { 'mjs-core-number': '.input', 'mjs-core-knob': '.knob', 'mjs-core-gauge': '.spinner' }
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__m   = (b, c) => __q(b).querySelector(c)
  window.__s   = (b, c) => { const m = __m(b, c); return m._shadow.querySelector(SAISIE[m.localName]) }
  window.__mods = (b) => Array.from(__q(b).querySelectorAll('${MODULES}'))
  window.__v   = (b) => __mods(b).map((m) => m.className + '=' + (m.localName === 'mjs-core-number' ? m._shadow.querySelector('.input').value : m._shadow.querySelector('output').textContent.trim()))
  window.__fd  = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__inv = (b) => __mods(b).filter((m) => m.matches(':invalid')).map((m) => m.className)
  window.__val = (b) => __mods(b).filter((m) => m.matches(':valid')).map((m) => m.className)
  window.__def = (el) => ['valueMissing', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput'].filter((k) => el.validity && el.validity[k]).join(',')
  // désactivé de l'intérieur : le champ du nombre, le cadran (aria-disabled), les deux boutons de la jauge
  window.__coupe = (b, c) => {
    const m = __m(b, c)
    const s = __s(b, c)
    if (m.localName === 'mjs-core-number') return s.disabled
    if (m.localName === 'mjs-core-knob') return s.getAttribute('aria-disabled') === 'true'
    return Array.from(m._shadow.querySelectorAll('button')).every((x) => x.disabled)
  }
  // le module où se trouve le focus (la balise dont l'ombre le porte), et l'élément focalisé dans son ombre
  window.__focus = () => {
    const hote = document.querySelector('mjs-hote')
    const m = hote._shadow.activeElement
    if (!m || !m._shadow) return null
    const dedans = m._shadow.activeElement
    return m.className + ':' + (dedans ? dedans.localName : 'rien')
  }
})()`

let construit: Promise<string> | null = null

// le script concaténé de la page, construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-associe-nombre')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const order = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return construit
}

function ouvrir(nom: string, playwright: any) {
  return playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
}

// une page servie sous une adresse interceptée (un vrai envoi y navigue), le script chargé après la balise de l'hôte
async function nouvellePage(browser: any, script: string, envois: string[], erreurs: string[], avant = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript('window.__name = (f) => f;' + avant)
  page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
  const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`
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
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow.querySelector('.input, .knob, .spinner'))
  })()`)
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

// un vrai clic au centre d'une pièce d'un module (`piece` : un sélecteur dans son ombre), ou d'une balise du bloc (étiquette, bouton)
async function cliquer(page: any, bloc: string, cls: string, piece = '') {
  const { x, y } = await page.evaluate(`(() => {
    const el = __m('${bloc}', '.${cls}')
    el.scrollIntoView({ block: 'center' })
    const r = (${piece ? `el._shadow.querySelector('${piece}')` : 'el'}).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.mouse.click(x, y)
  await page.waitForTimeout(150)
}

// une frappe réelle dans le champ du nombre, son texte d'abord sélectionné
async function taper(page: any, bloc: string, cls: string, texte: string) {
  await page.evaluate(`(() => { const i = __s('${bloc}', '.${cls}'); i.focus(); i.select() })()`)
  await page.keyboard.type(texte)
  await page.waitForTimeout(150)
}

// une touche réelle sur la saisie d'un module, le focus posé d'abord
async function touche(page: any, bloc: string, cls: string, cle: string) {
  await page.evaluate(`__s('${bloc}', '.${cls}').focus()`)
  await page.keyboard.press(cle)
  await page.waitForTimeout(150)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`le nombre, le bouton rotatif et la jauge reconnus par le formulaire (${nom} réel)`, function () {
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

  it('required : le nombre vide manque — checkValidity(), :invalid, le message d\'un champ nombre natif ; le bouton rotatif et la jauge ont toujours une valeur', async function () {
    const vu = await page.evaluate(`(() => {
      const f = __q('.f-oblig')
      return {
        valide: f.checkValidity(),
        elements: Array.from(f.elements).filter((e) => e.localName.startsWith('mjs-core-')).map((e) => e.className),
        invalides: __inv('.f-oblig'),
        valides: __val('.f-oblig'),
        defauts: ['nb', 'kn', 'ga'].map((c) => __def(__m('.f-oblig', '.' + c))),
        voulus: ['nb', 'kn', 'ga'].map((c) => __m('.f-oblig', '.' + c).willValidate),
        messages: ['nb', 'kn', 'ga'].map((c) => __m('.f-oblig', '.' + c).validationMessage),
        natif: __q('.natif-oblig').validationMessage,
        range: [__q('.natif-range').validity.valid, __q('.natif-range').validationMessage],
        requis: __s('.f-oblig', '.nb').getAttribute('aria-required')
      }
    })()`)
    assert.equal(vu.valide, false, 'le formulaire ne passe pas')
    assert.deepEqual(vu.elements, ['nb', 'kn', 'ga'], 'les trois modules sont des éléments du formulaire')
    assert.deepEqual(vu.invalides, ['nb'], ':invalid sur le nombre vide, lui seul')
    assert.deepEqual(vu.valides, ['kn', 'ga'], ':valid sur le bouton rotatif et la jauge : required sans effet, comme sur un range natif')
    assert.deepEqual(vu.defauts, ['valueMissing', '', ''], 'validity')
    assert.deepEqual(vu.voulus, [true, true, true], 'willValidate')
    assert.ok(vu.natif, 'préalable : le navigateur donne un message pour un champ nombre natif vide')
    assert.deepEqual(vu.range, [true, ''], 'préalable : un range natif obligatoire est toujours valide')
    assert.deepEqual(vu.messages, [vu.natif, '', ''], 'le message est celui du navigateur pour un champ nombre natif')
    assert.equal(vu.requis, 'true', 'la saisie du nombre se dit obligatoire, comme un champ nombre natif')
    assert.deepEqual(erreurs, [])
  })

  it('required : reportValidity() et l\'envoi bloqué, le focus dans la saisie ; un nombre tapé, et l\'envoi part — une paire par module', async function () {
    await page.evaluate(`window.__ev = []; __q('.f-oblig').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-oblig').reportValidity()`), false, 'reportValidity() rend false')
    assert.deepEqual(await page.evaluate(`__ev`), ['nb'], 'invalid sur le nombre seul')
    assert.equal(await page.evaluate(`__focus()`), 'nb:input', 'la bulle va au nombre, le focus dans sa saisie')
    await cliquer(page, '.f-oblig', 'go')
    await page.waitForTimeout(400)
    assert.deepEqual(envois, [], 'l\'envoi est bloqué')
    await taper(page, '.f-oblig', 'nb', '5')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [], 'un nombre tapé : plus rien ne manque')
    assert.deepEqual(await page.evaluate(`__val('.f-oblig')`), ['nb', 'kn', 'ga'], ':valid sur chaque balise')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true)
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['nb=5', 'kn=50', 'ga=0'], 'une paire par module')
    await cliquer(page, '.f-oblig', 'go')
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?nb=5&kn=50&ga=0'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('min, max, step : hors des bornes, hors du pas — validity et le message d\'un champ nombre natif aux mêmes règles ; le pas part de min, sinon de la valeur de départ', async function () {
    const vu = await page.evaluate(`(() => {
      const m = (c) => __m('.f-bornes', '.' + c)
      return {
        invalides: __inv('.f-bornes'),
        defauts: ['haut', 'bas', 'pas', 'base'].map((c) => __def(m(c))),
        messages: [m('haut').validationMessage, m('bas').validationMessage],
        natifs: [__q('.natif-haut').validationMessage, __q('.natif-bas').validationMessage],
        natifsDefauts: [__def(__q('.natif-haut')), __def(__q('.natif-bas'))]
      }
    })()`)
    assert.deepEqual(vu.natifsDefauts, ['rangeOverflow', 'rangeUnderflow'], 'préalable : les champs natifs aux mêmes règles')
    assert.ok(vu.natifs[0] && vu.natifs[1], 'préalable : le navigateur donne leurs messages')
    assert.deepEqual(vu.invalides, ['haut', 'bas'], 'au-dessus du max, sous le min : :invalid')
    assert.deepEqual(vu.defauts, ['rangeOverflow', 'rangeUnderflow', '', ''], 'validity')
    assert.deepEqual(vu.messages, vu.natifs, 'le message est celui du navigateur pour le même champ natif')
    await page.evaluate(`window.__ev = []; __q('.f-bornes').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-bornes').reportValidity()`), false)
    assert.deepEqual(await page.evaluate(`__ev`), ['haut', 'bas'])
    assert.equal(await page.evaluate(`__focus()`), 'haut:input', 'la bulle va au premier, le focus dans sa saisie')
    await taper(page, '.f-bornes', 'pas', '7')
    const pas = await page.evaluate(`[__def(__m('.f-bornes', '.pas')), __m('.f-bornes', '.pas').validationMessage, __def(__q('.natif-pas')), __q('.natif-pas').validationMessage]`)
    assert.equal(pas[2], 'stepMismatch', 'préalable : 7 est hors du pas de 5 d\'un champ natif')
    assert.ok(pas[3], 'préalable : son message')
    assert.deepEqual(pas.slice(0, 2), ['stepMismatch', pas[3]], 'tapé hors du pas : le défaut et le message du champ natif')
    await cliquer(page, '.f-bornes', 'base', PLUS.number)
    const base = await page.evaluate(`(() => { const n = __q('.natif-base'); n.value = '7'; return [__def(__m('.f-bornes', '.base')), __def(n)] })()`)
    assert.deepEqual(await page.evaluate(`__v('.f-bornes')`), ['haut=15', 'bas=2', 'pas=7', 'base=7'], 'préalable : « + » fait un pas depuis 2')
    assert.deepEqual(base, ['', ''], 'sans min, le pas part de la valeur de départ (2) : 7 est dans le pas, comme pour le champ natif de value="2"')
    await taper(page, '.f-bornes', 'base', '4')
    const hors = await page.evaluate(`(() => { const n = __q('.natif-base'); n.value = '4'; return [__def(__m('.f-bornes', '.base')), __def(n), __m('.f-bornes', '.base').validationMessage === n.validationMessage] })()`)
    assert.deepEqual(hors, ['stepMismatch', 'stepMismatch', true], 'et 4 n\'y est pas : le pas part toujours de 2, pas de la valeur courante')
    await taper(page, '.f-bornes', 'base', '7')
    await cliquer(page, '.f-bornes', 'haut', '.less')
    await cliquer(page, '.f-bornes', 'bas', PLUS.number)
    await taper(page, '.f-bornes', 'pas', '10')
    assert.deepEqual(await page.evaluate(`__v('.f-bornes')`), ['haut=10', 'bas=5', 'pas=10', 'base=7'], 'les boutons ramènent dans les bornes')
    assert.deepEqual(await page.evaluate(`__inv('.f-bornes')`), [], 'tout est valide')
    assert.equal(await page.evaluate(`__q('.f-bornes').checkValidity()`), true)
    await cliquer(page, '.f-bornes', 'go')
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?haut=10&bas=5&pas=10&base=7'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('form.reset() : le nombre, le bouton rotatif et la jauge reviennent à leur départ, et leur validité avec', async function () {
    await taper(page, '.f-oblig', 'nb', '5')
    await touche(page, '.f-oblig', 'kn', 'ArrowUp')
    await cliquer(page, '.f-oblig', 'ga', PLUS.gauge)
    assert.deepEqual(await page.evaluate(`__v('.f-oblig')`), ['nb=5', 'kn=51', 'ga=1'], 'préalable : les trois ont bougé')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [])
    await page.evaluate(`__q('.f-oblig').reset()`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__v('.f-oblig')`), ['nb=', 'kn=50', 'ga=0'], 'retour au départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['nb=', 'kn=50', 'ga=0'])
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['nb'], 'la validité suit la remise à zéro')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), false)
    await taper(page, '.f-bornes', 'pas', '7')
    await cliquer(page, '.f-bornes', 'haut', '.less')
    assert.deepEqual(await page.evaluate(`__inv('.f-bornes')`), ['bas', 'pas'], 'préalable : le max atteint, 7 hors du pas')
    await page.evaluate(`__q('.f-bornes').reset()`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__v('.f-bornes')`), ['haut=15', 'bas=2', 'pas=10', 'base=2'], 'retour au départ, hors des bornes compris')
    assert.deepEqual(await page.evaluate(`__inv('.f-bornes')`), ['haut', 'bas'], 'la validité suit')
    await taper(page, '.f-oblig', 'nb', '8')
    await cliquer(page, '.f-oblig', 'rz')
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__v('.f-oblig')`), ['nb=', 'kn=50', 'ga=0'], 'le bouton « reset » : même chose')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['nb'])
    assert.deepEqual(erreurs, [])
  })

  it('<label for> vise le module : un clic sur l\'étiquette met le focus dans sa saisie, sans rien changer ; un clic dans le module fait un pas, jamais deux', async function () {
    const vises = await page.evaluate(`['nb', 'kn', 'ga'].map((c) => __q('.f-etiquette .l-' + c).control === __m('.f-etiquette', '.' + c))`)
    assert.deepEqual(vises, [true, true, true], 'label.control est la balise du module')
    await page.evaluate(`window.__ch = []; __q('.f-etiquette').addEventListener('change', (e) => __ch.push(e.target.className + '=' + e.data))`)
    await cliquer(page, '.f-etiquette', 'l-nb')
    assert.equal(await page.evaluate(`__focus()`), 'nb:input', 'le focus dans le champ du nombre')
    await cliquer(page, '.f-etiquette', 'l-kn')
    assert.equal(await page.evaluate(`__focus()`), 'kn:div', 'sur le cadran du bouton rotatif')
    await cliquer(page, '.f-etiquette', 'l-ga')
    assert.equal(await page.evaluate(`__focus()`), 'ga:div', 'sur le compteur de la jauge')
    assert.deepEqual(await page.evaluate(`__v('.f-etiquette')`), ['nb=3', 'kn=50', 'ga=0'], 'rien ne bouge')
    assert.deepEqual(await page.evaluate(`__ch`), [], 'aucun change')
    await cliquer(page, '.f-etiquette', 'l-kn')
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(150)
    assert.deepEqual(await page.evaluate(`__v('.f-etiquette')`), ['nb=3', 'kn=51', 'ga=0'], 'le clavier suit le focus posé par l\'étiquette')
    await cliquer(page, '.f-etiquette', 'nb', PLUS.number)
    await cliquer(page, '.f-etiquette', 'ga', PLUS.gauge)
    assert.deepEqual(await page.evaluate(`__v('.f-etiquette')`), ['nb=4', 'kn=51', 'ga=1'], 'un clic dans le module : un pas')
    assert.deepEqual(await page.evaluate(`__ch`), ['kn=51', 'nb=4', 'ga=1'], 'un change par geste')
    assert.deepEqual(await page.evaluate(`__fd('.f-etiquette')`), ['nb=4', 'kn=51', 'ga=1'])
    assert.deepEqual(erreurs, [])
  })

  it('<fieldset disabled> désactive les trois modules, et les réactive', async function () {
    const etat = () => page.evaluate(`['nb', 'kn', 'ga'].map((c) => __m('.f-fieldset', '.' + c).matches(':disabled') + '/' + __coupe('.f-fieldset', '.' + c))`)
    const gestes = async () => {
      await cliquer(page, '.f-fieldset', 'nb', PLUS.number)
      await touche(page, '.f-fieldset', 'kn', 'ArrowUp')
      await cliquer(page, '.f-fieldset', 'ga', PLUS.gauge)
    }
    assert.deepEqual(await etat(), ['true/true', 'true/true', 'true/true'], ':disabled sur la balise, la saisie désactivée')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), true, 'désactivé, le nombre obligatoire ne compte plus')
    assert.deepEqual(await page.evaluate(`__inv('.f-fieldset')`), [])
    await gestes()
    assert.deepEqual(await page.evaluate(`__v('.f-fieldset')`), ['nb=', 'kn=20', 'ga=4'], 'aucun geste ne les change')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), [], 'rien ne part')
    await page.evaluate(`__q('.f-fieldset .fs').disabled = false`)
    await page.waitForTimeout(200)
    assert.deepEqual(await etat(), ['false/false', 'false/false', 'false/false'], 'réactivés')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), false, 'réactivé, required compte de nouveau')
    assert.deepEqual(await page.evaluate(`__inv('.f-fieldset')`), ['nb'])
    await gestes()
    assert.deepEqual(await page.evaluate(`__v('.f-fieldset')`), ['nb=1', 'kn=21', 'ga=5'])
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['nb=1', 'kn=21', 'ga=5'])
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), true)
    await page.evaluate(`__q('.f-fieldset .fs').disabled = true`)
    await page.waitForTimeout(200)
    assert.deepEqual(await etat(), ['true/true', 'true/true', 'true/true'], 'de nouveau désactivés')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), [], 'un champ désactivé ne part pas')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change : les paires envoyées, une par module, jamais deux ; disabled="false" écrit sur la balise laisse le module actif', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['nb=3', 'kn=20', 'ga=4', 'nf=6', 'kf=30', 'gf=5'])
    assert.deepEqual(await page.evaluate(`__mods('.f-libre').map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`), ['nb:1', 'kn:1', 'ga:1', 'nf:1', 'kf:1', 'gf:1'], 'un champ caché par module')
    assert.deepEqual(await page.evaluate(`['nf', 'kf', 'gf'].map((c) => __coupe('.f-libre', '.' + c))`), [false, false, false], 'disabled="false" : la saisie reste active')
    assert.deepEqual(await page.evaluate(`['nf', 'kf', 'gf'].map((c) => __m('.f-libre', '.' + c).matches(':disabled') + '/' + __m('.f-libre', '.' + c).hasAttribute('disabled'))`), ['false/false', 'false/false', 'false/false'], 'l\'attribut « false » est ôté : la balise n\'est pas :disabled')
    await cliquer(page, '.f-libre', 'nf', PLUS.number)
    await touche(page, '.f-libre', 'kf', 'ArrowUp')
    await cliquer(page, '.f-libre', 'gf', PLUS.gauge)
    assert.deepEqual(await page.evaluate(`__v('.f-libre')`), ['nb=3', 'kn=20', 'ga=4', 'nf=7', 'kf=31', 'gf=6'], 'et répond aux gestes')
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['nb=3', 'kn=20', 'ga=4', 'nf=7', 'kf=31', 'gf=6'])
    await cliquer(page, '.f-libre', 'go')
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?nb=3&kn=20&ga=4&nf=7&kf=31&gf=6'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change hors formulaire : le geste fait un pas, change est annoncé, le champ suit, aucune erreur', async function () {
    await page.evaluate(`window.__ch = []; __q('.hors').addEventListener('change', (e) => __ch.push(e.target.className + '=' + e.data))`)
    await cliquer(page, '.hors', 'nb', PLUS.number)
    await touche(page, '.hors', 'kn', 'ArrowUp')
    await cliquer(page, '.hors', 'ga', PLUS.gauge)
    assert.deepEqual(await page.evaluate(`__v('.hors')`), ['nb=2', 'kn=11', 'ga=3'])
    assert.deepEqual(await page.evaluate(`__ch`), ['nb=2', 'kn=11', 'ga=3'])
    assert.deepEqual(await page.evaluate(`__mods('.hors').map((m) => m.className + ':' + Array.from(m.querySelectorAll(':scope > input[type=hidden]')).map((i) => i.name + '=' + i.value).join(','))`), ['nb:hnb=2', 'kn:hkn=11', 'ga:hga=3'], 'le champ caché suit la valeur, comme avant')
    assert.deepEqual(erreurs, [])
  })

  // le libellé (aria-label), qui suit la langue de la page, n'est pas comparé ici : d'autres tests le gardent
  it('rien ne change pour l\'accessibilité : rôles et aria-* de la saisie, rien sur la balise du module', async function () {
    const a11y = await page.evaluate(`['nb', 'kn', 'ga'].map((c) => {
      const m = __m('.f-libre', '.' + c)
      const s = __s('.f-libre', '.' + c)
      const garde = (a) => a === 'role' || a === 'tabindex' || a.startsWith('aria-')
      const balise = Array.from(m.attributes).map((a) => a.name).filter(garde)
      const saisie = Array.from(s.attributes).filter((a) => garde(a.name) && a.name !== 'aria-label').map((a) => a.name + '=' + a.value).sort()
      return saisie.join(' ') + ' | ' + balise.join(',')
    })`)
    assert.deepEqual(a11y, [
      'aria-valuenow=3 role=spinbutton | ',
      'aria-disabled=false aria-valuemax=100 aria-valuemin=0 aria-valuenow=20 role=slider tabindex=0 | ',
      'aria-valuemax=10 aria-valuemin=0 aria-valuenow=4 role=spinbutton tabindex=0 | '
    ])
    assert.deepEqual(erreurs, [])
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`repli : un navigateur sans attachInternals garde le comportement d'avant, nombre, bouton rotatif et jauge (${nom} réel)`, function () {
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

  it('required, min et max sans effet, aucune étiquette ne vise le module, les paires et les gestes d\'avant, aucune erreur', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.attachInternals`), 'undefined', 'préalable : le navigateur simulé n\'a pas attachInternals')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true, 'le formulaire ne voit pas les modules')
    assert.equal(await page.evaluate(`__q('.f-bornes').checkValidity()`), true)
    assert.deepEqual(await page.evaluate(`[__inv('.f-oblig'), __inv('.f-bornes')]`), [[], []])
    assert.equal(await page.evaluate(`__q('.f-etiquette .l-nb').control`), null, 'l\'étiquette ne vise rien, comme avant')
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['nb=3', 'kn=20', 'ga=4', 'nf=6', 'kf=30', 'gf=5'])
    await cliquer(page, '.f-libre', 'nb', PLUS.number)
    await touche(page, '.f-libre', 'kn', 'ArrowUp')
    await cliquer(page, '.f-libre', 'ga', PLUS.gauge)
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['nb=4', 'kn=21', 'ga=5', 'nf=6', 'kf=30', 'gf=5'])
    assert.deepEqual(erreurs, [])
  })
})
