// `form.reset()` sur les composants du cœur qui portent un état : case, interrupteur, nombre, liste (choix
// simple et multiple). Un champ natif revient à l'état du premier rendu ; ces composants, eux, gardaient le
// dernier choix de l'utilisateur — le formulaire soumis après un « réinitialiser » envoyait encore les anciennes
// valeurs. Ils reviennent maintenant à leur état de départ (celui du montage), sans annoncer de `change` : un
// champ natif n'en annonce pas non plus, c'est le formulaire qui dit son `reset`. Une remise annulée
// (`preventDefault`) ne change rien.
// Chromium et Firefox réels : un vrai bouton « reset », un vrai `form.reset()`, les données du formulaire
// lues par FormData.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $ok   = true
  $nb   = 3
  $pays = 'fr'
</script>

<form class="f">
  <@@checkbox class="c1" name="c1" checked=!{$ok}>Un</@@checkbox>
  <@@checkbox class="c2" name="c2">Deux</@@checkbox>
  <@@switch class="sw" name="sw" checked={true}>Interrupteur</@@switch>
  <@@number class="nb" name="nb" value=!{$nb}></@@number>
  <@@select class="sel" name="pays" value=!{$pays}>
    <@@option value="fr">France</@@option>
    <@@option value="be">Belgique</@@option>
  </@@select>
  <@@select class="multi" name="langues" multiple value={['fr']}>
    <@@option value="fr">Français</@@option>
    <@@option value="de">Allemand</@@option>
  </@@select>
  <button type="reset" class="rz">Remise à zéro</button>
</form>
`

const DEPART = [['c1', 'on'], ['sw', 'on'], ['nb', '3'], ['pays', 'fr'], ['langues', 'fr']]
const CHANGE = [['c2', 'on'], ['nb', '7'], ['pays', 'be'], ['langues', 'fr'], ['langues', 'de']]

for (const nom of ['chromium', 'firefox'] as const) describe(`form.reset() : les composants du cœur reviennent à leur état de départ (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let script  = ''
  let page: any

  const donnees = async () => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('.f')).entries()])`))
  const attendre = () => page.waitForTimeout(200)

  // les gestes d'un utilisateur : décocher le un, cocher le deux, éteindre l'interrupteur, taper 7, choisir
  // Belgique, ajouter Allemand
  async function modifier() {
    await page.evaluate(`(() => {
      __q('.c1')._shadow.querySelector('input').click()
      __q('.c2')._shadow.querySelector('input').click()
      __q('.sw')._shadow.querySelector('input').click()
      const champ = __q('.nb')._shadow.querySelector('.input')
      champ.focus()
      champ.value = '7'
      champ.dispatchEvent(new Event('input', { bubbles: true }))
      champ.blur()
    })()`)
    await attendre()
    await page.evaluate(`__q('.sel')._shadow.querySelector('.select-btn').click()`)
    await attendre()
    await page.evaluate(`__q('.sel')._shadow.querySelectorAll('.select-option')[1].click()`)
    await attendre()
    await page.evaluate(`__q('.multi')._shadow.querySelector('.select-btn').click()`)
    await attendre()
    await page.evaluate(`__q('.multi')._shadow.querySelectorAll('.select-option')[1].click()`)
    await attendre()
    await page.evaluate(`document.body.click()`)
    await attendre()
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const root   = mjsTmp('formulaire-reset-composants')
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
      script  = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.multi')?._shadow?.querySelector('.select-btn'))
      await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      await page.waitForTimeout(400)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : le formulaire envoie les valeurs posées par la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnees(), DEPART)
  })

  it('le bouton « reset » rend la case, l\'interrupteur, le nombre et les deux listes à leur état de départ — sans aucun change', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable : les gestes ont changé le formulaire')
    await page.evaluate(`window.__changes = []; __q('.f').addEventListener('change', (e) => window.__changes.push(e.type))`)
    await page.evaluate(`__q('.rz').click()`)
    await attendre()
    assert.deepEqual(await donnees(), DEPART, 'les données envoyées')
    const vu = await page.evaluate(`({
      c1: __q('.c1')._shadow.querySelector('input').checked,
      c2: __q('.c2')._shadow.querySelector('input').checked,
      sw: __q('.sw')._shadow.querySelector('input').checked,
      nb: __q('.nb')._shadow.querySelector('.input').value,
      sel: __q('.sel')._shadow.querySelector('.select-label').textContent.trim(),
      multi: __q('.multi')._shadow.querySelector('.select-label').textContent.trim(),
      lie: { ok: document.querySelector('mjs-hote')._state.ok, nb: document.querySelector('mjs-hote')._state.nb, pays: document.querySelector('mjs-hote')._state.pays }
    })`)
    assert.deepEqual(vu, { c1: true, c2: false, sw: true, nb: '3', sel: 'France', multi: 'Français', lie: { ok: true, nb: 3, pays: 'fr' } }, 'ce que la page montre, et les variables liées en deux sens')
    assert.deepEqual(await page.evaluate(`window.__changes`), [], 'aucun change annoncé par la remise à zéro')
  })

  it('form.reset() par le script : même retour', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable')
    await page.evaluate(`__q('.f').reset()`)
    await attendre()
    assert.deepEqual(await donnees(), DEPART)
  })

  it('une remise annulée (preventDefault) ne change rien', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    await page.evaluate(`window.__annule = (e) => e.preventDefault(); __q('.f').addEventListener('reset', window.__annule, true)`)
    await page.evaluate(`__q('.rz').click()`)
    await attendre()
    assert.deepEqual(await donnees(), CHANGE, 'le formulaire reste tel que l\'utilisateur l\'a laissé')
    await page.evaluate(`__q('.f').removeEventListener('reset', window.__annule, true)`)
    await page.evaluate(`__q('.rz').click()`)
    await attendre()
    assert.deepEqual(await donnees(), DEPART, 'sans l\'annulation, la remise a lieu')
  })

  it('un choix refait après la remise à zéro marche encore : la remise ne fige rien', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE)
  })
})
