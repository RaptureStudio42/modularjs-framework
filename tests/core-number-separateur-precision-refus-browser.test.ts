// <@@number> dans Chromium, Firefox et WebKit réels, au clavier réel : sans `decimals`, le séparateur est celui de la langue de la page
// (« 64,3 » en français, « 64.3 » en anglais), `separator` le force ; `precision` arrondit au plus proche, sans zéro final ; avec
// `decimals`, la validité suit l'unité des décimales et `step` ne règle que les boutons : sous `step="1" decimals="2"`, 7,50 est valide
// (ni `:invalid`, ni `stepMismatch`, ni `aria-invalid`), même compté depuis `min="0"`, et la flèche avance d'une unité ; `strict` refuse la troisième décimale tapée ou
// collée ; `zero` écrit « 0,00 » dans un champ vidé ; le formulaire reçoit toujours le nombre, au point. La langue entière de la page, région
// comprise (`de-CH`, `es-MX`, `en-ZA`), choisit le séparateur, comme le navigateur l'écrit ; sous `strict`, un collage de plus de 15 caractères
// est refusé en entier, jamais coupé ; une valeur de départ à plus de décimales ne décale pas le pas validé ; avec `zero`, un champ vidé
// puis quitté par Tab écrit « 0,00 », avec ou sans `strict` et `placeholder`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'sep-page.mjs': `<script>
  $a = 64.3
  $q = 7.5
  $p = 9.9
  $s = 12.3
  $t = 12.3
  $z = 12.5
  $v1 = 7.505
  $v2 = 0.1 + 0.2
  $v3 = 1.23456
  $v4 = 7.505
  $za = 4.5
  $zb = 4.5
  $zc = 4.5
</script>
<form class="f" :noUJS>
  <@@number class="libre" name="libre" value=!{$a}></@@number>
  <@@number class="point" value=!{$a} separator="."></@@number>
  <@@number class="pas" name="pas" value=!{$q} min="0" step="1" decimals="2"></@@number>
  <@@number class="prec" name="prec" value=!{$p} precision="2" big="0.5"></@@number>
  <@@number class="strict" value=!{$s} decimals="2" strict></@@number>
  <@@number class="souple" value=!{$t} decimals="2"></@@number>
  <@@number class="zero" value=!{$z} decimals="2" placeholder="0,00" zero></@@number>
</form>
<form class="g5" :noUJS>
  <@@number class="za" value=!{$za} decimals="2" zero strict></@@number>
  <@@number class="zb" value=!{$zb} decimals="2" zero></@@number>
  <@@number class="zc" value=!{$zc} decimals="2" placeholder="0,00" zero strict></@@number>
</form>
<p class="vza">{$za}</p><p class="vzb">{$zb}</p><p class="vzc">{$zc}</p>
<form class="g1" :noUJS><@@number class="v1" name="v1" value=!{$v1} decimals="2"></@@number></form>
<form class="g2" :noUJS><@@number class="v2" name="v2" value=!{$v2} decimals="2"></@@number></form>
<form class="g3" :noUJS><@@number class="v3" name="v3" value=!{$v3} precision="2"></@@number></form>
<form class="g4" :noUJS><@@number class="v4" name="v4" value=!{$v4} step="1" decimals="2"></@@number></form>
<p class="vq">{$q}</p><p class="vp">{$p}</p><p class="vs">{$s}</p><p class="vt">{$t}</p><p class="vz">{$z}</p>
<button type="button" class="apres">après</button>
`
}

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les trois navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('number-separateur-precision-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@number> : séparateur de la langue, precision, validité du pas, strict, zero (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let page: any
  let script  = ''
  const erreurs: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test du séparateur et de la précision sauté`)
      return
    }
    script  = await construire()
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(function () {
    if (present) assert.deepEqual(erreurs, [], 'aucune erreur de page')
  })

  // une page neuve par langue : le script du build déclare ses noms au niveau global, une seconde écriture dans la même page les redéclarerait
  const charger = async (lang: string) => {
    erreurs.length = 0
    if (page) await page.close()
    page = await browser.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><mjs-sep-page></mjs-sep-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-sep-page') as any)?._shadow?.querySelector('.v4')?._shadow?.querySelector('input'))
    await page.evaluate(`window.__hote = () => document.querySelector('mjs-sep-page')._shadow; window.__mod = (c) => __hote().querySelector('.' + c); window.__champ = (c) => __mod(c)._shadow.querySelector('input'); window.__lu = (c) => __hote().querySelector('.' + c).textContent`)
  }

  const montre = (c: string): Promise<string> => page.evaluate(`__champ('${c}').value`)
  const lu     = (c: string): Promise<string> => page.evaluate(`__lu('${c}')`)

  // le champ vidé et sélectionné, la frappe au clavier réel, puis Tab vers le champ suivant
  const frapper = async (c: string, texte: string, sortir = true) => {
    await page.evaluate(`(() => { const i = __champ('${c}'); i.focus(); i.select() })()`)
    await page.keyboard.press('Backspace')
    if (texte) await page.keyboard.type(texte)
    if (sortir) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(60)
    }
  }

  for (const [lang, sep] of [['fr', ','], ['en', '.']] as const) {
    it(`page en ${lang === 'fr' ? 'français' : 'anglais'} : sans \`decimals\`, « 64${sep}3 » ; \`separator="."\` force « 64.3 » ; \`precision="2"\` : « 9${sep}996 » tapé donne « 10 », « 9${sep}9 » reste « 9${sep}9 » ; le formulaire au point ; « Augmenter de 0${sep}5 »`, async function () {
      if (!present) { this.skip(); return }
      await charger(lang)
      assert.equal(await montre('libre'), `64${sep}3`)
      assert.equal(await montre('point'), '64.3')
      await frapper('prec', `9${sep}996`)
      assert.equal(await lu('vp'), '10')
      assert.equal(await montre('prec'), '10')
      await frapper('prec', `9${sep}9`)
      assert.equal(await montre('prec'), `9${sep}9`)
      const envoi = await page.evaluate(`[...new FormData(__hote().querySelector('.f')).entries()].filter((e) => e[0] === 'libre' || e[0] === 'prec').map((e) => e.join('='))`)
      assert.deepEqual(envoi, ['libre=64.3', 'prec=9.9'])
      const nomme = await page.evaluate(`__mod('prec')._shadow.querySelector('.more.big').getAttribute('aria-label')`)
      assert.equal(nomme, lang === 'fr' ? 'Augmenter de 0,5' : 'Increase by 0.5', 'le libellé du grand pas suit le séparateur')
    })
  }

  it('`step="1" decimals="2"` : 7,50 est valide (formulaire, :valid, ni stepMismatch ni aria-invalid) ; « 7,25 » tapé aussi ; la flèche avance d\'une unité', async function () {
    if (!present) { this.skip(); return }
    await charger('fr')
    const etat = () => page.evaluate(`(() => { const m = __mod('pas'); return { form: __hote().querySelector('.f').checkValidity(), invalide: m.matches(':invalid'), pas: !!(m.validity && m.validity.stepMismatch), aria: __champ('pas').getAttribute('aria-invalid'), maintenant: __champ('pas').getAttribute('aria-valuenow') } })()`)
    assert.equal(await montre('pas'), '7,50')
    assert.deepEqual(await etat(), { form: true, invalide: false, pas: false, aria: null, maintenant: '7.5' })
    await frapper('pas', '7,25')
    assert.equal(await lu('vq'), '7.25')
    assert.deepEqual(await etat(), { form: true, invalide: false, pas: false, aria: null, maintenant: '7.25' })
    await page.evaluate(`__champ('pas').focus()`)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(60)
    assert.equal(await lu('vq'), '8.25', '`step` règle les boutons et les flèches')
    assert.equal(await montre('pas'), '8,25')
    assert.equal((await etat()).form, true)
  })

  it('`strict` : la troisième décimale tapée au clavier est refusée, un collage de trois décimales aussi ; sans `strict`, elle reste écrite et s\'arrondit à la sortie', async function () {
    if (!present) { this.skip(); return }
    await charger('fr')
    await frapper('strict', '12,345', false)
    assert.equal(await montre('strict'), '12,34', 'le 5 est refusé')
    assert.equal(await lu('vs'), '12.34')
    await page.evaluate(`__champ('strict').select()`)
    await page.keyboard.insertText('7,891')
    await page.waitForTimeout(60)
    assert.equal(await montre('strict'), '12,34', 'le texte collé est refusé en entier')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
    assert.equal(await montre('strict'), '12,34')
    await frapper('souple', '12,345', false)
    assert.equal(await montre('souple'), '12,345')
    assert.equal(await lu('vt'), '12.35')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
    assert.equal(await montre('souple'), '12,35')
  })

  it('`zero` : le champ vidé au clavier vaut 0 et s\'écrit « 0,00 » à la sortie', async function () {
    if (!present) { this.skip(); return }
    await charger('fr')
    await frapper('zero', '')
    assert.equal(await lu('vz'), '0')
    assert.equal(await montre('zero'), '0,00')
  })

  for (const [c, v, quoi] of [['za', 'vza', 'avec `strict`, sans `placeholder`'], ['zb', 'vzb', 'sans `strict` ni `placeholder`'], ['zc', 'vzc', 'avec `strict` et un `placeholder`']]) {
    it(`\`zero\` ${quoi} : vidé au clavier puis quitté par Tab, le champ écrit « 0,00 » et la variable vaut 0`, async function () {
      if (!present) { this.skip(); return }
      await charger('fr')
      await frapper(c, '')
      assert.equal(await lu(v), '0', 'la variable')
      assert.equal(await montre(c), '0,00', 'le zéro écrit à la sortie')
    })
  }

  for (const lang of ['de-CH', 'es-MX', 'en-ZA']) {
    it(`page en ${lang} : le séparateur est celui que le navigateur écrit pour la langue entière, région comprise`, async function () {
      if (!present) { this.skip(); return }
      await charger(lang)
      const sep = await page.evaluate(`new Intl.NumberFormat(document.documentElement.lang).formatToParts(1.5).find((p) => p.type === 'decimal').value`)
      assert.equal(await montre('libre'), `64${sep}3`)
      assert.equal(await montre('pas'), `7${sep}50`)
    })
  }

  it('`strict` : un collage de plus de 15 caractères est refusé en entier, jamais coupé (« 123456789012,345 », « 1234567890123456 ») ; sans `strict`, la saisie garde `maxlength="15"`', async function () {
    if (!present) { this.skip(); return }
    await charger('fr')
    assert.equal(await page.evaluate(`__champ('strict').hasAttribute('maxlength')`), false)
    assert.equal(await page.evaluate(`__champ('souple').getAttribute('maxlength')`), '15')
    const coller = async (c: string, texte: string) => {
      await page.evaluate(`(() => { const i = __champ('${c}'); i.focus(); i.select() })()`)
      await page.keyboard.insertText(texte)
      await page.waitForTimeout(60)
    }
    for (const texte of ['123456789012,345', '1234567890123456']) {
      await coller('strict', texte)
      assert.equal(await montre('strict'), '12,30', `« ${texte} » refusé en entier`)
      assert.equal(await lu('vs'), '12.3')
    }
    await coller('strict', '123456789012,34')
    assert.equal(await lu('vs'), '123456789012.34', 'quinze caractères passent')
    await coller('souple', '1234567890123456')
    assert.equal(await montre('souple'), '123456789012345', 'sans `strict`, le collage est coupé à quinze caractères')
  })

  it('validité sous `decimals` ou `precision` : une valeur de départ à plus de décimales (7.505, 0.1 + 0.2, 1.23456) ne décale pas le pas ; la frappe reste valide, `step="1"` compris', async function () {
    if (!present) { this.skip(); return }
    await charger('fr')
    const valide = (g: string, c: string) => page.evaluate(`(() => { const m = __mod('${c}'); return { form: __hote().querySelector('.${g}').checkValidity(), pas: !!(m.validity && m.validity.stepMismatch) } })()`)
    for (const [g, c, texte] of [['g1', 'v1', '7,25'], ['g2', 'v2', '0,5'], ['g3', 'v3', '1,5'], ['g4', 'v4', '7,25']]) {
      assert.deepEqual(await valide(g, c), { form: true, pas: false }, `${c} au départ`)
      await frapper(c, texte)
      assert.deepEqual(await valide(g, c), { form: true, pas: false }, `${c} après « ${texte} »`)
    }
  })
})
