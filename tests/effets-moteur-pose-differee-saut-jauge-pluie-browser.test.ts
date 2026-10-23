// Le moteur des effets et quelques effets, vus dans un vrai Chromium :
// - un effet à image posé loin de l'écran (pose différée) dont `setup` lève à l'arrivée à l'écran ne laisse ni jeton `mjs-fx`, ni
//   variable CSS, ni effet lourd suivi, ni retrait inscrit ; l'erreur sort par µ.error, comme une pose qui échoue à l'arrivée de son
//   fichier, au lieu d'une exception que personne n'attrape ;
// - *velocity : une page d'un coup au repos (Page suivante sans défilement doux, 700 px sur 800) est un saut, pas une vitesse ; un
//   défilement rapide et continu déforme toujours la balise ;
// - la garde de cadence des effets lourds : ses écouteurs (pointermove, wheel, scroll) et son observateur des images longues partent
//   quand le dernier effet lourd part, sans attendre un verdict ; ils reviennent avec le prochain effet lourd ;
// - *matrix : la toile qui se relit (une longue traîne) est ouverte pour des lectures fréquentes — aucun avertissement de Chromium dans
//   la console ; sans relecture, la toile garde le rendu par défaut.
// Un seul Chromium, sans mandataire.

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

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.barre{position:fixed;left:0;top:0;width:300px;height:40px;background:#888}.haut{height:6000px}'
  + '.loin{position:absolute;left:0;top:5000px;width:200px;height:100px}'
  + '.pluie{position:absolute;left:0;top:0;width:400px;height:300px}'

// les écouteurs de capture de la fenêtre (pointermove, wheel, scroll) et les observateurs des images longues encore branchés
const SUIVI = `(() => {
  const vus = new Map()
  const capture = (o) => o === true || !!(o && o.capture)
  const add = EventTarget.prototype.addEventListener
  const rem = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (this === window && /^(pointermove|wheel|scroll)$/.test(t) && capture(o)) vus.set(f, (vus.get(f) || new Set()).add(t))
    return add.call(this, t, f, o)
  }
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    if (this === window && capture(o) && vus.has(f)) vus.get(f).delete(t)
    return rem.call(this, t, f, o)
  }
  let po = 0
  if (typeof PerformanceObserver === 'function') {
    const obs = PerformanceObserver.prototype.observe
    const dis = PerformanceObserver.prototype.disconnect
    PerformanceObserver.prototype.observe = function (o) {
      if (o && o.type === 'long-animation-frame' && !this.__suivi) { this.__suivi = true; po++ }
      return obs.call(this, o)
    }
    PerformanceObserver.prototype.disconnect = function () {
      if (this.__suivi) { this.__suivi = false; po-- }
      return dis.call(this)
    }
  }
  window.__ecoutes = () => { let n = 0; for (const s of vus.values()) n += s.size; return [n, po] }
})()`

describe('Effets (Chromium réel) — pose différée qui lève, saut de velocity, garde de cadence, toile de *matrix', function () {
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
    const root   = mjsTmp('effets-moteur-pose-differee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *velocity>x</div>\n<div *matrix(trail: 0.02)>x</div>\n<div *sparkles>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  async function avec<T>(html: string, fn: (page: any, console: string[]) => Promise<T>): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const console: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    page.on('console', (m: any) => console.push(m.type() + ':' + m.text()))
    try {
      await page.addInitScript(SUIVI)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const r = await fn(page, console)
      assert.deepEqual(erreurs, [])
      return r
    }
    finally {
      await ctx.close()
    }
  }

  it('un effet à image posé loin de l\'écran dont setup lève à l\'arrivée : rien ne reste, l\'erreur sort par µ.error', async () => {
    const r: any = await avec('<div class="haut"></div><div id="ln" class="loin">x</div>', async (page) => {
      await page.evaluate(() => {
        const µ = (window as any).µ
        const w = window as any
        w.__lourds = null
        w.__err = []
        const jauge = µ._mjs_fxGauge
        µ._mjs_fxGauge = (s: any) => { w.__lourds = s; return jauge(s) }
        µ.error = (...a: any[]) => { w.__err.push(String(a[0]) + ' ' + String(a[1] && a[1].message)) }
        µ._mjs_fxDefs.essaiimage = { image: true, heavy: true, vars: { size: 'px' }, setup() { throw new Error('boum') } }
        µ._mjs_fx(null, document.getElementById('ln'), 'essaiimage', { image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', size: 3 })
      })
      const avant = await page.evaluate(() => document.getElementById('ln')!.getAttribute('mjs-fx'))
      await page.evaluate(() => document.getElementById('ln')!.scrollIntoView())
      await page.waitForTimeout(400)
      const apres = await page.evaluate(() => {
        const el = document.getElementById('ln')! as any
        const w  = window as any
        return { fx: el.getAttribute('mjs-fx'), style: el.getAttribute('style') || '', retrait: !!el._mjs_fxOff, lourds: w.__lourds ? w.__lourds.size : -1, err: w.__err }
      })
      return { avant, ...apres }
    })
    assert.equal(r.avant, 'essaiimage', JSON.stringify(r))
    assert.deepEqual({ fx: r.fx, style: r.style, retrait: r.retrait, lourds: r.lourds }, { fx: null, style: '', retrait: false, lourds: 0 }, JSON.stringify(r))
    assert.equal(r.err.length, 1, JSON.stringify(r))
    assert.match(r.err[0], /essaiimage.* boum$/)
  })

  it('*velocity : Page suivante sans défilement doux (700 px d\'un coup, au repos) ne déforme pas ; un défilement rapide continu, si', async () => {
    const r: any = await avec('<div class="haut"></div><div id="vb" class="barre">x</div>', async (page) => {
      await page.evaluate(() => (window as any).µ._mjs_fx(null, document.getElementById('vb'), 'velocity', {}))
      await page.waitForTimeout(200)
      const suivre = (geste: string, ms: number) => page.evaluate(([geste, ms]: [string, number]) => new Promise((res) => {
        const el = document.getElementById('vb')!
        const vus: number[] = []
        const t0 = performance.now()
        let i = 0
        const tour = () => {
          if (geste === 'page' && i === 0) window.scrollBy({ top: 700, behavior: 'instant' as ScrollBehavior })
          if (geste === 'rapide' && i < 15) window.scrollBy({ top: 60, behavior: 'instant' as ScrollBehavior })
          i++
          vus.push(Math.abs(parseFloat(el.style.getPropertyValue('--mjs-fx-velocity-v')) || 0))
          if (performance.now() - t0 < ms) requestAnimationFrame(tour)
          else res(vus)
        }
        requestAnimationFrame(tour)
      }), [geste, ms])
      const page1 = await suivre('page', 900) as number[]
      await page.waitForTimeout(1200)
      const rapide = await suivre('rapide', 600) as number[]
      return { pageMax: Math.max(...page1), rapideMax: Math.max(...rapide) }
    })
    assert.equal(r.pageMax, 0, `une page d'un coup au repos : la balise reste à plat — ${JSON.stringify(r)}`)
    assert.ok(r.rapideMax >= 0.5, `un défilement rapide continu (60 px par image) : la balise se déforme — ${JSON.stringify(r)}`)
  })

  it('garde de cadence : écouteurs et observateur partent avec le dernier effet lourd, sans verdict, et reviennent avec le suivant', async () => {
    const r: any = await avec('<div id="lr" class="pluie">x</div>', async (page) => {
      const lire = () => page.evaluate(() => (window as any).__ecoutes())
      const base = await lire()
      const poser = () => page.evaluate(() => {
        const µ = (window as any).µ
        µ._mjs_fxDefs.essailourd = µ._mjs_fxDefs.essailourd || { heavy: true, setup() { return null } }
        ;(window as any).__main = µ._mjs_fx(null, document.getElementById('lr'), 'essailourd', {})
      })
      const retirer = () => page.evaluate(() => {
        (window as any).__main()
        window.dispatchEvent(new PointerEvent('pointermove'))
      })
      await poser()
      const pose1 = await lire()
      await retirer()
      const parti1 = await lire()
      await poser()
      const pose2 = await lire()
      await retirer()
      const parti2 = await lire()
      return { base, pose1, parti1, pose2, parti2 }
    })
    assert.deepEqual(r.base, [0, 0], JSON.stringify(r))
    assert.deepEqual(r.pose1, [3, 1], JSON.stringify(r))
    assert.deepEqual(r.parti1, [0, 0], `le dernier effet lourd parti : plus d'écoute — ${JSON.stringify(r)}`)
    assert.deepEqual(r.pose2, [3, 1], `un nouvel effet lourd : l'écoute revient — ${JSON.stringify(r)}`)
    assert.deepEqual(r.parti2, [0, 0], JSON.stringify(r))
  })

  it('*matrix : une longue traîne ouvre la toile pour des lectures fréquentes, sans avertissement ; la traîne par défaut, non', async () => {
    const r: any = await avec('<div id="m1" class="pluie"></div><div id="m2" class="pluie"></div>', async (page, console) => {
      await page.evaluate(() => {
        const µ = (window as any).µ
        µ._mjs_fx(null, document.getElementById('m1'), 'matrix', { trail: 0.02 })
        µ._mjs_fx(null, document.getElementById('m2'), 'matrix', {})
      })
      await page.waitForTimeout(1500)
      const attr = await page.evaluate(() => ['m1', 'm2'].map((id) => {
        const cv = document.getElementById(id)!.querySelector('canvas') as HTMLCanvasElement
        return !!(cv.getContext('2d') as any).getContextAttributes().willReadFrequently
      }))
      return { attr, avis: console.filter((m) => /willReadFrequently/.test(m)) }
    })
    assert.deepEqual(r.attr, [true, false], JSON.stringify(r))
    assert.deepEqual(r.avis, [], JSON.stringify(r))
  })
})
