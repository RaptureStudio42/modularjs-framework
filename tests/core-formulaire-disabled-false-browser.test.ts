// `disabled="false"` écrit sur la balise d'un élément du formulaire du cœur le laisse actif, pour chacun : <@@checkbox>, <@@switch>, <@@radio>,
// <@@number>, <@@knob>, <@@gauge>, <@@select>, <@@editor>
// - le navigateur tient pour désactivé un élément du formulaire qui porte `disabled`, quelle que soit sa valeur : « false » est ôté de la
//   balise au montage, et quand la page le pose plus tard (`setAttribute('disabled', 'false')`, la casse ne compte pas)
// - la balise n'est pas :disabled, le module est validé (`required` bloque l'envoi tant qu'il manque), ses clics passent (les boutons de la
//   jauge sous Firefox compris), sa valeur part avec le formulaire ; un `<fieldset disabled>` le désactive, puis le lui rend
// - posé plus tard sur un module actif, ou sur un module désactivé par son attribut, « false » est ôté et le module est actif
// ce qui ne change pas : `disabled` sans valeur, `disabled=""`, `disabled="disabled"` désactivent le module ; `disabled={$x}` suit la variable ;
// `required="false"` laisse le module facultatif ; un navigateur sans attachInternals garde le module actif
// Chromium, Firefox et WebKit réels : de vrais clics, de vraies touches, un vrai envoi du formulaire

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const OPTIONS = '<@@option value="a">A</@@option><@@option value="b">B</@@option>'

// les huit modules d'un bloc, chacun avec `attrs` ; `extra` : ce qu'un module ajoute à sa balise
function huit(attrs: string, extra: Record<string, string> = {}) {
  const x = (c: string) => attrs + (extra[c] ? ' ' + extra[c] : '')
  return [
    `<@@checkbox class="cb" name="cb" ${x('cb')}>case</@@checkbox>`,
    `<@@switch class="sw" name="sw" ${x('sw')}>interrupteur</@@switch>`,
    `<@@radio class="ra" name="ra" value="x" ${x('ra')}>x</@@radio>`,
    `<@@number class="nb" name="nb" ${x('nb')}></@@number>`,
    `<@@knob class="kn" name="kn" value="20" ${x('kn')}></@@knob>`,
    `<@@gauge class="ga" name="ga" value="4" ${x('ga')}></@@gauge>`,
    `<@@select class="se" name="se" ${x('se')}>${OPTIONS}</@@select>`,
    `<@@editor class="ed" name="ed" toolbar="none" ${x('ed')}></@@editor>`
  ].join('\n  ')
}

const DEPART = { nb: 'value="3"', se: 'value="a"' }

const PAGE = `<script>
  $off = false

  µmount ->
    window.__poser = (v)-> $off = v
</script>

<form class="f-faux" method="get" action="/envoi" @noUJS>
  ${huit('disabled="false" required')}
  <button type="submit" class="go">envoyer</button>
</form>

<form class="f-fs" method="get" action="/envoi" @noUJS>
  <fieldset class="fs" disabled>
  ${huit('disabled="false"', DEPART)}
  </fieldset>
</form>

<form class="f-actif" method="get" action="/envoi" @noUJS>
  ${huit('', DEPART)}
</form>

<form class="f-vrai" method="get" action="/envoi" @noUJS>
  ${huit('disabled', DEPART)}
</form>

<form class="f-vide" method="get" action="/envoi" @noUJS>
  ${huit('disabled=""', DEPART)}
</form>

<form class="f-mot" method="get" action="/envoi" @noUJS>
  ${huit('disabled="disabled"', DEPART)}
</form>

<form class="f-lie" method="get" action="/envoi" @noUJS>
  ${huit('disabled={$off}', DEPART)}
</form>

<form class="f-requis" method="get" action="/envoi" @noUJS>
  ${huit('required="false"')}
</form>
`

const MODULES = 'mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-number, mjs-core-knob, mjs-core-gauge, mjs-core-select, mjs-core-editor'
const NOMBRE  = 64
const CLASSES = ['cb', 'sw', 'ra', 'nb', 'kn', 'ga', 'se', 'ed']

// chaque module d'un bloc dans le même état : sa classe, puis `etat`
const tous = (etat: string) => CLASSES.map((c) => c + ':' + etat)

// aides de la page : un module d'un bloc, l'état de chacun, ses valeurs, les données du formulaire
const AIDES = `(() => {
  window.__q    = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)
  window.__m    = (b, c) => __q(b).querySelector(c)
  window.__mods = (b) => Array.from(__q(b).querySelectorAll('${MODULES}'))
  window.__fd   = (b) => Array.from(new FormData(__q(b))).map((p) => p[0] + '=' + p[1])
  window.__inv  = (b) => __mods(b).filter((m) => m.matches(':invalid')).map((m) => m.className)
  window.__voulu = (b) => __mods(b).filter((m) => m.willValidate).map((m) => m.className)
  // désactivé de l'intérieur : la case native (case, interrupteur, radio), le champ du nombre, le cadran, les deux boutons de la jauge, le
  // bouton de la liste, la zone de l'éditeur
  window.__coupe = (m) => {
    const s = m._shadow
    if (m.localName === 'mjs-core-number') return s.querySelector('.input').disabled
    if (m.localName === 'mjs-core-knob') return s.querySelector('.knob').getAttribute('aria-disabled') === 'true'
    if (m.localName === 'mjs-core-gauge') return Array.from(s.querySelectorAll('button')).every((x) => x.disabled)
    if (m.localName === 'mjs-core-select') return s.querySelector('.select-btn').disabled
    if (m.localName === 'mjs-core-editor') return s.querySelector('.surface').getAttribute('contenteditable') === 'false'
    return s.querySelector('input.native').disabled
  }
  // classe:DCA — la balise :disabled (D), la saisie coupée (C), l'attribut disabled encore sur la balise (A) ; un tiret pour chaque non
  window.__etat = (b) => __mods(b).map((m) => m.className + ':' + (m.matches(':disabled') ? 'D' : '-') + (__coupe(m) ? 'C' : '-') + (m.hasAttribute('disabled') ? 'A' : '-'))
  window.__poserTous = (b, v) => __mods(b).forEach((m) => m.setAttribute('disabled', v))
  window.__v = (b) => __mods(b).map((m) => {
    const s = m._shadow
    let v
    if (m.localName === 'mjs-core-number') v = s.querySelector('.input').value
    else if (m.localName === 'mjs-core-knob' || m.localName === 'mjs-core-gauge') v = s.querySelector('output').textContent.trim()
    else if (m.localName === 'mjs-core-select') v = m._state.value
    else if (m.localName === 'mjs-core-editor') v = m._state.value
    else v = s.querySelector('input.native').checked
    return m.className + '=' + v
  })
})()`

let construit: Promise<string> | null = null

// le script de la page (le cœur, les libellés du manifeste, les modules, l'hôte), construit une fois pour les trois navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-disabled-false')
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.addInitScript('window.__name = (f) => f;' + avant)
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
    return m.length === ${NOMBRE} && m.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.native, .input, .knob, .spinner, .select-btn, .surface'))
  })()`, { timeout: 60000 })
  await page.evaluate(AIDES)
  await page.waitForTimeout(300)
}

const pause = (page: any, ms = 200) => page.waitForTimeout(ms)

// un vrai clic sur l'élément que donne l'expression, en (fx, fy) de sa boîte (le centre par défaut) ; rien quand l'élément manque
async function cliquer(page: any, expr: string, fx = 0.5, fy = 0.5) {
  const point = await page.evaluate(`(() => {
    const el = ${expr}
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }
  })()`)
  if (!point) return
  await page.mouse.click(point.x, point.y)
  await pause(page, 150)
}

const piece = (b: string, c: string, p: string) => `__m('${b}', '.${c}')._shadow.querySelector('${p}')`

// un geste réel sur chaque module du bloc : la case, l'interrupteur, le radio cliqués, le « + » du nombre et celui de la jauge, un clic sur le
// côté du cadran, la liste ouverte puis l'option B choisie, un mot tapé dans l'éditeur
async function gestes(page: any, b: string) {
  await cliquer(page, piece(b, 'cb', '.box'))
  await cliquer(page, piece(b, 'sw', '.pill'))
  await cliquer(page, piece(b, 'ra', '.ring'))
  await cliquer(page, piece(b, 'nb', '.more'))
  await cliquer(page, piece(b, 'kn', '.knob'), 0.9, 0.5)
  await cliquer(page, piece(b, 'ga', 'button[aria-label="+"]'))
  await cliquer(page, piece(b, 'se', '.select-btn'))
  await cliquer(page, `Array.from(__m('${b}', '.se')._shadow.querySelectorAll('.select-option')).find((o) => o.textContent.trim() === 'B')`)
  await cliquer(page, piece(b, 'ed', '.surface'))
  await page.keyboard.type('mot')
  await pause(page)
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`disabled="false" laisse actif chaque élément du formulaire du cœur (${nom} réel)`, function () {
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

  it('au montage : l\'attribut ôté, la balise n\'est pas :disabled, le module est validé — required bloque, puis les clics passent et l\'envoi part', async function () {
    assert.deepEqual(await page.evaluate(`__etat('.f-faux')`), tous('---'), 'ni :disabled, ni saisie coupée, ni attribut sur la balise')
    assert.deepEqual(await page.evaluate(`__voulu('.f-faux')`), CLASSES, 'chaque module est validé (willValidate)')
    assert.deepEqual(await page.evaluate(`__inv('.f-faux')`), ['cb', 'sw', 'ra', 'nb', 'se', 'ed'], 'required : ce qui manque est :invalid (le bouton rotatif et la jauge ont toujours une valeur)')
    assert.equal(await page.evaluate(`__q('.f-faux').checkValidity()`), false, 'le formulaire ne passe pas')
    await cliquer(page, `__q('.f-faux .go')`)
    await pause(page, 400)
    assert.deepEqual(envois, [], 'l\'envoi est bloqué')
    await gestes(page, '.f-faux')
    const vu = await page.evaluate(`__v('.f-faux')`)
    assert.deepEqual(vu.filter((v: string) => !v.startsWith('kn=')), ['cb=true', 'sw=true', 'ra=true', 'nb=1', 'ga=5', 'se=b', 'ed=<p>mot</p>'], 'chaque clic a fait son effet, les boutons de la jauge compris')
    assert.notEqual(vu[4], 'kn=20', 'le clic sur le cadran l\'a tourné')
    assert.deepEqual(await page.evaluate(`__inv('.f-faux')`), [], 'plus rien ne manque')
    await cliquer(page, `__q('.f-faux .go')`)
    await page.waitForFunction(`location.pathname === '/envoi'`)
    assert.equal(envois.length, 1, 'le vrai envoi')
    assert.deepEqual([...new URL('http://x' + envois[0]).searchParams.keys()], CLASSES, 'une paire par module')
    assert.deepEqual(erreurs, [])
  })

  it('<fieldset disabled> le désactive, puis le lui rend ; « false » posé pendant que le fieldset le désactive est ôté aussi', async function () {
    assert.deepEqual(await page.evaluate(`__etat('.f-fs')`), tous('DC-'), 'sous le fieldset désactivé : :disabled, saisie coupée, l\'attribut ôté')
    assert.deepEqual(await page.evaluate(`__fd('.f-fs')`), [], 'rien ne part')
    await page.evaluate(`__q('.f-fs .fs').disabled = false`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-fs')`), tous('---'), 'le fieldset réactivé : le module l\'est aussi')
    assert.deepEqual(await page.evaluate(`__fd('.f-fs')`), ['nb=3', 'kn=20', 'ga=4', 'se=a', 'ed='], 'sa valeur part')
    await cliquer(page, piece('.f-fs', 'ga', 'button[aria-label="+"]'))
    assert.deepEqual(await page.evaluate(`__v('.f-fs')`).then((v: string[]) => v[5]), 'ga=5', 'le clic sur la jauge passe')
    await page.evaluate(`__q('.f-fs .fs').disabled = true`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-fs')`), tous('DC-'), 'de nouveau désactivé')
    await page.evaluate(`__poserTous('.f-fs', 'false')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-fs')`), tous('DC-'), '« false » posé sous le fieldset désactivé : ôté, le fieldset désactive toujours')
    await page.evaluate(`__q('.f-fs .fs').disabled = false`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-fs')`), tous('---'), 'et le fieldset réactivé le rend actif')
    assert.deepEqual(erreurs, [])
  })

  it('posé plus tard par setAttribute(\'disabled\', \'false\'), sans tenir compte de la casse : ôté, le module actif — même désactivé avant par son attribut', async function () {
    await page.evaluate(`__poserTous('.f-actif', 'false')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-actif')`), tous('---'), 'un module actif : « false » ôté, il reste actif')
    await page.evaluate(`__poserTous('.f-actif', 'FALSE')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-actif')`), tous('---'), '« FALSE » aussi')
    assert.deepEqual(await page.evaluate(`__voulu('.f-actif')`), CLASSES, 'toujours validé')
    await cliquer(page, piece('.f-actif', 'ga', 'button[aria-label="+"]'))
    await cliquer(page, piece('.f-actif', 'nb', '.more'))
    assert.deepEqual(await page.evaluate(`__v('.f-actif')`).then((v: string[]) => [v[3], v[5]]), ['nb=4', 'ga=5'], 'les clics passent')
    assert.deepEqual(await page.evaluate(`__etat('.f-vrai')`), tous('DCA'), 'préalable : désactivé par son attribut')
    await page.evaluate(`__poserTous('.f-vrai', 'False')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-vrai')`), tous('---'), 'désactivé par son attribut, puis « False » posé : ôté, le module actif')
    assert.deepEqual(await page.evaluate(`__fd('.f-vrai')`), ['nb=3', 'kn=20', 'ga=4', 'se=a', 'ed='], 'sa valeur part')
    await cliquer(page, piece('.f-vrai', 'ga', 'button[aria-label="+"]'))
    assert.deepEqual(await page.evaluate(`__v('.f-vrai')`).then((v: string[]) => v[5]), 'ga=5', 'le clic sur la jauge passe')
    await page.evaluate(`__poserTous('.f-vrai', '')`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-vrai')`), tous('DCA'), 'puis disabled="" posé : de nouveau désactivé')
    assert.deepEqual(erreurs, [])
  })

  it('rien ne change : disabled sans valeur, disabled="", disabled="disabled" désactivent le module ; disabled={$x} suit la variable', async function () {
    for (const b of ['.f-vrai', '.f-vide', '.f-mot']) {
      assert.deepEqual(await page.evaluate(`__etat('${b}')`), tous('DCA'), b + ' : :disabled, saisie coupée, l\'attribut gardé')
      assert.deepEqual(await page.evaluate(`__fd('${b}')`), [], b + ' : rien ne part')
    }
    await gestes(page, '.f-vrai')
    assert.deepEqual(await page.evaluate(`__v('.f-vrai')`), ['cb=false', 'sw=false', 'ra=false', 'nb=3', 'kn=20', 'ga=4', 'se=a', 'ed='], 'aucun geste ne le change')
    assert.deepEqual(await page.evaluate(`__etat('.f-lie')`), tous('---'), 'disabled={$x} faux : actif')
    await page.evaluate(`__poser(true)`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-lie')`), tous('-C-'), 'disabled={$x} vrai : la saisie coupée (une prop, aucun attribut sur la balise)')
    await page.evaluate(`__poser(false)`)
    await pause(page)
    assert.deepEqual(await page.evaluate(`__etat('.f-lie')`), tous('---'), 'et faux de nouveau : actif')
    assert.deepEqual(erreurs, [])
  })

  it('required="false" laisse le module facultatif : rien ne manque, le formulaire passe', async function () {
    assert.deepEqual(await page.evaluate(`__inv('.f-requis')`), [])
    assert.deepEqual(await page.evaluate(`__voulu('.f-requis')`), CLASSES, 'chaque module est validé')
    assert.equal(await page.evaluate(`__q('.f-requis').checkValidity()`), true)
    assert.deepEqual(erreurs, [])
  })
})

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`repli : un navigateur sans attachInternals garde actif le module qui porte disabled="false" (${nom} réel)`, function () {
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

  it('la saisie active, les clics passent, aucune erreur', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.attachInternals`), 'undefined', 'préalable : le navigateur simulé n\'a pas attachInternals')
    assert.deepEqual(await page.evaluate(`__mods('.f-faux').map((m) => m.className + ':' + (m.matches(':disabled') ? 'D' : '-') + (__coupe(m) ? 'C' : '-'))`), tous('--'), 'ni :disabled, ni saisie coupée')
    await gestes(page, '.f-faux')
    const vu = await page.evaluate(`__v('.f-faux')`)
    assert.deepEqual(vu.filter((v: string) => !v.startsWith('kn=')), ['cb=true', 'sw=true', 'ra=true', 'nb=1', 'ga=5', 'se=b', 'ed=<p>mot</p>'])
    assert.deepEqual(erreurs, [])
  })
})
