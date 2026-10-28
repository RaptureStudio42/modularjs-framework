// <@@select> dans Chromium, Firefox et WebKit réels :
// - Tab (et Maj+Tab) ferme le panneau ouvert sans changer la valeur, le focus part vers le champ voisin, et `search` envoie '' à la fermeture ;
// - un clic ailleurs ferme aussi le panneau, `search` envoie '' ;
// - pendant une composition de saisie (IME) ni filtre ni `search` ne partent ; un seul passage à `compositionend` ;
// - pendant une composition, aucune touche n'agit sur le panneau (Tab, Entrée, flèches, Échap : elles sont à l'IME) ;
// - les deux signes d'une touche de l'IME comptent chacun seul : `keyCode` 229 sans `isComposing` (claviers mobiles, et WebKit dont le `keydown` de validation suit `compositionend`), `isComposing` sans `keyCode` 229 ;
// - une composition qui finit sans `input` ne fait pas ignorer une saisie identique ensuite ; une composition coupée par la fermeture ne bloque pas l'ouverture suivante ;
// - cette remise à zéro tient à l'ouverture comme à la fermeture, chacune seule : un panneau refermé ou rouvert par l'état de la balise (sans passer par l'autre) repart propre aussi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { attendreEgal } from './helpers/attendre.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<input id="avant" type="text">
<@@select class="liste" name="liste" search>
  <@@option value="a">Alpha</@@option>
  <@@option value="b">Beta</@@option>
  <@@option value="c">Gamma</@@option>
</@@select>
<input id="apres" type="text">
<p id="dehors">dehors</p>
`

let compile: Promise<string> | null = null

function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-tab')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> — Tab, clic ailleurs, composition (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  const errors: string[] = []

  const coque    = '__q(\'.liste\')._shadow'
  const lire     = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })
  const ouvert   = () => lire(`!!${coque}.querySelector('.select-panel')`)
  const recus    = () => lire('window.__recus.slice()')
  const nbOptions = () => lire(`${coque}.querySelectorAll('.select-option').length`)

  async function ouvrir() {
    await page.evaluate(`${coque}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await attendre(`!!${coque}.querySelector('.select-search')`)
    await page.waitForTimeout(150)
  }

  // la frappe part quand la recherche a le focus, et elle y arrive : deux portes, pas une pause (sous charge, la frappe
  // partait parfois avant que le focus n'y soit) ; ce qu'elle déclenche (search, filtre) s'attend dans chaque test
  async function taper(texte: string) {
    await attendre(`${coque}.activeElement === ${coque}.querySelector('.select-search')`)
    await page.keyboard.type(texte)
    await attendre(`${coque}.querySelector('.select-search').value.endsWith(${JSON.stringify(texte)})`)
  }

  async function ferme() {
    await attendre(`!${coque}.querySelector('.select-panel')`)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 800, height: 500 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => errors.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.liste')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s); window.__recus = []; __q('.liste').addEventListener('search', (e) => window.__recus.push(e.data))`)
    await page.waitForTimeout(400)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) return
    await page.evaluate('window.__recus.length = 0')
  })

  afterEach(async function () {
    if (!present) return
    assert.deepEqual(errors, [], 'aucune erreur de page')
  })

  it('Tab ferme le panneau sans changer la valeur, le focus part vers le champ suivant, search annonce \'\'', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await taper('al')
    await attendreEgal(recus, ['a', 'al'], 'une recherche par frappe')
    await page.keyboard.press('Tab')
    await ferme()
    assert.equal(await lire(`__q('.liste')._state.value`), null)
    assert.deepEqual(await recus(), ['a', 'al', ''])
    await attendre(`document.querySelector('mjs-hote')._shadow.activeElement?.id === 'apres'`)
  })

  it('Maj+Tab ferme aussi, sans changer la valeur, le focus part vers le bouton qui précède la recherche', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await page.keyboard.press('Shift+Tab')
    await ferme()
    assert.equal(await lire(`__q('.liste')._state.value`), null)
    await attendre(`${coque}.activeElement?.classList.contains('select-btn')`)
  })

  it('un clic ailleurs ferme le panneau et search annonce \'\'', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await taper('be')
    await page.mouse.click(400, 300)
    await ferme()
    assert.equal(await lire(`__q('.liste')._state.value`), null)
    assert.deepEqual((await recus()).slice(-1), [''])
  })

  it('composition : ni filtre ni search pendant, un seul passage à compositionend', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await page.evaluate(`(() => {
      const c = ${coque}.querySelector('.select-search')
      c.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
      for (const t of ['g', 'ga']) {
        c.value = t
        c.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertCompositionText', isComposing: true }))
      }
    })()`)
    await page.waitForTimeout(150)
    assert.deepEqual(await recus(), [])
    assert.equal(await nbOptions(), 3)
    await page.evaluate(`${coque}.querySelector('.select-search').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'ga' }))`)
    await attendreEgal(recus, ['ga'], 'une seule recherche, à compositionend')
    await attendreEgal(nbOptions, 1, 'le filtre appliqué à compositionend')
    await page.evaluate(`${coque}.querySelector('.select-search').dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', isComposing: false }))`)
    await page.waitForTimeout(100)
    assert.deepEqual(await recus(), ['ga'])
  })

  const touche = (key: string, ime: boolean) => page.evaluate(`${coque}.querySelector('.select-search').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', keyCode: ${ime ? 229 : 0}, isComposing: ${ime}, bubbles: true, composed: true, cancelable: true }))`)
  const composer = (texte: string) => page.evaluate(`(() => {
    const c = ${coque}.querySelector('.select-search')
    c.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
    c.value = '${texte}'
    c.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertCompositionText', isComposing: true }))
  })()`)

  it('composition : Tab, Entrée, flèches et Échap ne touchent pas au panneau', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await composer('g')
    for (const key of ['Tab', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
      await touche(key, true)
      await page.waitForTimeout(60)
      assert.equal(await ouvert(), true, `${key} pendant la composition laisse le panneau ouvert`)
    }
    assert.equal(await lire(`__q('.liste')._state.value`), null)
    await page.evaluate(`${coque}.querySelector('.select-search').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'g' }))`)
    await touche('Escape', false)
    await ferme()
  })

  // un seul des deux signes d'une touche de l'IME : `keyCode` 229 sans `isComposing`, ou l'inverse
  const toucheIme = (key: string, keyCode: number, ime: boolean) => page.evaluate(`${coque}.querySelector('.select-search').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', keyCode: ${keyCode}, isComposing: ${ime}, bubbles: true, composed: true, cancelable: true }))`)

  for (const [titre, keyCode, ime] of [['keyCode 229 sans isComposing', 229, false], ['isComposing sans keyCode 229', 0, true]] as const) {
    it(`touche de l'IME avec ${titre} : Tab, Entrée, flèches, Début, Fin et Échap ne touchent pas au panneau`, async function () {
      if (!present) { this.skip(); return }
      await ouvrir()
      for (const key of ['Tab', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
        await toucheIme(key, keyCode, ime)
        await page.waitForTimeout(60)
        assert.equal(await ouvert(), true, `${key} laisse le panneau ouvert`)
      }
      assert.equal(await lire(`__q('.liste')._state.value`), null)
      await touche('Escape', false)
      await ferme()
    })
  }

  it('ordre de WebKit : compositionend AVANT le keydown 229 de validation — Entrée 229 ne choisit rien, une vraie Entrée choisit la ligne', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await page.evaluate(`(() => {
      const c = ${coque}.querySelector('.select-search')
      c.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
      c.value = 'ga'
      c.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertCompositionText', isComposing: true }))
      c.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'ga' }))
    })()`)
    await page.waitForTimeout(100)
    await toucheIme('Enter', 229, false)
    await page.waitForTimeout(100)
    assert.equal(await ouvert(), true, 'Entrée 229 hors composition laisse le panneau ouvert')
    assert.equal(await lire(`__q('.liste')._state.value`), null)
    await page.keyboard.press('Enter')
    await ferme()
    assert.equal(await lire(`__q('.liste')._state.value`), 'c')
  })

  // la remise à zéro de la composition tient à l'ouverture ET à la fermeture, chacune seule : on refait passer le panneau par l'état de la
  // balise (`open`), de sorte que l'autre moitié n'y ait pas eu lieu
  it('composition coupée par une fermeture qui ne passe pas par le panneau : l\'ouverture suivante repart propre', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await composer('g')
    await page.evaluate(`__q('.liste')._set('open', false)`)
    await ferme()
    await page.evaluate('window.__recus.length = 0')
    await ouvrir()
    await taper('ga')
    await attendreEgal(recus, ['g', 'ga'], 'la saisie prise, une recherche par frappe')
    await attendreEgal(nbOptions, 1, 'le filtre appliqué')
    await page.keyboard.press('Escape')
    await ferme()
  })

  it('composition coupée par la fermeture du panneau : une ouverture qui ne passe pas par lui repart propre aussi', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await composer('g')
    await page.mouse.click(400, 300)
    await ferme()
    await page.evaluate('window.__recus.length = 0')
    await page.evaluate(`__q('.liste')._set('open', true)`)
    await attendre(`!!${coque}.querySelector('.select-search')`)
    await page.evaluate(`${coque}.querySelector('.select-search').focus()`)
    await taper('ga')
    await attendreEgal(recus, ['g', 'ga'], 'la saisie prise, une recherche par frappe')
    await attendreEgal(nbOptions, 1, 'le filtre appliqué')
    await page.keyboard.press('Escape')
    await ferme()
  })

  it('composition finie sans input, puis fermeture : la saisie identique à la réouverture est prise', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await page.evaluate(`(() => {
      const c = ${coque}.querySelector('.select-search')
      c.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
      c.value = 'g'
      c.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'g' }))
    })()`)
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')
    await ferme()
    await page.evaluate('window.__recus.length = 0')
    await ouvrir()
    await taper('g')
    await attendreEgal(recus, ['g'], 'la saisie identique prise')
    await attendreEgal(nbOptions, 1, 'le filtre appliqué')
    await page.keyboard.press('Escape')
    await ferme()
  })

  it('composition finie sans input : retaper le même texte dans le panneau ouvert est pris', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await page.evaluate(`(() => {
      const c = ${coque}.querySelector('.select-search')
      c.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }))
      c.value = 'g'
      c.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: 'g' }))
    })()`)
    await page.waitForTimeout(100)
    await page.evaluate('window.__recus.length = 0')
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('g')
    await attendreEgal(recus, ['g'], 'le même texte retapé pris')
    await page.keyboard.press('Escape')
    await ferme()
  })

  it('composition coupée par la fermeture : l\'ouverture suivante repart propre', async function () {
    if (!present) { this.skip(); return }
    await ouvrir()
    await composer('g')
    await page.keyboard.press('Escape')
    await ferme()
    await page.evaluate('window.__recus.length = 0')
    await ouvrir()
    await taper('ga')
    await attendreEgal(recus, ['g', 'ga'], 'la saisie prise, une recherche par frappe')
    await attendreEgal(nbOptions, 1, 'le filtre appliqué')
    await page.keyboard.press('Escape')
    await ferme()
  })
})
