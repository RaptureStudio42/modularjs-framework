// <@@select> : le champ du formulaire est déjà à jour quand `change` part (puis `other`). Un gestionnaire posé sur la balise, ou un
// `<form @change>`, qui lit `new FormData(form)` y voit le choix d'APRÈS le geste, jamais l'ancien : choix simple, choix multiple,
// réponse libre (choix simple et multiple), valeur retirée, option qui remplace une réponse libre.
// Chromium et Firefox réels : de vrais clics sur les lignes, la vraie frappe dans le champ de la réponse libre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'
const LAIT = '<@@option value="lait">Lait</@@option><@@option value="oeuf">Oeuf</@@option><@@option value="noix">Noix</@@option>'

// ce que le formulaire enverrait, lu PENDANT l'évènement (sur la balise ou sur le formulaire)
const PAGE = `<script>
  $lus = []

  @lire = (voie, e)->
    champs = Array.from(new FormData(e.target.closest('form'))).map((p)-> p[0] + '=' + p[1])
    $lus   = [...$lus, { voie, qui: e.target.className.split(' ')[0], type: e.type, data: e.data, champs }]
</script>

<form class="balise" @noUJS>
  <@@select class="simple" name="pays" value="fr" @change={@lire('balise', e)}>${PAYS}</@@select>
  <@@select class="multi" name="langues[]" multiple @change={@lire('balise', e)}>${LAIT}</@@select>
  <@@select class="libre" name="libre" other @change={@lire('balise', e)} @other={@lire('balise', e)}>${PAYS}</@@select>
  <@@select class="libres" name="mots[]" multiple other @change={@lire('balise', e)} @other={@lire('balise', e)}>${LAIT}</@@select>
</form>

<form class="form" @noUJS @change={@lire('form', e)} @other={@lire('form', e)}>
  <@@select class="simple" name="pays" value="fr">${PAYS}</@@select>
  <@@select class="multi" name="langues[]" multiple>${LAIT}</@@select>
  <@@select class="libre" name="libre" other>${PAYS}</@@select>
  <@@select class="libres" name="mots[]" multiple other>${LAIT}</@@select>
</form>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, libellés), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-formdata-change')
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
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return compile
}

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select> — FormData lu pendant change et other (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any

  const lire = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const lus  = async () => await lire(`document.querySelector('mjs-hote')._state.lus`) as Array<{ voie: string, qui: string, type: string, data: any, champs: string[] }>

  // le champ du formulaire d'un sélecteur, parmi toutes les entrées lues : celles dont le nom commence par `prefixe`
  const de = (champs: string[], prefixe: string) => champs.filter((c) => c.startsWith(prefixe))

  // ce que le formulaire porte une fois les effets passés : la même chose que pendant le dernier évènement
  async function repos(zone: string, prefixe: string): Promise<string[]> {
    await page.waitForTimeout(200)
    return de(await lire(`Array.from(new FormData(__q('.${zone}'))).map((p) => p[0] + '=' + p[1])`), prefixe)
  }

  async function charger() {
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${await script()}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.form .libres')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  }

  const coque = (zone: string, cls: string) => `__q('.${zone} .${cls}')._shadow`

  async function ouvrir(zone: string, cls: string) {
    const ouvert = `${coque(zone, cls)}.querySelector('.select-btn').getAttribute('aria-expanded') === 'true'`
    if (!(await lire(ouvert))) await page.evaluate(`${coque(zone, cls)}.querySelector('.select-btn').click()`)
    await page.waitForFunction(`${ouvert} && ${coque(zone, cls)}.querySelector('.select-panel')`, null, { timeout: 30000 })
  }

  // un vrai clic sur la ligne qui porte ce libellé
  async function ligne(zone: string, cls: string, libelle: string) {
    await ouvrir(zone, cls)
    const p = await page.evaluate(`(() => {
      const l = [...${coque(zone, cls)}.querySelectorAll('.select-option')].find((x) => x.querySelector('.select-option-label').textContent === ${JSON.stringify(libelle)})
      const r = l.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    await page.mouse.click(p.x, p.y)
  }

  // « Autre… », le texte tapé, Entrée
  async function saisir(zone: string, cls: string, texte: string) {
    await ouvrir(zone, cls)
    await page.evaluate(`${coque(zone, cls)}.querySelector('.select-other').click()`)
    const champ = `${coque(zone, cls)}.querySelector('.select-other-input')`
    await page.waitForFunction(`${champ} && ${coque(zone, cls)}.activeElement === ${champ}`, null, { timeout: 30000 })
    await page.keyboard.type(texte)
    await page.keyboard.press('Enter')
  }

  // attend que `n` évènements de plus aient été lus, rend les nouveaux
  async function attendre(avant: number, n: number) {
    await page.waitForFunction(`document.querySelector('mjs-hote')._state.lus.length >= ${avant + n}`, null, { timeout: 30000 })
    return (await lus()).slice(avant)
  }

  // le bouton referme la liste, où que soit le focus
  async function fermer(zone: string, cls: string) {
    const ouvert = `${coque(zone, cls)}.querySelector('.select-btn').getAttribute('aria-expanded') === 'true'`
    if (await lire(ouvert)) await page.evaluate(`${coque(zone, cls)}.querySelector('.select-btn').click()`)
    await page.waitForFunction(`!(${ouvert})`, null, { timeout: 30000 })
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    await charger()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const zone of ['balise', 'form'] as const) describe(zone === 'balise' ? 'gestionnaire posé sur la balise' : '<form @change> et <form @other>', () => {
    it('choix simple : choisir une option, FormData montre déjà la nouvelle valeur, pas « fr »', async function () {
      if (!present) { this.skip(); return }
      const avant = (await lus()).length
      await ligne(zone, 'simple', 'Allemagne')
      const [l] = await attendre(avant, 1)
      assert.deepEqual([l.voie, l.qui, l.type, l.data], [zone, 'simple', 'change', 'de'])
      assert.deepEqual(de(l.champs, 'pays'), ['pays=de'])
      assert.deepEqual(await repos(zone, 'pays'), ['pays=de'])
    })

    it('choix multiple : cocher deux options puis en décocher une, FormData montre à chaque fois l\'état d\'après', async function () {
      if (!present) { this.skip(); return }
      const avant = (await lus()).length
      await ligne(zone, 'multi', 'Lait')
      await ligne(zone, 'multi', 'Oeuf')
      await ligne(zone, 'multi', 'Lait')
      const vus = await attendre(avant, 3)
      assert.deepEqual(vus.map((l) => l.data), [['lait'], ['lait', 'oeuf'], ['oeuf']])
      assert.deepEqual(vus.map((l) => de(l.champs, 'langues')), [['langues[]=lait'], ['langues[]=lait', 'langues[]=oeuf'], ['langues[]=oeuf']])
      assert.deepEqual(await repos(zone, 'langues'), ['langues[]=oeuf'])
      await fermer(zone, 'multi')
    })

    it('réponse libre en choix simple : change puis other voient la réponse sous libre_other, puis l\'option qui la remplace sous libre', async function () {
      if (!present) { this.skip(); return }
      const avant = (await lus()).length
      await saisir(zone, 'libre', 'Zed')
      const donnee = await attendre(avant, 2)
      assert.deepEqual(donnee.map((l) => [l.type, l.data]), [['change', 'Zed'], ['other', 'Zed']])
      for (const l of donnee) assert.deepEqual(de(l.champs, 'libre'), ['libre_other=Zed'], `à l'évènement ${l.type}`)
      const milieu = (await lus()).length
      await ligne(zone, 'libre', 'France')
      const remplacee = await attendre(milieu, 2)
      assert.deepEqual(remplacee.map((l) => [l.type, l.data]), [['change', 'fr'], ['other', null]])
      for (const l of remplacee) assert.deepEqual(de(l.champs, 'libre'), ['libre=fr'], `à l'évènement ${l.type}`)
      assert.deepEqual(await repos(zone, 'libre'), ['libre=fr'])
    })

    it('réponse libre en choix multiple : ajoutée, mêlée à une option, retirée ; FormData est à jour à chaque évènement', async function () {
      if (!present) { this.skip(); return }
      const avant = (await lus()).length
      await saisir(zone, 'libres', 'Kiwi')
      const ajoutee = await attendre(avant, 2)
      assert.deepEqual(ajoutee.map((l) => [l.type, l.data]), [['change', ['Kiwi']], ['other', ['Kiwi']]])
      for (const l of ajoutee) assert.deepEqual(de(l.champs, 'mots'), ['mots_other[]=Kiwi'], `à l'évènement ${l.type}`)
      const milieu = (await lus()).length
      await page.keyboard.press('Escape')
      await ligne(zone, 'libres', 'Lait')
      const melee = await attendre(milieu, 1)
      assert.deepEqual(melee.map((l) => [l.type, l.data]), [['change', ['Kiwi', 'lait']]])
      assert.deepEqual(de(melee[0].champs, 'mots'), ['mots[]=lait', 'mots_other[]=Kiwi'])
      const fin = (await lus()).length
      await ligne(zone, 'libres', 'Kiwi')
      const retiree = await attendre(fin, 2)
      assert.deepEqual(retiree.map((l) => [l.type, l.data]), [['change', ['lait']], ['other', []]])
      for (const l of retiree) assert.deepEqual(de(l.champs, 'mots'), ['mots[]=lait'], `à l'évènement ${l.type}`)
      assert.deepEqual(await repos(zone, 'mots'), ['mots[]=lait'])
      await fermer(zone, 'libres')
    })
  })
})
