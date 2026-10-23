// *filter(…, spot) dans Chromium et Firefox réels : la zone nette suit la balise là où elle est vraiment. Un ancêtre
// agrandi ne la déforme pas ; le double ne change aucun `:nth-child` des frères existants (sa lentille se pose en dernier
// enfant, marquée comme calque d'effet) ; une valeur neutre de `scale` ne la refuse pas, une vraie transformation (au
// survol, en cours de transition) est reprise image par image ; le double suit l'image qui change d'adresse ; le
// retrait pendant le survol et la sortie défont double, écouteurs et observateur.

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

const svg   = (corps: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' shape-rendering='crispEdges'>${corps}</svg>`)
const ROUGE = svg('<rect width="300" height="200" fill="#f00"/>')
const BLEU  = svg('<rect width="300" height="200" fill="#00f"/>')

const FX = '*filter(grayscale, spot: 100, soft: 0, smooth: 1)'

// huit scènes de 300 × 120 : un ancêtre agrandi, trois images côte à côte, une valeur neutre de scale, un scale au survol, un scale qui
// monte lentement, une image qui change d'adresse, une image qu'on parcourt puis qu'on quitte, et en dernier une image qu'on retire ({if}) :
// rien ne glisse alors sous la souris
const PAGE = '<script>\n$on = true\n</script>\n'
  + `<div class="g8"><img class="i8" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="g9"><img class="n1" src="${ROUGE}" alt="a"><img class="n2" ${FX} src="${ROUGE}" alt="b"><img class="n3" src="${ROUGE}" alt="c"></div>\n`
  + `<div class="k1"><img class="i1" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="k2"><img class="i2" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="k3"><img class="i3" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="s9"><img class="i9" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `<div class="m1"><img class="i11" ${FX} src="${ROUGE}" alt="a"></div>\n`
  + `{if $on}<div class="l1"><img class="i10" *filter(grayscale, spot: 100, soft: 0, smooth: 0.5) src="${ROUGE}" alt="a"></div>{end}\n`
  + '<button class="t" @click={$on = !$on}>t</button>\n'
  + '<style>\n.g8\n  width: 300px\n  height: 120px\n  margin: 10px 10px 40px\n  transform: scale(1.2)\n  transform-origin: 0 0\n'
  + '.g9\n  display: flex\n  width: 300px\n  height: 120px\n  margin: 10px\n'
  + '.g9 > img\n  flex: none\n  width: 60px\n  height: 120px\n'
  + '.g9 > img:nth-child(3)\n  width: 100px\n'
  + '.k1, .k2, .k3, .s9, .l1, .m1\n  width: 300px\n  height: 120px\n  margin: 10px\n'
  + '.k1 img\n  scale: 1\n  rotate: 0deg\n  translate: 0px\n'
  + '.k2 img:hover\n  scale: 1.1\n'
  + '.k3 img:hover\n  scale: 1.5\n  transition: scale 20s linear\n'
  + '.k1 img, .k2 img, .k3 img, .s9 img, .l1 img, .m1 img\n  display: block\n  width: 300px\n  height: 120px\n'
  + 'img.i8\n  display: block\n  width: 300px\n  height: 120px\n</style>\n'

// le registre des écouteurs vivants et des observateurs de taille, posé avant la page : les méthodes natives que les effets
// appellent sont alors les siennes (les effets les cherchent sur le prototype à chaque appel)
const REGISTRE = `(function() {
  var live = [];
  var ro = new Set();
  var add = EventTarget.prototype.addEventListener;
  var rem = EventTarget.prototype.removeEventListener;
  var cap = function(o) { return typeof o === 'boolean' ? o : !!(o && o.capture); };
  EventTarget.prototype.addEventListener = function(type, fn, o) {
    var c = cap(o);
    var self = this;
    var dup = live.some(function(e) { return e.t === self && e.type === type && e.fn === fn && e.capture === c; });
    if (!dup) live.push({ t: this, type: type, fn: fn, capture: c, passive: !!(o && typeof o === 'object' && o.passive) });
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function(type, fn, o) {
    var c = cap(o);
    var self = this;
    live = live.filter(function(e) { return !(e.t === self && e.type === type && e.fn === fn && e.capture === c); });
    return rem.call(this, type, fn, o);
  };
  var RO = window.ResizeObserver;
  if (RO) {
    window.ResizeObserver = class extends RO {
      observe(t, o) { (this._t = this._t || new Set()).add(t); ro.add(this); return super.observe(t, o); }
      unobserve(t) { if (this._t) { this._t.delete(t); if (!this._t.size) ro.delete(this); } return super.unobserve(t); }
      disconnect() { if (this._t) this._t.clear(); ro.delete(this); return super.disconnect(); }
    };
  }
  var nom = function(t) {
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (typeof ShadowRoot === 'function' && t instanceof ShadowRoot) return 'shadow';
    return t && t.localName ? t.localName + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '') : '?';
  };
  window.__vivants = function(types) {
    return live.filter(function(e) { return types.indexOf(e.type) >= 0; }).map(function(e) { return { cible: nom(e.t), type: e.type, capture: e.capture, passive: e.passive }; });
  };
  window.__observateurs = function() { return ro.size; };
})();`

describe('*filter(…, spot) : la zone nette suit la balise là où elle est, dans de vrais navigateurs', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-spot-filtre-corr')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-spotf-corr.mjs'), PAGE)
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
          console.log(`  ℹ️  ${nom} non installé, test de *filter(spot) sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function ouvrir() {
        const ctx  = await browser.newContext({ viewport: { width: 340, height: 1500 } })
        await ctx.addInitScript(REGISTRE)
        const page = await ctx.newPage()
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fx-spotf-corr></mjs-fx-spotf-corr><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-spotf-corr') as any)?._shadow?.querySelector('.i11'))
        await page.waitForTimeout(500)
        return { ctx, page, erreurs }
      }

      const boite = (page: any, sel: string) => page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }, sel)

      const copies  = (page: any) => page.evaluate(() => (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelectorAll('[mjs-fx-filter-copy]').length)
      const vivants = (page: any, types: string[]) => page.evaluate((t: string[]) => (window as any).__vivants(t), types)

      // la boîte d'écran de l'image et celle de son double, lues dans la même tâche, après deux images
      const deux = (page: any, sel: string) => page.evaluate(async (s: string) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const sh = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow
        const a  = sh.querySelector(s).getBoundingClientRect()
        const c  = sh.querySelector('[mjs-fx-filter-copy]')
        if (!c) return null
        const b = c.getBoundingClientRect()
        return { dx: b.left - a.left, dy: b.top - a.top, dw: b.width - a.width, dh: b.height - a.height, w: a.width }
      }, sel)

      const pres = (d: any) => d && Math.abs(d.dx) < 0.6 && Math.abs(d.dy) < 0.6 && Math.abs(d.dw) < 0.6 && Math.abs(d.dh) < 0.6

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
      const bleu  = (p: number[]) => p[2] > 200 && p[0] < 60 && p[1] < 60
      const gris  = (p: number[]) => Math.abs(p[0] - p[1]) < 8 && Math.abs(p[1] - p[2]) < 8 && p[0] > 20 && p[0] < 90

      it('un ancêtre agrandi (scale 1,2) : le double a la boîte de l\'image, la zone est sous la souris', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page, erreurs } = await ouvrir()
        try {
          const a = await boite(page, '.i8')
          await page.mouse.move(a.x + a.w / 2, a.y + a.h / 2, { steps: 3 })
          await page.waitForTimeout(300)
          assert.equal(await copies(page), 1, 'le double existe')
          const d = await deux(page, '.i8')
          assert.ok(pres(d), `le double a la boîte (écran) de l'image : ${JSON.stringify(d)}`)
          const cx = a.x + a.w / 2
          const cy = a.y + a.h / 2
          const [dedans, juste, loin] = await pixels(page, [[cx, cy], [cx + 40, cy], [cx + 80, cy]])
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
          assert.ok(rouge(juste), `à 40 px d'écran (le rayon de 50 px est agrandi : 60), encore rouge : ${juste}`)
          assert.ok(gris(loin), `à 80 px d'écran, du gris : ${loin}`)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await ctx.close()
        }
      })

      it('la lentille du double se pose en dernier enfant du parent, marquée calque d\'effet : aucun frère ne change de rang', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const largeurs = () => page.evaluate(() => {
            const g = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.g9')
            return Array.from(g.querySelectorAll('img:not([mjs-fx-filter-copy])')).map((i: any) => Math.round(i.getBoundingClientRect().width))
          })
          const avant = await largeurs()
          assert.deepEqual(avant, [60, 60, 100])
          const a = await boite(page, '.n2')
          await page.mouse.move(a.x + 30, a.y + 60, { steps: 3 })
          await page.waitForTimeout(300)
          assert.equal(await copies(page), 1)
          assert.deepEqual(await largeurs(), avant, 'le troisième frère garde son rang (nth-child(3)), donc sa largeur')
          const r = await page.evaluate(() => {
            const g = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.g9')
            const c = g.querySelector('[mjs-fx-filter-lens]')
            return { dernier: g.lastElementChild === c, calque: c.getAttribute('mjs-fx-layer'), rang: Array.from(g.children).indexOf(c) }
          })
          assert.deepEqual(r, { dernier: true, calque: 'filter', rang: 3 })
        }
        finally {
          await ctx.close()
        }
      })

      it('valeurs neutres de scale, rotate et translate : la zone nette se pose', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const a = await boite(page, '.i1')
          await page.mouse.move(a.x + 150, a.y + 60, { steps: 3 })
          await page.waitForTimeout(300)
          assert.equal(await copies(page), 1, 'le double existe : une transformation neutre n\'en est pas une')
          const [dedans, loin] = await pixels(page, [[a.x + 150, a.y + 60], [a.x + 150 + 80, a.y + 60]])
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
          assert.ok(gris(loin), `plus loin, du gris : ${loin}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('une balise agrandie au survol (scale 1,1) : le double reprend la transformation, boîte et zone justes', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const a = await boite(page, '.i2')
          await page.mouse.move(a.x + 150, a.y + 60, { steps: 3 })
          await page.waitForTimeout(400)
          assert.equal(await copies(page), 1, 'le double existe')
          const d = await deux(page, '.i2')
          assert.ok(d && d.w > 320, `la balise est agrandie : ${d && d.w}`)
          assert.ok(pres(d), `le double a la boîte (écran) de l'image agrandie : ${JSON.stringify(d)}`)
          const [dedans, juste, loin] = await pixels(page, [[a.x + 150, a.y + 60], [a.x + 150 + 40, a.y + 60], [a.x + 150 + 80, a.y + 60]])
          assert.ok(rouge(dedans), `sous la souris, le rouge : ${dedans}`)
          assert.ok(rouge(juste), `à 40 px d'écran (le rayon de 50 px est agrandi : 55), encore rouge : ${juste}`)
          assert.ok(gris(loin), `à 80 px d'écran, du gris : ${loin}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('une transition de la balise en cours : le double la suit image par image', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const a = await boite(page, '.i3')
          await page.mouse.move(a.x + 150, a.y + 60, { steps: 3 })
          // la transition dure 20 s : l'image grossit sous nos yeux ; le double doit toujours la recouvrir
          await page.waitForFunction(() => {
            const i = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.i3')
            return i.getBoundingClientRect().width > 306
          }, null, { timeout: 30000 })
          const premier = await deux(page, '.i3')
          assert.ok(pres(premier), `le double recouvre l'image qui grossit : ${JSON.stringify(premier)}`)
          await page.waitForFunction(() => (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.i3').getBoundingClientRect().width > 312, null, { timeout: 30000 })
          const second = await deux(page, '.i3')
          assert.ok(second && second.w > premier.w, 'elle a grossi')
          assert.ok(pres(second), `et le double a suivi : ${JSON.stringify(second)}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('une image qui change d\'adresse pendant le survol : la zone nette montre la nouvelle', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const a = await boite(page, '.i9')
          await page.mouse.move(a.x + 150, a.y + 60, { steps: 3 })
          await page.waitForTimeout(300)
          assert.equal(await copies(page), 1)
          await page.evaluate(async (bleu: string) => {
            const i = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.i9')
            const fin = new Promise((r) => i.addEventListener('load', r, { once: true }))
            i.src = bleu
            await fin
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          }, BLEU)
          const meme = await page.evaluate(() => {
            const sh = (document.querySelector('mjs-fx-spotf-corr') as any)._shadow
            return sh.querySelector('[mjs-fx-filter-copy]').getAttribute('src') === sh.querySelector('.i9').currentSrc
          })
          assert.ok(meme, 'le double a l\'adresse que la balise a retenue')
          const [dedans] = await pixels(page, [[a.x + 150, a.y + 60]])
          assert.ok(bleu(dedans), `sous la souris, le bleu : ${dedans}`)
        }
        finally {
          await ctx.close()
        }
      })

      it('le retrait pendant le survol enlève le double, les écouteurs de la balise et les observateurs', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const types = ['pointerenter', 'pointermove', 'pointerleave', 'scroll', 'resize']
          const reposTous = await vivants(page, types)
          const obs0      = await page.evaluate(() => (window as any).__observateurs())
          const a = await boite(page, '.i10')
          await page.mouse.move(a.x + 100, a.y + 60, { steps: 3 })
          await page.mouse.move(a.x + 140, a.y + 50, { steps: 2 })
          await page.waitForTimeout(300)
          assert.equal(await copies(page), 1, 'le double existe pendant le survol')
          assert.ok((await vivants(page, types)).some((e: any) => e.cible === 'img.i10' && e.type === 'pointermove'), 'la balise écoute')
          await page.evaluate(() => (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.t').click())
          await page.waitForFunction(() => !(document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelector('.i10'), null, { timeout: 10000 })
          await page.waitForFunction(() => (document.querySelector('mjs-fx-spotf-corr') as any)._shadow.querySelectorAll('[mjs-fx-filter-copy]').length === 0, null, { timeout: 5000 }).catch(() => {})
          assert.equal(await copies(page), 0, 'plus aucun double, fondu compris')
          assert.deepEqual((await vivants(page, types)).filter((e: any) => e.cible === 'img.i10'), [], 'plus aucun écouteur sur la balise retirée')
          assert.deepEqual(await vivants(page, ['scroll', 'resize']), reposTous.filter((e: any) => e.type === 'scroll' || e.type === 'resize'), 'ni défilement ni redimensionnement')
          assert.equal(await page.evaluate(() => (window as any).__observateurs()), obs0)
        }
        finally {
          await ctx.close()
        }
      })

      it('la sortie défait la surveillance du défilement et de la taille, à chaque visite', async function () {
        if (!present) { this.skip(); return }
        const { ctx, page } = await ouvrir()
        try {
          const repos = await vivants(page, ['scroll', 'resize'])
          const obs0  = await page.evaluate(() => (window as any).__observateurs())
          const a     = await boite(page, '.i11')
          for (let i = 0; i < 3; i++) {
            await page.mouse.move(a.x + 100, a.y + 60, { steps: 3 })
            await page.waitForTimeout(150)
            assert.ok((await vivants(page, ['scroll', 'resize'])).length > repos.length, 'pendant le survol, la zone surveille')
            await page.mouse.move(335, 1495, { steps: 2 })
            await page.waitForTimeout(150)
            assert.deepEqual(await vivants(page, ['scroll', 'resize']), repos, `après la sortie n° ${i + 1}, rien de plus qu'au repos`)
            assert.equal(await page.evaluate(() => (window as any).__observateurs()), obs0, 'observateur déconnecté')
          }
        }
        finally {
          await ctx.close()
        }
      })
    })
  }
})
