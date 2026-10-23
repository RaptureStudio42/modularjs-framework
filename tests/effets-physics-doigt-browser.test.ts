// *physics au doigt dans Chromium réel (événements tactiles du protocole) : ce que la souris ne montre pas. Un toucher donne au navigateur
// une capture implicite du pointeur sur l'enfant touché ; quand l'effet prend la capture pour le conteneur, l'enfant la perd et cette perte
// remonte jusqu'au conteneur : ce n'est pas la fin du geste, le corps reste tenu. Un seul geste à la fois : un second pointeur (un autre
// doigt, ou un doigt pendant que la souris tient un corps) ne prend pas la main, et tout lâché plus rien ne reste tenu (marque de saisie,
// touch-action, boucle qui ne s'arrêterait plus). Un appui resté sans suite (sorti du conteneur avant 5 px, relâché dehors : son lâcher ne
// vient pas jusqu'ici) ne bloque pas le geste suivant et ne laisse rien sur son corps.

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

const etiquettes = (n: number) => Array.from({ length: n }, (_, i) => `<span>E${i}</span>`).join('')
// un bac de 420 × 300 px aux étiquettes de 90 × 32 px ; il ne défile pas au doigt, le geste reste à l'effet. Le monde se fige 3 s après le
// dernier geste (sleep) : un corps lâché laisse la boucle s'arrêter vite, un corps resté tenu la garde à jamais (le geste dure)
const SOURCE = `<div class="bac" *physics(on: load, sleep: 3s)>${etiquettes(6)}</div>\n<style>\n.bac\n  width: 420px\n  height: 300px\n  overflow: hidden\n  background: #222\n  touch-action: none\n  span\n    display: inline-block\n    box-sizing: border-box\n    width: 90px\n    height: 32px\n    margin: 4px\n    border-radius: 8px\n    background: #829cf1\n</style>\n`

// les images d'animation demandées par la page
const COMPTEURS = () => {
  const w = window as any
  w.__rafAppels = 0
  const ra = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { w.__rafAppels++; return ra(f) }
}

// les évènements de pointeur vus par le conteneur (les 40 derniers), pour le message d'un échec
const ECOUTE = () => {
  const c = (document.querySelector('mjs-doigt') as any)._shadow.querySelector('.bac')
  const w = window as any
  w.__ev = []
  for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
    c.addEventListener(t, (e: any) => { w.__ev.push(t + ':' + e.pointerType + e.pointerId + (e.target === c ? '' : '@enfant')); if (w.__ev.length > 40) w.__ev.shift() }, true)
  }
}

// le conteneur, ses corps (centre, bas, touch-action), ses marques
const ETAT = () => {
  const c  = (document.querySelector('mjs-doigt') as any)._shadow.querySelector('.bac')
  const cr = c.getBoundingClientRect()
  const kids = Array.from(c.children).filter((k: any) => !k.hasAttribute('mjs-fx-layer')).map((k: any) => {
    const r = k.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), b: r.bottom, touch: k.style.touchAction }
  })
  return { box: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom }, kids: kids, held: c.hasAttribute('mjs-fx-physics-held'), run: c.hasAttribute('mjs-fx-physics-run'), ev: (window as any).__ev || [] }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// attend qu'une condition sur l'état soit vraie (sondée toutes les 25 ms, au plus `delai`) : le rythme d'un navigateur ne se suppose pas ;
// rend l'état, et le donne dans le message d'un échec
const jusqua = async (page: any, condition: (e: any) => boolean, message: string, delai = 10000) => {
  const fin = Date.now() + delai
  let e = await page.evaluate(ETAT)
  while (!condition(e)) {
    assert.ok(Date.now() < fin, `${message} — état : ${JSON.stringify({ held: e.held, run: e.run, touch: e.kids.map((k: any) => k.touch), ev: e.ev })}`)
    await attendre(25)
    e = await page.evaluate(ETAT)
  }
  return e
}

const pres = (k: any, p: { x: number, y: number }, d = 30) => Math.hypot(k.x - p.x, k.y - p.y) < d

describe('*physics au doigt (Chromium réel) — saisie tactile, un seul geste à la fois, appui resté sans suite', function () {
  this.timeout(240000)
  let script  = ''
  let present = false
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-physics-doigt')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'doigt.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // une page tactile neuve, les corps tombés et la boucle arrêtée ; `fn` s'y exécute, le contexte est refermé ensuite
  async function avec(fn: (page: any, doigts: (type: string, points: Array<{ x: number, y: number, id: number }>) => Promise<void>) => Promise<void>): Promise<void> {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true })
    try {
      const page = await ctx.newPage()
      await page.addInitScript(COMPTEURS)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-doigt></mjs-doigt><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load', timeout: 60000 })
      await page.waitForFunction(() => !!(document.querySelector('mjs-doigt') as any)?._shadow?.querySelector('[mjs-fx]'))
      await page.waitForFunction(() => {
        const c = (document.querySelector('mjs-doigt') as any)._shadow.querySelector('.bac')
        return !c.hasAttribute('mjs-fx-physics-run') && Array.from(c.children).some((k: any) => k.style.translate !== '')
      }, null, { timeout: 30000 })
      await page.evaluate(ECOUTE)
      const cdp = await ctx.newCDPSession(page)
      // touchEnd lève tous les doigts ; un doigt seul se lève par un touchMove qui ne le porte plus
      const doigts = async (type: string, points: Array<{ x: number, y: number, id: number }>) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : points }) }
      await fn(page, doigts)
    }
    finally {
      await ctx.close()
    }
  }

  // le corps sous ce point est bien le n-ième (aucun autre ne le couvre)
  const sous = async (page: any, x: number, y: number, n: number) => {
    const i = await page.evaluate(([px, py]: number[]) => {
      const c = (document.querySelector('mjs-doigt') as any)._shadow.querySelector('.bac')
      return Array.from(c.children).indexOf((document.querySelector('mjs-doigt') as any)._shadow.elementFromPoint(px, py))
    }, [x, y])
    assert.equal(i, n, `le point (${x}, ${y}) n'est pas sur le corps ${n}`)
  }

  // tout lâché : plus de marque de saisie, la boucle arrêtée, touch-action rendu à chaque corps, aucune image demandée en une seconde
  const rienNeReste = async (page: any, message: string) => {
    const fin = await jusqua(page, (e) => !e.held && !e.run, `${message} : un corps reste tenu ou la boucle tourne encore`, 20000)
    assert.deepEqual(fin.kids.map((k: any) => k.touch), ['', '', '', '', '', ''], `${message} : touch-action resté sur un corps`)
    const images = await page.evaluate(() => new Promise((fin) => {
      const w  = window as any
      const a0 = w.__rafAppels
      setTimeout(() => fin(w.__rafAppels - a0), 1000)
    }))
    assert.equal(images, 0, `${message} : des images d'animation sont encore demandées`)
  }

  it('au doigt : le corps touché se saisit et suit le doigt pendant tout le geste (la perte de capture de l\'enfant n\'est pas la fin du geste) ; lâché, rien ne reste', async function () {
    if (!present) { this.skip(); return }
    await avec(async (page, doigts) => {
      const avant = await page.evaluate(ETAT)
      const p     = avant.kids[2]
      await sous(page, p.x, p.y, 2)
      await doigts('touchStart', [{ x: p.x, y: p.y, id: 1 }])
      for (let i = 1; i <= 8; i++) await doigts('touchMove', [{ x: p.x + i * 8, y: p.y - i * 10, id: 1 }])
      const tenu = await jusqua(page, (e) => e.held && pres(e.kids[2], { x: p.x + 64, y: p.y - 80 }), 'au doigt, le corps touché n\'est pas tenu ou ne suit pas le doigt', 5000)
      assert.equal(tenu.kids[2].touch, 'none', 'touch-action: none sur le corps tenu')
      await doigts('touchEnd', [])
      await rienNeReste(page, 'le doigt levé')
    })
  })

  it('deux doigts : le second, posé sur un autre corps pendant la saisie, ne prend pas le geste ; le premier garde son corps ; tout lâché, rien ne reste', async function () {
    if (!present) { this.skip(); return }
    await avec(async (page, doigts) => {
      const avant = await page.evaluate(ETAT)
      const a     = avant.kids[0]
      const b     = avant.kids[3]
      await sous(page, a.x, a.y, 0)
      await sous(page, b.x, b.y, 3)
      await doigts('touchStart', [{ x: a.x, y: a.y, id: 1 }])
      for (let i = 1; i <= 6; i++) await doigts('touchMove', [{ x: a.x + i * 5, y: a.y - i * 10, id: 1 }])
      const un = { x: a.x + 30, y: a.y - 60, id: 1 }
      await jusqua(page, (e) => e.held && pres(e.kids[0], un), 'le premier doigt ne tient pas son corps', 5000)
      // le second doigt se pose sur un autre corps et n'en bouge pas ; le premier continue son geste
      const f2 = { x: b.x, y: b.y, id: 2 }
      await doigts('touchStart', [un, f2])
      for (let i = 1; i <= 4; i++) await doigts('touchMove', [{ x: un.x + i * 10, y: un.y, id: 1 }, f2])
      const deux    = { x: un.x + 40, y: un.y, id: 1 }
      const pendant = await jusqua(page, (e) => e.held && pres(e.kids[0], deux), 'le second doigt a pris la main : le corps du premier ne le suit plus', 5000)
      assert.equal(pendant.kids[3].touch, '', 'le corps sous le second doigt n\'est pas pris')
      // le second doigt se lève, le premier reste ; puis le premier se lève
      await doigts('touchMove', [deux])
      await attendre(50)
      await doigts('touchEnd', [])
      await rienNeReste(page, 'les deux doigts levés')
    })
  })

  it('la souris tient un corps, un doigt se pose sur un autre : le doigt ne prend pas le geste ; la souris lâchée, rien ne reste', async function () {
    if (!present) { this.skip(); return }
    await avec(async (page, doigts) => {
      const avant = await page.evaluate(ETAT)
      const a     = avant.kids[0]
      const b     = avant.kids[3]
      await sous(page, a.x, a.y, 0)
      await sous(page, b.x, b.y, 3)
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move(a.x + 40, a.y - 70, { steps: 8 })
      await jusqua(page, (e) => e.held && pres(e.kids[0], { x: a.x + 40, y: a.y - 70 }), 'la souris ne tient pas son corps', 5000)
      await doigts('touchStart', [{ x: b.x, y: b.y, id: 1 }])
      await attendre(50)
      await doigts('touchEnd', [])
      await page.mouse.move(a.x + 80, a.y - 70, { steps: 4 })
      await jusqua(page, (e) => e.held && pres(e.kids[0], { x: a.x + 80, y: a.y - 70 }), 'le doigt a pris la main : le corps tenu à la souris ne la suit plus', 5000)
      await page.mouse.up()
      await rienNeReste(page, 'la souris lâchée')
    })
  })

  it('un appui resté sans suite (la souris sort du conteneur avant 5 px et lâche dehors) ne bloque pas le geste suivant et ne laisse rien sur son corps', async function () {
    if (!present) { this.skip(); return }
    await avec(async (page) => {
      const avant = await page.evaluate(ETAT)
      // le corps le plus bas repose sur le sol, le bord du conteneur : appuyé à 2 px du bord, la souris sort à 4 px de l'appui (encore un clic)
      let n = 0
      for (let i = 1; i < avant.kids.length; i++) if (avant.kids[i].b > avant.kids[n].b) n = i
      const x = avant.kids[n].x
      await sous(page, x, avant.box.b - 2, n)
      await page.mouse.move(x, avant.box.b - 2)
      await page.mouse.down()
      await page.mouse.move(x, avant.box.b + 2)
      await page.mouse.move(x, avant.box.b + 80, { steps: 4 })
      await page.mouse.up()
      // le geste suivant, sur un autre corps
      const m = n === 0 ? 1 : 0
      const k = avant.kids[m]
      await sous(page, k.x, k.y, m)
      await page.mouse.move(k.x, k.y)
      await page.mouse.down()
      await page.mouse.move(k.x + 40, k.y - 70, { steps: 8 })
      await jusqua(page, (e) => e.held && pres(e.kids[m], { x: k.x + 40, y: k.y - 70 }), 'le geste suivant ne saisit rien : l\'appui resté sans suite le bloque', 5000)
      await page.mouse.up()
      await rienNeReste(page, 'après l\'appui resté sans suite et le geste suivant')
    })
  })
})
