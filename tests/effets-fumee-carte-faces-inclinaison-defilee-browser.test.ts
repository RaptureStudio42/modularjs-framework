// petits effets dans Chromium réel (happy-dom ne dessine rien, ne fait pas défiler, ne donne pas le focus au clic) :
// - *smoke : `count` règle la fumée sur toute sa course, sous le plafond de 300 bouffées vivantes ;
// - *flipcard(on: click) : un clic sur une face qui porte un tabindex la retourne (la face n'est pas un contrôle) ; un bouton
//   de la face garde son action ; un champ dans un composant du verso (ombre fermée ou ouverte) reçoit le clic et la frappe ;
// - *tilt : après un défilement sous la carte survolée, l'inclinaison se calcule sur sa boîte à plat, comme à l'entrée.
// Les effets sont posés par le moteur sur des balises de la page (µ._mjs_fx) ; un seul Chromium.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const EFFETS = ['smoke', 'flipcard', 'tilt']

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.fc{width:300px;height:160px;margin:40px}.fc>div{background:#eef}'
  + '#tilt{width:300px;height:300px;margin:100px 0 0 100px;background:#468}'

// deux composants à champ, l'un d'ombre fermée, l'autre ouverte
const COMPOSANTS = '<script>'
  + 'for (const [nom, mode] of [["x-champ-ferme", "closed"], ["x-champ-ouvert", "open"]]) customElements.define(nom, class extends HTMLElement {'
  + ' constructor() { super(); const r = this.attachShadow({ mode }); r.innerHTML = "<input style=\\"width:200px;height:30px\\">"; this._r = r }'
  + ' get valeur() { return this._r.querySelector("input").value } });'
  + '</script>'

describe('petits effets (Chromium réel) — fumée dosée, faces cliquables, inclinaison après défilement', function () {
  this.timeout(240000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-fumee-carte-faces-inclinaison')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), EFFETS.map((e) => `<div *${e}>x</div>`).join('\n') + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // une page (une zone, de quoi défiler) où le moteur pose les effets ; `fn` s'y exécute, la page est refermée ensuite
  async function avec<T>(fn: (page: any) => Promise<T>): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style>${COMPOSANTS}</head><body><div id="zone"></div><div style="height:3000px"></div><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const r = await fn(page)
      assert.deepEqual(erreurs, [])
      return r
    }
    finally {
      await ctx.close()
    }
  }

  it('*smoke : count règle la fumée sur toute sa course (5, 20, 100), sous le plafond de 300 bouffées vivantes', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      const out: any = {}
      // jamais économe (`"effects": { "lite": "off" }`) : la garde de cadence d'une machine chargée diviserait les bouffées des mesures suivantes
      µ._fxConf = { ...µ._fxConf, lite: 'off' }
      for (const count of [5, 20, 100]) {
        zone.insertAdjacentHTML('beforeend', '<div id="sm" style="width:300px;height:200px;background:#222">fumée</div>')
        const el = document.getElementById('sm')!
        µ._mjs_fx(null, el, 'smoke', { count })
        const b = el.getBoundingClientRect()
        let max = 0
        let n   = 0
        const t = performance.now()
        // la souris bouge à chaque image pendant 1,4 s : plus que la vie d'une bouffée (1 s)
        while (performance.now() - t < 1400) {
          await new Promise((f) => requestAnimationFrame(f))
          n++
          el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 20 + (n * 7) % 260, clientY: b.top + 100, pointerType: 'mouse' }))
          max = Math.max(max, el.querySelectorAll('[mjs-fx-layer="smoke"] i').length)
        }
        µ._mjs_fxClear(el)
        el.remove()
        out[count] = max
      }
      return out
    }))
    assert.ok(r[5] > 0, `la fumée naît sous la souris — ${JSON.stringify(r)}`)
    assert.ok(r[20] >= 2 * r[5], `count: 20 fait nettement plus de fumée que count: 5 — ${JSON.stringify(r)}`)
    assert.ok(r[100] >= 2 * r[20], `count: 100 fait nettement plus de fumée que count: 20 — ${JSON.stringify(r)}`)
    assert.ok(r[100] <= 300, `au plus 300 bouffées vivantes — ${JSON.stringify(r)}`)
  })

  it('*flipcard(on: click) : un clic sur une face à tabindex la retourne ; un bouton de la face garde son action', async () => {
    const r: any = await avec(async (page) => {
      await page.evaluate(() => {
        document.getElementById('zone')!.innerHTML = '<div id="fc" class="fc"><div id="recto" tabindex="-1">recto <button id="bt">ok</button></div><div id="verso" tabindex="-1">verso</div></div>'
        ;(window as any).µ._mjs_fx(null, document.getElementById('fc'), 'flipcard', { on: 'click', duration: '0s' })
      })
      const etat = () => page.evaluate(() => ({ versoInerte: document.getElementById('verso')!.hasAttribute('inert'), rectoInerte: document.getElementById('recto')!.hasAttribute('inert') }))
      const out: any = { depart: await etat() }
      await page.click('#bt')
      await page.waitForTimeout(80)
      out.apresBouton = await etat()
      await page.click('#recto', { position: { x: 200, y: 100 } })
      await page.waitForTimeout(80)
      out.apresRecto = await etat()
      if (out.apresRecto.versoInerte) return out
      await page.click('#verso', { position: { x: 200, y: 100 } })
      await page.waitForTimeout(80)
      out.apresVerso = await etat()
      return out
    })
    assert.deepEqual(r.depart, { versoInerte: true, rectoInerte: false }, `au départ, le recto — ${JSON.stringify(r)}`)
    assert.deepEqual(r.apresBouton, { versoInerte: true, rectoInerte: false }, `le bouton du recto garde son action, la carte ne tourne pas — ${JSON.stringify(r)}`)
    assert.deepEqual(r.apresRecto, { versoInerte: false, rectoInerte: true }, `un clic sur le recto à tabindex la retourne — ${JSON.stringify(r)}`)
    assert.deepEqual(r.apresVerso, { versoInerte: true, rectoInerte: false }, `un clic sur le verso à tabindex la remet — ${JSON.stringify(r)}`)
  })

  it('*flipcard(on: click) : un champ dans un composant du verso (ombre fermée, ombre ouverte) reçoit le clic et la frappe', async () => {
    const r: any = await avec(async (page) => {
      await page.evaluate(() => {
        document.getElementById('zone')!.innerHTML = '<div id="fc" class="fc"><div id="recto">recto</div><div id="verso">verso <x-champ-ferme id="xf"></x-champ-ferme> <x-champ-ouvert id="xo"></x-champ-ouvert></div></div>'
        ;(window as any).µ._mjs_fx(null, document.getElementById('fc'), 'flipcard', { on: 'click', duration: '0s' })
      })
      const etat = () => page.evaluate(() => ({ versoInerte: document.getElementById('verso')!.hasAttribute('inert'), actif: document.activeElement ? document.activeElement.id || document.activeElement.localName : null, ferme: (document.getElementById('xf') as any).valeur, ouvert: (document.getElementById('xo') as any).valeur }))
      const out: any = {}
      await page.click('#recto')
      await page.waitForTimeout(80)
      out.retournee = await etat()
      for (const [id, texte] of [['xf', 'xyz'], ['xo', 'abc']]) {
        const b = await page.evaluate((id: string) => { const r = document.getElementById(id)!.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 } }, id)
        await page.mouse.click(b.x, b.y)
        await page.keyboard.type(texte)
        await page.waitForTimeout(80)
        out[id] = await etat()
      }
      return out
    })
    assert.equal(r.retournee.versoInerte, false, `un clic sur le recto montre le verso — ${JSON.stringify(r)}`)
    assert.deepEqual(r.xf, { versoInerte: false, actif: 'xf', ferme: 'xyz', ouvert: '' }, `le champ du composant à ombre fermée reçoit la frappe, la carte reste sur le verso — ${JSON.stringify(r)}`)
    assert.deepEqual(r.xo, { versoInerte: false, actif: 'xo', ferme: 'xyz', ouvert: 'abc' }, `le champ du composant à ombre ouverte aussi — ${JSON.stringify(r)}`)
  })

  it('*tilt : après un défilement sous la carte survolée, l\'inclinaison se calcule sur sa boîte à plat', async () => {
    const r: any = await avec(async (page) => {
      await page.evaluate(() => {
        document.getElementById('zone')!.innerHTML = '<div id="tilt">t</div>'
        ;(window as any).µ._mjs_fx(null, document.getElementById('tilt'), 'tilt', {})
      })
      // la carte à plat, page en haut : 300 × 300 px
      const b = await page.evaluate(() => { const r = document.getElementById('tilt')!.getBoundingClientRect(); return { x: r.left, y: r.top } })
      const lire = () => page.evaluate(() => { const e = document.getElementById('tilt')!; return { rx: parseFloat(e.style.getPropertyValue('--mjs-fx-tilt-rx')), ry: parseFloat(e.style.getPropertyValue('--mjs-fx-tilt-ry')), defile: window.scrollY } })
      await page.mouse.move(b.x + 150, b.y + 150)
      await page.waitForTimeout(100)
      await page.mouse.move(b.x + 151, b.y + 150)
      await page.waitForTimeout(400)
      const centre = await lire()
      // la page défile de 100 px sous la souris immobile, puis la souris va à 85 % de la hauteur de la carte à plat (là où elle est désormais)
      await page.mouse.wheel(0, 100)
      await page.waitForFunction(() => window.scrollY >= 100, null, { timeout: 5000 })
      await page.waitForTimeout(300)
      const defile = await page.evaluate(() => window.scrollY)
      await page.mouse.move(b.x + 150, b.y - defile + 255)
      await page.waitForTimeout(400)
      const apres = await lire()
      return { centre, apres }
    })
    // à 85 % de la hauteur et au milieu de la largeur : rx = (0,85 − 0,5) × 2 × 12 = 8,4°, ry = 0
    assert.ok(Math.abs(r.centre.rx) < 0.2, `au centre, la carte est à plat — ${JSON.stringify(r)}`)
    assert.ok(r.apres.defile >= 100, `la page a défilé — ${JSON.stringify(r)}`)
    assert.ok(Math.abs(r.apres.rx - 8.4) < 0.1, `après le défilement, rx à 0,1° de 8,4° — ${JSON.stringify(r)}`)
    assert.ok(Math.abs(r.apres.ry) < 0.1, `ry nul au milieu de la largeur — ${JSON.stringify(r)}`)
  })
})
