// Le champ (`<@@field>`) relit son libellé flottant quand le formulaire de SON champ natif est remis à zéro : le
// formulaire propriétaire du champ (`native.form`, l'attribut `form="…"` compris), pas le plus proche ancêtre
// `<form>` de la balise. Un champ natif rattaché à un autre formulaire que celui où il est posé (ou posé hors de
// tout formulaire) est remis à zéro par le formulaire désigné : le libellé doit suivre ce formulaire-là.
// Un champ posé dans un formulaire avec une case partage l'unique écoute du `reset` de ce formulaire.
// Chromium, Firefox et WebKit réels, deux mises en page : la page compilée (formulaires dans l'ombre de l'hôte) et
// le DOM léger (balises du cœur posées à la main dans le document).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

// « dedans » est posé dans le formulaire b mais son champ natif appartient au formulaire a ;
// « dehors » n'est dans aucun formulaire, son champ natif appartient au formulaire a
const OMBRE = `<form id="a" @noUJS>
  <button type="reset" id="raz-a">reset a</button>
</form>
<form id="b" @noUJS>
  <@@field id="dedans" name="x" label="Dedans"><input name="x" form="a"></@@field>
  <button type="reset" id="raz-b">reset b</button>
</form>
<@@field id="dehors" name="y" label="Dehors"><input name="y" form="a"></@@field>
<form id="c" @noUJS>
  <@@field id="partage" name="z" label="Partage"><input name="z"></@@field>
  <@@checkbox id="case" name="k">Case</@@checkbox>
</form>
`

// les balises du cœur, posées telles quelles dans la page (l'amorce ne sert qu'à les embarquer dans le script)
const AMORCE = '<@@field name="a"><input name="a"></@@field>\n<@@checkbox name="b">B</@@checkbox>\n'

const LEGER = `<form id="a"><button type="reset" id="raz-a">reset a</button></form><form id="b"><mjs-core-field id="dedans" name="x" label="Dedans"><input name="x" form="a"></mjs-core-field><button type="reset" id="raz-b">reset b</button></form><mjs-core-field id="dehors" name="y" label="Dehors"><input name="y" form="a"></mjs-core-field><form id="c"><mjs-core-field id="partage" name="z" label="Partage"><input name="z"></mjs-core-field> <mjs-core-checkbox id="case" name="k">Case</mjs-core-checkbox></form>`

// l'espion : les écouteurs du `reset` encore posés sur les formulaires (une fonction distincte par couple formulaire / fonction)
const ESPION = `window.__name = (f) => f;
window.__resets = { vivants: [] };
(() => {
  const ajouter = EventTarget.prototype.addEventListener;
  const retirer = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (t === 'reset' && this instanceof HTMLFormElement && !window.__resets.vivants.some((v) => v[0] === this && v[1] === f)) window.__resets.vivants.push([this, f]);
    return ajouter.call(this, t, f, o);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    if (t === 'reset' && this instanceof HTMLFormElement) window.__resets.vivants = window.__resets.vivants.filter((v) => !(v[0] === this && v[1] === f));
    return retirer.call(this, t, f, o);
  };
})();`

const scripts = new Map<string, Promise<string>>()

// le script de la page (cœur, module, hôte), compilé une fois par mise en page pour les trois navigateurs
function script(mode: 'ombre' | 'leger'): Promise<string> {
  if (!scripts.has(mode)) {
    scripts.set(mode, (async () => {
      const root   = mjsTmp('field-reset-proprietaire-' + mode)
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) for (const mode of ['ombre', 'leger'] as const) describe(`le champ suit le formulaire de son champ natif — ${mode === 'ombre' ? 'formulaires dans l\'ombre de la page' : 'DOM léger'} (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const rempli  = (id: string): Promise<boolean> => page.evaluate(`__q('#${id}')._state.filled`)
  const vivants = (formulaire: string): Promise<number> => page.evaluate(`window.__resets.vivants.filter((v) => v[0] === __q('${formulaire}')).length`)
  const natif   = (id: string): Promise<string> => page.evaluate(`__q('#${id}').querySelector('input').value`)
  // les gestes d'un utilisateur : taper dans le champ natif
  const taper   = (id: string) => page.evaluate(`(() => { const c = __q('#${id}').querySelector('input'); c.focus(); c.value = 'x'; c.dispatchEvent(new Event('input', { bubbles: true })); c.blur() })()`)
  // sous charge, la relecture peut tarder : on attend l'état voulu (jusqu'à 8 s) avant de comparer
  const jusqua  = async (id: string, attendu: boolean) => {
    const fin = Date.now() + 8000
    while (Date.now() < fin && await rempli(id) !== attendu) await page.waitForTimeout(100)
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
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#dehors')?._shadow?.querySelector('.field') && !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#case')?._shadow?.querySelector('input'))
        await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      }
      else {
        await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${LEGER}<script>${code}</script></body></html>`, { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('#dehors') as any)?._shadow?.querySelector('.field') && !!(document.querySelector('#case') as any)?._shadow?.querySelector('input'))
        await page.evaluate(`window.__q = (s) => document.querySelector(s)`)
      }
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : les deux champs natifs sont vides, les libellés au repos', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await natif('dedans'), '')
    assert.equal(await natif('dehors'), '')
    assert.equal(await rempli('dedans'), false)
    assert.equal(await rempli('dehors'), false)
  })

  it('la remise du formulaire désigné par `form="…"` relit les deux champs : le libellé de chacun redescend', async function () {
    if (!present) { this.skip(); return }
    await taper('dedans')
    await taper('dehors')
    assert.equal(await rempli('dedans'), true, 'préalable : le libellé de « dedans » est monté')
    assert.equal(await rempli('dehors'), true, 'préalable : le libellé de « dehors » est monté')
    await page.evaluate(`__q('#raz-a').click()`)
    await jusqua('dedans', false)
    await jusqua('dehors', false)
    assert.equal(await natif('dedans'), '', 'le formulaire a vidé le champ natif')
    assert.equal(await natif('dehors'), '', 'le formulaire a vidé le champ natif')
    assert.equal(await rempli('dedans'), false, 'posé dans le formulaire b, suivi sur le formulaire a de son champ natif')
    assert.equal(await rempli('dehors'), false, 'posé hors de tout formulaire, suivi sur le formulaire a de son champ natif')
  })

  it('la remise du formulaire où la balise est posée, mais qui n\'est pas celui du champ natif, ne change rien', async function () {
    if (!present) { this.skip(); return }
    await taper('dedans')
    assert.equal(await rempli('dedans'), true, 'préalable')
    await page.evaluate(`__q('#raz-b').click()`)
    await page.waitForTimeout(600)
    assert.equal(await natif('dedans'), 'x', 'le formulaire b ne remet pas à zéro un champ qui n\'est pas à lui')
    assert.equal(await rempli('dedans'), true, 'le libellé reste monté')
  })

  it('un champ et une case dans le même formulaire : UNE seule écoute du reset, et la remise relit le champ', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await vivants('#c'), 1, 'une seule écoute pour les deux modules')
    await taper('partage')
    assert.equal(await rempli('partage'), true, 'préalable : le libellé est monté')
    await page.evaluate(`__q('#c').reset()`)
    await jusqua('partage', false)
    assert.equal(await natif('partage'), '', 'le formulaire a vidé le champ natif')
    assert.equal(await rempli('partage'), false, 'le libellé est redescendu')
  })
})
