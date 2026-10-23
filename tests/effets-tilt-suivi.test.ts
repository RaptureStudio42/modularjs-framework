// *tilt(follow) — la durée du suivi pendant le survol, réglable. Avant, le suivi valait toujours 0,1 s
// en ligne droite, figé dans la feuille de l'effet (`duration` ne règle que le retour à plat) : les cartes
// qui suivent la souris en 0,2 s ou 0,25 s n'avaient aucun moyen de l'écrire. Ici : le réglage est au
// catalogue (100ms) et lu par le CSS (`--mjs-tilt-follow`) ; la variable qui le tient le suit sans
// reposer l'effet ; avec la valeur par défaut, tout ce que fait `*tilt` reste identique (mêmes durées,
// mêmes courbes, au repos, pendant le survol et au retour) ; dans Chromium réel, la durée de la
// transition qui suit la souris est celle du réglage (0 : aucune, la carte est collée à la souris).

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
const FICHIER = readFileSync(join(ICI, '../src/runtime/mjs_fx_tilt.ts'), 'utf-8')

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const STYLE = `<style>
.t
  width: 200px
  height: 120px
  margin: 30px
  background: #234
  color: #fff
.s
  width: 300px
</style>`

const SOURCES: Record<string, string> = {
  'tl-defaut.mjs': `<div class="t" *tilt>Carte</div>\n${STYLE}`,
  'tl-250.mjs':    `<div class="t" *tilt(follow: 250ms)>Carte</div>\n${STYLE}`,
  'tl-zero.mjs':   `<div class="t" *tilt(follow: 0, duration: 600ms)>Carte</div>\n${STYLE}`,
  'tl-theme.mjs':  `<div class="s"><div class="t" *tilt></div></div>\n${STYLE}`,
  'tl-ecrit.mjs':  `<div class="s"><div class="t" *tilt(follow: 250ms)></div></div>\n${STYLE}`,
  'tl-var.mjs':    `<script>\n$suivi = '100ms'\n</script>\n<div class="t" *tilt(follow: $suivi)>Carte</div>\n<button class="b" @click={$suivi = '400ms'}>b</button>\n${STYLE}`,
  'tl-bloc.mjs':   `<script>\n$on = true\n</script>\n{if $on}\n<div class="t" *tilt(follow: 250ms)>Carte</div>\n{end}\n<button class="b" @click={$on = !$on}>b</button>\n${STYLE}`
}

describe('*tilt(follow) — la lenteur du suivi', function () {
  this.timeout(120000)
  let script  = ''
  let present = false

  before(async () => {
    present = await navigateurPresent()
    const root   = mjsTmp('effets-tilt-suivi')
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
    it('follow : une durée de 100ms par défaut, lue par la feuille sous le même repli, plus aucune durée figée', () => {
      const r = EFFECTS.tilt.settings.follow
      assert.equal(r.rule, 'time')
      assert.equal(r.dflt, '100ms')
      assert.match(FICHIER, /\[mjs-fx-tilt-active\]\{transition:transform var\(--mjs-tilt-follow,100ms\) linear;will-change:transform\}/)
      assert.ok(!/transform \.1s linear/.test(FICHIER), 'la durée du suivi n\'est plus écrite en dur')
      assert.match(FICHIER, /vars: \{[^}]*follow: ''/)
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
      while (!comp._shadow?.querySelector('.t') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      return comp
    }

    it('écrit : la variable porte la durée ; non écrit : aucune variable (le repli de la feuille vaut 100ms)', async () => {
      const ecrit = (await monte('mjs-tl-250'))._shadow.querySelector('.t')
      assert.equal(ecrit.style.getPropertyValue('--mjs-tilt-follow'), '250ms')
      const defaut = (await monte('mjs-tl-defaut'))._shadow.querySelector('.t')
      assert.equal(defaut.style.getPropertyValue('--mjs-tilt-follow'), '')
    })

    it('0 s\'écrit tel quel (le repli CSS ne sert pas)', async () => {
      const el = (await monte('mjs-tl-zero'))._shadow.querySelector('.t')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-follow'), '0')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-duration'), '600ms')
    })

    it('une variable de l\'appli : la variable CSS suit sur place, l\'effet n\'est pas reposé', async () => {
      const comp = await monte('mjs-tl-var')
      const el   = comp._shadow.querySelector('.t')
      const off  = el._mjs_fxOff.tilt
      assert.equal(el.style.getPropertyValue('--mjs-tilt-follow'), '100ms')
      comp._shadow.querySelector('.b').click()
      const fin = Date.now() + 3000
      while (el.style.getPropertyValue('--mjs-tilt-follow') !== '400ms' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      assert.equal(el.style.getPropertyValue('--mjs-tilt-follow'), '400ms')
      assert.ok(el._mjs_fxOff.tilt === off, 'le même effet : rien n\'a été reposé')
    })

    it('retiré avec sa balise ({if} refermé) : ni marque, ni variable de suivi', async () => {
      const comp = await monte('mjs-tl-bloc')
      const el   = comp._shadow.querySelector('.t')
      assert.equal(el.style.getPropertyValue('--mjs-tilt-follow'), '250ms')
      comp._shadow.querySelector('.b').click()
      const fin = Date.now() + 3000
      while (comp._shadow.querySelector('.t') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
      assert.ok(!/--mjs-/.test(el.getAttribute('style') ?? ''), 'variable restée : ' + el.getAttribute('style'))
    })
  })

  describe('Chromium réel', () => {
    async function ouvre(browser: any, tag: string) {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t'), tag)
      await page.waitForTimeout(300)
      return { page, erreurs }
    }

    const boite = (page: any, tag: string) => page.evaluate((t: string) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector('.t').getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, tag)

    // la transition qui suit la souris : sa durée en ms (null : aucune) et la durée calculée de la feuille
    const suivi = (page: any, tag: string) => page.evaluate((t: string) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector('.t')
      const cs = getComputedStyle(el)
      const tr = el.getAnimations().filter((a: any) => a.transitionProperty === 'transform')
      return { duree: tr.length ? tr[0].effect.getTiming().duration : null, calculee: cs.transitionDuration, courbe: cs.transitionTimingFunction, actif: el.hasAttribute('mjs-fx-tilt-active') }
    }, tag)

    // survole la carte en deux temps (entrée, puis un mouvement qui relance la transition) et lit le suivi
    async function survole(page: any, tag: string) {
      const r = await boite(page, tag)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(300)
      await page.mouse.move(r.x + 30, r.y + 30)
      await page.mouse.move(r.x + r.w - 40, r.y + r.h - 30)
      return suivi(page, tag)
    }

    it('sans réglage : 0,1 s en ligne droite pendant le survol, 0,45 s en courbe au retour — comme avant', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-tl-defaut')
        const repos = await suivi(page, 'mjs-tl-defaut')
        assert.equal(repos.calculee, '0.45s')
        assert.equal(repos.courbe, 'cubic-bezier(0.2, 0.8, 0.2, 1)')
        const vol = await survole(page, 'mjs-tl-defaut')
        assert.equal(vol.actif, true)
        assert.equal(vol.calculee, '0.1s')
        assert.equal(vol.courbe, 'linear')
        assert.equal(vol.duree, 100)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        const apres = await suivi(page, 'mjs-tl-defaut')
        assert.equal(apres.actif, false)
        assert.equal(apres.calculee, '0.45s')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('follow: 250ms : le suivi dure 0,25 s, le retour garde sa durée', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-tl-250')
        const vol = await survole(page, 'mjs-tl-250')
        assert.equal(vol.calculee, '0.25s')
        assert.equal(vol.courbe, 'linear')
        assert.equal(vol.duree, 250)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        assert.equal((await suivi(page, 'mjs-tl-250')).calculee, '0.45s')
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('follow: 0 : aucune transition pendant le survol (la carte est collée à la souris), le retour dure duration', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-tl-zero')
        const r = await boite(page, 'mjs-tl-zero')
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        await page.mouse.move(r.x + 30, r.y + 30)
        await page.mouse.move(r.x + r.w - 40, r.y + r.h - 30)
        const vol = await suivi(page, 'mjs-tl-zero')
        assert.equal(vol.actif, true)
        assert.equal(vol.duree, null, 'aucune transition en cours')
        assert.equal(vol.calculee, '0s')
        // la carte est déjà inclinée tout de suite : la matrice calculée ne bouge plus ensuite
        const tout = () => page.evaluate(() => getComputedStyle((document.querySelector('mjs-tl-zero') as any)._shadow.querySelector('.t')).transform)
        const a = await tout()
        await page.waitForTimeout(400)
        const b = await tout()
        assert.notEqual(a, 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.00125, 0, 0, 0, 1)', 'la carte est inclinée')
        assert.equal(a, b)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(100)
        const retour = await suivi(page, 'mjs-tl-zero')
        assert.equal(retour.calculee, '0.6s')
        assert.equal(retour.duree, 600)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })

    it('une variable de thème (--mjs-tilt-follow sur un englobant) règle le suivi ; ce qui est écrit sur la balise l\'emporte', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        let ouvert = await ouvre(browser, 'mjs-tl-theme')
        await ouvert.page.evaluate(() => (document.querySelector('mjs-tl-theme') as any)._shadow.querySelector('.s').style.setProperty('--mjs-tilt-follow', '180ms'))
        assert.equal((await survole(ouvert.page, 'mjs-tl-theme')).duree, 180)
        ouvert = await ouvre(browser, 'mjs-tl-ecrit')
        await ouvert.page.evaluate(() => (document.querySelector('mjs-tl-ecrit') as any)._shadow.querySelector('.s').style.setProperty('--mjs-tilt-follow', '180ms'))
        assert.equal((await survole(ouvert.page, 'mjs-tl-ecrit')).duree, 250)
      } finally {
        await browser.close()
      }
    })

    it('une variable de l\'appli change le suivi sans reposer l\'effet (le survol suivant dure 0,4 s)', async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch()
      try {
        const { page, erreurs } = await ouvre(browser, 'mjs-tl-var')
        assert.equal((await survole(page, 'mjs-tl-var')).duree, 100)
        await page.mouse.move(2, 2)
        await page.waitForTimeout(300)
        await page.evaluate(() => (document.querySelector('mjs-tl-var') as any)._shadow.querySelector('.b').click())
        await page.waitForTimeout(100)
        assert.equal((await survole(page, 'mjs-tl-var')).duree, 400)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  })
})
