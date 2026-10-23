// *spotlight(where: veil) dans Chromium et Firefox réels : ce qui se VOIT. Le trou est net sous la souris,
// le voile opaque plus loin, le bord s'efface entre les deux ; le voile laisse passer les clics ; la
// lumière traîne derrière la souris puis la rejoint, et plus aucune image n'est demandée ; le voile
// d'un survol n'est visible que pendant le survol ; sur <@document> il couvre la fenêtre ; le halo
// et le liseré (sans veil) sont les pseudo-éléments d'avant, sans nœud de plus dans la balise.

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

// quatre scènes de 300 × 200 sur fond blanc : un voile noir opaque au bord net (fixe), un autre au bord doux de 100 px,
// un voile de survol qui traîne, le halo d'avant
const PAGE = '<script>\n$n = 0\n</script>\n'
  + '<div class="s1" *spotlight(where: veil, color: #000, fill: 1, size: 100, soft: 0, on: always)><div class="fond"></div><button class="bouton" @click={$n = $n + 1}>clic</button><span class="n">{$n}</span></div>\n'
  + '<div class="s2" *spotlight(where: veil, color: #000, fill: 1, size: 100, soft: 100, on: always)><div class="fond"></div></div>\n'
  + '<div class="s3" *spotlight(where: veil, color: #000, fill: 1, size: 100, soft: 0, smooth: 0.15)><div class="fond"></div></div>\n'
  + '<div class="s4" *spotlight(color: #ff0, fill: 0.3)><div class="fond"></div></div>\n'
  + '<style>\n.s1, .s2, .s3, .s4\n  position: relative\n  width: 300px\n  height: 200px\n  margin: 10px\n  background: #fff\n'
  + '.fond\n  position: absolute\n  inset: 0\n  background: #fff\n'
  + '.bouton\n  position: absolute\n  left: 10px\n  top: 10px\n  z-index: 1\n'
  + '.n\n  position: absolute\n  left: 80px\n  top: 12px\n  z-index: 1\n</style>\n'

// une page entière voilée : <@document>
const PAGE_DOC = '<script>\n$n = 0\n</script>\n<@document *spotlight(where: veil, color: #000, fill: 1, size: 100, soft: 0, on: always)></@document>\n'
  + '<button class="bouton" @click={$n = $n + 1}>clic</button><span class="n">{$n}</span>\n'
  + '<style>\n.bouton\n  position: absolute\n  left: 10px\n  top: 10px\n</style>\n'

async function construire(nom: string, source: string): Promise<string> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('*spotlight(where: veil) : ce qui se voit, dans de vrais navigateurs', function () {
  this.timeout(300000)
  let page1 = ''
  let page2 = ''

  before(async () => {
    page1 = await construire('fx-spot-vue', PAGE)
    page2 = await construire('fx-spot-vue-doc', PAGE_DOC)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de *spotlight sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir(script: string, tag: string, sel: string, taille = { width: 400, height: 960 }) {
        const ctx  = await browser.newContext({ viewport: taille })
        const page = await ctx.newPage()
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((s: string) => !!(document.querySelector(s.split(' ')[0]) as any)?._shadow?.querySelector(s.split(' ')[1]), `${tag} ${sel}`)
        await page.waitForTimeout(300)
        return { ctx, page, erreurs }
      }

      const boite = (page: any, tag: string, sel: string) => page.evaluate(([t, s]: [string, string]) => {
        const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }, [tag, sel])

      // la couleur (r, g, b) de pixels de la capture : la page est décodée dans un canevas
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

      it('le trou est net sous la souris, le voile opaque plus loin, et le bord doux s\'efface entre les deux', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page, erreurs } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s1')
        try {
          // bord net : disque de 100 px de diamètre autour de la souris
          const a = await boite(page, 'mjs-fx-spot-vue', '.s1')
          await page.mouse.move(a.x + 200, a.y + 120, { steps: 3 })
          const [dedans, loin] = await pixels(page, [[a.x + 200, a.y + 120], [a.x + 200 + 70, a.y + 120]])
          assert.ok(dedans.every((v) => v >= 250), `sous la souris, le fond blanc : ${dedans}`)
          assert.ok(loin.every((v) => v <= 5), `à 70 px, le voile noir opaque : ${loin}`)
          const [juste] = await pixels(page, [[a.x + 200 + 40, a.y + 120]])
          assert.ok(juste.every((v) => v >= 250), `à 40 px, encore dans le disque de 50 px de rayon : ${juste}`)
          // bord doux : transparent jusqu'à 50 px, opaque à 150 px, à moitié à 100 px
          const b = await boite(page, 'mjs-fx-spot-vue', '.s2')
          await page.mouse.move(b.x + 150, b.y + 100, { steps: 3 })
          const [c25, c100, c170] = await pixels(page, [[b.x + 150 + 25, b.y + 100], [b.x + 150 + 100, b.y + 100], [b.x + 150 + 140, b.y + 100]])
          assert.ok(c25.every((v) => v >= 250), `à 25 px : net ${c25}`)
          assert.ok(c100.every((v) => v > 90 && v < 170), `à 100 px : à moitié ${c100}`)
          assert.ok(c170.every((v) => v <= 40), `à 140 px : presque opaque ${c170}`)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await ctx.close()
        }
      })

      it('le voile laisse passer les clics : le bouton sous le voile se clique', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page, erreurs } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s1')
        try {
          const a = await boite(page, 'mjs-fx-spot-vue', '.s1')
          await page.mouse.move(a.x + 250, a.y + 150, { steps: 2 })
          const cible = await page.evaluate(([x, y]: [number, number]) => {
            const sh = (document.querySelector('mjs-fx-spot-vue') as any)._shadow
            return (sh.elementFromPoint(x, y) as HTMLElement).className
          }, [a.x + 30, a.y + 20])
          assert.equal(cible, 'bouton', 'le voile n\'est pas sous le pointeur : la balise du dessous l\'est')
          await page.mouse.click(a.x + 30, a.y + 20)
          const n = await page.evaluate(() => (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.n').textContent.trim())
          assert.equal(n, '1', 'le clic est arrivé au bouton')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await ctx.close()
        }
      })

      it('on: hover : aucun calque au repos, visible pendant le survol (promu seulement alors), parti après son effacement', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s3')
        try {
          const lire = () => page.evaluate(() => {
            const l = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s3 [mjs-fx-layer="spotlight"]')
            if (!l) return null
            const cs = getComputedStyle(l)
            return { vis: cs.visibility, op: cs.opacity, wc: l.getAttribute('mjs-fx-live') }
          })
          assert.equal(await lire(), null, 'au repos, le calque n\'existe pas')
          const a = await boite(page, 'mjs-fx-spot-vue', '.s3')
          await page.mouse.move(a.x + 100, a.y + 100, { steps: 2 })
          await page.waitForFunction(() => {
            const l = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s3 [mjs-fx-layer="spotlight"]')
            return !!l && getComputedStyle(l).opacity === '1'
          }, null, { timeout: 10000 })
          assert.deepEqual(await lire(), { vis: 'visible', op: '1', wc: '' }, 'promu pendant le survol : la feuille promeut le disque')
          await page.mouse.move(380, 5, { steps: 2 })
          await page.waitForFunction(() => !(document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s3 [mjs-fx-layer="spotlight"]'), null, { timeout: 10000 })
          assert.equal(await lire(), null, 'parti après son effacement')
        }
        finally {
          await ctx.close()
        }
      })

      it('smooth: 0.15 : la lumière traîne derrière la souris puis la rejoint ; la boucle s\'arrête, plus aucune image', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s3')
        try {
          await page.evaluate(() => {
            const w = window as any
            w.__images = 0
            const o = w.requestAnimationFrame
            w.requestAnimationFrame = (f: any) => { w.__images++; return o.call(w, f) }
          })
          // la lumière : le centre du disque dans le repère du calque (le calque ne bouge pas, le disque se déplace par translate)
          const lire = () => page.evaluate(() => { const l = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s3 [mjs-fx-layer="spotlight"]'); const d = l.firstChild.getBoundingClientRect(); return d.left + d.width / 2 - l.getBoundingClientRect().left })
          const a = await boite(page, 'mjs-fx-spot-vue', '.s3')
          await page.mouse.move(a.x + 50, a.y + 100)
          assert.ok(Math.abs((await lire()) - 50) < 1, 'née sous la souris')
          await page.mouse.move(a.x + 250, a.y + 100)
          const tot = await lire()
          assert.ok(tot < 200, `juste après le saut de la souris, la lumière traîne : ${tot}`)
          await page.waitForTimeout(1800)
          assert.ok(Math.abs((await lire()) - 250) < 0.6, 'elle a rejoint la souris')
          const avant = await page.evaluate(() => (window as any).__images)
          await page.waitForTimeout(500)
          const apres = await page.evaluate(() => (window as any).__images)
          assert.equal(apres, avant, 'plus aucune image demandée une fois la souris rejointe')
        }
        finally {
          await ctx.close()
        }
      })

      it('la souris déplace un disque par translate : ni variable, ni écriture sur le calque, le dégradé et l\'ombre ne changent pas', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s1')
        try {
          const lire = () => page.evaluate(() => {
            const l = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s1 [mjs-fx-layer="spotlight"]')
            const cs = getComputedStyle(l.firstChild)
            return { calque: l.getAttribute('style'), disque: l.firstChild.getAttribute('style'), fond: cs.backgroundImage, ombre: cs.boxShadow }
          })
          const a = await boite(page, 'mjs-fx-spot-vue', '.s1')
          await page.mouse.move(a.x + 50, a.y + 60, { steps: 2 })
          const un = await lire()
          await page.mouse.move(a.x + 250, a.y + 150, { steps: 4 })
          const deux = await lire()
          assert.equal(un.calque, '--mjs-fx-veil-r: 300px;', 'le calque est immobile : sa seule écriture est l\'étendue de son ombre (la plus grande dimension de la balise), posée une fois')
          assert.equal(deux.calque, un.calque, 'et elle ne bouge pas avec la souris')
          assert.match(un.disque ?? '', /^translate: [^;]+;?$/, 'le disque ne porte que son translate')
          assert.notEqual(un.disque, deux.disque, 'et il suit la souris')
          assert.equal(deux.fond, un.fond, 'le dégradé du trou est peint une fois : il ne dépend pas de la souris')
          assert.equal(deux.ombre, un.ombre, 'l\'ombre portée non plus')
          assert.match(un.ombre, /\s300px$/, 'l\'ombre portée s\'étend sur 300 px, pas sur 100000')
          const libres = await page.evaluate(() => ['x', 'y'].map((k) => {
            try {
              CSS.registerProperty({ name: '--mjs-fx-veil-' + k, syntax: '*', inherits: true })
              return 'libre'
            }
            catch (e: any) {
              return e.name
            }
          }))
          assert.deepEqual(libres, ['libre', 'libre'], 'plus de variable de position : rien à enregistrer')
        }
        finally {
          await ctx.close()
        }
      })

      it('le halo et le liseré (sans veil) : les pseudo-éléments d\'avant, éteints au repos et allumés au survol ; aucun nœud de plus dans la balise', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s4')
        try {
          const lire = () => page.evaluate(() => {
            const el = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s4')
            return { enfants: el.children.length, calques: el.querySelectorAll('[mjs-fx-layer]').length, apres: getComputedStyle(el, '::after').content, avant: getComputedStyle(el, '::before').content, opApres: getComputedStyle(el, '::after').opacity, opAvant: getComputedStyle(el, '::before').opacity }
          })
          const repos = await lire()
          assert.deepEqual(repos, { enfants: 1, calques: 0, apres: '""', avant: '""', opApres: '0', opAvant: '0' }, 'au repos, éteints, et rien dans la balise que son contenu')
          const a = await boite(page, 'mjs-fx-spot-vue', '.s4')
          await page.mouse.move(a.x + 100, a.y + 60, { steps: 2 })
          await page.waitForFunction(() => {
            const el = (document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s4')
            return getComputedStyle(el, '::after').opacity === '1' && getComputedStyle(el, '::before').opacity === '1'
          }, null, { timeout: 10000 })
          const r = await lire()
          assert.deepEqual({ enfants: r.enfants, calques: r.calques }, { enfants: 1, calques: 0 }, 'allumés au survol, sans nœud de plus')
          await page.mouse.move(395, 955, { steps: 2 })
          await page.waitForFunction(() => getComputedStyle((document.querySelector('mjs-fx-spot-vue') as any)._shadow.querySelector('.s4'), '::after').opacity === '0', null, { timeout: 10000 })
        }
        finally {
          await ctx.close()
        }
      })

      it('l\'ombre du voile est bornée à ce qui couvre la balise : le calque promu pendant le survol reste de la taille de la balise, non de 200 000 px (Chromium)', async function () {
        if (!present || nom !== 'chromium') { this.skip(); return }
        const { ctx, page } = await ouvrir(page1, 'mjs-fx-spot-vue', '.s1')
        try {
          const cdp = await ctx.newCDPSession(page)
          await cdp.send('LayerTree.enable')
          let calques: any[] = []
          cdp.on('LayerTree.layerTreeDidChange', (e: any) => { if (e.layers) calques = e.layers })
          const a = await boite(page, 'mjs-fx-spot-vue', '.s1')
          await page.mouse.move(a.x + 120, a.y + 80, { steps: 4 })
          await page.waitForTimeout(1200)
          const plus = Math.max(...calques.map((l: any) => Math.max(l.width, l.height)))
          assert.ok(calques.length > 0 && plus < 4000, `le plus grand calque : ${plus} px de côté (balise de 300 × 200)`)
        }
        finally {
          await ctx.close()
        }
      })

      it('sur <@document> : le voile couvre la fenêtre, le trou suit la souris, un clic traverse', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page, erreurs } = await ouvrir(page2, 'mjs-fx-spot-vue-doc', '.bouton', { width: 500, height: 400 })
        try {
          const l = await page.evaluate(() => {
            const el = document.querySelector('[mjs-fx-layer="spotlight"]') as HTMLElement
            const r = el.getBoundingClientRect()
            return { pos: getComputedStyle(el).position, x: r.left, y: r.top, w: r.width, h: r.height }
          })
          assert.deepEqual(l, { pos: 'fixed', x: 0, y: 0, w: 500, h: 400 })
          await page.mouse.move(300, 250, { steps: 3 })
          const [sous, loin] = await pixels(page, [[300, 250], [300 + 90, 250]])
          assert.ok(sous.every((v) => v >= 250), `sous la souris, la page : ${sous}`)
          assert.ok(loin.every((v) => v <= 5), `plus loin, le voile : ${loin}`)
          await page.mouse.click(30, 22)
          const n = await page.evaluate(() => (document.querySelector('mjs-fx-spot-vue-doc') as any)._shadow.querySelector('.n').textContent.trim())
          assert.equal(n, '1', 'le clic traverse le voile de la page')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await ctx.close()
        }
      })
    })
  }
})
