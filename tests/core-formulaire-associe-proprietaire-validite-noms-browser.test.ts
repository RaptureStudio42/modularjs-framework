// les éléments du formulaire du cœur et d'un composant de l'application, comme leurs champs natifs :
// - un groupe radio = même name ET même formulaire : un bouton qui rejoint le <form> par `form="id"` est du groupe des boutons écrits dans
//   le <form> (cocher l'un décoche l'autre, une seule paire part) ; un bouton visant un autre formulaire, ou sans formulaire, n'en est pas
// - `form="id"` hors de la balise <form> : l'interrupteur, le radio, le bouton rotatif et la jauge envoient leur valeur avec ce formulaire,
//   et reset() les remet
// - un composant `@formAssociated` de l'application : `setCustomValidity` passe devant la validité qu'il a posée, et `''` lui rend celle
//   qu'il a écrite en dernier, jamais une ancienne
// - `required="false"`, quelle que soit la casse, est ôté de la balise et tenu pour faux ; toute autre valeur, vide comprise, rend obligatoire
// - `readonly` agit comme sur le champ natif : la case, l'interrupteur, le radio, le bouton rotatif et la jauge le gardent et sortent de la
//   validation, comme une case, un radio ou une glissière natifs ; la liste l'ignore, comme `<select>` (ôté, elle reste validée) ; le nombre en
//   lecture seule sort de la validation, `readonly="false"` (toute casse) est ôté
// - le nom que porte la balise (`aria-label`, `aria-labelledby`, posé dans la page ou plus tard) passe au vrai champ de l'ombre
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const OPTIONS = '<@@option value="a">A</@@option><@@option value="b">B</@@option>'

const PAGE = `<form id="f-radio" class="f-radio" method="get" action="/envoi" @noUJS>
  <@@radio class="r3" name="r" value="3">trois</@@radio>
  <@@radio class="ra" form="f-autre" name="r" value="a" checked>autre formulaire</@@radio>
</form>
<form id="f-autre" class="f-autre" method="get" action="/envoi" @noUJS></form>
<div class="hors-radio">
  <@@radio class="r1" form="f-radio" name="r" value="1" checked>un</@@radio>
  <@@radio class="r2" form="f-radio" name="r" value="2">deux</@@radio>
  <@@radio class="rx" name="r" value="x" checked>sans formulaire</@@radio>
</div>

<form id="f-loin" class="f-loin" method="get" action="/envoi" @noUJS>
  <button type="submit" class="go">envoyer</button>
</form>
<div class="loin">
  <@@switch class="xsw" form="f-loin" name="xsw" checked>interrupteur</@@switch>
  <@@radio class="xra" form="f-loin" name="xra" value="1" checked>radio</@@radio>
  <@@knob class="xkn" form="f-loin" name="xkn" value="40"></@@knob>
  <@@gauge class="xga" form="f-loin" name="xga" value="4"></@@gauge>
</div>

<form class="f-appli" method="get" action="/envoi" @noUJS>
  <@perso class="pa" name="pa"></@perso>
</form>

<form class="f-requis" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cf" name="cf" required="false">c</@@checkbox>
  <@@checkbox class="cF" name="cF" required="FALSE">c</@@checkbox>
  <@@switch class="sF" name="sF" required="False">s</@@switch>
  <@@radio class="rF" name="rF" value="1" required="FALSE">r</@@radio>
  <@@number class="nF" name="nF" required="FALSE"></@@number>
  <@@select class="lF" name="lF" required="FALSE">${OPTIONS}</@@select>
  <@@editor class="eF" name="eF" required="FALSE" toolbar="none"></@@editor>
  <@@checkbox class="cv" name="cv" required="">c</@@checkbox>
  <@@checkbox class="co" name="co" required="oui">c</@@checkbox>
</form>

<form class="f-lecture" method="get" action="/envoi" @noUJS>
  <@@checkbox class="cR" name="cR" readonly required>c</@@checkbox>
  <@@switch class="sR" name="sR" readonly="false" required>s</@@switch>
  <@@radio class="rR" name="rR" value="1" readonly="" required>r</@@radio>
  <@@select class="lR" name="lR" readonly required>${OPTIONS}</@@select>
  <@@knob class="kR" name="kR" readonly></@@knob>
  <@@gauge class="gR" name="gR" readonly></@@gauge>
  <@@number class="nR" name="nR" readonly required></@@number>
  <@@number class="nRF" name="nRF" readonly="FALSE" required></@@number>
</form>

<form class="f-nom" method="get" action="/envoi" @noUJS>
  <@@switch class="sN" name="sN" aria-label="Mode sombre"></@@switch>
  <@@checkbox class="cN" name="cN" aria-label="Accepter les conditions"></@@checkbox>
  <@@radio class="rN" name="rN" value="1" aria-label="Choix un"></@@radio>
  <@@number class="nN" name="nN" aria-label="Quantité"></@@number>
  <@@select class="lN" name="lN" aria-label="Pays">${OPTIONS}</@@select>
  <@@knob class="kN" name="kN" aria-label="Volume"></@@knob>
  <@@gauge class="gN" name="gN" aria-label="Niveau"></@@gauge>
  <span id="nom-cite">Notifications</span>
  <@@switch class="sC" name="sC" aria-labelledby="nom-cite"></@@switch>
  <@@checkbox class="cT" name="cT"></@@checkbox>
</form>
`

// un composant de l'application qui se dit lui-même manquant, à son montage
const PERSO = `@formAssociated

<script>
  $name = ''
  µmount ->
    @@internals.setValidity({ valueMissing: true }, 'Manque (appli)')
</script>

<span class="x">perso</span>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-knob, mjs-core-gauge, mjs-core-select, mjs-core-editor'
const NOMBRE  = 35

const AIDES = `(() => {
  window.__q   = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__sh  = (c, s) => __q('.' + c)._shadow.querySelector(s)
  window.__fd  = (f) => Array.from(new FormData(__q(f))).map((p) => p[0] + '=' + p[1])
  window.__inv = (f) => Array.from(__q(f).querySelectorAll('${MODULES}')).filter((m) => m.matches(':invalid')).map((m) => m.classList[0])
  window.__v   = (c) => { const m = __q('.' + c); return [m.validationMessage, m.validity.customError, m.validity.valueMissing, m.matches(':invalid')] }
})()`

let construit: Promise<string> | null = null

// le script de la page (le cœur, les libellés du manifeste, les modules, le composant de l'application, l'hôte), construit une fois pour
// les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-proprietaire-validite-noms')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    writeFileSync(join(srcDir, 'perso.mjs'), PERSO)
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
    const p = h && h._shadow ? h._shadow.querySelector('mjs-perso') : null
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.native, .input, .select-btn, .surface, .knob, .spinner'))
      && p && p._mjs_is_mounted && p._shadow && p._shadow.querySelector('.x')
  })()`, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 200) => page.waitForTimeout(ms)

async function touche(page: any, k: string) {
  await page.keyboard.press(k)
  await pause(page, 150)
}

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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`les éléments du formulaire, comme leurs champs natifs : propriétaire, validité, attributs booléens, nom (${nom} réel)`, function () {
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

  it('radio : un groupe = même name et même formulaire — cocher un bouton du <form> décoche celui qui le rejoint par form="id", pas celui d\'un autre formulaire ni celui sans formulaire', async function () {
    const coches = () => page.evaluate(`['r1', 'r2', 'r3', 'ra', 'rx'].map((c) => __sh(c, 'input').checked)`)
    assert.deepEqual(await coches(), [true, false, false, true, true], 'départ : un bouton coché par formulaire, et celui sans formulaire')
    assert.deepEqual(await page.evaluate(`__fd('.f-radio')`), ['r=1'])
    assert.deepEqual(await page.evaluate(`__fd('.f-autre')`), ['r=a'])
    await cliquer(page, `__sh('r3', '.ring')`)
    assert.deepEqual(await coches(), [false, false, true, true, true], 'le bouton 1, du même formulaire, se décoche ; celui de l\'autre formulaire et celui sans formulaire restent cochés')
    assert.deepEqual(await page.evaluate(`__fd('.f-radio')`), ['r=3'], 'une seule paire part, jamais r=3&r=1')
    assert.deepEqual(await page.evaluate(`__fd('.f-autre')`), ['r=a'])
    assert.deepEqual(await page.evaluate(`['r3', 'r1', 'r2'].map((c) => __sh(c, 'input').tabIndex)`), [0, -1, -1], 'un seul arrêt de tabulation dans le groupe : le bouton coché')
    await page.evaluate(`__sh('r3', 'input').focus()`)
    await touche(page, 'ArrowDown')
    assert.deepEqual(await coches(), [true, false, false, true, true], 'la flèche passe au bouton suivant du groupe, hors de la balise <form>')
    assert.deepEqual(await page.evaluate(`__fd('.f-radio')`), ['r=1'])
    await cliquer(page, `__sh('r2', '.ring')`)
    assert.deepEqual(await page.evaluate(`__fd('.f-radio')`), ['r=2'])
    await page.evaluate(`__q('.f-radio').reset()`)
    await pause(page, 400)
    assert.deepEqual(await coches(), [true, false, false, true, true], 'reset() rend au groupe son départ')
    assert.deepEqual(await page.evaluate(`__fd('.f-radio')`), ['r=1'])
    assert.deepEqual(erreurs, [])
  })

  it('form="id" hors de la balise <form> : l\'interrupteur, le radio, le bouton rotatif et la jauge envoient leur valeur avec ce formulaire, et reset() les remet', async function () {
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xsw=on', 'xra=1', 'xkn=40', 'xga=4'], 'chaque valeur part avec le formulaire visé')
    await cliquer(page, `__sh('xsw', '.pill')`)
    await page.evaluate(`__sh('xkn', '.knob').focus()`)
    await touche(page, 'ArrowUp')
    await page.evaluate(`__sh('xga', '.spinner').focus()`)
    await touche(page, 'ArrowUp')
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xra=1', 'xkn=41', 'xga=5'], 'l\'interrupteur éteint ne part plus, le bouton rotatif et la jauge suivent')
    await page.evaluate(`__q('.f-loin').reset()`)
    await pause(page, 400)
    assert.deepEqual(await page.evaluate(`__fd('.f-loin')`), ['xsw=on', 'xra=1', 'xkn=40', 'xga=4'], 'reset() rend leur départ')
    await cliquer(page, `__q('.f-loin .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.deepEqual(envois, ['/envoi?xsw=on&xra=1&xkn=40&xga=4'], 'le vrai envoi')
    assert.deepEqual(erreurs, [])
  })

  it('un composant @formAssociated de l\'application : setCustomValidity passe devant sa validité, et \'\' lui rend celle qu\'il a écrite en dernier', async function () {
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['Manque (appli)', false, true, true], 'départ : il se dit manquant')
    await page.evaluate(`__q('.pa').setCustomValidity('Page')`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['Page', true, true, true], 'le message de la page, son manque dessous')
    await page.evaluate(`__q('.pa').setCustomValidity('')`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['Manque (appli)', false, true, true], 'levé : il retrouve son manque')
    await page.evaluate(`__q('.pa').setCustomValidity('Page')`)
    await page.evaluate(`__q('.pa').internals.setValidity({})`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['', false, false, false], 'son setValidity remplace le message de la page')
    await page.evaluate(`__q('.pa').setCustomValidity('')`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['', false, false, false], 'levé : il garde la validité qu\'il a écrite en dernier, jamais l\'ancienne')
    assert.equal(await page.evaluate(`__q('.f-appli').checkValidity()`), true, 'l\'envoi passe')
    await page.evaluate(`__q('.pa').internals.setValidity({ customError: true }, 'Format (appli)')`)
    await page.evaluate(`__q('.pa').setCustomValidity('Page')`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['Page', true, false, true])
    await page.evaluate(`__q('.pa').setCustomValidity('')`)
    assert.deepEqual(await page.evaluate(`__v('pa')`), ['Format (appli)', true, false, true], 'son propre message aussi, quand il le dit par customError')
    assert.equal(await page.evaluate(`__q('.f-appli').checkValidity()`), false)
    assert.deepEqual(erreurs, [])
  })

  it('required="false", quelle que soit la casse, est ôté et tenu pour faux ; toute autre valeur, vide comprise, rend obligatoire — écrit dans la page ou posé plus tard', async function () {
    assert.deepEqual(await page.evaluate(`__inv('.f-requis')`), ['cv', 'co'], 'seuls required="" et required="oui" rendent obligatoire')
    assert.deepEqual(await page.evaluate(`['cf', 'cF', 'sF', 'rF', 'nF', 'lF', 'eF'].filter((c) => __q('.' + c).hasAttribute('required'))`), [], '« false » ôté de chaque balise')
    await page.evaluate(`__q('.cv').setAttribute('required', 'FALSE'); __q('.cF').setAttribute('required', '')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__inv('.f-requis')`), ['cF', 'co'], '« FALSE » posé plus tard rend facultatif, une valeur vide obligatoire')
    assert.equal(await page.evaluate(`__q('.cv').hasAttribute('required')`), false)
    assert.deepEqual(erreurs, [])
  })

  it('readonly agit comme sur le champ natif : gardé par la case, l\'interrupteur, le radio, le bouton rotatif et la jauge, qui sortent de la validation ; ôté de la liste, qui reste validée comme <select> ; le nombre en lecture seule sort de la validation', async function () {
    const etats = () => page.evaluate(`Object.fromEntries(['cR', 'sR', 'rR', 'lR', 'kR', 'gR', 'nR', 'nRF'].map((c) => { const m = __q('.' + c); return [c, [m.hasAttribute('readonly'), m.willValidate, m.matches(':invalid')]] }))`)
    assert.deepEqual(await etats(), {
      cR: [true, false, false], sR: [false, true, true], rR: [true, false, false], lR: [false, true, true],
      kR: [true, false, false], gR: [true, false, false],
      nR: [true, false, false], nRF: [false, true, true]
    }, '[readonly sur la balise, validé, :invalid]')
    assert.equal(await page.evaluate(`__q('.f-lecture').checkValidity()`), false, 'les modules obligatoires bloquent l\'envoi')
    await cliquer(page, `__sh('cR', '.box')`)
    assert.deepEqual(await page.evaluate(`[__sh('cR', 'input').checked, __q('.cR').matches(':invalid')]`), [true, false], 'comme une case native en lecture seule, elle se coche')
    await page.evaluate(`__q('.sR').setAttribute('readonly', ''); __q('.lR').setAttribute('readonly', ''); __q('.nRF').setAttribute('readonly', '')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`['sR', 'lR', 'nRF'].map((c) => [__q('.' + c).hasAttribute('readonly'), __q('.' + c).willValidate])`), [[true, false], [false, true], [true, false]], 'posé plus tard : gardé par l\'interrupteur et le nombre, ôté de la liste')
    assert.deepEqual(erreurs, [])
  })

  it('le nom que porte la balise (aria-label, aria-labelledby, posé même plus tard) passe au vrai champ de l\'ombre', async function () {
    const cite = (c: string, champ: string) => page.evaluate(`(() => { const f = __sh('${c}', '${champ}'); const l = f.ariaLabelledByElements; return l === undefined ? 'sans' : (l || []).map((x) => x === __q('.${c}') ? 'balise' : x.textContent.trim()).join(' | ') })()`)
    if (await cite('sN', 'input') !== 'sans') {
      for (const [c, champ] of [['sN', 'input'], ['cN', 'input'], ['rN', 'input'], ['nN', '.input'], ['kN', '.knob'], ['gN', '.spinner']]) assert.equal(await cite(c, champ), 'balise', c + ' cite sa balise, qui porte son nom')
      assert.equal(await cite('sC', 'input'), 'Notifications', 'aria-labelledby de la balise : l\'élément cité')
      assert.equal(await cite('cT', 'input'), '', 'sans nom sur la balise : rien de cité')
    }
    await page.evaluate(`__q('.cT').setAttribute('aria-label', 'Posé plus tard')`)
    await pause(page)
    if (await cite('cT', 'input') !== 'sans') assert.equal(await cite('cT', 'input'), 'balise', 'aria-label posé plus tard par la page')
    if (nom === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      const noms = nodes.filter((n: any) => !n.ignored && ['checkbox', 'switch', 'radio', 'spinbutton', 'slider', 'combobox'].includes(n.role?.value)).map((n: any) => n.role.value + ':' + (n.name?.value ?? ''))
      for (const attendu of ['switch:Mode sombre', 'checkbox:Accepter les conditions', 'radio:Choix un', 'spinbutton:Quantité', 'combobox:Pays', 'slider:Volume', 'spinbutton:Niveau', 'switch:Notifications', 'checkbox:Posé plus tard']) assert.ok(noms.includes(attendu), attendu + ' absent de ' + noms.join(', '))
      await cdp.detach()
    }
    assert.deepEqual(erreurs, [])
  })
})
