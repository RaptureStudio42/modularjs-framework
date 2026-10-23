// `form.reset()` suit le formulaire où le composant EST au moment de la remise, pas celui où il était au
// montage. L'écoute du `reset` se posait une fois (`µmount`, qui ne se rejoue jamais) : un composant déplacé
// vers un autre formulaire restait écouté par l'ancien, et la remise du nouveau ne l'atteignait pas ; retiré
// puis remis plus tard, il n'était plus écouté du tout (`µdestroy` avait retiré l'écouteur) ; né hors de tout
// formulaire puis rangé dans l'un, il n'avait jamais pris son état de départ. L'écoute se pose maintenant à
// chaque connexion et se retire à chaque déconnexion.
// Chromium et Firefox réels : case, interrupteur, nombre, listes (simple et multiple), boutons radio.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<div id="hors"><@@checkbox id="h" name="h" checked>Né hors formulaire</@@checkbox></div>
<form id="f1" @noUJS>
  <@@checkbox id="c" name="c" checked>Case</@@checkbox>
  <@@switch id="s" name="s" checked>Interrupteur</@@switch>
  <@@number id="n" name="n" value={3}></@@number>
  <@@select id="p" name="pays" value="fr"><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select>
  <@@select id="m" name="langues" multiple value={['fr']}><@@option value="fr">Français</@@option><@@option value="de">Allemand</@@option></@@select>
  <@@radio id="ra" name="couleur" value="rouge" checked>Rouge</@@radio>
  <@@radio id="rb" name="couleur" value="vert">Vert</@@radio>
  <button type="reset" id="raz1">reset 1</button>
</form>
<form id="f2" @noUJS>
  <button type="reset" id="raz2">reset 2</button>
</form>
`

const DEPART = [['c', 'on'], ['s', 'on'], ['n', '3'], ['pays', 'fr'], ['langues', 'fr'], ['couleur', 'rouge']]
const CHANGE = [['n', '9'], ['pays', 'be'], ['langues', 'fr'], ['langues', 'de'], ['couleur', 'vert']]
const IDS    = ['c', 's', 'n', 'p', 'm', 'ra', 'rb']

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('reset-suit-le-formulaire')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compile
}

for (const nom of ['chromium', 'firefox'] as const) describe(`form.reset() suit le formulaire où le composant est (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const donnees  = async (formulaire: string) => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('${formulaire}')).entries()].filter((e) => e[0] !== 'h'))`))
  const attendre = () => page.waitForTimeout(600)
  // sous charge, la remise peut tarder : on attend l'état voulu (jusqu'à 8 s) avant de comparer
  const jusqua   = async (formulaire: string, attendu: string[][]) => {
    const fin = Date.now() + 8000
    while (Date.now() < fin && JSON.stringify(await donnees(formulaire)) !== JSON.stringify(attendu)) await page.waitForTimeout(100)
  }
  const ranger   = (formulaire: string) => page.evaluate(`(() => { const f = __q('${formulaire}'); for (const id of ${JSON.stringify(IDS)}) f.appendChild(__q('#' + id)) })()`)

  // les gestes d'un utilisateur : décocher la case, éteindre l'interrupteur, taper 9, choisir Belgique, ajouter
  // Allemand, choisir le bouton vert
  async function modifier() {
    await page.evaluate(`(() => {
      const i = (id, q = 'input') => __q('#' + id)._shadow.querySelector(q)
      i('c').click(); i('s').click(); i('rb').click()
      const champ = i('n', '.input')
      champ.focus(); champ.value = '9'
      champ.dispatchEvent(new Event('input', { bubbles: true }))
      champ.blur()
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
      const code = await script()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#m')?._shadow?.querySelector('.select-btn'))
      await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : le formulaire envoie les valeurs posées par la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnees('#f1'), DEPART)
  })

  it('déplacés vers un autre formulaire : la remise du nouveau les rend, celle de l\'ancien ne les touche plus', async function () {
    if (!present) { this.skip(); return }
    await ranger('#f2')
    await attendre()
    await modifier()
    assert.deepEqual(await donnees('#f2'), CHANGE, 'préalable : les gestes ont changé le formulaire d\'arrivée')
    await page.evaluate(`__q('#raz1').click()`)
    await attendre()
    assert.deepEqual(await donnees('#f2'), CHANGE, 'la remise de l\'ancien formulaire ne les concerne plus')
    await page.evaluate(`__q('#raz2').click()`)
    await jusqua('#f2', DEPART)
    assert.deepEqual(await donnees('#f2'), DEPART, 'la remise du nouveau formulaire les rend à leur état de départ')
  })

  it('retirés de la page puis remis plus tard dans un formulaire : la remise les rend encore', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`(() => { window.__sortis = ${JSON.stringify(IDS)}.map((id) => __q('#' + id)); window.__sortis.forEach((e) => e.remove()) })()`)
    await page.waitForTimeout(500)
    await page.evaluate(`(() => { const f = __q('#f1'); window.__sortis.forEach((e) => f.appendChild(e)) })()`)
    await attendre()
    await modifier()
    assert.deepEqual(await donnees('#f1'), CHANGE, 'préalable : les gestes ont changé le formulaire')
    await page.evaluate(`__q('#raz1').click()`)
    await jusqua('#f1', DEPART)
    assert.deepEqual(await donnees('#f1'), DEPART, 'après le retour, la remise rend tout')
  })

  it('né hors de tout formulaire puis rangé dans l\'un : il a pris son état de départ et la remise le lui rend', async function () {
    if (!present) { this.skip(); return }
    const case_ = () => page.evaluate(`__q('#h')._shadow.querySelector('input').checked`)
    assert.equal(await case_(), true, 'départ : coché par la page')
    await page.evaluate(`__q('#f1').appendChild(__q('#h'))`)
    await attendre()
    await page.evaluate(`__q('#h')._shadow.querySelector('input').click()`)
    await attendre()
    assert.equal(await case_(), false, 'préalable : l\'utilisateur l\'a décochée')
    await page.evaluate(`__q('#raz1').click()`)
    for (let i = 0; i < 80 && !(await case_()); i++) await page.waitForTimeout(100)
    assert.equal(await case_(), true, 'la remise du formulaire où il est lui rend son état de départ')
  })
})
