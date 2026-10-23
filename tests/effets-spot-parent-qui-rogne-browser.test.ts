// *filter(…, spot) dans un parent qui rogne sans être positionné, dans Chromium réel, construit en développement puis en production.
// La zone nette se pose quand même : le parent est positionné (`position: relative`) le temps du survol, sans que rien ne bouge, puis
// rendu tel qu'il était. La carte de la galerie (une scène en grille, arrondie, qui rogne, dans un bloc positionné) montre ses couleurs
// sous la souris, et la zone ne dépasse pas l'arrondi du parent. Un parent qu'on ne peut pas positionner sans déplacer ce qu'il contient
// (une balise posée en absolu qui le prendrait pour repère) reste tel quel : pas de zone, et la console le dit en développement seulement.

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

const ROUGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'300\' height=\'200\' shape-rendering=\'crispEdges\'><rect width=\'300\' height=\'200\' fill=\'#f00\'/></svg>')
const POSE  = `*filter(grayscale, spot: 100, soft: 0, smooth: 1) src="${ROUGE}"`

// trois blocs positionnés : la scène de la galerie (grille, arrondie, qui rogne), un parent arrondi qui rogne, un parent qui rogne et
// contient une pastille posée en absolu par rapport au bloc du dessus
const PAGE = `<div class="haut"><div class="scene"><img class="a" ${POSE} alt="a"></div></div>\n`
  + `<div class="haut"><div class="arrondi"><img class="b" ${POSE} alt="b"></div></div>\n`
  + `<div class="haut"><div class="pastille"><img class="c" ${POSE} alt="c"><span class="point"></span></div></div>\n`
  + '<style>\n.haut\n  position: relative\n  z-index: 1\n  width: 330px\n  margin: 10px\n'
  + '.scene\n  display: grid\n  place-items: center\n  padding: 14px\n  border-radius: 10px\n  background: #0d1117\n  overflow: hidden\n'
  + '.arrondi\n  overflow: hidden\n  border-radius: 60px\n  width: 300px\n  height: 200px\n'
  + '.pastille\n  overflow: hidden\n  width: 300px\n  height: 200px\n'
  + '.point\n  position: absolute\n  top: 0\n  right: 0\n  width: 20px\n  height: 20px\n  background: #00f\n'
  + 'img\n  display: block\n  width: 300px\n  height: 200px\n</style>\n'

describe('*filter(…, spot) dans un parent qui rogne sans être positionné (Chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let browser: any = null
  const scripts = {} as Record<'dev' | 'prod', string>

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test de *filter(spot) sauté. Activer : `npx playwright install chromium`')
      return
    }
    for (const mode of ['dev', 'prod'] as const) {
      const root   = mjsTmp(`effets-spot-parent-qui-rogne-${mode}`)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fx-spot-rogne.mjs'), PAGE)
      // production : un seul fichier (le manifeste), pour que les noms réduits des morceaux ne se heurtent pas
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: mode === 'prod' ? manifeste : join(root, 'bundle.js'), ...mode === 'prod' && { env: 'prod', js: 'bundle' } } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      if (mode === 'prod') scripts[mode] = stripEsm(readFileSync(manifeste, 'utf-8'))
      else scripts[mode] = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    }
    browser = await (await import('playwright')).chromium.launch({ args: ['--no-sandbox'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvrir(mode: 'dev' | 'prod') {
    const ctx  = await browser.newContext({ viewport: { width: 360, height: 900 } })
    const page = await ctx.newPage()
    const erreurs: string[]      = []
    const avertissements: string[] = []
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push(m.text())
      if (m.type() === 'warning') avertissements.push(m.text())
    })
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spot-rogne></mjs-fx-spot-rogne><script>${scripts[mode]}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spot-rogne') as any)?._shadow?.querySelector('.c'))
    await page.waitForTimeout(400)
    return { ctx, page, erreurs, avertissements }
  }

  const lire = (page: any, sel: string) => page.evaluate((s: string) => {
    const el = (document.querySelector('mjs-fx-spot-rogne') as any)._shadow.querySelector(s)
    const r  = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, position: getComputedStyle(el).position, style: el.getAttribute('style') }
  }, sel)

  const copies = (page: any) => page.evaluate(() => (document.querySelector('mjs-fx-spot-rogne') as any)._shadow.querySelectorAll('[mjs-fx-filter-copy]').length)

  async function pixels(page: any, points: [number, number][]): Promise<number[][]> {
    const shot = await page.screenshot()
    return page.evaluate(async ([b64, pts]: [string, [number, number][]]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      return pts.map(([x, y]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
    }, [shot.toString('base64'), points])
  }

  const rouge = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60
  const gris  = (p: number[]) => Math.abs(p[0] - p[1]) < 8 && Math.abs(p[1] - p[2]) < 8 && p[0] > 20 && p[0] < 90
  const place = (b: any) => ({ x: b.x, y: b.y, w: b.w, h: b.h })

  for (const mode of ['dev', 'prod'] as const) {
    const titre = mode === 'dev' ? 'développement' : 'production'

    it(`${titre} — la carte de la galerie : la zone se pose, le parent est positionné le temps du survol sans que rien ne bouge, puis rendu tel quel`, async function () {
      if (!present) return this.skip()
      const { ctx, page, erreurs } = await ouvrir(mode)
      try {
        const scene = await lire(page, '.scene')
        const a     = await lire(page, '.a')
        assert.equal(scene.position, 'static', 'la scène n\'est pas positionnée au repos')
        await page.mouse.move(a.x + 150, a.y + 100, { steps: 3 })
        await page.waitForTimeout(400)
        assert.equal(await copies(page), 1, 'la zone nette est posée pendant le survol')
        const pendant = await lire(page, '.scene')
        assert.equal(pendant.position, 'relative', 'la scène est positionnée le temps du survol')
        assert.deepEqual(place(pendant), place(scene), 'la scène ne bouge pas')
        assert.deepEqual(place(await lire(page, '.a')), place(a), 'l\'image ne bouge pas')
        const [dedans, loin] = await pixels(page, [[a.x + 150, a.y + 100], [a.x + 10, a.y + 10]])
        assert.ok(rouge(dedans), `sous la souris, les couleurs : ${dedans}`)
        assert.ok(gris(loin), `loin de la souris, le filtre : ${loin}`)
        await page.mouse.move(355, 895, { steps: 2 })
        await page.waitForTimeout(600)
        assert.equal(await copies(page), 0, 'la zone repart après la sortie')
        const apres = await lire(page, '.scene')
        assert.equal(apres.position, 'static', 'la scène redevient non positionnée')
        assert.equal(apres.style, scene.style, 'son attribut style est rendu tel qu\'il était')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await ctx.close()
      }
    })

    it(`${titre} — un parent arrondi qui rogne : la zone ne dépasse pas son arrondi`, async function () {
      if (!present) return this.skip()
      const { ctx, page } = await ouvrir(mode)
      try {
        const b = await lire(page, '.b')
        await page.mouse.move(b.x + 40, b.y + 40, { steps: 3 })
        await page.waitForTimeout(400)
        assert.equal(await copies(page), 1, 'la zone nette est posée')
        // (5, 5) est hors du coin arrondi (rayon 60) mais à 49 px de la souris : dans le disque, le double l'y montrerait
        const [horsCoin, dedans] = await pixels(page, [[b.x + 5, b.y + 5], [b.x + 40, b.y + 40]])
        assert.ok(horsCoin.every((v) => v > 245), `hors du coin arrondi, le fond de la page : ${horsCoin}`)
        assert.ok(rouge(dedans), `sous la souris, les couleurs : ${dedans}`)
      }
      finally {
        await ctx.close()
      }
    })

    it(`${titre} — un parent qui contient une balise posée en absolu : il reste tel quel, pas de zone${mode === 'dev' ? ', la console le dit une fois' : ', la console se tait'}`, async function () {
      if (!present) return this.skip()
      const { ctx, page, erreurs, avertissements } = await ouvrir(mode)
      try {
        const point = await lire(page, '.point')
        const c     = await lire(page, '.c')
        for (const [x, y] of [[c.x + 100, c.y + 80], [355, 895], [c.x + 120, c.y + 90]]) {
          await page.mouse.move(x, y, { steps: 3 })
          await page.waitForTimeout(300)
        }
        assert.equal(await copies(page), 0, 'pas de zone')
        assert.equal((await lire(page, '.pastille')).position, 'static', 'le parent n\'est pas positionné')
        assert.deepEqual(place(await lire(page, '.point')), place(point), 'la pastille ne bouge pas')
        const [p] = await pixels(page, [[c.x + 120, c.y + 90]])
        assert.ok(gris(p), `l'image reste filtrée : ${p}`)
        const dits = avertissements.filter((t) => t.includes('*filter'))
        if (mode === 'dev') {
          assert.equal(dits.length, 1, `un avertissement, une seule fois : ${avertissements.join(' | ')}`)
          assert.match(dits[0], /zone nette \(spot\)/)
          assert.match(dits[0], /<div\.pastille>/)
          assert.match(dits[0], /position: relative/)
        }
        else assert.deepEqual(dits, [], 'la production ne dit rien')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await ctx.close()
      }
    })
  }
})
