// Trois effets qui refaisaient trop, ou pas assez, dans Chromium :
//   - *annotate sur un mot lié (`{$mot}`) : le mot change sans que sa ligne ne change de taille (aucun ResizeObserver ne
//     le dit) — le trait est redessiné sous le nouveau mot, il ne reste pas sous les premières lettres ;
//   - *matrix : la pluie d'avance (des dizaines de pas sur le fil principal) n'est faite qu'à la pose — la première
//     notification du ResizeObserver, de même taille, ne la refait pas, et un redimensionnement garde la pluie déjà
//     tombée (la toile recopiée, jamais vide) ;
//   - *offline : hors ligne, le bandeau n'est pas refait toutes les 500 ms — rien ne change tant que le compte ne change
//     pas (le logo reste le même <img>, la région `status` n'est pas réécrite), et seul son texte suit le compte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
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

const COMPOSANTS: Record<string, string> = {
  'fx-tp-mot':   '<script>\n$mot = \'mot\'\n</script>\n<p class="pa">Un <span class="mot" *annotate(on: load, duration: 0s)>{$mot}</span> ici</p>\n<button class="t" @click={$mot = \'beaucoup plus long encore\'}>t</button>\n',
  'fx-tp-pluie': '<div class="m" *matrix(on: hover)></div>\n<style>\n.m\n  width: 800px\n  height: 600px\n</style>\n',
  'fx-tp-hors':  '<div class="o" *offline(logo: \'/logo.png\', delay: 0s)>contenu</div>\n<style>\n.o\n  width: 400px\n  height: 200px\n</style>\n',
}

describe('*annotate, *matrix, *offline — redessiner quand il le faut, pas plus (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-trait-pluie-bandeau-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
    page    = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage()
    // chaque pas de la pluie pose un voile (un rectangle effacé sur toute la toile)
    await page.addInitScript(() => {
      const proto: any = CanvasRenderingContext2D.prototype
      const fill = proto.fillRect
      ;(window as any).__voiles = 0
      proto.fillRect = function (...a: any[]) {
        if (this.globalCompositeOperation === 'destination-out') (window as any).__voiles++
        return fill.apply(this, a)
      }
    })
    await page.route('http://t.test/**', async (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  const poser = async (nom: string, sel: string) => {
    await page.evaluate((nom: string) => { document.body.appendChild(document.createElement(nom)) }, nom)
    await page.waitForFunction(({ nom, sel }: any) => !!(document.querySelector(nom) as any)?._shadow?.querySelector(sel), { nom, sel }, { timeout: 60000 })
  }

  it('*annotate : le trait suit le mot lié qui change, même quand sa ligne garde sa taille', async () => {
    await poser('mjs-fx-tp-mot', '[mjs-fx-layer="annotate"] path')
    await page.waitForTimeout(500)
    const mesure = () => page.evaluate(() => {
      const s = (document.querySelector('mjs-fx-tp-mot') as any)._shadow
      const m = s.querySelector('.mot')
      const path = s.querySelector('[mjs-fx-layer="annotate"] path')
      return { texte: m.textContent, mot: Math.round(m.getBoundingClientRect().width), trait: path ? Math.round(path.getBBox().width) : 0 }
    })
    const avant = await mesure()
    const t = await page.evaluate(() => {
      const r = (document.querySelector('mjs-fx-tp-mot') as any)._shadow.querySelector('.t').getBoundingClientRect()
      return [r.x + 3, r.y + 3]
    })
    await page.mouse.click(t[0], t[1])
    await page.waitForTimeout(600)
    const apres = await mesure()
    await page.evaluate(() => document.querySelector('mjs-fx-tp-mot')!.remove())
    assert.ok(avant.trait >= avant.mot - 2, 'avant : ' + JSON.stringify(avant))
    assert.equal(apres.texte, 'beaucoup plus long encore')
    assert.ok(apres.trait >= apres.mot - 2, 'après : ' + JSON.stringify(apres))
  })

  it('*matrix : la pluie d\'avance une seule fois à la pose, rien de refait à un redimensionnement, la toile jamais vide', async () => {
    // le pointeur hors de la balise : avec `on: hover`, la pluie ne tombe pas, seuls les pas d'avance se comptent
    await page.mouse.move(890, 690)
    await page.evaluate(() => { (window as any).__voiles = 0 })
    await poser('mjs-fx-tp-pluie', '[mjs-fx-layer="matrix"]')
    await page.waitForTimeout(600)
    const encre = () => page.evaluate(() => {
      const cv = (document.querySelector('mjs-fx-tp-pluie') as any)._shadow.querySelector('[mjs-fx-layer="matrix"]')
      const d  = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let n = 0
      for (let k = 3; k < d.length; k += 4) if (d[k] > 0) n++
      return n
    })
    const pose      = await page.evaluate(() => (window as any).__voiles)
    const encrePose = await encre()
    await page.evaluate(() => { (document.querySelector('mjs-fx-tp-pluie') as any)._shadow.querySelector('.m').style.width = '801px' })
    await page.waitForTimeout(400)
    const redim      = (await page.evaluate(() => (window as any).__voiles)) - pose
    const encreRedim = await encre()
    await page.evaluate(() => document.querySelector('mjs-fx-tp-pluie')!.remove())
    // réglages par défaut : trail 0.06, 50 pas d'avance
    assert.deepEqual({ pose, redim }, { pose: 50, redim: 0 })
    assert.ok(encrePose > 0 && encreRedim > 0, 'pixels de pluie : ' + encrePose + ' puis ' + encreRedim)
  })

  it('*offline : à compte constant, le bandeau n\'est pas réécrit ; le compte change, seul son texte suit', async () => {
    const r = await page.evaluate(async () => {
      const w: any = window
      w.µ._mjs_fxOfflineSim = true
      const h: any = document.createElement('mjs-fx-tp-hors')
      document.body.appendChild(h)
      await new Promise((f) => setTimeout(f, 1200))
      const band = h._shadow.querySelector('[mjs-fx-offline-band]')
      const logo = band && band.querySelector('img')
      let ecritures = 0
      const mo = new MutationObserver((l) => { ecritures += l.length })
      mo.observe(band, { childList: true, subtree: true, characterData: true })
      await new Promise((f) => setTimeout(f, 1600))
      const stable = ecritures
      const compteurAvant = !!band.querySelector('[mjs-fx-offline-n]')
      w.µ._mjs_optPending = 2
      await new Promise((f) => setTimeout(f, 800))
      mo.disconnect()
      const out = { bandeau: !!band, stable, compteurAvant, compteur: !!band.querySelector('[mjs-fx-offline-n]'), memeLogo: band.querySelector('img') === logo, logos: band.querySelectorAll('img').length }
      w.µ._mjs_optPending = 0
      w.µ._mjs_fxOfflineSim = false
      h.remove()
      return out
    })
    assert.equal(r.bandeau, true)
    assert.equal(r.stable, 0, 'réécritures du bandeau en 1,6 s à compte constant')
    assert.equal(r.compteurAvant, false)
    assert.equal(r.compteur, true, 'le compte qui attend apparaît')
    assert.equal(r.memeLogo, true)
    assert.equal(r.logos, 1)
  })
})
