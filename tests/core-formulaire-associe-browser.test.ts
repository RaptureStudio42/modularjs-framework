// Les modules de saisie du cœur reconnus par le formulaire : <@@checkbox>, <@@switch>, <@@radio> sont des éléments associés au formulaire.
// - `required` a l'effet d'un champ natif : form.checkValidity() et reportValidity(), l'envoi bloqué (la bulle du navigateur), `:invalid` /
//   `:valid` sur la balise du module, le message du navigateur (celui d'une case native), puis l'envoi dès que tout est coché.
// - Un groupe de <@@radio> obligatoire (un bouton au moins porte `required`) : tous ses boutons manquent tant qu'aucun n'est coché, une seule
//   bulle (celle du premier bouton du groupe), levée dès qu'un bouton du groupe est coché, quel qu'il soit.
// - Une `<label for>` vise le module : un clic sur l'étiquette coche la case, allume l'interrupteur, choisit le bouton — une fois, avec son change.
// - Un `<fieldset disabled>` désactive les trois modules (aucun clic ne les change, la validité ne compte plus), et les réactive.
// - `form.reset()` les ramène à leur départ, et leur validité suit.
// Ce qui ne change pas : les paires envoyées (une par module coché, jamais deux), un module hors formulaire, les rôles et `aria-*`, et un
// navigateur sans attachInternals (repli silencieux : le comportement d'avant).
// Chromium, Firefox et WebKit réels : de vrais clics, un vrai envoi du formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<form class="f-oblig" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" required>case</@@checkbox>
  <@@switch class="sw" name="sw" required>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x">x</@@radio>
  <@@radio class="r2" name="g" value="y" required>y</@@radio>
  <@@radio class="r3" name="g" value="z">z</@@radio>
  <button type="submit" class="go">envoyer</button>
  <button type="reset" class="rz">remise à zéro</button>
</form>

<form class="f-groupe" method="get" action="/envoi" @noUJS>
  <@@radio class="r1" name="t" value="a">a</@@radio>
  <@@radio class="r2" name="t" value="b" required>b</@@radio>
  <@@radio class="r3" name="t" value="c">c</@@radio>
</form>

<form class="f-libre" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" name="cb" checked={true}>case</@@checkbox>
  <@@switch class="sw" name="sw">interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x">x</@@radio>
  <@@radio class="r2" name="g" value="y" checked>y</@@radio>
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-etiquette" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cb" id="e-cb" name="cb">case</@@checkbox>
  <@@switch class="sw" id="e-sw" name="sw">interrupteur</@@switch>
  <@@radio class="r1" id="e-r1" name="g" value="x">x</@@radio>
  <@@radio class="r2" id="e-r2" name="g" value="y">y</@@radio>
  <label class="l-cb" for="e-cb">étiquette de la case</label>
  <label class="l-sw" for="e-sw">étiquette de l'interrupteur</label>
  <label class="l-r1" for="e-r1">étiquette de x</label>
  <label class="l-r2" for="e-r2">étiquette de y</label>
</form>

<form class="f-fieldset" method="get" action="/envoi" @noUJS>
  <fieldset class="fs" disabled>
    <@@checkbox class="cb" name="cb" required>case</@@checkbox>
    <@@switch class="sw" name="sw" required>interrupteur</@@switch>
    <@@radio class="r1" name="g" value="x" required>x</@@radio>
    <@@radio class="r2" name="g" value="y">y</@@radio>
  </fieldset>
</form>

<div class="hors">
  <@@checkbox class="cb" name="hcb">case hors formulaire</@@checkbox>
  <@@switch class="sw" name="hsw">interrupteur hors formulaire</@@switch>
  <@@radio class="r1" name="hg" value="x">x</@@radio>
  <@@radio class="r2" name="hg" value="y">y</@@radio>
</div>

<input class="natif-case" type="checkbox" required>
<input class="natif-radio" type="radio" name="natif" required>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio'
const NOMBRE  = 24

// la pièce visible sur laquelle on clique, pour chaque module
const PIECE: Record<string, string> = { cb: '.box', sw: '.pill', r1: '.ring', r2: '.ring', r3: '.ring' }

// aides de la page : un module d'un bloc, sa case native, l'état de chacun, les données du formulaire
const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__m   = (b, c) => __q(b).querySelector(c)
  window.__n   = (b, c) => __m(b, c)._shadow.querySelector('input.native')
  window.__fd  = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__inv = (b) => Array.from(__q(b).querySelectorAll('${MODULES}')).filter((m) => m.matches(':invalid')).map((m) => m.className)
  window.__val = (b) => Array.from(__q(b).querySelectorAll('${MODULES}')).filter((m) => m.matches(':valid')).map((m) => m.className)
  window.__coche = (b) => Array.from(__q(b).querySelectorAll('${MODULES}')).filter((m) => m._shadow.querySelector('input.native').checked).map((m) => m.className)
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
    const root   = mjsTmp('formulaire-associe')
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
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow.querySelector('input.native'))
  })()`)
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

// un vrai clic au centre d'une pièce visible : la case, la pastille, l'anneau d'un module, ou une balise du bloc (étiquette, bouton)
async function cliquer(page: any, bloc: string, cls: string, piece = true) {
  const { x, y } = await page.evaluate(`(() => {
    const el = __m('${bloc}', '.${cls}')
    el.scrollIntoView({ block: 'center' })
    const r = (${piece} ? el._shadow.querySelector('${PIECE[cls] ?? ''}') : el).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.mouse.click(x, y)
  await page.waitForTimeout(150)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`les modules de saisie du cœur reconnus par le formulaire (${nom} réel)`, function () {
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

  it('required : le formulaire voit la case, l\'interrupteur et le groupe — checkValidity(), :invalid, le message du navigateur', async function () {
    const vu = await page.evaluate(`(() => {
      const f = __q('.f-oblig')
      const message = (c) => __m('.f-oblig', c).validationMessage
      return {
        valide: f.checkValidity(),
        elements: Array.from(f.elements).filter((e) => e.localName.startsWith('mjs-core-')).map((e) => e.className),
        invalides: __inv('.f-oblig'),
        manque: ['cb', 'sw', 'r1', 'r2', 'r3'].map((c) => __m('.f-oblig', '.' + c).validity?.valueMissing === true),
        messages: [message('.cb'), message('.sw'), message('.r1'), message('.r2'), message('.r3')],
        natifs: [__q('.natif-case').validationMessage, __q('.natif-radio').validationMessage]
      }
    })()`)
    assert.equal(vu.valide, false, 'le formulaire ne passe pas')
    assert.deepEqual(vu.elements, ['cb', 'sw', 'r1', 'r2', 'r3'], 'les modules sont des éléments du formulaire')
    assert.deepEqual(vu.invalides, ['cb', 'sw', 'r1', 'r2', 'r3'], ':invalid sur la balise de chaque module, sur tout le groupe')
    assert.deepEqual(vu.manque, [true, true, true, true, true], 'validity.valueMissing')
    assert.ok(vu.natifs[0] && vu.natifs[1], 'préalable : le navigateur donne un message pour une case et un bouton natifs')
    assert.deepEqual(vu.messages, [vu.natifs[0], vu.natifs[0], vu.natifs[1], vu.natifs[1], vu.natifs[1]], 'le message est celui du navigateur pour une case ou un bouton natif')
    assert.deepEqual(erreurs, [])
  })

  it('required : reportValidity() et l\'envoi bloqué, puis l\'envoi dès que tout est coché — une paire par module', async function () {
    await page.evaluate(`window.__ev = []; __q('.f-oblig').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-oblig').reportValidity()`), false, 'reportValidity() rend false')
    assert.deepEqual(await page.evaluate(`__ev`), ['cb', 'sw', 'r1', 'r2', 'r3'], 'invalid sur chaque module qui manque')
    assert.equal(await page.evaluate(`__focus()`), 'cb:input', 'la bulle va au premier module qui manque, le focus sur sa case')
    await cliquer(page, '.f-oblig', 'go', false)
    await page.waitForTimeout(400)
    assert.deepEqual(envois, [], 'l\'envoi est bloqué')
    await cliquer(page, '.f-oblig', 'cb')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['sw', 'r1', 'r2', 'r3'], 'la case cochée est valide')
    await cliquer(page, '.f-oblig', 'sw')
    await cliquer(page, '.f-oblig', 'r3')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [], 'plus rien ne manque')
    assert.deepEqual(await page.evaluate(`__val('.f-oblig')`), ['cb', 'sw', 'r1', 'r2', 'r3'], ':valid sur chaque balise')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true)
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['cb=on', 'sw=on', 'g=z'], 'une paire par module coché')
    await cliquer(page, '.f-oblig', 'go', false)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?cb=on&sw=on&g=z'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('un groupe radio obligatoire : tous ses boutons manquent, une seule bulle sur le premier, levée par n\'importe quel bouton coché', async function () {
    assert.deepEqual(await page.evaluate(`__inv('.f-groupe')`), ['r1', 'r2', 'r3'], 'le groupe entier manque, pas seulement le bouton qui porte required')
    await page.evaluate(`window.__ev = []; __q('.f-groupe').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-groupe').reportValidity()`), false)
    assert.equal(await page.evaluate(`__focus()`), 'r1:input', 'la bulle du groupe va à son premier bouton')
    await cliquer(page, '.f-groupe', 'r3')
    assert.deepEqual(await page.evaluate(`__inv('.f-groupe')`), [], 'le troisième bouton coché lève la bulle de tout le groupe')
    assert.deepEqual(await page.evaluate(`__val('.f-groupe')`), ['r1', 'r2', 'r3'])
    assert.equal(await page.evaluate(`__q('.f-groupe').checkValidity()`), true)
    await cliquer(page, '.f-groupe', 'r1')
    assert.deepEqual(await page.evaluate(`__inv('.f-groupe')`), [], 'un autre bouton coché : toujours valide')
    assert.deepEqual(await page.evaluate(`__coche('.f-groupe')`), ['r1'])
    assert.deepEqual(erreurs, [])
  })

  it('form.reset() : la case, l\'interrupteur et le groupe reviennent à leur départ, et leur validité avec', async function () {
    await cliquer(page, '.f-oblig', 'cb')
    await cliquer(page, '.f-oblig', 'sw')
    await cliquer(page, '.f-oblig', 'r1')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [], 'préalable : tout est coché')
    await page.evaluate(`__q('.f-oblig').reset()`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__coche('.f-oblig')`), [], 'retour au départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), [])
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['cb', 'sw', 'r1', 'r2', 'r3'], 'la validité suit la remise à zéro')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), false)
    await cliquer(page, '.f-oblig', 'rz', false)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['cb', 'sw', 'r1', 'r2', 'r3'], 'le bouton « reset » : même chose')
    assert.deepEqual(erreurs, [])
  })

  it('<label for> vise le module : un clic sur l\'étiquette coche la case, allume l\'interrupteur, choisit le bouton — une fois, avec son change', async function () {
    const vises = await page.evaluate(`['cb', 'sw', 'r1', 'r2'].map((c) => __q('.f-etiquette .l-' + c).control === __m('.f-etiquette', '.' + c))`)
    assert.deepEqual(vises, [true, true, true, true], 'label.control est la balise du module')
    await page.evaluate(`window.__ch = []; __q('.f-etiquette').addEventListener('change', (e) => __ch.push(e.target.className + '=' + e.data))`)
    await cliquer(page, '.f-etiquette', 'l-cb', false)
    assert.deepEqual(await page.evaluate(`__coche('.f-etiquette')`), ['cb'], 'l\'étiquette coche la case')
    await cliquer(page, '.f-etiquette', 'l-sw', false)
    await cliquer(page, '.f-etiquette', 'l-r2', false)
    assert.deepEqual(await page.evaluate(`__coche('.f-etiquette')`), ['cb', 'sw', 'r2'])
    await cliquer(page, '.f-etiquette', 'l-r1', false)
    await cliquer(page, '.f-etiquette', 'l-cb', false)
    assert.deepEqual(await page.evaluate(`__coche('.f-etiquette')`), ['sw', 'r1'], 'un second clic décoche, un autre bouton du groupe se choisit')
    assert.deepEqual(await page.evaluate(`__fd('.f-etiquette')`), ['sw=on', 'g=x'])
    assert.deepEqual(await page.evaluate(`__ch`), ['cb=true', 'sw=true', 'r2=y', 'r1=x', 'cb=false'], 'un change par clic sur l\'étiquette, jamais deux')
    await cliquer(page, '.f-etiquette', 'cb')
    assert.deepEqual(await page.evaluate(`__coche('.f-etiquette')`), ['cb', 'sw', 'r1'], 'un clic sur la case elle-même la coche une fois')
    await page.evaluate(`__m('.f-etiquette', '.sw').click()`)
    await page.waitForTimeout(150)
    assert.deepEqual(await page.evaluate(`__coche('.f-etiquette')`), ['cb', 'r1'], 'un click() de la page sur la balise la bascule, comme sur une case native')
    assert.deepEqual(erreurs, [])
  })

  it('<fieldset disabled> désactive les trois modules, et les réactive', async function () {
    const desactive = () => page.evaluate(`['cb', 'sw', 'r1', 'r2'].map((c) => __m('.f-fieldset', '.' + c).matches(':disabled') + '/' + __n('.f-fieldset', '.' + c).disabled)`)
    assert.deepEqual(await desactive(), ['true/true', 'true/true', 'true/true', 'true/true'], ':disabled sur la balise, la case native désactivée')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), true, 'désactivés, les modules obligatoires ne comptent plus')
    await cliquer(page, '.f-fieldset', 'cb')
    await cliquer(page, '.f-fieldset', 'r2')
    assert.deepEqual(await page.evaluate(`__coche('.f-fieldset')`), [], 'aucun clic ne les change')
    await page.evaluate(`__q('.f-fieldset .fs').disabled = false`)
    await page.waitForTimeout(200)
    assert.deepEqual(await desactive(), ['false/false', 'false/false', 'false/false', 'false/false'], 'réactivés')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), false, 'réactivés, required compte de nouveau')
    await cliquer(page, '.f-fieldset', 'cb')
    await cliquer(page, '.f-fieldset', 'r2')
    assert.deepEqual(await page.evaluate(`__coche('.f-fieldset')`), ['cb', 'r2'])
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['cb=on', 'g=y'])
    await page.evaluate(`__q('.f-fieldset .fs').disabled = true`)
    await page.waitForTimeout(200)
    assert.deepEqual(await desactive(), ['true/true', 'true/true', 'true/true', 'true/true'], 'de nouveau désactivés')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), [], 'un champ désactivé ne part pas')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change : les paires envoyées, une par module coché, jamais deux', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['cb=on', 'g=y'])
    assert.deepEqual(await page.evaluate(`Array.from(__q('.f-libre').querySelectorAll('${MODULES}')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`), ['cb:1', 'sw:0', 'r1:0', 'r2:1'], 'un champ caché par module coché')
    await cliquer(page, '.f-libre', 'sw')
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['cb=on', 'sw=on', 'g=y'])
    await cliquer(page, '.f-libre', 'go', false)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?cb=on&sw=on&g=y'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change hors formulaire : le clic coche, change est annoncé, le champ suit, aucune erreur', async function () {
    await page.evaluate(`window.__ch = []; __q('.hors').addEventListener('change', (e) => __ch.push(e.target.className + '=' + e.data))`)
    await cliquer(page, '.hors', 'cb')
    await cliquer(page, '.hors', 'sw')
    await cliquer(page, '.hors', 'r2')
    assert.deepEqual(await page.evaluate(`__coche('.hors')`), ['cb', 'sw', 'r2'])
    assert.deepEqual(await page.evaluate(`__ch`), ['cb=true', 'sw=true', 'r2=y'])
    assert.deepEqual(await page.evaluate(`Array.from(__q('.hors').querySelectorAll('${MODULES}')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`), ['cb:1', 'sw:1', 'r1:0', 'r2:1'], 'le champ caché suit l\'état, comme avant')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change pour l\'accessibilité : rôles et aria-* des cases natives, rien sur la balise du module', async function () {
    const a11y = await page.evaluate(`['cb', 'sw', 'r1'].map((c) => {
      const m = __m('.f-libre', '.' + c)
      const n = __n('.f-libre', '.' + c)
      const balise = Array.from(m.attributes).map((a) => a.name).filter((a) => a === 'role' || a.startsWith('aria-'))
      const piece = m._shadow.querySelector('[aria-hidden]')
      return [n.type, n.getAttribute('role'), n.hasAttribute('required'), n.hasAttribute('aria-required'), piece && piece.getAttribute('aria-hidden'), balise.join(',')].join('|')
    })`)
    assert.deepEqual(a11y, ['checkbox||false|false|true|', 'checkbox|switch|false|false|true|', 'radio||false|false|true|'])
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`repli : un navigateur sans attachInternals garde le comportement d'avant (${nom} réel)`, function () {
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

  it('required sans effet, aucune étiquette ne vise le module, les paires et les clics d\'avant, aucune erreur', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.attachInternals`), 'undefined', 'préalable : le navigateur simulé n\'a pas attachInternals')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true, 'le formulaire ne voit pas les modules')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [])
    assert.equal(await page.evaluate(`__q('.f-etiquette .l-cb').control`), null, 'l\'étiquette ne vise rien, comme avant')
    assert.deepEqual(await page.evaluate(`__fd('.f-libre')`), ['cb=on', 'g=y'])
    await cliquer(page, '.f-oblig', 'cb')
    await cliquer(page, '.f-oblig', 'r3')
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['cb=on', 'g=z'])
    assert.deepEqual(await page.evaluate(`__coche('.f-oblig')`), ['cb', 'r3'])
    assert.deepEqual(erreurs, [])
  })
})

// un composant de l'application qui déclare `@formAssociated` : le même socle, sans rien du cœur à écrire — sa balise est un élément du
// formulaire, une `<label for>` la vise, `@@internals` donne ses ElementInternals (ici, la valeur envoyée par `setFormValue`) et
// `$formDisabled` suit le `<fieldset disabled>` autour de lui
const ACCORD = `@formAssociated

<script>
  $oui          = false
  $formDisabled = false

  @basculer = -> $oui = not $oui

  µeffect ->
    $oui
    @@internals?.setFormValue(if $oui then 'oui' else null)
</script>

<button type="button" class="b" disabled={$formDisabled} @click={@basculer()}>{$oui}</button>
`

const HOTE_APPLI = `<form class="f-appli" method="get" action="/envoi" @noUJS>
  <fieldset class="fs">
    <@accord class="ac" id="ac" name="accord"></@accord>
  </fieldset>
  <label class="l-ac" for="ac">étiquette de l'accord</label>
</form>
`

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`un composant de l'application déclaré @formAssociated (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const root   = mjsTmp('formulaire-associe-appli')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), HOTE_APPLI)
      writeFileSync(join(srcDir, 'accord.mjs'), ACCORD)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const order  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      const script = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      browser = await ouvrir(nom, playwright)
      page    = await browser.newPage()
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.ac')?._shadow?.querySelector('.b'))
      await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s); window.__fd = () => Array.from(new FormData(__q('.f-appli'))).map((p) => p[0] + '=' + p[1])`)
      await page.waitForTimeout(300)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('élément du formulaire, visé par son étiquette, sa valeur par @@internals, désactivé puis réactivé par le fieldset ($formDisabled)', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`Array.from(__q('.f-appli').elements).includes(__q('.ac'))`), true, 'un élément du formulaire')
    assert.equal(await page.evaluate(`__q('.l-ac').control === __q('.ac')`), true, 'l\'étiquette le vise')
    assert.deepEqual(await page.evaluate(`__fd()`), [])
    await page.evaluate(`__q('.ac')._shadow.querySelector('.b').click()`)
    await page.waitForTimeout(150)
    assert.deepEqual(await page.evaluate(`__fd()`), ['accord=oui'], 'la valeur posée par setFormValue part avec le formulaire')
    await page.evaluate(`__q('.fs').disabled = true`)
    await page.waitForTimeout(150)
    assert.deepEqual(await page.evaluate(`[__q('.ac')._state.formDisabled, __q('.ac').matches(':disabled'), __q('.ac')._shadow.querySelector('.b').disabled]`), [true, true, true], '$formDisabled suit le fieldset')
    assert.deepEqual(await page.evaluate(`__fd()`), [], 'désactivé, il ne part pas')
    await page.evaluate(`__q('.fs').disabled = false`)
    await page.waitForTimeout(150)
    assert.deepEqual(await page.evaluate(`[__q('.ac')._state.formDisabled, __q('.ac')._shadow.querySelector('.b').disabled]`), [false, false])
    assert.deepEqual(await page.evaluate(`__fd()`), ['accord=oui'])
  })
})
