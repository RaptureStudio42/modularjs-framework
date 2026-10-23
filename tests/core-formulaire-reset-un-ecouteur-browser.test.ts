// La remise à zéro des modules de saisie du cœur est écrite UNE fois : un formulaire qui contient trois modules
// de natures différentes (case, jauge, liste) n'écoute le `reset` qu'UNE fois, et la remise reste celle d'avant :
// chaque module revient à son état de départ, sauf si la page annule la remise ; un module déplacé dans un
// autre formulaire est suivi, un module retiré n'est plus écouté.
// Chromium, Firefox et WebKit réels, deux mises en page : la page compilée (formulaire dans l'ombre de l'hôte) et
// le DOM léger (balises du cœur posées à la main dans le document). Les écoutes sont comptées par un espion posé
// sur `addEventListener` AVANT le script de la page ; les données lues par FormData.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const OMBRE = `<form id="f1" @noUJS>
  <@@checkbox id="c" name="c" checked>Case</@@checkbox>
  <@@gauge id="g" name="g" value={3}></@@gauge>
  <@@select id="p" name="pays" value="fr"><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select>
  <button type="reset" id="raz1">reset 1</button>
</form>
<form id="f2" @noUJS>
  <button type="reset" id="raz2">reset 2</button>
</form>
`

// les balises du cœur, posées telles quelles dans la page (l'amorce ne sert qu'à les embarquer dans le script)
const AMORCE = `<@@checkbox name="a"></@@checkbox>
<@@gauge name="a"></@@gauge>
<@@select name="a"><@@option value="a">a</@@option></@@select>
`

const LEGER = `<form id="f1"><mjs-core-checkbox id="c" name="c" checked="true">Case</mjs-core-checkbox> <mjs-core-gauge id="g" name="g" value="3"></mjs-core-gauge> <mjs-core-select id="p" name="pays" value="fr"><mjs-core-option value="fr">France</mjs-core-option><mjs-core-option value="be">Belgique</mjs-core-option></mjs-core-select> <button type="reset" id="raz1">reset 1</button></form><form id="f2"><button type="reset" id="raz2">reset 2</button></form>`

const DEPART = [['c', 'on'], ['g', '3'], ['pays', 'fr']]
const CHANGE = [['g', '4'], ['pays', 'be']]
const IDS    = ['c', 'g', 'p']

// l'espion : chaque pose d'écoute du `reset` sur un formulaire (poses) et les écouteurs encore là (vivants)
const ESPION = `window.__name = (f) => f;
window.__resets = { poses: [], vivants: [] };
(() => {
  const ajouter = EventTarget.prototype.addEventListener;
  const retirer = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (t === 'reset' && this instanceof HTMLFormElement) {
      window.__resets.poses.push(this);
      if (!window.__resets.vivants.some((v) => v[0] === this && v[1] === f)) window.__resets.vivants.push([this, f]);
    }
    return ajouter.call(this, t, f, o);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    if (t === 'reset' && this instanceof HTMLFormElement) window.__resets.vivants = window.__resets.vivants.filter((v) => !(v[0] === this && v[1] === f));
    return retirer.call(this, t, f, o);
  };
})();`

const scripts = new Map<string, Promise<string>>()

// le script de la page (cœur, modules, hôte), compilé une fois par mise en page pour les trois navigateurs
function script(mode: 'ombre' | 'leger'): Promise<string> {
  if (!scripts.has(mode)) {
    scripts.set(mode, (async () => {
      const root   = mjsTmp('reset-un-ecouteur-' + mode)
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const mode of ['ombre', 'leger'] as const) describe(`un seul écouteur du reset par formulaire — ${mode === 'ombre' ? 'formulaire dans l\'ombre de la page' : 'DOM léger'} (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const donnees  = async (formulaire: string) => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('${formulaire}')).entries()])`))
  const attendre = () => page.waitForTimeout(600)
  // sous charge, la remise peut tarder : on attend l'état voulu (jusqu'à 8 s) avant de comparer
  const jusqua   = async (formulaire: string, attendu: string[][]) => {
    const fin = Date.now() + 8000
    while (Date.now() < fin && JSON.stringify(await donnees(formulaire)) !== JSON.stringify(attendu)) await page.waitForTimeout(100)
  }
  const poses    = (formulaire: string): Promise<number> => page.evaluate(`window.__resets.poses.filter((f) => f === __q('${formulaire}')).length`)
  const vivants  = (formulaire: string): Promise<number> => page.evaluate(`window.__resets.vivants.filter((v) => v[0] === __q('${formulaire}')).length`)
  const ranger   = (formulaire: string) => page.evaluate(`(() => { const f = __q('${formulaire}'); for (const id of ${JSON.stringify(IDS)}) f.appendChild(__q('#' + id)) })()`)
  const poser    = (cible: string) => page.evaluate(`window.__annule = (e) => e.preventDefault(); ${cible}.addEventListener('reset', window.__annule)`)
  const retirer  = (cible: string) => page.evaluate(`${cible}.removeEventListener('reset', window.__annule)`)

  // les gestes d'un utilisateur : décocher la case, un cran de plus sur la jauge, choisir Belgique
  async function modifier() {
    await page.evaluate(`(() => {
      const i = (id, q = 'input') => __q('#' + id)._shadow.querySelector(q)
      i('c').click(); i('g', '.btn').click()
    })()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#p')._shadow.querySelector('.select-btn').click()`)
    await page.waitForTimeout(150)
    await page.evaluate(`__q('#p')._shadow.querySelectorAll('.select-option')[1].click()`)
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
      // posé par evaluate et non par addInitScript : setContent écrit dans le document courant, sans navigation, et un script d'initialisation ne jouerait pas
      await page.evaluate(ESPION)
      if (mode === 'ombre') {
        await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#p')?._shadow?.querySelector('.select-btn'))
        await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      }
      else {
        await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${LEGER}<script>${code}</script></body></html>`, { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('#p') as any)?._shadow?.querySelector('.select-btn') && !!(document.querySelector('#g') as any)?._shadow?.querySelector('.btn'))
        await page.evaluate(`window.__q = (s) => document.querySelector(s)`)
      }
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  // un test qui échoue ne laisse pas son écouteur d'annulation aux suivants
  afterEach(async () => {
    if (page) await page.evaluate(`if (window.__annule) __q('#f1').removeEventListener('reset', window.__annule)`)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : trois modules différents, UNE seule écoute du reset sur le formulaire', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnees('#f1'), DEPART, 'le formulaire envoie les valeurs posées par la page')
    assert.equal(await poses('#f1'), 1, 'une seule pose, pas une par module')
    assert.equal(await vivants('#f1'), 1, 'un seul écouteur vivant')
    assert.equal(await poses('#f2'), 0, 'le formulaire vide n\'écoute rien')
  })

  it('le bouton « reset » rend les trois modules à leur état de départ', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees('#f1'), CHANGE, 'préalable : les gestes ont changé le formulaire')
    await page.evaluate(`__q('#raz1').click()`)
    await jusqua('#f1', DEPART)
    assert.deepEqual(await donnees('#f1'), DEPART)
  })

  it('une remise annulée après coup par un écouteur de la page ne touche à rien', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees('#f1'), CHANGE, 'préalable')
    await poser(`__q('#f1')`)
    await page.evaluate(`__q('#raz1').click()`)
    await attendre()
    assert.deepEqual(await donnees('#f1'), CHANGE, 'la remise annulée laisse les trois tels quels')
    await retirer(`__q('#f1')`)
    await page.evaluate(`__q('#raz1').click()`)
    await jusqua('#f1', DEPART)
    assert.deepEqual(await donnees('#f1'), DEPART, 'sans l\'annulation, la remise rend tout')
  })

  it('déplacés dans un autre formulaire : l\'ancien est quitté, le nouveau écouté une fois, sa remise les rend', async function () {
    if (!present) { this.skip(); return }
    const avant = await poses('#f2')
    await ranger('#f2')
    await attendre()
    assert.equal(await vivants('#f1'), 0, 'l\'ancien formulaire n\'écoute plus')
    assert.equal(await vivants('#f2'), 1, 'le nouveau écoute une fois')
    assert.equal(await poses('#f2') - avant, 1, 'une seule pose pour les trois')
    await modifier()
    assert.deepEqual(await donnees('#f2'), CHANGE, 'préalable : les gestes ont changé le formulaire d\'arrivée')
    await page.evaluate(`__q('#raz1').click()`)
    await attendre()
    assert.deepEqual(await donnees('#f2'), CHANGE, 'la remise de l\'ancien formulaire ne les concerne plus')
    await page.evaluate(`__q('#raz2').click()`)
    await jusqua('#f2', DEPART)
    assert.deepEqual(await donnees('#f2'), DEPART, 'la remise du nouveau formulaire les rend')
  })

  it('retirés de la page : plus aucune écoute ; remis dans un formulaire : une seule, et la remise les rend', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`(() => { window.__sortis = ${JSON.stringify(IDS)}.map((id) => __q('#' + id)); window.__sortis.forEach((e) => e.remove()) })()`)
    await page.waitForTimeout(500)
    assert.equal(await vivants('#f1') + await vivants('#f2'), 0, 'plus aucun module : plus d\'écoute')
    await page.evaluate(`(() => { const f = __q('#f1'); window.__sortis.forEach((e) => f.appendChild(e)) })()`)
    await attendre()
    assert.equal(await vivants('#f1'), 1, 'remis dans le formulaire : une seule écoute')
    await modifier()
    assert.deepEqual(await donnees('#f1'), CHANGE, 'préalable : les gestes ont changé le formulaire')
    await page.evaluate(`__q('#raz1').click()`)
    await jusqua('#f1', DEPART)
    assert.deepEqual(await donnees('#f1'), DEPART, 'après le retour, la remise rend tout')
  })
})
