// *goo(merge, pointer) dans des navigateurs réels : une vraie mise en page est nécessaire
// (happy-dom ne mesure rien, ne dessine rien).
// une goutte de 90 px centrée sous la souris, qui ne capte aucun clic, qui part avec
// elle, qui suit encore après un défilement, et que le filtre soude au rond voisin (relevé sur les pixels :
// de près le pont existe, de loin la goutte est seule) ; sans `pointer`, aucune goutte.
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const ROND  = '\n.plateau\n  width: 700px\n  height: 300px\n  background: #5d002a\n.goutte\n  position: relative\n  width: 700px\n  height: 300px\n  b\n    position: absolute\n    top: 90px\n    width: 120px\n    height: 120px\n    border-radius: 50%\n    background: #0039ff\n  .r1\n    left: 30px\n  .r2\n    left: 290px\n'

// une boîte qui défile DANS le composant, la balise `goo` au milieu de son contenu
const DEFILE  = '\n.cadre\n  width: 700px\n  height: 300px\n  overflow: auto\n  background: #161b22\n.long\n  height: 900px\n.goutte\n  position: relative\n  width: 600px\n  height: 200px\n  margin: 20px\n  background: #5d002a\n  .r1\n    position: absolute\n    left: 20px\n    top: 20px\n    width: 60px\n    height: 60px\n    border-radius: 50%\n    background: #0039ff\n'
// une balise bordée dans un parent mis à l\'échelle, d\'un facteur différent sur chaque axe
const ECHELLE = '\n.zz\n  width: 300px\n  margin: 10px\n  transform: scale(1.5, 1.25)\n  transform-origin: 0 0\n.goutte\n  position: relative\n  width: 300px\n  height: 120px\n  border: 12px solid #333\n  background: #222\n  .q1\n    position: absolute\n    left: 20px\n    top: 20px\n    width: 40px\n    height: 40px\n    border-radius: 50%\n    background: #fa0\n'

const SOURCES: Record<string, string> = {
  'tgb-goutte.mjs':  `<script>\n$clics = 0\n</script>\n<div class="plateau"><div class="goutte" *goo(merge, pointer: 90)><b class="r1"></b><b class="r2" @click={$clics++}></b></div></div>\n<p class="n">{$clics}</p>\n<div class="bas"></div>\n<style>${ROND}.bas\n  height: 1500px\n</style>\n`,
  'tgb-rond.mjs':    `<div class="plateau"><div class="goutte" *goo(merge, pointer: 90)><b class="r2"></b></div></div>\n<style>${ROND}</style>\n`,
  'tgb-sans.mjs':    `<div class="plateau"><div class="goutte" *goo(merge)><b class="r2"></b></div></div>\n<style>${ROND}</style>\n`,
  'tgb-defile.mjs':  `<div class="cadre"><div class="long"><div class="goutte" *goo(merge, pointer: 90)><b class="r1"></b></div></div></div>\n<style>${DEFILE}</style>\n`,
  'tgb-echelle.mjs': `<div class="zz"><div class="goutte" *goo(merge, pointer: 60)><b class="q1"></b></div></div>\n<style>${ECHELLE}</style>\n`
}

// ce que la page compte : les images d'animation en attente, les minuteries vivantes
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__iv = new Set()
  const si = w.setInterval.bind(w)
  const ci = w.clearInterval.bind(w)
  w.setInterval = (f: any, d: number, ...a: any[]) => { const h = si(f, d, ...a); w.__iv.add(h); return h }
  w.clearInterval = (h: number) => { w.__iv.delete(h); return ci(h) }
}
describe('*goo(merge, pointer) (navigateurs réels) — ce qui se voit', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-goo-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = (r: number) => files.filter((f) => rang(f) === r).sort((a, b) => a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    // les effets économes coupés (réglage `effects.lite: off`, que le manifeste porte dans une page construite) : la mesure d'images du
    // moteur, qui tourne un moment après la pose d'un effet lourd, ne fausse pas « rien au repos »
    script = [code(0), code(1), 'µ._fxConf = { lite: \'off\' };', code(2)].join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      beforeEach(function () { if (!present) this.skip() })

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite ; les erreurs de la page sont rendues
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, opts: { calme?: boolean } = {}): Promise<T> {
        const page   = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()) })
        try {
          if (opts.calme) await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          const r = await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur dans la console ni dans la page')
          return r
        }
        finally {
          await page.close()
        }
      }

      // le pixel (x, y) de la page telle qu'on la voit, relu dans une toile
      async function pixel(page: any, x: number, y: number): Promise<number[]> {
        const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
        return page.evaluate(async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width = c.height = 1
          const g = c.getContext('2d')!
          g.drawImage(img, 0, 0)
          return Array.from(g.getImageData(0, 0, 1, 1).data)
        }, png.toString('base64'))
      }
      const proche = (a: number[], b: number[], tol = 14) => a.slice(0, 3).every((v, k) => Math.abs(v - b[k]) <= tol)

      // un geste : on part de (x0, y0), puis on avance par pas jusqu'à (x1, y1)
      async function glisse(page: any, x0: number, y0: number, x1: number, y1: number, pas = 12) {
        await page.mouse.move(x0, y0)
        await page.mouse.move(x1, y1, { steps: pas })
      }

      // ----- *goo(merge, pointer) -----

      const goutte = (page: any, tag = 'mjs-tgb-goutte') => page.evaluate((t: string) => {
        const s = (document.querySelector(t) as any)._shadow
        const d = s.querySelector('[mjs-fx-goo-drop]')
        const b = d && d.getBoundingClientRect()
        return { n: s.querySelectorAll('[mjs-fx-goo-drop]').length, enfants: s.querySelector('.goutte').children.length, cx: b && b.left + b.width / 2, cy: b && b.top + b.height / 2, w: b && b.width, h: b && b.height, pe: d && getComputedStyle(d).pointerEvents, fond: d && getComputedStyle(d).backgroundColor }
      }, tag)

      // des images d'animation passées (un nombre d'images, pas une durée) : ce qui attendait la prochaine image a eu son tour
      const images = (page: any, n = 2) => page.evaluate((k: number) => new Promise<void>((fini) => {
        const suite = (reste: number) => { if (reste <= 0) fini(); else requestAnimationFrame(() => suite(reste - 1)) }
        suite(k)
      }), n)

      it('la goutte suit la souris, centrée dessus, de 90 px, de la couleur du premier enfant, sans rien capter ; elle part avec la souris', async () => {
        await avec('mjs-tgb-goutte', async (page) => {
          assert.equal((await goutte(page)).n, 0, 'rien avant la souris')
          await glisse(page, 900, 700, 200, 150, 6)
          await page.waitForTimeout(60)
          const a = await goutte(page)
          assert.equal(a.n, 1)
          assert.equal(a.enfants, 3, 'deux formes et la goutte')
          assert.ok(Math.abs(a.cx - 200) <= 1.5 && Math.abs(a.cy - 150) <= 1.5, `sous la souris : (${a.cx}, ${a.cy})`)
          assert.ok(Math.abs(a.w - 90) < 0.5 && Math.abs(a.h - 90) < 0.5, 'pointer: 90')
          assert.equal(a.pe, 'none', 'aucun clic capté')
          assert.equal(a.fond, 'rgb(0, 57, 255)', 'la couleur du premier enfant')
          await page.mouse.move(420, 220, { steps: 5 })
          await page.waitForTimeout(40)
          const b = await goutte(page)
          assert.ok(Math.abs(b.cx - 420) <= 1.5 && Math.abs(b.cy - 220) <= 1.5, `elle suit : (${b.cx}, ${b.cy})`)
          assert.equal(b.n, 1, 'une seule')
          await page.mouse.move(420, 700, { steps: 5 })
          await page.waitForTimeout(40)
          const c = await goutte(page)
          assert.equal(c.n, 0, 'la souris est partie, la goutte aussi')
          assert.equal(c.enfants, 2)
        })
      })

      it('la goutte a son propre calque tant que la souris est sur la balise (la bouger ne refait pas la trame de la balise filtrée), et plus rien après', async () => {
        await avec('mjs-tgb-goutte', async (page) => {
          const calque = () => page.evaluate(() => {
            const s = (document.querySelector('mjs-tgb-goutte') as any)._shadow
            const d = s.querySelector('[mjs-fx-goo-drop]')
            return { goutte: d ? getComputedStyle(d).willChange : null, formes: Array.from(s.querySelectorAll('.goutte > b')).map((b: any) => getComputedStyle(b).willChange) }
          })
          assert.deepEqual(await calque(), { goutte: null, formes: ['auto', 'auto'] }, 'au repos : pas de goutte, aucun calque réservé')
          await glisse(page, 900, 700, 200, 150, 6)
          await page.waitForTimeout(60)
          assert.deepEqual(await calque(), { goutte: 'translate', formes: ['auto', 'auto'] }, 'la goutte, et elle seule, a son calque')
          await page.mouse.move(420, 700, { steps: 5 })
          await page.waitForTimeout(40)
          assert.deepEqual(await calque(), { goutte: null, formes: ['auto', 'auto'] }, 'la souris est partie : la goutte et son calque aussi')
        })
      })

      it('un clic au travers de la goutte atteint le rond dessous ; rien d\'autre ne le reçoit', async () => {
        await avec('mjs-tgb-goutte', async (page) => {
          // le rond .r2 : de 290 à 410 en x, de 90 à 210 en y dans le plateau
          await glisse(page, 900, 700, 350, 150, 6)
          await page.waitForTimeout(40)
          assert.equal((await goutte(page)).n, 1)
          const dessus = await page.evaluate(() => { const s = (document.querySelector('mjs-tgb-goutte') as any)._shadow; return s.elementFromPoint(350, 150).className })
          assert.equal(dessus, 'r2', 'ce que la souris touche : le rond, pas la goutte')
          await page.mouse.click(350, 150)
          await page.waitForFunction(() => (document.querySelector('mjs-tgb-goutte') as any)._shadow.querySelector('.n').textContent === '1')
        })
      })

      // la souris ne bouge JAMAIS après le geste : c'est la page qui se déplace sous elle, et la goutte doit la suivre sans attendre un mouvement
      it('la page défile à la molette, la souris posée : la goutte reste sous la souris, cran après cran', async () => {
        await avec('mjs-tgb-goutte', async (page) => {
          await glisse(page, 900, 700, 350, 150, 6)
          assert.equal((await goutte(page)).n, 1)
          // le plateau finit à 300 px de la page : après quatre crans de 20 px, la souris (à 150) est encore dessus
          for (let cran = 1; cran <= 4; cran++) {
            await page.mouse.wheel(0, 20)
            await page.waitForFunction((y: number) => window.scrollY >= y, 20 * cran)
            await images(page)
            const g = await goutte(page)
            assert.equal(g.n, 1, `cran ${cran} : la goutte est toujours là`)
            assert.ok(Math.abs(g.cx - 350) <= 1.5 && Math.abs(g.cy - 150) <= 1.5, `cran ${cran} (la page a défilé de ${20 * cran} px) : la goutte est en (${g.cx}, ${g.cy}), la souris en (350, 150)`)
          }
        })
      })

      it('une boîte qui défile dans le composant (le défilement ne sort pas de son shadow root), la souris posée : la goutte suit', async () => {
        await avec('mjs-tgb-defile', async (page) => {
          const haut = (y: number) => page.waitForFunction((v: number) => (document.querySelector('mjs-tgb-defile') as any)._shadow.querySelector('.cadre').scrollTop >= v, y)
          await glisse(page, 900, 700, 300, 120, 6)
          const a = await goutte(page, 'mjs-tgb-defile')
          assert.equal(a.n, 1)
          assert.ok(Math.abs(a.cx - 300) <= 1.5 && Math.abs(a.cy - 120) <= 1.5, `avant le défilement : (${a.cx}, ${a.cy})`)
          // la balise passe de 20 à -70 px : la souris (à 120) est encore dedans (elle finit à 130)
          for (let cran = 1; cran <= 3; cran++) {
            await page.mouse.wheel(0, 30)
            await haut(30 * cran)
            await images(page)
            const g = await goutte(page, 'mjs-tgb-defile')
            assert.equal(g.n, 1, `cran ${cran} : la goutte est toujours là`)
            assert.ok(Math.abs(g.cx - 300) <= 1.5 && Math.abs(g.cy - 120) <= 1.5, `cran ${cran} (la boîte a défilé de ${30 * cran} px) : la goutte est en (${g.cx}, ${g.cy}), la souris en (300, 120)`)
          }
        })
      })

      it('une balise bordée dans un parent mis à l\'échelle (1,5 sur x, 1,25 sur y) : la goutte est centrée sous la souris sur les deux axes', async () => {
        await avec('mjs-tgb-echelle', async (page) => {
          // la balise couvre de (10, 10) à (478, 175) à l'écran
          for (const [x, y] of [[200, 90], [430, 160], [60, 40]]) {
            await glisse(page, 900, 700, x, y, 6)
            const g = await goutte(page, 'mjs-tgb-echelle')
            assert.equal(g.n, 1)
            assert.ok(Math.abs(g.cx - x) <= 1.5 && Math.abs(g.cy - y) <= 1.5, `souris en (${x}, ${y}) : la goutte est en (${g.cx}, ${g.cy})`)
            assert.ok(Math.abs(g.w - 60 * 1.5) < 0.5 && Math.abs(g.h - 60 * 1.25) < 0.5, `elle est mise à l'échelle avec son parent (60 px × 1,5 et × 1,25) : ${g.w} × ${g.h}`)
          }
        })
      })

      it('le filtre soude la goutte au rond de près (un pont de la couleur des formes), de loin la goutte est seule', async () => {
        await avec('mjs-tgb-rond', async (page) => {
          const BLEU = [0, 57, 255]
          const FOND = [93, 0, 42]
          // le rond : centre (350, 150), rayon 60 ; la goutte : rayon 45
          // de près : 45 px entre les bords, la souris à 150 du centre du rond
          await glisse(page, 900, 700, 500, 150, 6)
          await page.waitForTimeout(150)
          assert.ok(proche(await pixel(page, 432, 150), BLEU, 30), 'de près : le pont entre la goutte et le rond')
          // de loin : 225 px entre les bords
          await page.mouse.move(680, 150, { steps: 8 })
          await page.waitForTimeout(150)
          assert.ok(proche(await pixel(page, 540, 150), FOND, 30), 'de loin : rien entre les deux')
          assert.ok(proche(await pixel(page, 680, 150), BLEU, 30), 'et la goutte est dessinée, à la souris')
          assert.ok(proche(await pixel(page, 350, 150), BLEU, 30), 'le rond est resté où il était')
        })
      })

      it('sans pointer, la souris ne pose aucune goutte ; avec pointer, rien ne tourne quand la souris est immobile', async () => {
        await avec('mjs-tgb-sans', async (page) => {
          await glisse(page, 900, 700, 200, 150, 6)
          await page.waitForTimeout(80)
          const n = await page.evaluate(() => (document.querySelector('mjs-tgb-sans') as any)._shadow.querySelectorAll('[mjs-fx-goo-drop]').length)
          assert.equal(n, 0)
          assert.ok(proche(await pixel(page, 200, 150), [93, 0, 42], 8), 'rien sous la souris : le fond')
        })
        await avec('mjs-tgb-goutte', async (page) => {
          await glisse(page, 900, 700, 200, 150, 6)
          await page.waitForTimeout(400)
          const repos = await page.evaluate(() => new Promise<any>((fini) => {
            setTimeout(() => { const w = window as any; fini({ raf: w.__raf.size, minuteries: w.__iv.size }) }, 400)
          }))
          assert.deepEqual(repos, { raf: 0, minuteries: 0 }, 'souris immobile sur la balise')
        })
      })
    })
  }
})
