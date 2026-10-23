// `form.reset()` annulé APRÈS le passage des composants du cœur : un écouteur de remontée posé après leur
// montage — sur le formulaire, sur un ancêtre, sur `document` — appelle `preventDefault()`. Le champ
// natif et le bouton radio gardaient alors leur valeur ; la case, l'interrupteur, le nombre et la liste,
// eux, lisaient `defaultPrevented` tout de suite, avant que l'écouteur n'ait parlé, et se remettaient quand
// même : le formulaire restait à moitié remis. La lecture se fait maintenant une fois l'événement passé.
// Chromium et Firefox réels, deux mises en page : la page compilée (formulaire dans l'ombre de l'hôte) et le
// DOM léger (balises du cœur posées à la main dans le document). Les données lues par FormData.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const OMBRE = `<form id="f" @noUJS>
  <@@checkbox id="c" name="c" checked>Case</@@checkbox>
  <@@switch id="s" name="s" checked>Interrupteur</@@switch>
  <@@number id="n" name="n" value={3}></@@number>
  <@@select id="p" name="pays" value="fr"><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select>
  <@@select id="m" name="langues" multiple value={['fr']}><@@option value="fr">Français</@@option><@@option value="de">Allemand</@@option></@@select>
  <@@radio id="ra" name="couleur" value="rouge" checked>Rouge</@@radio>
  <@@radio id="rb" name="couleur" value="vert">Vert</@@radio>
  <input id="t" type="text" name="t" value="départ">
  <button type="reset" id="raz">reset</button>
</form>
`

// les balises du cœur, posées telles quelles dans la page (l'amorce ne sert qu'à les embarquer dans le script)
const AMORCE = `<@@checkbox name="a"></@@checkbox>
<@@switch name="a"></@@switch>
<@@number name="a"></@@number>
<@@select name="a"><@@option value="a">a</@@option></@@select>
<@@radio name="a" value="a"></@@radio>
`

const LEGER = `<form id="f"><mjs-core-checkbox id="c" name="c" checked="true">Case</mjs-core-checkbox> <mjs-core-switch id="s" name="s" checked="true">Interrupteur</mjs-core-switch> <mjs-core-number id="n" name="n" value="3"></mjs-core-number> <mjs-core-select id="p" name="pays" value="fr"><mjs-core-option value="fr">France</mjs-core-option><mjs-core-option value="be">Belgique</mjs-core-option></mjs-core-select> <mjs-core-select id="m" name="langues" multiple value='["fr"]'><mjs-core-option value="fr">Français</mjs-core-option><mjs-core-option value="de">Allemand</mjs-core-option></mjs-core-select> <mjs-core-radio id="ra" name="couleur" value="rouge" checked="true">Rouge</mjs-core-radio> <mjs-core-radio id="rb" name="couleur" value="vert">Vert</mjs-core-radio> <input id="t" type="text" name="t" value="départ"> <button type="reset" id="raz">reset</button></form>`

const DEPART = [['c', 'on'], ['s', 'on'], ['n', '3'], ['pays', 'fr'], ['langues', 'fr'], ['couleur', 'rouge'], ['t', 'départ']]
const CHANGE = [['n', '9'], ['pays', 'be'], ['langues', 'fr'], ['langues', 'de'], ['couleur', 'vert'], ['t', 'tapé']]

const scripts = new Map<string, Promise<string>>()

// le script de la page (cœur, modules, hôte), compilé une fois par mise en page pour les deux navigateurs
function script(mode: 'ombre' | 'leger'): Promise<string> {
  if (!scripts.has(mode)) {
    scripts.set(mode, (async () => {
      const root   = mjsTmp('reset-annule-' + mode)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), mode === 'ombre' ? OMBRE : AMORCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })())
  }
  return scripts.get(mode)!
}

for (const nom of ['chromium', 'firefox'] as const) for (const mode of ['ombre', 'leger'] as const) describe(`form.reset() annulé après coup — ${mode === 'ombre' ? 'formulaire dans l\'ombre de la page' : 'DOM léger'} (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const donnees  = async () => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('#f')).entries()])`))
  const attendre = () => page.waitForTimeout(600)
  // sous charge, la remise peut tarder : on attend l'état voulu (jusqu'à 8 s) avant de comparer
  const jusqua   = async (attendu: string[][]) => {
    const fin = Date.now() + 8000
    while (Date.now() < fin && JSON.stringify(await donnees()) !== JSON.stringify(attendu)) await page.waitForTimeout(100)
  }

  // un écouteur qui annule la remise, posé APRÈS le montage des composants : sur le formulaire, sur un ancêtre
  // (la racine de l'ombre, ou `document`)
  const ancetre = mode === 'ombre' ? `document.querySelector('mjs-hote')._shadow` : 'document'
  const poser   = (cible: string) => page.evaluate(`window.__annule = (e) => e.preventDefault(); window.__cibles = (window.__cibles || []).concat([${cible}]); ${cible}.addEventListener('reset', window.__annule)`)
  const retirer = (cible: string) => page.evaluate(`${cible}.removeEventListener('reset', window.__annule)`)

  // les gestes d'un utilisateur : décocher la case, éteindre l'interrupteur, taper 9, choisir Belgique, ajouter
  // Allemand, choisir le bouton vert, taper dans le champ texte
  async function modifier() {
    await page.evaluate(`(() => {
      const i = (id, q = 'input') => __q('#' + id)._shadow.querySelector(q)
      i('c').click(); i('s').click(); i('rb').click()
      const champ = i('n', '.input')
      champ.focus(); champ.value = '9'
      champ.dispatchEvent(new Event('input', { bubbles: true }))
      champ.blur()
      __q('#t').value = 'tapé'
    })()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#p')._shadow.querySelector('.select-btn').click()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#p')._shadow.querySelectorAll('.select-option')[1].click()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#m')._shadow.querySelector('.select-btn').click()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#m')._shadow.querySelectorAll('.select-option')[1].click()`)
    await page.waitForTimeout(150)
    await page.evaluate(`document.body.click()`)
    await page.waitForTimeout(150)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const code = await script(mode)
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      if (mode === 'ombre') {
        await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#m')?._shadow?.querySelector('.select-btn'))
        await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      }
      else {
        await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${LEGER}<script>${code}</script></body></html>`, { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('#m') as any)?._shadow?.querySelector('.select-btn') && !!(document.querySelector('#n') as any)?._shadow?.querySelector('.input'))
        await page.evaluate(`window.__q = (s) => document.querySelector(s)`)
      }
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  // un test qui échoue ne laisse pas son écouteur d'annulation aux suivants
  afterEach(async () => {
    if (page) await page.evaluate(`(window.__cibles || []).forEach((c) => c.removeEventListener('reset', window.__annule)); window.__cibles = []`)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : le formulaire envoie les valeurs posées par la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnees(), DEPART)
  })

  it('un écouteur de remontée posé après le montage, sur le formulaire, annule la remise : rien ne bouge, pour aucun composant', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable : les gestes ont changé le formulaire')
    await poser(`__q('#f')`)
    await page.evaluate(`__q('#raz').click()`)
    await attendre()
    assert.deepEqual(await donnees(), CHANGE, 'la remise annulée laisse la case, l\'interrupteur, le nombre, les listes, le radio et le champ texte tels quels')
    await retirer(`__q('#f')`)
    await page.evaluate(`__q('#raz').click()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART, 'sans l\'annulation, la remise rend tout')
  })

  it(`un écouteur posé sur ${mode === 'ombre' ? 'la racine de l\'ombre' : 'document'} annule aussi : la remise ne se fait qu'à moitié nulle part`, async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable')
    await poser(ancetre)
    await page.evaluate(`__q('#raz').click()`)
    await attendre()
    assert.deepEqual(await donnees(), CHANGE, 'tout reste tel que l\'utilisateur l\'a laissé')
    await retirer(ancetre)
    await page.evaluate(`__q('#f').reset()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART, 'form.reset() par le script, sans annulation : tout revient')
  })

  it('une remise non annulée n\'attend pas un deuxième geste : le bouton « reset » rend tout, comme avant', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    await page.evaluate(`__q('#raz').click()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART)
  })
})
