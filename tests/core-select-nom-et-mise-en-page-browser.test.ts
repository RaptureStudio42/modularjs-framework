// <@@select> dans Chromium réel.
// - Son nom accessible : le combobox est le bouton INTERNE du composant, que lit le lecteur d'écran ; la
//   balise <mjs-core-select> est ignorée de l'arbre d'accessibilité. Le nom (`aria-label`, `aria-labelledby`)
//   et l'état d'erreur (`aria-invalid`) posés sur la balise — par <@@field label="…"> ou à la main — lui sont
//   donc reportés, et le suivent quand ils changent. Sans rien, la liste n'a pas de nom (rien n'est inventé).
//   `aria-labelledby` cite un élément de l'arbre de la balise : l'ombre du composant ne le résout pas, il
//   passe par la propriété `ariaLabelledByElements` du combobox.
// - Sa mise en page : le retrait de 8 px des options groupées (dans la liste et dans la jauge de largeur) et
//   l'image d'icône à 1,2 fois le texte, dans le bouton fermé comme dans la liste.
// Arbre d'accessibilité lu par le protocole du navigateur (Accessibility.getFullAXTree).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const PAGE = `<span id="titre">Titre externe</span>
<@@field label="Pays"><@@select id="s-field" name="pays"><@@option value="fr">France</@@option></@@select></@@field>
<@@field label="Langue"><@@select id="s-valeur" name="langue" value="fr"><@@option value="fr">Français</@@option></@@select></@@field>
<@@select id="s-aria" name="a" aria-label="Choix direct"><@@option value="x">X</@@option></@@select>
<@@select id="s-lie" name="b" aria-labelledby="titre"><@@option value="x">X</@@option></@@select>
<@@select id="s-rien" name="c"><@@option value="x">X</@@option></@@select>
<@@select id="s-groupes" name="g" value="eur">
  <@@optgroup label="Europe">
    <@@option value="eur" icon={{ src: '${PNG}' }}>Euro</@@option>
  </@@optgroup>
  <@@option value="btc">Bitcoin</@@option>
</@@select>
`

describe('<@@select> — nom accessible, retrait des groupes, image d\'icône (Chromium réel)', function () {
  this.timeout(120000)
  let present = false
  let browser: any
  let script  = ''
  let page: any

  // les comboboxes de l'arbre d'accessibilité (l'ordre de l'arbre n'est pas celui de la page : le contenu d'un
  // <@@field> y vient en dernier) : nom et état d'erreur
  async function comboboxes(): Promise<Array<{ name: string; invalid: string }>> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Accessibility.enable')
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    await cdp.detach()
    return nodes.filter((n: any) => !n.ignored && n.role?.value === 'combobox').map((n: any) => ({
      name:    n.name?.value ?? '',
      invalid: String((n.properties || []).find((p: any) => p.name === 'invalid')?.value?.value)
    }))
  }

  const noms   = async () => (await comboboxes()).map((c) => c.name).sort()
  const etats  = async () => (await comboboxes()).map((c) => `${c.name}|${c.invalid}`).sort()

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright.chromium.executablePath())
      if (!present) return
      const root   = mjsTmp('select-nom-mise-en-page')
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
      script  = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
      browser = await playwright.chromium.launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#s-groupes')?._shadow?.querySelector('.select-btn'))
      await page.waitForTimeout(300)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le nom posé sur la balise arrive au combobox : <@@field label>, aria-label, aria-labelledby ; sans rien, pas de nom', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await noms(), ['', '', 'Choix direct', 'Langue', 'Pays', 'Titre externe'])
  })

  it('aria-invalid posé sur la balise arrive au combobox, et part avec elle', async function () {
    if (!present) { this.skip(); return }
    const hote = () => `(document.querySelector('mjs-hote')._shadow.querySelector('#s-field'))`
    const sans = ['Pays|false', 'Langue|false', 'Choix direct|false', 'Titre externe|false', '|false', '|false'].sort()
    assert.deepEqual(await etats(), sans, 'au départ : aucune liste en erreur')
    await page.evaluate(`${hote()}.setAttribute('aria-invalid', 'true')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await etats(), ['Pays|true', 'Langue|false', 'Choix direct|false', 'Titre externe|false', '|false', '|false'].sort(), 'la liste du champ est en erreur, ses voisines non')
    await page.evaluate(`${hote()}.removeAttribute('aria-invalid')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await etats(), sans, 'l\'erreur levée')
  })

  it('le nom suit les changements de l\'attribut : un autre texte, puis plus de nom', async function () {
    if (!present) { this.skip(); return }
    const hote = (id: string) => `(document.querySelector('mjs-hote')._shadow.querySelector('#${id}'))`
    await page.evaluate(`${hote('s-aria')}.setAttribute('aria-label', 'Autre nom')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await noms(), ['', '', 'Autre nom', 'Langue', 'Pays', 'Titre externe'])
    await page.evaluate(`${hote('s-aria')}.removeAttribute('aria-label')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await noms(), ['', '', '', 'Langue', 'Pays', 'Titre externe'], 'attribut retiré : le combobox n\'a plus de nom')
    await page.evaluate(`${hote('s-aria')}.setAttribute('aria-label', 'Choix direct')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await noms(), ['', '', 'Choix direct', 'Langue', 'Pays', 'Titre externe'])
    await page.evaluate(`${hote('s-lie')}.removeAttribute('aria-labelledby')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await noms(), ['', '', '', 'Choix direct', 'Langue', 'Pays'], 'aria-labelledby retiré : le nom part')
    await page.evaluate(`${hote('s-lie')}.setAttribute('aria-labelledby', 'titre')`)
    await page.waitForTimeout(120)
    assert.deepEqual(await noms(), ['', '', 'Choix direct', 'Langue', 'Pays', 'Titre externe'], 'aria-labelledby reposé : le nom revient')
  })

  it('les options groupées sont en retrait de 8 px, dans la liste et dans la jauge de largeur ; l\'image d\'icône mesure 1,2 em', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('#s-groupes')._shadow.querySelector('.select-btn').click()`)
    await page.waitForTimeout(200)
    const m = await page.evaluate(`(() => {
      const sh = document.querySelector('mjs-hote')._shadow.querySelector('#s-groupes')._shadow
      const cs = (el) => getComputedStyle(el)
      const opts  = [...sh.querySelectorAll('.select-option')]
      const sizer = [...sh.querySelectorAll('.select-sizer > span')]
      const imgB  = sh.querySelector('.select-btn img.select-img')
      const imgL  = opts[0].querySelector('img.select-img')
      return {
        options: opts.map((o) => o.textContent.trim() + ':' + cs(o).paddingLeft),
        jauge:   sizer.map((s) => s.textContent.trim() + ':' + cs(s).paddingLeft),
        bouton:  imgB && { w: parseFloat(cs(imgB).width), h: parseFloat(cs(imgB).height), police: parseFloat(cs(imgB).fontSize) },
        liste:   imgL && { w: parseFloat(cs(imgL).width), h: parseFloat(cs(imgL).height), police: parseFloat(cs(imgL).fontSize) }
      }
    })()`)
    assert.deepEqual(m.options, ['Euro:20px', 'Bitcoin:12px'], 'une option groupée : 12 px + 8 px de retrait')
    assert.deepEqual(m.jauge, ['Choisir…:0px', 'Euro:8px', 'Bitcoin:0px'], 'la jauge de largeur compte le même retrait')
    for (const [lieu, i] of [['bouton', m.bouton], ['liste', m.liste]] as const) {
      assert.ok(i, `une image dans ${lieu}`)
      assert.ok(i.police > 0)
      assert.ok(Math.abs(i.w - 1.2 * i.police) < .05, `${lieu} : largeur ${i.w} px pour une police de ${i.police} px`)
      assert.ok(Math.abs(i.h - 1.2 * i.police) < .05, `${lieu} : hauteur ${i.h} px pour une police de ${i.police} px`)
    }
  })
})
