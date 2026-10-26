// *lift(color, blur, press) — l'ombre soulevée se règle (sa couleur, son flou) et la balise s'enfonce à
// l'appui. Avant, l'ombre était fixe et dure (noire à 45 %, 18 px de décalage, 30 px de flou) et rien ne
// répondait à l'appui. Ici : avec les défauts, les valeurs calculées sont celles d'avant (même ombre,
// même montée, mêmes durées) ; `color` et `blur` passent par leurs variables CSS ; `press` pose un
// attribut le temps d'un appui — souris, doigt, Entrée ou Espace — et la balise redescend, son ombre se
// resserre, vite ; la saisie dans un champ n'appuie pas ; rien ne reste au retrait (écouteurs compris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const FICHIER = readFileSync(join(ICI, '../src/runtime/mjs_fx_lift.ts'), 'utf-8')

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const STYLE = `<style>
.c
  display: block
  width: 200px
  height: 80px
  margin: 40px
  padding: 0
  border: 0
  background: #345
  color: #fff
  border-radius: 8px
</style>`

const SOURCES: Record<string, string> = {
  'lf-defaut.mjs': `<div class="c" *lift(on: always)>Carte</div>\n${STYLE}`,
  'lf-teinte.mjs': `<div class="c" *lift(on: always, color: rgba(0,0,0,.12), blur: 32)>Carte</div>\n${STYLE}`,
  'lf-dur.mjs':    `<div class="c" *lift(on: always, blur: 0, color: #c9c90a)>Carte</div>\n${STYLE}`,
  'lf-appui.mjs':  `<button class="c" *lift(on: always, press: true)>Touche</button>\n${STYLE}`,
  'lf-survol.mjs': `<div class="c" *lift(press: true)>Carte</div>\n${STYLE}`,
  'lf-sans.mjs':   `<button class="c" *lift(on: always)>Touche</button>\n${STYLE}`,
  'lf-champ.mjs':  `<div class="c" tabindex="0" *lift(on: always, press: true)><input class="i" type="text" aria-label="nom"><input class="k" type="checkbox" aria-label="accord"></div>\n${STYLE}`,
  'lf-plat.mjs':   `<button class="c" *lift(on: always, shadow: false, press: true)>Touche</button>\n${STYLE}`,
  'lf-bloc.mjs':   `<script>\n$on = true\n</script>\n{if $on}\n<button class="c" *lift(on: always, press: true)>Touche</button>\n{end}\n<button class="b" @click={$on = !$on}>b</button>\n${STYLE}`,
  'lf-var.mjs':    `<script>\n$appui = false\n</script>\n<button class="c" *lift(on: always, press: $appui)>Touche</button>\n<button class="b" @click={$appui = true}>b</button>\n${STYLE}`,
  'lf-inactif.mjs': `<button class="c a" disabled *lift(on: always, press: true)>Touche</button><div class="c d" tabindex="0" aria-disabled="true" *lift(on: always, press: true)>Carte</div><div class="c e" tabindex="0" aria-disabled="false" *lift(on: always, press: true)>Carte</div>\n${STYLE}`
}

// l'ombre et la montée d'une balise soulevée, telles que le moteur les écrivait avant ces réglages
const OMBRE_AVANT   = 'rgba(0, 0, 0, 0.45) 0px 18px 30px 0px'
const MONTEE_AVANT  = 'matrix(1, 0, 0, 1, 0, -8)'
const OMBRE_APPUI   = 'rgba(0, 0, 0, 0.45) 0px 4px 7.5px 0px'

describe('*lift(color, blur, press) — l\'ombre réglable et l\'appui', function () {
  this.timeout(120000)
  let script  = ''
  let present = false

  before(async () => {
    present = await navigateurPresent()
    const root   = mjsTmp('effets-lift-ombre-appui')
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
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  describe('le catalogue et la feuille de l\'effet', () => {
    it('color et blur ont pour défaut l\'ombre d\'avant, press est faux ; la feuille lit les deux variables sous ce repli', () => {
      const st = EFFECTS.lift.settings
      assert.equal(st.color.rule, 'color')
      assert.equal(st.color.dflt, 'rgba(0,0,0,.45)')
      assert.equal(st.blur.rule, 'int 0..200')
      assert.equal(st.blur.dflt, 30)
      assert.equal(st.press.rule, 'bool')
      assert.equal(st.press.dflt, false)
      assert.match(FICHIER, /box-shadow:0 18px var\(--mjs-lift-blur,30px\) var\(--mjs-lift-color,rgba\(0,0,0,\.45\)\)/)
      assert.match(FICHIER, /vars: \{[^}]*color: ''[^}]*blur: 'px'/)
    })
  })

  describe('dans un composant (happy-dom)', () => {
    let window: any
    before(() => {
      window = new Window({ url: 'http://localhost/' })
      window.eval(script)
    })
    after(() => { window?.close?.() })

    const monte = async (tag: string) => {
      window.document.body.innerHTML = `<${tag}></${tag}>`
      const comp = window.document.querySelector(tag)
      const fin  = Date.now() + 3000
      while (!comp._shadow?.querySelector('.c') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      return comp
    }
    const pointeur = (type: string, extra: any = {}, bulle = true) => Object.assign(new window.Event(type, { bubbles: bulle }), { isPrimary: true, button: 0, pointerType: 'mouse' }, extra)
    const touche   = (type: string, key: string) => new window.KeyboardEvent(type, { key, bubbles: true, composed: true })
    const appuyee  = (el: any) => el.hasAttribute('mjs-fx-lift-press')

    it('color et blur écrits : leurs variables CSS ; non écrits : aucune (le repli de la feuille vaut l\'ombre d\'avant)', async () => {
      const el = (await monte('mjs-lf-teinte'))._shadow.querySelector('.c')
      assert.equal(el.style.getPropertyValue('--mjs-lift-color'), 'rgba(0,0,0,.12)')
      assert.equal(el.style.getPropertyValue('--mjs-lift-blur'), '32px')
      const d = (await monte('mjs-lf-defaut'))._shadow.querySelector('.c')
      assert.equal(d.style.getPropertyValue('--mjs-lift-color'), '')
      assert.equal(d.style.getPropertyValue('--mjs-lift-blur'), '')
    })

    it('la souris appuie la balise (bouton principal seulement) jusqu\'au relâchement, à la sortie ou à l\'annulation', async () => {
      const el = (await monte('mjs-lf-appui'))._shadow.querySelector('.c')
      assert.equal(appuyee(el), false)
      el.dispatchEvent(pointeur('pointerdown', { button: 2 }))
      assert.equal(appuyee(el), false, 'le bouton droit n\'appuie pas')
      el.dispatchEvent(pointeur('pointerdown', { isPrimary: false }))
      assert.equal(appuyee(el), false, 'un second doigt n\'appuie pas')
      el.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(el), true)
      window.document.body.dispatchEvent(pointeur('pointerup'))
      assert.equal(appuyee(el), false, 'relâché n\'importe où dans la fenêtre')
      el.dispatchEvent(pointeur('pointerdown'))
      el.dispatchEvent(pointeur('pointerleave', {}, false))
      assert.equal(appuyee(el), false, 'le pointeur est sorti de la balise')
      el.dispatchEvent(pointeur('pointerdown', { pointerType: 'touch' }))
      assert.equal(appuyee(el), true)
      window.document.body.dispatchEvent(pointeur('pointercancel'))
      assert.equal(appuyee(el), false, 'le doigt est parti faire défiler')
    })

    it('Entrée et Espace appuient tant qu\'ils sont tenus ; une autre touche, un champ de saisie, non ; la perte du focus relâche', async () => {
      const el = (await monte('mjs-lf-appui'))._shadow.querySelector('.c')
      for (const k of ['Enter', ' ']) {
        el.dispatchEvent(touche('keydown', k))
        assert.equal(appuyee(el), true, `${JSON.stringify(k)} tenu`)
        el.dispatchEvent(touche('keyup', k))
        assert.equal(appuyee(el), false, `${JSON.stringify(k)} relâché`)
      }
      el.dispatchEvent(touche('keydown', 'a'))
      assert.equal(appuyee(el), false, 'une lettre n\'appuie pas')
      el.dispatchEvent(touche('keydown', 'Enter'))
      el.dispatchEvent(new window.Event('focusout', { bubbles: true }))
      assert.equal(appuyee(el), false, 'le focus est parti : la touche ne reviendra pas')
      const carte = (await monte('mjs-lf-champ'))._shadow.querySelector('.c')
      carte.querySelector('.i').dispatchEvent(touche('keydown', ' '))
      assert.equal(appuyee(carte), false, 'taper une espace dans un champ n\'appuie pas la carte')
      carte.querySelector('.k').dispatchEvent(touche('keydown', ' '))
      assert.equal(appuyee(carte), true, 'une case à cocher s\'active à l\'Espace : la carte appuie')
    })

    it('sans press : aucun écouteur, rien ne s\'appuie', async () => {
      const el = (await monte('mjs-lf-sans'))._shadow.querySelector('.c')
      el.dispatchEvent(pointeur('pointerdown'))
      el.dispatchEvent(touche('keydown', 'Enter'))
      assert.equal(appuyee(el), false)
    })

    it('une balise désactivée ne s\'appuie pas — :disabled, aria-disabled="true" — ni à la souris ni au clavier ; réactivée, elle s\'appuie (le fieldset désactivé autour : dans les navigateurs réels)', async () => {
      const sh = (await monte('mjs-lf-inactif'))._shadow
      for (const k of ['a', 'd']) {
        const el = sh.querySelector('.' + k)
        el.dispatchEvent(pointeur('pointerdown'))
        assert.equal(appuyee(el), false, `.${k} : la souris n\'appuie pas une balise désactivée`)
        el.dispatchEvent(touche('keydown', 'Enter'))
        assert.equal(appuyee(el), false, `.${k} : Entrée n\'appuie pas une balise désactivée`)
        el.dispatchEvent(touche('keydown', ' '))
        assert.equal(appuyee(el), false, `.${k} : Espace n\'appuie pas une balise désactivée`)
      }
      const actif = sh.querySelector('.e')
      actif.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(actif), true, 'aria-disabled="false" : la balise s\'appuie')
      window.document.body.dispatchEvent(pointeur('pointerup'))
      const bouton = sh.querySelector('.a')
      bouton.removeAttribute('disabled')
      bouton.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(bouton), true, 'réactivé après la pose : l\'état est relu à chaque appui')
      window.document.body.dispatchEvent(pointeur('pointerup'))
      const carte = sh.querySelector('.d')
      carte.setAttribute('aria-disabled', 'true')
      carte.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(carte), false)
    })

    it('au relâchement (pointerup, pointercancel, sortie de la balise), la fenêtre n\'est plus écoutée : rien ne s\'accumule d\'un appui à l\'autre', async () => {
      const el = (await monte('mjs-lf-appui'))._shadow.querySelector('.c')
      // les écouteurs de relâchement encore posés sur la fenêtre : la fonction écoutée, et les types qu'elle écoute
      const actives = new Map<any, Set<string>>()
      const ecoutes = () => [...actives.values()].reduce((n, types) => n + types.size, 0)
      const ajoute  = window.addEventListener
      const retire  = window.removeEventListener
      window.addEventListener = function (type: string, f: any, o: any) {
        if (type === 'pointerup' || type === 'pointercancel') actives.set(f, (actives.get(f) ?? new Set<string>()).add(type))
        return ajoute.call(window, type, f, o)
      }
      window.removeEventListener = function (type: string, f: any, o: any) {
        actives.get(f)?.delete(type)
        return retire.call(window, type, f, o)
      }
      try {
        el.dispatchEvent(pointeur('pointerdown'))
        assert.equal(ecoutes(), 2, 'appuyée : la fenêtre écoute le relâchement et l\'annulation')
        window.document.body.dispatchEvent(pointeur('pointerup'))
        assert.equal(ecoutes(), 0, 'relâchée : plus rien n\'écoute sur la fenêtre')
        el.dispatchEvent(pointeur('pointerdown'))
        window.document.body.dispatchEvent(pointeur('pointercancel'))
        assert.equal(ecoutes(), 0, 'annulée : plus rien n\'écoute sur la fenêtre')
        el.dispatchEvent(pointeur('pointerdown'))
        el.dispatchEvent(pointeur('pointerleave', {}, false))
        assert.equal(ecoutes(), 0, 'sortie de la balise : plus rien n\'écoute sur la fenêtre')
      } finally {
        window.addEventListener    = ajoute
        window.removeEventListener = retire
      }
    })

    it('retiré avec sa balise ({if} refermé) : ni marque, ni variable, et la fenêtre n\'est plus écoutée', async () => {
      const comp = await monte('mjs-lf-bloc')
      const el   = comp._shadow.querySelector('.c')
      el.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(el), true)
      comp._shadow.querySelector('.b').click()
      const fin = Date.now() + 3000
      while (comp._shadow.querySelector('.c') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [], 'même un appui en cours est défait')
      assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'variable restée : ' + el.getAttribute('style'))
      el.dispatchEvent(pointeur('pointerdown'))
      el.dispatchEvent(touche('keydown', 'Enter'))
      assert.equal(appuyee(el), false, 'les écouteurs sont retirés')
    })

    it('press tenu par une variable : l\'effet est reposé avec ses écouteurs', async () => {
      const comp = await monte('mjs-lf-var')
      const el   = comp._shadow.querySelector('.c')
      el.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(el), false)
      comp._shadow.querySelector('.b').click()
      await new Promise((r) => setTimeout(r, 80))
      el.dispatchEvent(pointeur('pointerdown'))
      assert.equal(appuyee(el), true)
    })
  })

  describe('Chromium réel', () => {
    async function ouvre(browser: any, tag: string, reduit = false) {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.c'), tag)
      await page.waitForTimeout(400)
      return { page, erreurs }
    }

    // ce que la balise montre : sa montée, son ombre, ses durées (et la marque d'appui)
    const vue = (page: any, tag: string) => page.evaluate((t: string) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector('.c')
      const cs = getComputedStyle(el)
      return { transform: cs.transform, ombre: cs.boxShadow, duree: cs.transitionDuration, propriete: cs.transitionProperty, appui: el.hasAttribute('mjs-fx-lift-press') }
    }, tag)

    // on ne mesure qu'après la fin des transitions : les valeurs d'arrivée
    const pose = (page: any) => page.waitForTimeout(450)

    it('sans réglage : la montée et l\'ombre d\'avant, à la valeur près ; les durées aussi', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-lf-defaut')
        const v = await vue(page, 'mjs-lf-defaut')
        assert.equal(v.transform, MONTEE_AVANT)
        assert.equal(v.ombre, OMBRE_AVANT)
        assert.equal(v.duree, '0.25s, 0.25s')
        assert.equal(v.propriete, 'transform, box-shadow')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('color et blur règlent l\'ombre soulevée : une teinte légère et floue, une ombre dure et colorée (blur: 0)', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const a = await ouvre(browser, 'mjs-lf-teinte')
        const t = await vue(a.page, 'mjs-lf-teinte')
        assert.equal(t.ombre, 'rgba(0, 0, 0, 0.12) 0px 18px 32px 0px')
        assert.equal(t.transform, MONTEE_AVANT, 'la montée n\'a pas changé')
        const b = await ouvre(browser, 'mjs-lf-dur')
        assert.equal((await vue(b.page, 'mjs-lf-dur')).ombre, 'rgb(201, 201, 10) 0px 18px 0px 0px')
        assert.deepEqual([...a.erreurs, ...b.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('press à la souris : la balise redescend (montée 0), son ombre se resserre (4 px, flou ÷ 4), vite ; au relâchement elle remonte à son pas', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-lf-appui')
        const p = await page.evaluate(() => { const r = (document.querySelector('mjs-lf-appui') as any)._shadow.querySelector('.c').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
        const repos = await vue(page, 'mjs-lf-appui')
        assert.equal(repos.transform, MONTEE_AVANT)
        assert.equal(repos.ombre, OMBRE_AVANT)
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        const debut = await vue(page, 'mjs-lf-appui')
        assert.equal(debut.appui, true)
        assert.equal(debut.duree, '0.08s, 0.08s', 'l\'appui est rapide (la même durée pour la montée et pour l\'ombre)')
        await pose(page)
        const bas = await vue(page, 'mjs-lf-appui')
        assert.equal(bas.transform, 'matrix(1, 0, 0, 1, 0, 0)', 'la balise est redescendue')
        assert.equal(bas.ombre, OMBRE_APPUI, 'son ombre est resserrée')
        await page.mouse.up()
        const relache = await vue(page, 'mjs-lf-appui')
        assert.equal(relache.appui, false)
        assert.equal(relache.duree, '0.25s, 0.25s', 'la remontée garde sa durée')
        await pose(page)
        const haut = await vue(page, 'mjs-lf-appui')
        assert.equal(haut.transform, MONTEE_AVANT)
        assert.equal(haut.ombre, OMBRE_AVANT)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('press au clavier : Entrée et Espace tenus appuient la touche, relâchés la remontent ; le doigt aussi (événements de pointeur tactile)', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-lf-appui')
        await page.evaluate(() => (document.querySelector('mjs-lf-appui') as any)._shadow.querySelector('.c').focus())
        for (const k of ['Enter', ' ']) {
          await page.keyboard.down(k)
          await pose(page)
          const bas = await vue(page, 'mjs-lf-appui')
          assert.equal(bas.transform, 'matrix(1, 0, 0, 1, 0, 0)', `${JSON.stringify(k)} tenu : redescendue`)
          assert.equal(bas.ombre, OMBRE_APPUI)
          await page.keyboard.up(k)
          await pose(page)
          assert.equal((await vue(page, 'mjs-lf-appui')).transform, MONTEE_AVANT, `${JSON.stringify(k)} relâché : remontée`)
        }
        // le doigt : un pointeur tactile appuyé, puis annulé (il part faire défiler)
        await page.evaluate(() => {
          const el = (document.querySelector('mjs-lf-appui') as any)._shadow.querySelector('.c')
          el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, bubbles: true, composed: true }))
        })
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-appui')).transform, 'matrix(1, 0, 0, 1, 0, 0)', 'le doigt appuie')
        await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', isPrimary: true, bubbles: true })))
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-appui')).transform, MONTEE_AVANT, 'annulé : remontée')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('press avec on: hover : soulevée au survol, appuyée à l\'appui, soulevée de nouveau au relâchement, à plat à la sortie', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-lf-survol')
        const p = await page.evaluate(() => { const r = (document.querySelector('mjs-lf-survol') as any)._shadow.querySelector('.c').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
        assert.equal((await vue(page, 'mjs-lf-survol')).transform, 'none')
        await page.mouse.move(p.x, p.y)
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-survol')).transform, MONTEE_AVANT, 'survolée : soulevée')
        await page.mouse.down()
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-survol')).transform, 'matrix(1, 0, 0, 1, 0, 0)', 'appuyée')
        await page.mouse.up()
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-survol')).transform, MONTEE_AVANT, 'relâchée sur la balise : soulevée')
        await page.mouse.move(2, 2)
        await pose(page)
        assert.equal((await vue(page, 'mjs-lf-survol')).transform, 'none', 'sortie : à plat')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('sortir de la balise pendant l\'appui la relâche ; un champ de saisie dans la balise ne l\'appuie pas ; shadow: false : l\'appui n\'a pas d\'ombre', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const a = await ouvre(browser, 'mjs-lf-appui')
        const p = await a.page.evaluate(() => { const r = (document.querySelector('mjs-lf-appui') as any)._shadow.querySelector('.c').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
        await a.page.mouse.move(p.x, p.y)
        await a.page.mouse.down()
        await a.page.mouse.move(2, 2, { steps: 3 })
        assert.equal((await vue(a.page, 'mjs-lf-appui')).appui, false, 'sorti : relâchée')
        await a.page.mouse.up()
        const c = await ouvre(browser, 'mjs-lf-champ')
        await c.page.evaluate(() => (document.querySelector('mjs-lf-champ') as any)._shadow.querySelector('.i').focus())
        await c.page.keyboard.type('a b')
        assert.equal((await vue(c.page, 'mjs-lf-champ')).appui, false, 'la frappe dans un champ n\'appuie pas la carte')
        const f = await ouvre(browser, 'mjs-lf-plat')
        await f.page.evaluate(() => (document.querySelector('mjs-lf-plat') as any)._shadow.querySelector('.c').focus())
        await f.page.keyboard.down('Enter')
        await pose(f.page)
        const plat = await vue(f.page, 'mjs-lf-plat')
        assert.equal(plat.transform, 'matrix(1, 0, 0, 1, 0, 0)')
        assert.equal(plat.ombre, 'none')
        assert.deepEqual([...a.erreurs, ...c.erreurs, ...f.erreurs], [])
      } finally {
        await browser.close()
      }
    })

    it('« réduire les animations » : aucune transition, aucune montée, mais l\'ombre se resserre encore à l\'appui (l\'état reste lisible)', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-lf-appui', true)
        const repos = await vue(page, 'mjs-lf-appui')
        assert.equal(repos.transform, 'none')
        assert.equal(repos.propriete, 'none')
        await page.evaluate(() => (document.querySelector('mjs-lf-appui') as any)._shadow.querySelector('.c').focus())
        await page.keyboard.down('Enter')
        const bas = await vue(page, 'mjs-lf-appui')
        assert.equal(bas.transform, 'none')
        assert.equal(bas.propriete, 'none')
        assert.equal(bas.ombre, OMBRE_APPUI)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
})
