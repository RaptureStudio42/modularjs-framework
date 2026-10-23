// *tilt dans Chromium et Firefox réels : le moins de travail possible pour le navigateur, le même rendu.
// - `will-change: transform` n'est posé que pendant le geste (au repos, un calque de la taille de la carte resterait en
//   mémoire pour chaque carte de la page) ;
// - le reflet (`glare`) est, comme avant, le `::after` de la balise : il ne pose aucun élément dans la carte (le `* + *`,
//   `:last-child` ou `childElementCount` de l'auteur ne le voient pas), il se dessine aussi sur un composant, et il est
//   comparé pixel à pixel au dégradé d'origine (`radial-gradient(circle at X% Y%, blanc à 35 %, transparent à 60 %)` sur
//   la boîte entière, rognée par l'arrondi) ;
// - le suivi de la souris ne lit rien de la mise en page (la boîte de la carte se lit à l'entrée), et un reflet retiré
//   ne laisse ni marque ni variable.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'tgp-scene.mjs': `<script>
$g = true
</script>
<div class="s">
<article class="c a" *tilt(glare: true)></article>
<article class="c b" *tilt(max: 0, scale: 1, glare: true)></article>
<div class="c ref"><div class="lueur"></div></div>
<mjs-tgp-carte class="c d" *tilt(max: 0, scale: 1, glare: true)></mjs-tgp-carte>
<div class="c pile e" *tilt(max: 0, scale: 1, glare: true)><i></i></div>
<article class="c f" *tilt(max: 0, scale: 1, glare: $g)></article>
<button class="bascule" @click={$g = !$g}>bascule</button>
</div>
<style>
.s
  position: relative
  height: 1000px
  background: #e9edf3
.c
  position: absolute
  box-sizing: border-box
  left: 40px
  width: 300px
  height: 200px
  border-radius: 24px
  background: #345
  color: #fff
.a
  top: 20px
.b
  top: 300px
.ref
  top: 560px
  left: 400px
.d
  top: 20px
  left: 400px
.e
  top: 300px
  left: 400px
.f
  top: 560px
.pile > * + *
  margin-top: 24px
.bascule
  position: absolute
  top: 800px
  left: 40px
.lueur
  position: absolute
  inset: 0
  border-radius: inherit
  background: radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255, 255, 255, .35), transparent 60%)
</style>
`,
  'tgp-carte.mjs': `<span class="vide"></span>
`
}

describe('*tilt (navigateurs réels) — will-change au geste seulement, reflet qui se déplace, même rendu', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-tilt-gpu')
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
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
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

      async function avec<T>(fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-tgp-scene></mjs-tgp-scene><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-tgp-scene') as any)?._shadow?.querySelector('.c.f[mjs-fx]'))
          await page.waitForTimeout(300)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      const rect = (page: any, c: string) => page.evaluate((c: string) => { const r = (document.querySelector('mjs-tgp-scene') as any)._shadow.querySelector('.' + c).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }, c)
      const wc   = (page: any, c: string) => page.evaluate((c: string) => getComputedStyle((document.querySelector('mjs-tgp-scene') as any)._shadow.querySelector('.' + c)).willChange, c)
      const ecart = (page: any, a: Buffer, b: Buffer) => page.evaluate(async ([x, y]: [string, string]) => {
        const lire = async (s: string) => {
          const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
          const c   = new OffscreenCanvas(bmp.width, bmp.height)
          const g   = c.getContext('2d') as OffscreenCanvasRenderingContext2D
          g.drawImage(bmp, 0, 0)
          return g.getImageData(0, 0, bmp.width, bmp.height).data
        }
        const A = await lire(x)
        const B = await lire(y)
        let max = 0
        let somme = 0
        for (let i = 0; i < A.length; i++) {
          if (i % 4 === 3) continue
          const d = Math.abs(A[i] - B[i])
          if (d > max) max = d
          somme += d
        }
        return { max, moyenne: somme / (A.length * 3 / 4), pixels: A.length / 4 }
      }, [a.toString('base64'), b.toString('base64')])
      // le reflet d'une carte (souris à (fx, fy) dans la carte) comparé au dégradé d'origine posé sur la boîte `ref`
      const contreRef = async (page: any, carte: string, positions: number[][]) => {
        for (const [fx, fy] of positions) {
          const b = await rect(page, carte)
          await page.mouse.move(b.x + b.w * fx, b.y + b.h * fy, { steps: 6 })
          await page.waitForTimeout(700)
          const gx = (fx * 100).toFixed(1) + '%'
          const gy = (fy * 100).toFixed(1) + '%'
          await page.evaluate(([gx, gy]: [string, string]) => { const ref = (document.querySelector('mjs-tgp-scene') as any)._shadow.querySelector('.ref'); ref.style.setProperty('--gx', gx); ref.style.setProperty('--gy', gy) }, [gx, gy])
          const ref = await rect(page, 'ref')
          const e = await ecart(page, await page.screenshot({ clip: { x: b.x, y: b.y, width: b.w, height: b.h } }), await page.screenshot({ clip: { x: ref.x, y: ref.y, width: ref.w, height: ref.h } }))
          assert.ok(e.max <= 4 && e.moyenne <= 1, `${carte}, souris à ${fx}, ${fy} : écart maximal ${e.max} niveaux, moyen ${e.moyenne.toFixed(3)} (sur ${e.pixels} pixels)`)
        }
      }

      it('will-change: transform seulement pendant le geste : absent au repos, présent pendant le survol, rendu au retour à plat', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          assert.equal(await wc(page, 'a'), 'auto', 'au repos : aucun calque réservé')
          const r = await rect(page, 'a')
          await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.4, { steps: 4 })
          await page.mouse.move(r.x + r.w * 0.6, r.y + r.h * 0.6, { steps: 4 })
          await page.waitForTimeout(250)
          assert.equal(await wc(page, 'a'), 'transform', 'pendant le survol')
          await page.mouse.move(700, 800, { steps: 4 })
          await page.waitForTimeout(900)
          assert.equal(await wc(page, 'a'), 'auto', 'revenue à plat : plus de calque réservé')
        })
      })

      it('le reflet ne pose aucun élément dans la carte : le nombre d\'enfants, le dernier enfant et un `* + *` de l\'auteur ne le voient pas, et la page ne gagne aucune zone défilable', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const etat = () => page.evaluate(() => {
            const e = (document.querySelector('mjs-tgp-scene') as any)._shadow.querySelector('.e')
            const a = getComputedStyle(e, '::after')
            return { enfants: e.childElementCount, dernier: e.lastElementChild && e.lastElementChild.tagName, vide: e.matches(':empty'), apres: a.content, opacite: a.opacity, largeur: document.documentElement.scrollWidth, hauteur: document.documentElement.scrollHeight }
          })
          const repos = await etat()
          assert.equal(repos.enfants, 1, 'la carte n\'a que l\'enfant de l\'auteur')
          const e = await rect(page, 'e')
          await page.mouse.move(e.x + e.w * 0.9, e.y + e.h * 0.9, { steps: 5 })
          await page.mouse.move(e.x + e.w * 0.1, e.y + e.h * 0.1, { steps: 5 })
          await page.waitForTimeout(500)
          const survol = await etat()
          assert.equal(survol.enfants, 1, 'pendant le survol : toujours l\'enfant de l\'auteur seul')
          assert.equal(survol.dernier, 'I', 'le dernier enfant reste celui de l\'auteur')
          assert.equal(survol.apres, '""', 'le reflet est le ::after de la carte')
          assert.equal(survol.opacite, '1', 'allumé pendant le survol')
          assert.equal(repos.largeur, survol.largeur, 'aucune zone défilable en largeur')
          assert.equal(repos.hauteur, survol.hauteur, 'aucune zone défilable en hauteur')
        })
      })

      it('un `* + *` de l\'auteur n\'atteint pas le reflet : il se dessine à sa place, au pixel près, comme le dégradé d\'origine', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => { await contreRef(page, 'e', [[0.2, 0.3], [0.85, 0.8]]) })
      })

      it('sur un composant, le reflet se dessine : au pixel près, comme sur une balise ordinaire', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => { await contreRef(page, 'd', [[0.2, 0.3], [0.85, 0.8]]) })
      })

      it('le même rendu : le reflet, à une position de souris fixée, égale le dégradé d\'origine au pixel près (écart d\'arrondi)', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => { await contreRef(page, 'b', [[0.2, 0.3], [0.85, 0.8], [0.5, 0.5], [0.05, 0.95]]) })
      })

      it('le suivi de la souris ne lit rien de la mise en page : la boîte de la carte se lit à l\'entrée, jamais à un mouvement', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const r = await rect(page, 'a')
          await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.3, { steps: 3 })
          await page.waitForTimeout(150)
          await page.evaluate(() => {
            const w = window as any
            w.__lectures = 0
            const E = Element.prototype as any
            for (const k of ['getBoundingClientRect', 'getClientRects']) { const o = E[k]; E[k] = function (...a: any[]) { w.__lectures++; return o.apply(this, a) } }
            const lecteurs: [any, string][] = [[HTMLElement.prototype, 'offsetWidth'], [HTMLElement.prototype, 'offsetHeight'], [Element.prototype, 'clientWidth'], [Element.prototype, 'clientHeight'], [Element.prototype, 'scrollWidth'], [Element.prototype, 'scrollHeight']]
            for (const [proto, k] of lecteurs) {
              const d = Object.getOwnPropertyDescriptor(proto, k) as PropertyDescriptor
              Object.defineProperty(proto, k, { ...d, get() { w.__lectures++; return (d.get as () => number).call(this) } })
            }
            const lire = window.getComputedStyle
            window.getComputedStyle = function (...a: any[]) { w.__lectures++; return (lire as any).apply(window, a) }
          })
          for (let i = 0; i < 6; i++) await page.mouse.move(r.x + r.w * (0.35 + i * 0.08), r.y + r.h * (0.3 + i * 0.07), { steps: 3 })
          await page.waitForTimeout(150)
          assert.equal(await page.evaluate(() => (window as any).__lectures), 0, 'aucune lecture de la mise en page pendant le suivi')
        })
      })

      it('un reflet retiré ne laisse rien : l\'effet reposé sans reflet n\'a plus de marque, de pseudo-élément ni de variable ; remis, il revient', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const f = await rect(page, 'f')
          const bascule = await rect(page, 'bascule')
          const marque = () => page.evaluate(() => {
            const el = (document.querySelector('mjs-tgp-scene') as any)._shadow.querySelector('.f')
            return { attribut: el.hasAttribute('mjs-fx-tilt-glare'), apres: getComputedStyle(el, '::after').content, style: el.getAttribute('style') || '' }
          })
          await page.mouse.move(f.x + f.w * 0.4, f.y + f.h * 0.4, { steps: 5 })
          await page.waitForTimeout(300)
          const avec1 = await marque()
          assert.equal(avec1.attribut, true, 'avec le reflet : la marque')
          assert.equal(avec1.apres, '""', 'avec le reflet : le ::after')
          assert.match(avec1.style, /--mjs-fx-tilt-gx/, 'avec le reflet : la souris écrit sa place')
          await page.mouse.click(bascule.x + 5, bascule.y + 5)
          await page.waitForTimeout(300)
          const sans = await marque()
          assert.equal(sans.attribut, false, 'sans reflet : plus de marque')
          assert.ok(sans.apres === 'none' || sans.apres === 'normal', 'sans reflet : plus de pseudo-élément (' + sans.apres + ')')
          assert.ok(!/--mjs-fx-tilt-g[xy]/.test(sans.style), 'sans reflet : plus de variable (' + sans.style + ')')
          await page.mouse.click(bascule.x + 5, bascule.y + 5)
          await page.waitForTimeout(300)
          await page.mouse.move(f.x + f.w * 0.6, f.y + f.h * 0.5, { steps: 5 })
          await page.waitForTimeout(300)
          const remis = await marque()
          assert.equal(remis.attribut, true, 'remis : la marque revient')
          assert.equal(remis.apres, '""', 'remis : le ::after revient')
        })
      })
    })
  }
})
