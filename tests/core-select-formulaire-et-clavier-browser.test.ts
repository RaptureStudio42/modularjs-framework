// <@@select> élément du formulaire, saisie au vol, Page haut / Page bas, dans Chromium, Firefox et WebKit réels (de vrais clics, de vraies
// touches, un vrai envoi du formulaire).
// - `required` a l'effet d'un <select required> natif : form.checkValidity() et reportValidity(), l'envoi bloqué (la bulle, le focus sur le
//   bouton de la liste), `:invalid` / `:valid` sur la balise, le message du navigateur (celui d'un <select required> natif) ; une valeur vide
//   choisie manque aussi ; en `multiple`, rien de coché manque ;
// - `<label for="id">` vise la liste : un clic sur l'étiquette met le focus sur son bouton, comme sur un <select> natif, sans l'ouvrir ;
// - `<fieldset disabled>` désactive la liste, et la réactive ; `disabled` de la liste s'y ajoute ; `disabled="false"` la laisse active ;
// - `form.reset()` ramène le choix de départ, et la validité suit ;
// - saisie au vol, liste fermée ou ouverte : une lettre va à la prochaine option qui commence par elle, sans accents ni casse, la même lettre
//   retapée passe à la suivante, des lettres tapées vite cherchent le début du libellé ; ouverte, la ligne active suit (`aria-activedescendant`
//   aussi) ; fermée, le choix se fait comme à la souris ; en `multiple`, la liste s'ouvre sur l'option ; Espace garde son rôle, sauf au milieu
//   d'une saisie ; une réponse libre donnée n'est pas remplacée sur la liste fermée ; avec `search`, la liste ouverte laisse les lettres au champ ;
// - Page haut / Page bas, liste ouverte : la ligne active avance ou recule d'une page visible, bornée au début et à la fin ; Début / Fin restent ;
// Ce qui ne change pas : les paires envoyées (une par valeur choisie), les rôles et `aria-*`, et un navigateur sans attachInternals (repli
// silencieux : le comportement d'avant).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const F = (v: string, l: string) => `<@@option value="${v}">${l}</@@option>`

const FRUITS = [F('abricot', 'Abricot'), F('banane', 'Banane'), F('bleuet', 'Bleuet'), F('cerise', 'Cerise'), F('ecorce', 'Écorce'), F('eglantine', 'Églantine'), F('figue', 'Figue')].join('')
const VILLES = [F('nantes', 'Nantes'), F('nj', 'New Jersey'), F('ny', 'New York'), F('nice', 'Nice')].join('')
const LONGUE = Array.from({ length: 30 }, (_, i) => F('o' + (i + 1), 'Option ' + String(i + 1).padStart(2, '0'))).join('')

const PAGE = `<form class="f-oblig" method="get" action="/envoi" @noUJS>
  <@@select class="s" name="s" required>${FRUITS}</@@select>
  <@@select class="m" name="m" multiple required>${FRUITS}</@@select>
  <@@select class="v" name="v" required value="">${F('', 'Choisir un fruit')}${FRUITS}</@@select>
  <button type="submit" class="go">envoyer</button>
  <button type="reset" class="rz">remise à zéro</button>
</form>

<form class="f-depart" method="get" action="/envoi" @noUJS>
  <@@select class="s" name="s" required value="banane">${FRUITS}</@@select>
  <@@select class="m" name="m" multiple required value={['cerise', 'figue']}>${FRUITS}</@@select>
</form>

<form class="f-etiquette" method="get" action="/envoi" @noUJS>
  <@@select class="s" id="e-s" name="s">${FRUITS}</@@select>
  <label class="l-s" for="e-s">étiquette de la liste</label>
</form>

<form class="f-fieldset" method="get" action="/envoi" @noUJS>
  <fieldset class="fs" disabled>
    <@@select class="s" name="s" required>${FRUITS}</@@select>
    <@@select class="b" name="b" value="banane">${FRUITS}</@@select>
    <@@select class="d" name="d" disabled value="cerise">${FRUITS}</@@select>
  </fieldset>
  <@@select class="faux" name="faux" disabled="false" value="figue">${FRUITS}</@@select>
</form>

<form class="f-clavier" method="get" action="/envoi" @noUJS>
  <@@select class="fermee" name="fermee">${FRUITS}</@@select>
  <@@select class="ouverte" name="ouverte" value="abricot">${FRUITS}</@@select>
  <@@select class="multi" name="multi" multiple>${FRUITS}</@@select>
  <@@select class="villes" name="villes">${VILLES}</@@select>
  <@@select class="cherche" name="cherche" search>${FRUITS}</@@select>
  <@@select class="libre" name="libre" other value="Zed">${FRUITS}</@@select>
  <@@select class="longue" name="longue">${LONGUE}</@@select>
</form>

<select class="natif" required></select>
<select class="natif-multi" multiple required></select>
`

const NOMBRE = 17

// aides de la page : une liste d'un bloc, son bouton, son état, les données du formulaire, la validité de chaque liste du bloc
const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__m   = (b, c) => __q(b).querySelector(c)
  window.__btn = (b, c) => __m(b, c)._shadow.querySelector('.select-btn')
  window.__fd  = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__inv = (b) => Array.from(__q(b).querySelectorAll('mjs-core-select')).filter((m) => m.matches(':invalid')).map((m) => m.className)
  window.__val = (b) => Array.from(__q(b).querySelectorAll('mjs-core-select')).filter((m) => m.matches(':valid')).map((m) => m.className)
  window.__etat = (b, c) => {
    const m = __m(b, c), s = m._shadow
    const act   = s.querySelector('.select-option.active')
    const champ = s.querySelector('.select-search')
    return {
      valeur: m._state.value,
      ouverte: !!s.querySelector('.select-panel'),
      active: act ? act.querySelector('.select-option-label').textContent.trim() : null,
      suit: (champ || s.querySelector('.select-btn')).getAttribute('aria-activedescendant') === (act ? act.id : null),
      bouton: s.querySelector('.select-label').textContent.trim(),
      champs: Array.from(m.querySelectorAll(':scope > input[type=hidden]')).map((i) => i.name + '=' + i.value)
    }
  }
  window.__lignes = (b, c) => Array.from(__m(b, c)._shadow.querySelectorAll('.select-option')).map((o) => o.querySelector('.select-option-label').textContent.trim())
  // la ligne active de la liste ouverte : sa place, si elle se voit en entier dans le panneau, et combien de lignes s'y voient en entier
  window.__page = (b, c) => {
    const s = __m(b, c)._shadow, p = s.querySelector('.select-panel'), lignes = Array.from(s.querySelectorAll('.select-option'))
    const act = s.querySelector('.select-option.active'), pr = p.getBoundingClientRect(), haut = pr.top + p.clientTop
    const vues = lignes.filter((l) => { const r = l.getBoundingClientRect(); return r.top >= haut - 0.5 && r.bottom <= haut + p.clientHeight + 0.5 })
    return { place: lignes.indexOf(act), nombre: lignes.length, vues: vues.length, enVue: vues.includes(act), suit: s.querySelector('.select-btn').getAttribute('aria-activedescendant') === act.id }
  }
  // la liste où se trouve le focus (la balise dont l'ombre le porte), et l'élément focalisé dans son ombre
  window.__focus = () => {
    const m = document.querySelector('mjs-hote')._shadow.activeElement
    if (!m || !m._shadow) return null
    const dedans = m._shadow.activeElement
    return m.className + ':' + (dedans ? dedans.localName : 'rien')
  }
  window.__ch = []
  window.__se = []
  for (const f of document.querySelector('mjs-hote')._shadow.querySelectorAll('form')) {
    f.addEventListener('change', (e) => { if (e.target.localName === 'mjs-core-select') __ch.push(e.target.className + '=' + JSON.stringify(e.data)) })
    f.addEventListener('search', (e) => __se.push(e.target.className + '=' + e.data))
  }
})()`

let construit: Promise<string> | null = null

// le script concaténé de la page, construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('select-formulaire-clavier')
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
    const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-select')) : []
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow.querySelector('.select-btn'))
  })()`)
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

// un vrai clic au centre d'un élément de la page, désigné par une expression
async function cliquer(page: any, expr: string) {
  const { x, y } = await page.evaluate(`(() => {
    const el = ${expr}
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.mouse.click(x, y)
  await page.waitForTimeout(150)
}

const bouton = (b: string, c: string) => `__btn('${b}', '.${c}')`
const ligne  = (b: string, c: string, l: string) => `Array.from(__m('${b}', '.${c}')._shadow.querySelectorAll('.select-option')).find((o) => o.querySelector('.select-option-label').textContent.trim() === '${l}')`

// le focus sur le bouton de la liste fermée, sans l'ouvrir
async function viser(page: any, b: string, c: string) {
  await page.evaluate(`(() => { const el = ${bouton(b, c)}; el.scrollIntoView({ block: 'center' }); el.focus() })()`)
}

async function touche(page: any, k: string, pause = 60) {
  await page.keyboard.press(k)
  await page.waitForTimeout(pause)
}

// plus d'une demi-seconde sans toucher le clavier : la saisie suivante repart de zéro
const attendre = (page: any) => page.waitForTimeout(700)

const etat = (page: any, b: string, c: string) => page.evaluate(`__etat('${b}', '.${c}')`)

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> élément du formulaire, saisie au vol, Page haut / Page bas (${nom} réel)`, function () {
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

  it('required : le formulaire voit la liste — checkValidity(), :invalid, valueMissing, le message d\'un <select required> natif', async function () {
    const vu = await page.evaluate(`(() => {
      const f = __q('.f-oblig')
      return {
        valide: f.checkValidity(),
        elements: Array.from(f.elements).filter((e) => e.localName === 'mjs-core-select').map((e) => e.className),
        invalides: __inv('.f-oblig'),
        manque: ['s', 'm', 'v'].map((c) => __m('.f-oblig', '.' + c).validity?.valueMissing === true),
        messages: ['s', 'm', 'v'].map((c) => __m('.f-oblig', '.' + c).validationMessage),
        natifs: [__q('.natif').validationMessage, __q('.natif-multi').validationMessage],
        depart: [__q('.f-depart').checkValidity(), __inv('.f-depart').length, __val('.f-depart')]
      }
    })()`)
    assert.equal(vu.valide, false, 'le formulaire ne passe pas')
    assert.deepEqual(vu.elements, ['s', 'm', 'v'], 'les listes sont des éléments du formulaire')
    assert.deepEqual(vu.invalides, ['s', 'm', 'v'], ':invalid sans choix, en multiple sans rien de coché, sur une valeur vide')
    assert.deepEqual(vu.manque, [true, true, true], 'validity.valueMissing')
    assert.ok(vu.natifs[0] && vu.natifs[1], 'préalable : le navigateur donne un message pour un <select required> natif')
    assert.deepEqual(vu.messages, [vu.natifs[0], vu.natifs[1], vu.natifs[0]], 'le message est celui du navigateur pour un <select required> natif')
    assert.deepEqual(vu.depart, [true, 0, ['s', 'm']], 'une liste obligatoire qui a un choix est valide')
    assert.deepEqual(erreurs, [])
  })

  it('required : reportValidity() et l\'envoi bloqué (focus sur le bouton), puis l\'envoi dès que tout est choisi — une paire par valeur', async function () {
    await page.evaluate(`window.__ev = []; __q('.f-oblig').addEventListener('invalid', (e) => __ev.push(e.target.className), true)`)
    assert.equal(await page.evaluate(`__q('.f-oblig').reportValidity()`), false, 'reportValidity() rend false')
    assert.deepEqual(await page.evaluate(`__ev`), ['s', 'm', 'v'], 'invalid sur chaque liste qui manque')
    assert.equal(await page.evaluate(`__focus()`), 's:button', 'la bulle va à la première liste qui manque, le focus sur son bouton')
    await cliquer(page, `__q('.f-oblig .go')`)
    await page.waitForTimeout(400)
    assert.deepEqual(envois, [], 'l\'envoi est bloqué')
    await cliquer(page, bouton('.f-oblig', 's'))
    await cliquer(page, ligne('.f-oblig', 's', 'Cerise'))
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['m', 'v'], 'la liste qui a un choix est valide')
    await cliquer(page, bouton('.f-oblig', 'm'))
    await cliquer(page, ligne('.f-oblig', 'm', 'Banane'))
    await page.mouse.click(5, 5)
    await cliquer(page, bouton('.f-oblig', 'v'))
    await cliquer(page, ligne('.f-oblig', 'v', 'Figue'))
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [], 'plus rien ne manque')
    assert.deepEqual(await page.evaluate(`__val('.f-oblig')`), ['s', 'm', 'v'], ':valid sur chaque balise')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true)
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['s=cerise', 'm=banane', 'v=figue'], 'une paire par valeur choisie')
    await cliquer(page, `__q('.f-oblig .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?s=cerise&m=banane&v=figue'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('required : une valeur vide choisie manque, comme le texte d\'attente d\'un <select> natif ; en multiple, tout décocher manque', async function () {
    await cliquer(page, bouton('.f-oblig', 'v'))
    await cliquer(page, ligne('.f-oblig', 'v', 'Figue'))
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['s', 'm'])
    await cliquer(page, bouton('.f-oblig', 'v'))
    await cliquer(page, ligne('.f-oblig', 'v', 'Choisir un fruit'))
    assert.deepEqual(await page.evaluate(`[__m('.f-oblig', '.v')._state.value, __inv('.f-oblig')]`), ['', ['s', 'm', 'v']], 'la valeur vide manque de nouveau')
    await cliquer(page, bouton('.f-oblig', 'm'))
    await cliquer(page, ligne('.f-oblig', 'm', 'Banane'))
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['s', 'v'])
    await cliquer(page, ligne('.f-oblig', 'm', 'Banane'))
    assert.deepEqual(await page.evaluate(`[__m('.f-oblig', '.m')._state.value, __inv('.f-oblig')]`), [[], ['s', 'm', 'v']], 'plus rien de coché : manque')
    assert.deepEqual(erreurs, [])
  })

  it('form.reset() : chaque liste revient à son choix de départ, et sa validité avec', async function () {
    await cliquer(page, bouton('.f-oblig', 's'))
    await cliquer(page, ligne('.f-oblig', 's', 'Cerise'))
    await cliquer(page, bouton('.f-oblig', 'm'))
    await cliquer(page, ligne('.f-oblig', 'm', 'Banane'))
    await page.mouse.click(5, 5)
    await cliquer(page, bouton('.f-oblig', 'v'))
    await cliquer(page, ligne('.f-oblig', 'v', 'Figue'))
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [], 'préalable : tout est choisi')
    await page.evaluate(`__q('.f-oblig').reset()`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`['s', 'm', 'v'].map((c) => __m('.f-oblig', '.' + c)._state.value)`), [null, null, ''], 'retour au départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-oblig')`), ['v='])
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['s', 'm', 'v'], 'la validité suit la remise à zéro')
    await cliquer(page, bouton('.f-depart', 's'))
    await cliquer(page, ligne('.f-depart', 's', 'Abricot'))
    await cliquer(page, bouton('.f-depart', 'm'))
    await cliquer(page, ligne('.f-depart', 'm', 'Cerise'))
    await cliquer(page, ligne('.f-depart', 'm', 'Figue'))
    await page.mouse.click(5, 5)
    assert.deepEqual(await page.evaluate(`[__fd('.f-depart'), __inv('.f-depart')]`), [['s=abricot'], ['m']])
    await page.evaluate(`__q('.f-depart').reset()`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`[__fd('.f-depart'), __inv('.f-depart'), __val('.f-depart')]`), [['s=banane', 'm=cerise', 'm=figue'], [], ['s', 'm']], 'le choix de départ revient, valide')
    await cliquer(page, bouton('.f-oblig', 's'))
    await cliquer(page, ligne('.f-oblig', 's', 'Cerise'))
    await cliquer(page, `__q('.f-oblig .rz')`)
    await page.waitForTimeout(400)
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), ['s', 'm', 'v'], 'le bouton « reset » : même chose')
    assert.deepEqual(erreurs, [])
  })

  it('<label for> vise la liste : un clic sur l\'étiquette met le focus sur son bouton, sans l\'ouvrir ni rien choisir', async function () {
    assert.equal(await page.evaluate(`__q('.f-etiquette .l-s').control === __m('.f-etiquette', '.s')`), true, 'label.control est la balise de la liste')
    await cliquer(page, `__q('.f-etiquette .l-s')`)
    assert.equal(await page.evaluate(`__focus()`), 's:button', 'le focus est sur le bouton de la liste')
    const vu = await etat(page, '.f-etiquette', 's')
    assert.deepEqual([vu.ouverte, vu.valeur], [false, null], 'la liste reste fermée, rien n\'est choisi')
    await touche(page, 'ArrowDown')
    assert.equal((await etat(page, '.f-etiquette', 's')).ouverte, true, 'le clavier pilote la liste')
    assert.deepEqual(await page.evaluate(`__ch`), [], 'aucun change')
    assert.deepEqual(erreurs, [])
  })

  it('<fieldset disabled> désactive la liste, et la réactive ; son propre disabled s\'y ajoute ; disabled="false" la laisse active', async function () {
    const desactive = () => page.evaluate(`['s', 'b', 'd', 'faux'].map((c) => __m('.f-fieldset', '.' + c).matches(':disabled') + '/' + __btn('.f-fieldset', '.' + c).disabled)`)
    assert.deepEqual(await desactive(), ['true/true', 'true/true', 'true/true', 'false/false'], ':disabled sur la balise, le bouton désactivé ; disabled="false" : active')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), true, 'désactivée, la liste obligatoire ne compte plus')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['faux=figue'], 'une liste désactivée n\'envoie rien')
    await cliquer(page, bouton('.f-fieldset', 'b'))
    assert.equal((await etat(page, '.f-fieldset', 'b')).ouverte, false, 'le clic n\'ouvre pas la liste')
    await cliquer(page, bouton('.f-fieldset', 'faux'))
    assert.equal((await etat(page, '.f-fieldset', 'faux')).ouverte, true, 'disabled="false" : la liste s\'ouvre')
    await page.mouse.click(5, 5)
    await page.evaluate(`__q('.f-fieldset .fs').disabled = false`)
    await page.waitForTimeout(200)
    assert.deepEqual(await desactive(), ['false/false', 'false/false', 'true/true', 'false/false'], 'réactivées, sauf celle qui porte disabled')
    assert.equal(await page.evaluate(`__q('.f-fieldset').checkValidity()`), false, 'réactivée, required compte de nouveau')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['b=banane', 'faux=figue'])
    await cliquer(page, bouton('.f-fieldset', 'b'))
    assert.equal((await etat(page, '.f-fieldset', 'b')).ouverte, true, 'la liste réactivée s\'ouvre')
    await page.evaluate(`__q('.f-fieldset .fs').disabled = true`)
    await page.waitForTimeout(200)
    assert.equal((await etat(page, '.f-fieldset', 'b')).ouverte, false, 'désactivée pendant qu\'elle est ouverte, la liste se ferme')
    assert.deepEqual(await desactive(), ['true/true', 'true/true', 'true/true', 'false/false'], 'de nouveau désactivées')
    assert.deepEqual(await page.evaluate(`__fd('.f-fieldset')`), ['faux=figue'])
    assert.deepEqual(erreurs, [])
  })

  it('saisie au vol, liste fermée : la lettre choisit, la même lettre passe à la suivante, sans accents ni casse, des lettres vite tapées cherchent le début', async function () {
    await viser(page, '.f-clavier', 'fermee')
    await touche(page, 'b')
    assert.deepEqual(await etat(page, '.f-clavier', 'fermee'), { valeur: 'banane', ouverte: false, active: null, suit: true, bouton: 'Banane', champs: ['fermee=banane'] }, 'la première option qui commence par la lettre, choisie comme à la souris')
    await touche(page, 'b')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'bleuet', 'la même lettre retapée passe à la suivante')
    await touche(page, 'b')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'banane', 'et reboucle au début')
    await attendre(page)
    await touche(page, 'E')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'ecorce', 'sans tenir compte des accents ni de la casse')
    await touche(page, 'e')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'eglantine')
    await attendre(page)
    await touche(page, 'b')
    await touche(page, 'l')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'bleuet', 'deux lettres tapées vite cherchent le début du libellé')
    await attendre(page)
    await touche(page, 'z')
    assert.equal((await etat(page, '.f-clavier', 'fermee')).valeur, 'bleuet', 'aucune option ne commence par la lettre : rien ne change')
    assert.deepEqual(await page.evaluate(`__ch`), ['fermee="banane"', 'fermee="bleuet"', 'fermee="banane"', 'fermee="ecorce"', 'fermee="eglantine"', 'fermee="banane"', 'fermee="bleuet"'], 'un change par choix')
    await viser(page, '.f-clavier', 'villes')
    await page.keyboard.type('new y', { delay: 60 })
    await page.waitForTimeout(100)
    const villes = await etat(page, '.f-clavier', 'villes')
    assert.deepEqual([villes.valeur, villes.ouverte], ['ny', false], 'Espace au milieu d\'une saisie en fait partie : « new y » va à New York, la liste reste fermée')
    assert.deepEqual(erreurs, [])
  })

  it('saisie au vol, liste ouverte : la ligne active suit (aria-activedescendant aussi), rien n\'est choisi avant Entrée', async function () {
    await viser(page, '.f-clavier', 'ouverte')
    await touche(page, 'ArrowDown')
    assert.equal((await etat(page, '.f-clavier', 'ouverte')).active, 'Abricot', 'préalable : la liste s\'ouvre sur son choix')
    await touche(page, 'c')
    let vu = await etat(page, '.f-clavier', 'ouverte')
    assert.deepEqual([vu.active, vu.suit, vu.valeur, vu.ouverte], ['Cerise', true, 'abricot', true], 'la ligne active va à la lettre, aria-activedescendant la suit')
    await attendre(page)
    await touche(page, 'e')
    await touche(page, 'e')
    vu = await etat(page, '.f-clavier', 'ouverte')
    assert.deepEqual([vu.active, vu.suit, vu.valeur], ['Églantine', true, 'abricot'])
    await touche(page, 'Enter')
    vu = await etat(page, '.f-clavier', 'ouverte')
    assert.deepEqual([vu.valeur, vu.ouverte, vu.champs], ['eglantine', false, ['ouverte=eglantine']], 'Entrée choisit la ligne active')
    assert.deepEqual(await page.evaluate(`__ch`), ['ouverte="eglantine"'])
    await viser(page, '.f-clavier', 'multi')
    await touche(page, 'f')
    vu = await etat(page, '.f-clavier', 'multi')
    assert.deepEqual([vu.ouverte, vu.active, vu.valeur], [true, 'Figue', null], 'multiple, liste fermée : elle s\'ouvre sur l\'option, rien n\'est coché')
    await attendre(page)
    await touche(page, ' ')
    assert.deepEqual((await etat(page, '.f-clavier', 'multi')).valeur, ['figue'], 'Espace, hors d\'une saisie, coche la ligne active')
    await touche(page, 'b', 0)
    await touche(page, ' ')
    vu = await etat(page, '.f-clavier', 'multi')
    assert.deepEqual([vu.active, vu.valeur], ['Banane', ['figue']], 'Espace juste après une lettre continue la saisie, rien n\'est coché')
    await attendre(page)
    await touche(page, ' ')
    assert.deepEqual((await etat(page, '.f-clavier', 'multi')).valeur, ['figue', 'banane'])
    assert.deepEqual(erreurs, [])
  })

  it('saisie au vol : la recherche garde la main liste ouverte ; une réponse libre donnée n\'est pas remplacée liste fermée', async function () {
    await viser(page, '.f-clavier', 'cherche')
    await touche(page, 'c')
    assert.deepEqual((await etat(page, '.f-clavier', 'cherche')).valeur, 'cerise', 'liste fermée, la saisie au vol choisit')
    await touche(page, 'ArrowDown', 150)
    await page.keyboard.type('an', { delay: 60 })
    await page.waitForTimeout(150)
    const vu = await page.evaluate(`[__m('.f-clavier', '.cherche')._shadow.querySelector('.select-search').value, __lignes('.f-clavier', '.cherche'), __etat('.f-clavier', '.cherche')]`)
    assert.deepEqual([vu[0], vu[1], vu[2].active, vu[2].suit, vu[2].valeur], ['an', ['Banane', 'Églantine'], 'Banane', true, 'cerise'], 'les lettres vont au champ de recherche, qui filtre comme avant')
    assert.deepEqual(await page.evaluate(`__se`), ['cherche=a', 'cherche=an'], 'search part à chaque lettre')
    await touche(page, 'Escape')
    await viser(page, '.f-clavier', 'libre')
    await touche(page, 'b')
    assert.deepEqual((await etat(page, '.f-clavier', 'libre')).valeur, 'Zed', 'liste fermée, la réponse libre reste')
    await touche(page, 'ArrowDown')
    await touche(page, 'b')
    assert.equal((await etat(page, '.f-clavier', 'libre')).active, 'Banane', 'liste ouverte, la ligne active va à la lettre')
    await touche(page, 'Enter')
    assert.deepEqual((await etat(page, '.f-clavier', 'libre')).valeur, 'banane')
    assert.deepEqual(await page.evaluate(`__ch`), ['cherche="cerise"', 'libre="banane"'])
    assert.deepEqual(erreurs, [])
  })

  it('Page haut / Page bas, liste ouverte : d\'une page visible, bornées au début et à la fin ; Début / Fin restent ; fermée, rien', async function () {
    await viser(page, '.f-clavier', 'longue')
    await touche(page, 'ArrowDown', 150)
    const depart = await page.evaluate(`__page('.f-clavier', '.longue')`)
    assert.equal(depart.place, 0, 'préalable : la première ligne est active')
    assert.ok(depart.vues > 2 && depart.vues < 30, `préalable : le panneau défile (${depart.vues} lignes en vue)`)
    const pas = depart.vues - 1
    const places: number[] = []
    for (let i = 0; i < 5; i++) {
      await touche(page, 'PageDown', 120)
      const p = await page.evaluate(`__page('.f-clavier', '.longue')`)
      assert.ok(p.enVue && p.suit, 'la ligne active se voit, aria-activedescendant la suit')
      places.push(p.place)
    }
    assert.deepEqual(places, [1, 2, 3, 4, 5].map((n) => Math.min(n * pas, 29)), 'Page bas avance d\'une page visible, jusqu\'à la dernière ligne')
    await touche(page, 'PageDown', 120)
    assert.equal((await page.evaluate(`__page('.f-clavier', '.longue')`)).place, 29, 'bornée à la fin')
    places.length = 0
    for (let i = 0; i < 5; i++) {
      await touche(page, 'PageUp', 120)
      const p = await page.evaluate(`__page('.f-clavier', '.longue')`)
      assert.ok(p.enVue && p.suit)
      places.push(p.place)
    }
    assert.deepEqual(places, [1, 2, 3, 4, 5].map((n) => Math.max(29 - n * pas, 0)), 'Page haut recule d\'une page visible, jusqu\'à la première ligne')
    await touche(page, 'PageUp', 120)
    assert.equal((await page.evaluate(`__page('.f-clavier', '.longue')`)).place, 0, 'bornée au début')
    await touche(page, 'End', 120)
    assert.equal((await page.evaluate(`__page('.f-clavier', '.longue')`)).place, 29, 'Fin : la dernière ligne')
    await touche(page, 'Home', 120)
    assert.equal((await page.evaluate(`__page('.f-clavier', '.longue')`)).place, 0, 'Début : la première ligne')
    const vu = await etat(page, '.f-clavier', 'longue')
    assert.deepEqual([vu.valeur, vu.ouverte], [null, true], 'rien n\'est choisi, la liste reste ouverte')
    await touche(page, 'Escape')
    await touche(page, 'PageDown')
    const ferme = await etat(page, '.f-clavier', 'longue')
    assert.deepEqual([ferme.valeur, ferme.ouverte], [null, false], 'liste fermée : Page bas ne fait rien')
    assert.deepEqual(await page.evaluate(`__ch`), [])
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change : les paires envoyées, une par valeur choisie, rien de plus pour la balise', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-depart')`), ['s=banane', 'm=cerise', 'm=figue'])
    assert.deepEqual(await page.evaluate(`Array.from(__q('.f-depart').querySelectorAll('mjs-core-select')).map((m) => m.className + ':' + m.querySelectorAll(':scope > input[type=hidden]').length)`), ['s:1', 'm:2'], 'un champ caché par valeur choisie')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change pour l\'accessibilité : le bouton combobox et ses aria-*, rien sur la balise ; required se dit au bouton', async function () {
    const a11y = await page.evaluate(`[['.f-etiquette', '.s'], ['.f-oblig', '.s']].map(([b, c]) => {
      const m = __m(b, c), btn = __btn(b, c)
      const balise = Array.from(m.attributes).map((a) => a.name).filter((a) => a === 'role' || a.startsWith('aria-'))
      return [btn.getAttribute('role'), btn.getAttribute('aria-haspopup'), btn.getAttribute('aria-expanded'), btn.hasAttribute('aria-controls'), btn.getAttribute('aria-required'), balise.join(',')].join('|')
    })`)
    assert.deepEqual(a11y, ['combobox|listbox|false|true||', 'combobox|listbox|false|true|true|'])
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> repli : un navigateur sans attachInternals garde le comportement d'avant (${nom} réel)`, function () {
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

  it('required sans effet, aucune étiquette ne vise la liste, le fieldset ne la désactive pas, les paires et la saisie au vol, aucune erreur', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.attachInternals`), 'undefined', 'préalable : le navigateur simulé n\'a pas attachInternals')
    assert.equal(await page.evaluate(`__q('.f-oblig').checkValidity()`), true, 'le formulaire ne voit pas les listes')
    assert.deepEqual(await page.evaluate(`__inv('.f-oblig')`), [])
    assert.equal(await page.evaluate(`__q('.f-etiquette .l-s').control`), null, 'l\'étiquette ne vise rien, comme avant')
    assert.equal(await page.evaluate(`__btn('.f-fieldset', '.b').disabled`), false, 'le fieldset ne désactive pas la liste, comme avant')
    assert.deepEqual(await page.evaluate(`__fd('.f-depart')`), ['s=banane', 'm=cerise', 'm=figue'])
    await viser(page, '.f-clavier', 'fermee')
    await touche(page, 'c')
    assert.deepEqual(await page.evaluate(`__fd('.f-clavier')`).then((l: string[]) => l.filter((p) => p.startsWith('fermee='))), ['fermee=cerise'], 'la saisie au vol choisit')
    assert.deepEqual(erreurs, [])
  })
})
