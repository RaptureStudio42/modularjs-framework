// Le moteur des effets, vu dans un vrai Chromium (happy-dom ne calcule ni les animations, ni les boîtes, ni le survol) :
// - *float, *spin, *attention, *shake, *zoom gardent le `transform` de l'auteur pendant qu'ils jouent : un badge centré par
//   `translate(-50%, -50%)` reste à sa place (il flotte, tourne, grossit sur place) ; sans transform de l'auteur, le rendu ne change pas ;
// - une pose dont `setup` lève ne laisse ni jeton `mjs-fx`, ni variable CSS, ni arrondi, ni effet lourd suivi ;
// - *crossfade : une pose suivante du même groupe qui écrit d'autres réglages est signalée en développement, une seule fois ;
// - *liquid au repos (non survolé) ne réécrit plus son filtre à chaque image ; survolé, ses vagues bougent comme avant ;
// - *velocity : un saut de défilement (ancre, haut de page) ne déforme pas la balise ; un défilement continu, si ;
// - *weight sur l'axe `wdth` : la police variable est reconnue (axe 75..100) et les largeurs écrites restent dans les bornes de l'axe ;
// - l'image d'un effet cadrée en `cover` : la variante couvre la largeur que l'image prend vraiment dans la balise.
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
  + '.cadre{position:absolute;left:100px;top:100px;width:400px;height:400px}'
  + '.badge{position:absolute;left:50%;top:50%;width:100px;height:40px;transform:translate(-50%,-50%);background:#c00;margin:0;padding:0;border:0;overflow:visible}'
  + '.nu{position:absolute;left:250px;top:280px;width:100px;height:40px;background:#08c;margin:0;padding:0;border:0}'
  + '.lq{position:absolute;left:600px;top:100px;width:200px;height:120px;background:linear-gradient(90deg,#c00,#00c)}'
  + '.barre{position:fixed;left:0;top:0;width:300px;height:40px;background:#888}.haut{height:6000px}'
  + '.case{position:absolute;left:600px;top:300px;width:147px;height:240px}'
  + '.mot{position:absolute;left:100px;top:600px;font-size:40px;margin:0}'

describe('Effets (Chromium réel) — transform de l\'auteur gardé, pose qui lève, crossfade, liquid au repos, saut de velocity, axe de weight, cadrage cover', function () {
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
    const root   = mjsTmp('effets-moteur-transform-auteur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *float>x</div>\n<div *spin>x</div>\n<div *attention>x</div>\n<div *shake>x</div>\n<div *zoom>x</div>\n<div *liquid>x</div>\n<div *velocity>x</div>\n<p *weight>texte</p>\n<div @transition=*crossfade(key: 1)>x</div>\n')
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

  async function avec<T>(html: string, fn: (page: any) => Promise<T>): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}<script>${script}</script></body></html>` })
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

  const poser = (page: any, quoi: Array<[string, string, any]>) => page.evaluate((quoi: Array<[string, string, any]>) => {
    for (const [id, nom, s] of quoi) (window as any).µ._mjs_fx(null, document.getElementById(id), nom, s)
  }, quoi)

  // le centre de la balise et sa largeur à l'écran, ses animations arrêtées à l'instant `t` (ms ; null : telles quelles)
  const centre = (page: any, id: string, t: number | null) => page.evaluate(([id, t]: [string, number | null]) => {
    const e = document.getElementById(id)!
    const a = e.getAnimations()
    for (const x of a) {
      x.pause()
      if (t !== null) x.currentTime = t
    }
    const r = e.getBoundingClientRect()
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), a.length]
  }, [id, t])

  it('*float, *spin, *attention, *shake, *zoom : le badge centré par translate(-50%, -50%) joue sur place, le rendu sans transform ne change pas', async () => {
    const r: any = await avec('<div class="cadre"><div class="badge" id="f">f</div><div class="badge" id="s">s</div><div class="badge" id="a">a</div><div class="badge" id="k">k</div><div class="badge" id="z">z</div></div><div class="nu" id="fn">n</div><div class="nu" id="kn">n</div>', async (page) => {
      const out: any = { repos: await centre(page, 'f', null) }
      await poser(page, [['f', 'float', {}], ['fn', 'float', {}], ['s', 'spin', {}], ['a', 'attention', { on: 'load', style: 'pop' }], ['k', 'shake', { on: 'load' }], ['kn', 'shake', { on: 'load' }], ['z', 'zoom', { on: 'always' }]])
      await page.waitForTimeout(60)
      out.float    = await centre(page, 'f', 1500)
      out.floatNu  = await centre(page, 'fn', 1500)
      out.spin     = await centre(page, 's', 625)
      out.pop      = await centre(page, 'a', 500)
      out.shake    = await centre(page, 'k', 90)
      out.shakeNu  = await centre(page, 'kn', 90)
      await page.waitForTimeout(800)
      out.zoom     = await centre(page, 'z', null)
      return out
    })
    const dit = JSON.stringify(r)
    assert.deepEqual(r.repos.slice(0, 3), [300, 300, 100], `au repos : le badge est centré dans son cadre — ${dit}`)
    assert.deepEqual(r.float.slice(0, 2), [300, 288], `*float à mi-course : 12 px plus haut, à sa place — ${dit}`)
    assert.deepEqual(r.floatNu.slice(0, 2), [300, 288], `*float sans transform de l'auteur : rendu inchangé — ${dit}`)
    assert.deepEqual(r.spin.slice(0, 3), [300, 300, 40], `*spin au quart de tour : il tourne sur place — ${dit}`)
    assert.deepEqual(r.pop.slice(0, 3), [300, 300, 115], `*attention(pop) au plus gros : il gonfle sur place — ${dit}`)
    assert.deepEqual(r.shake.slice(0, 2), [292, 300], `*shake : 8 px à gauche de sa place — ${dit}`)
    assert.deepEqual(r.shakeNu.slice(0, 2), [292, 300], `*shake sans transform de l'auteur : rendu inchangé — ${dit}`)
    assert.deepEqual(r.zoom.slice(0, 3), [300, 300, 150], `*zoom sur la balise elle-même : elle grossit sur place — ${dit}`)
  })

  it('une pose dont setup lève ne laisse ni jeton, ni variable CSS, ni arrondi, ni effet lourd suivi', async () => {
    const r: any = await avec('<div id="lv" class="nu">x</div>', (page) => page.evaluate(() => {
      const µ = (window as any).µ
      let tas: any = null
      const jauge = µ._mjs_fxGauge
      µ._mjs_fxGauge = (s: any) => { tas = s }
      µ._mjs_fxDefs.essaileve = { heavy: true, radius: true, vars: { size: 'px' }, setup() { throw new Error('boum') } }
      const el = document.getElementById('lv')!
      let erreur = ''
      try { µ._mjs_fx(null, el, 'essaileve', { size: 3, radius: 4 }) } catch (e: any) { erreur = e.message }
      µ._mjs_fxGauge = jauge
      return { erreur, fx: el.getAttribute('mjs-fx'), style: el.getAttribute('style') || '', lourds: tas ? tas.size : -1, retrait: !!(el as any)._mjs_fxOff }
    }))
    assert.deepEqual(r, { erreur: 'boum', fx: null, style: '', lourds: 0, retrait: false }, JSON.stringify(r))
  })

  it('*crossfade : une pose suivante du même groupe aux réglages différents est signalée, une fois', async () => {
    const r: any = await avec('<div id="xf">x</div>', (page) => page.evaluate(() => {
      const µ = (window as any).µ
      const avis: string[] = []
      const w = µ.warn
      µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
      const el = document.getElementById('xf')!
      µ._mjs_fxAnim(null, el, 'crossfade', { key: 'a', group: 'g1', duration: '300ms' })
      µ._mjs_fxAnim(null, el, 'crossfade', { key: 'b', group: 'g1', duration: '300ms' })
      const pareils = avis.length
      µ._mjs_fxAnim(null, el, 'crossfade', { key: 'c', group: 'g1', duration: '900ms', easing: 'linear' })
      µ._mjs_fxAnim(null, el, 'crossfade', { key: 'd', group: 'g1', duration: '900ms' })
      µ.warn = w
      return { dev: !!µ.instances, pareils, avis }
    }))
    assert.equal(r.dev, true, `build de développement — ${JSON.stringify(r)}`)
    assert.equal(r.pareils, 0, `mêmes réglages : rien à dire — ${JSON.stringify(r)}`)
    assert.equal(r.avis.length, 1, `une seule fois par groupe — ${JSON.stringify(r)}`)
    assert.match(r.avis[0], /\*crossfade/)
    assert.match(r.avis[0], /g1/)
    assert.match(r.avis[0], /duration/)
  })

  it('*liquid : au repos le filtre ne se réécrit plus ; survolé, les vagues bougent', async () => {
    const r: any = await avec('<div id="lq" class="lq">x</div>', async (page) => {
      await poser(page, [['lq', 'liquid', {}]])
      await page.waitForTimeout(800)
      const compter = () => page.evaluate(() => new Promise((res) => {
        const turb = document.querySelector('[mjs-fx-liquid-svg] feTurbulence')!
        let n = 0
        const mo = new MutationObserver((l) => { n += l.length })
        mo.observe(turb, { attributes: true, attributeFilter: ['baseFrequency'] })
        setTimeout(() => {
          mo.disconnect()
          res(n)
        }, 1000)
      }))
      const out: any = { filtre: await page.evaluate(() => document.getElementById('lq')!.hasAttribute('mjs-fx-liquid-on')), repos: await compter() }
      await page.mouse.move(700, 160)
      await page.waitForTimeout(100)
      out.survol = await compter()
      return out
    })
    assert.equal(r.filtre, true, `au repos, la déformation douce reste posée — ${JSON.stringify(r)}`)
    assert.ok(r.repos <= 2, `au repos : aucune réécriture du filtre — ${JSON.stringify(r)}`)
    assert.ok(r.survol >= 20, `survolé : les vagues bougent à chaque image — ${JSON.stringify(r)}`)
  })

  it('*velocity : un saut de défilement ne déforme pas la balise, un défilement continu la déforme', async () => {
    const r: any = await avec('<div class="haut"></div><div id="vb" class="barre">x</div>', async (page) => {
      await poser(page, [['vb', 'velocity', {}]])
      await page.waitForTimeout(200)
      // la vitesse écrite à chaque image, pendant `ms`, après `geste` (joué dans la première image)
      const suivre = (geste: string, ms: number) => page.evaluate(([geste, ms]: [string, number]) => new Promise((res) => {
        const el = document.getElementById('vb')!
        const vus: number[] = []
        const t0 = performance.now()
        let i = 0
        const tour = () => {
          if (geste === 'saut' && i === 0) window.scrollTo({ top: 3000, behavior: 'instant' as ScrollBehavior })
          if (geste === 'continu' && i < 15) window.scrollBy({ top: 20, behavior: 'instant' as ScrollBehavior })
          i++
          vus.push(Math.abs(parseFloat(el.style.getPropertyValue('--mjs-fx-velocity-v')) || 0))
          if (performance.now() - t0 < ms) requestAnimationFrame(tour)
          else res(vus)
        }
        requestAnimationFrame(tour)
      }), [geste, ms])
      const saut = await suivre('saut', 1000) as number[]
      await page.waitForTimeout(1200)
      const continu = await suivre('continu', 600) as number[]
      return { sautMax: Math.max(...saut), sautDeformees: saut.filter((v) => v > 0).length, continuMax: Math.max(...continu) }
    })
    assert.equal(r.sautMax, 0, `un saut (scrollTo instantané de 3 000 px) : la balise reste à plat — ${JSON.stringify(r)}`)
    assert.ok(r.continuMax >= 0.5, `un défilement continu (20 px par image) : la balise se déforme — ${JSON.stringify(r)}`)
  })

  it('*weight sur l\'axe wdth : police variable reconnue (axe 75..100), largeurs écrites dans les bornes de l\'axe', async () => {
    const r: any = await avec('<p id="wg" class="mot">largeur</p>', async (page) => {
      // une police dont l'axe wdth va de 75 à 100 : la largeur du mot d'essai suit la valeur de l'axe, bornée par la police
      await page.evaluate(() => {
        const vrai = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
          const r = vrai.call(this)
          const m = /"wdth" (-?[\d.]+)/.exec((this.style && this.style.fontVariationSettings) || '')
          if (this.textContent !== 'Mmmmmmmwwwwiiii' || !m) return r
          return { x: r.x, y: r.y, top: r.top, left: r.left, right: r.left + Math.min(100, Math.max(75, +m[1])), bottom: r.bottom, height: r.height, width: Math.min(100, Math.max(75, +m[1])), toJSON() { return this } } as DOMRect
        }
      })
      await poser(page, [['wg', 'weight', { axis: 'wdth', idle: false }]])
      await page.waitForTimeout(100)
      const boite = await page.evaluate(() => { const b = document.getElementById('wg')!.getBoundingClientRect(); return [b.left + 20, b.top + b.height / 2] })
      await page.mouse.move(boite[0], boite[1])
      await page.waitForTimeout(400)
      return page.evaluate(() => {
        const el = document.getElementById('wg')!
        const ecrits = Array.from(el.querySelectorAll('[mjs-fx-letter]')).map((l) => (l as HTMLElement).style.fontVariationSettings).filter((v) => v !== '')
        return { mode: el.getAttribute('mjs-fx-weight-mode'), ecrits, valeurs: ecrits.map((v) => parseFloat(v.replace(/^"wdth"\s*/, ''))) }
      })
    })
    assert.equal(r.mode, 'variable', `l'axe wdth de la police est reconnu — ${JSON.stringify(r)}`)
    assert.ok(r.valeurs.length > 0, `des lettres ont reçu une largeur — ${JSON.stringify(r)}`)
    assert.ok(r.valeurs.every((v: number) => v >= 75 && v <= 125), `largeurs dans les bornes de l'axe wdth (75 à 125), pas 300..900 — ${JSON.stringify(r)}`)
  })

  it('l\'image d\'un effet cadrée en cover : la variante couvre la largeur que l\'image prend dans la balise', async () => {
    const r: any = await avec('<div id="cs" class="case"></div>', (page) => page.evaluate(() => {
      const µ = (window as any).µ
      const el = document.getElementById('cs')!
      const srcset = '/a-240.jpg 240w, /a-480.jpg 480w, /a-960.jpg 960w'
      return { dpr: devicePixelRatio, connue: µ._mjs_fxImage({ src: '/o.jpg', srcset, width: 1600, height: 900 }, el), inconnue: µ._mjs_fxImage({ src: '/o.jpg', srcset }, el), large: µ._mjs_fxImage({ src: '/o.jpg', srcset, width: 300, height: 900 }, el) }
    }))
    assert.equal(r.dpr, 1)
    assert.equal(r.connue, '/a-480.jpg', `case 147 × 240, image 16/9 : affichée sur 427 px, la variante 480 — ${JSON.stringify(r)}`)
    assert.equal(r.inconnue, '/a-240.jpg', `dimensions inconnues : la largeur de la balise seule, comme avant — ${JSON.stringify(r)}`)
    assert.equal(r.large, '/a-240.jpg', `image plus haute que la case : la largeur de la balise suffit — ${JSON.stringify(r)}`)
  })
})
