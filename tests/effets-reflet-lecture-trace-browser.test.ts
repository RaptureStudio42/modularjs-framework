// *reflect, *scrollprogress et *path dans de vrais navigateurs (Chromium et Firefox) : il faut une vraie
// mise en page et un vrai rendu. Chaque effet est joué par ses deux techniques — chez soi, puis avec la
// technique native masquée (pas de reflet natif, pas de ligne de temps du défilement, pas d'offset-path)
// pour essayer les chemins de repli. Une capture de chaque effet est rangée dans TMPDIR.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const IMAGE = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'100\'%3E%3Crect width=\'200\' height=\'50\' fill=\'%23f00\'/%3E%3Crect y=\'50\' width=\'200\' height=\'50\' fill=\'%2300f\'/%3E%3C/svg%3E'
const SVG   = 'M10 100 C 60 20, 100 20, 145 80 S 230 140, 280 60'
const BAND  = 'zone: \'bottom top\''

const RF = `<div class="p">__TAG__</div><div class="fin">fin</div>\n<style>\n.p\n  position: relative\n  padding: 20px 20px 130px\n  background: #fff\n.a\n  display: block\n  width: 200px\n  height: 100px\n.t\n  margin: 0\n  width: 260px\n  color: #00f\n  font: bold 48px sans-serif\n.fin\n  height: 10px\n</style>\n`
const SP = (reglages: string, haut: number, extra = '') => `<div class="a" *scrollprogress(${reglages})><div class="tall"></div></div>${extra}\n<style>\n.a\n  width: 300px\n  height: 200px\n  overflow: auto\n  background: #ddd\n.tall\n  height: ${haut}px\n</style>\n`
const TR = (balise: string, cadre = '') => `<div class="p">${cadre}${balise}</div><div class="tall"></div>\n<style>\n.p\n  position: relative\n  width: 400px\n  height: 300px\n  margin-top: 120vh\n.s\n  position: absolute\n  left: 0\n  top: 0\n  width: 400px\n  height: 300px\n  overflow: visible\n.a\n  display: block\n  width: 20px\n  height: 20px\n  background: #f0f\n.r\n  width: 40px\n  height: 10px\n.tall\n  height: 100vh\n</style>\n`
const REF = `<svg class="s"><path class="ref" d="${SVG}" fill="none" stroke="#999"></path></svg>`

const SOURCES: Record<string, string> = {
  'rf-img':     RF.replace('__TAG__', `<img class="a" *reflect(8) src="${IMAGE}" alt="x">`),
  'rf-haut':    RF.replace('__TAG__', `<img class="a" *reflect(8, direction: up) src="${IMAGE}" alt="x">`),
  'rf-flou':    RF.replace('__TAG__', `<img class="a" *reflect(8, blur: 2) src="${IMAGE}" alt="x">`),
  'rf-eau':     RF.replace('__TAG__', `<img class="a" *reflect(8, water: true, speed: 2s) src="${IMAGE}" alt="x">`),
  'rf-titre':   RF.replace('__TAG__', '<h1 class="t" *reflect(4, opacity: 0.6, size: 70)>REFLET</h1>'),
  'sp-self':    SP('#f00, thickness: 8', 1000),
  'sp-bas':     SP('#f00, thickness: 8, place: bottom', 1000),
  'sp-gauche':  SP('#f00, thickness: 8, place: left', 1000),
  'sp-centre':  SP('#f00, thickness: 8, origin: center, track: #888, radius: 4, glow: 6', 1000),
  'sp-vide':    SP('#f00', 100),
  'sp-page':    SP('#00f, source: page, thickness: 6', 100, '<div class="long"></div>').replace('.tall\n', '.long\n  height: 3000px\n.tall\n'),
  'tr-propre':  TR(`<i class="a" *path('${SVG}', ${BAND}, on: scroll)></i>`, REF),
  'tr-pos':     TR(`<i class="a" *path('${SVG}', ${BAND}, on: scroll)></i>`, REF).replace('.a\n  display: block', '.a\n  position: absolute\n  left: 120px\n  top: 70px'),
  'tr-forme':   TR(`<i class="a" *path(wave, ${BAND}, on: scroll)></i>`),
  'tr-vb':      TR(`<i class="a" *path('M0 0 L 100 50 L 100 0', viewbox: '0 0 100 50', ${BAND}, on: scroll)></i>`),
  'tr-from':    TR(`<i class="a" *path(from: '#trace', ${BAND}, on: scroll)></i>`, '<svg class="g" viewBox="0 0 100 50"><path id="trace" d="M0 25 C 30 0, 70 50, 100 25" fill="none" stroke="#999"></path></svg>').replace('.a\n  display', '.g\n  position: absolute\n  left: 50px\n  top: 40px\n  width: 300px\n  height: 150px\n.a\n  display'),
  'tr-tourne':  TR(`<i class="a r" *path('M50 0 L 50 100', ${BAND}, on: scroll)></i>`),
  'cm-a-carte':   '<div class="in"></div>\n<style>\n.in\n  width: 200px\n  height: 100px\n  background: #0a0\n</style>\n',
  'cm-a-haute':   '<div class="in"></div>\n<style>\n.in\n  height: 1000px\n</style>\n',
  'cm-reflet':  '<div class="p"><@cm-a-carte class="a" *reflect(8)></@cm-a-carte></div>\n<style>\n.p\n  padding: 20px 20px 130px\n.a\n  display: block\n  width: 200px\n  height: 100px\n</style>\n',
  'cm-barre':   '<@cm-a-haute class="a" *scrollprogress(#f00, thickness: 8)></@cm-a-haute>\n<style>\n.a\n  display: block\n  width: 300px\n  height: 200px\n  overflow: auto\n</style>\n',
  'cm-trace':   TR(`<@cm-a-carte class="a" *path('M10 100 L 200 100', ${BAND}, on: scroll)></@cm-a-carte>`).replace('.a\n  display: block\n  width: 20px\n  height: 20px\n  background: #f0f', '.a\n  display: block\n  width: 20px\n  height: 20px'),
  'tr-toujours': TR(`<i class="a" *path('${SVG}', duration: 2s)></i>`, REF),
}

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// la technique native masquée avant tout script : on joue le repli du même navigateur
const MASQUE = `(function() { var s = CSS.supports.bind(CSS); CSS.supports = function(a, b) { return /box-reflect|animation-timeline|offset-path|moz-element/.test(String(a) + String(b)) ? false : s(a, b); }; })();`

describe('*reflect, *scrollprogress, *path (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''
  const tmp  = process.env.TMPDIR || '/tmp'

  before(async function () {
    const root   = mjsTmp('effets-reflet-lecture-trace-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom + '.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  async function ouvre(browser: any, tag: string, masque: boolean, options: any = {}) {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 600 }, ...options })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    if (masque) await page.addInitScript(MASQUE)
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.a, .t'), tag)
    await page.evaluate(() => new Promise((r) => setTimeout(r, 150)))
    return { page, erreurs, ctx }
  }

  const frames = (page: any) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  // les couleurs de la page vues à ces points (coordonnées de la fenêtre), par une capture
  async function couleurs(page: any, points: number[][]): Promise<number[][]> {
    const png = await page.screenshot()
    return page.evaluate(async ([b64, pts]: any) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const c = cv.getContext('2d') as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      return pts.map(([x, y]: number[]) => Array.from(c.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3))
    }, [png.toString('base64'), points])
  }

  const dans = (page: any, tag: string, sel: string, fn: string, ...args: any[]) => page.evaluate(([t, s, f, a]: any) => {
    const n = (document.querySelector(t) as any)._shadow.querySelector(s)
    return (new Function('n', 'a', 'return (' + f + ')(n, ...a)'))(n, a)
  }, [tag, sel, fn, args])

  const NAVIGATEURS: [string, 'chromium' | 'firefox', boolean][] = [
    ['Chromium', 'chromium', false],
    ['Chromium, technique native masquée', 'chromium', true],
    ['Firefox', 'firefox', false],
    ['Firefox, technique native masquée', 'firefox', true],
  ]

  for (const [titre, nom, masque] of NAVIGATEURS) {
    describe(titre, function () {
      let browser: any
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, tests sautés. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { await browser?.close() })

      // ----------------------------------------------------------------------------------------------
      // *reflect
      // ----------------------------------------------------------------------------------------------

      async function reflet(tag: string, haut = false) {
        const { page, erreurs, ctx } = await ouvre(browser, tag, masque)
        const r = await dans(page, tag, '.a', '(n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, mode: n.getAttribute("mjs-fx-reflect-mode"), fin: n.getRootNode().querySelector(".fin").getBoundingClientRect().top } }')
        const x = r.l + 100
        const sous = (d: number) => haut ? r.t - 8 - d : r.b + 8 + d
        const [c3, c40, c90] = await couleurs(page, [[x, sous(3)], [x, sous(haut ? 40 : 40)], [x, sous(90)]])
        return { page, erreurs, ctx, r, c3, c40, c90 }
      }

      it('*reflect : le reflet d\'une image reprend son image retournée (le bleu du bas contre la balise), s\'estompe, et ne prend pas de place', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx, r, c3, c40, c90 } = await reflet('mjs-rf-img')
        try {
          const attendu = masque || nom === 'firefox' ? ['copy', 'moz'] : ['box']
          assert.ok(attendu.includes(r.mode), `technique : ${r.mode}`)
          assert.ok(c3[2] > c3[0] + 60 && c3[2] > 200, `sous la balise, du bleu : ${c3}`)
          assert.ok(c40[0] > 215 && c40[1] > 215 && c40[2] > 235, `le fondu : ${c40}`)
          assert.ok(c90[0] > 245 && c90[1] > 245 && c90[2] > 245, `plus de rouge, le haut de l'image n'est pas reflété : ${c90}`)
          assert.equal(Math.round(r.fin), Math.round(r.b + 130), 'le reflet ne prend pas de place : le bloc suivant ne bouge pas')
          assert.deepEqual(erreurs, [])
          await page.screenshot({ path: join(tmp, `reflet-img-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*reflect(direction: up) : le reflet tombe au-dessus', async function () {
        if (!present) { this.skip(); return }
        const { ctx, r, c3 } = await reflet('mjs-rf-haut', true)
        try {
          // le haut de l'image est rouge : le reflet vers le haut reprend le rouge contre la balise
          assert.ok(c3[0] > 200 && c3[0] > c3[2] + 60, `au-dessus de la balise, du rouge : ${c3}`)
          assert.ok(r.t > 8)
        } finally {
          await ctx.close()
        }
      })

      it('*reflect(blur: 2) : le reflet est flou (copie, ou -moz-element), la balise reste nette', async function () {
        if (!present) { this.skip(); return }
        const { page, ctx, r, c3 } = await reflet('mjs-rf-flou')
        try {
          assert.ok(['copy', 'moz'].includes(r.mode), `technique : ${r.mode}`)
          assert.ok(c3[2] > c3[0] + 40, `du bleu sous la balise : ${c3}`)
          // la balise nette : la frontière rouge / bleu de l'image est franche
          const [h, b] = await couleurs(page, [[r.l + 100, r.t + 47], [r.l + 100, r.t + 53]])
          assert.ok(h[0] > 240 && h[2] < 20, `rouge net : ${h}`)
          assert.ok(b[2] > 240 && b[0] < 20, `bleu net : ${b}`)
          // le flou du reflet : sa frontière (le haut du reflet n'a pas de rouge) ne laisse pas un bord franc
          const [e1, e2] = await couleurs(page, [[r.l - 1, r.b + 8 + 30], [r.l + 1, r.b + 8 + 30]])
          assert.ok(e1[0] > 240 && e2[0] > 170 && e2[0] < 250, `bord adouci : ${e1} ${e2}`)
          await page.screenshot({ path: join(tmp, `reflet-flou-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*reflect(water: true) : un reflet ondulé, par un filtre SVG, sans erreur', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx, r, c3 } = await reflet('mjs-rf-eau')
        try {
          assert.ok(['copy', 'moz'].includes(r.mode), `technique : ${r.mode}`)
          assert.ok(c3[2] > c3[0] + 40, `du bleu sous la balise : ${c3}`)
          // l'onde bouge : le bord gauche du reflet n'est pas droit
          const bords: number[] = []
          for (const dy of [4, 14, 24, 34]) {
            const ligne = await couleurs(page, Array.from({ length: 40 }, (_, i) => [r.l - 20 + i, r.b + 8 + dy]))
            bords.push(ligne.findIndex((c) => c[0] < 200 || c[1] < 200))
          }
          assert.ok(new Set(bords).size > 1, `un bord qui ondule : ${bords}`)
          assert.deepEqual(erreurs, [])
          await page.screenshot({ path: join(tmp, `reflet-eau-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*reflect sur un titre : son reflet retourné suit son texte', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx } = await ouvre(browser, 'mjs-rf-titre', masque)
        try {
          const r = await dans(page, 'mjs-rf-titre', '.t', '(n) => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, b: b.bottom, h: b.height, mode: n.getAttribute("mjs-fx-reflect-mode") } }')
          assert.ok(r.mode)
          // sous le titre, du bleu (le texte est bleu) dans la bande du reflet
          const pts: number[][] = []
          for (let y = r.b + 4; y < r.b + 4 + r.h * 0.5; y += 3) for (let x = r.l; x < r.l + 200; x += 3) pts.push([x, y])
          const px = await couleurs(page, pts)
          const bleus = px.filter((c) => c[2] > c[0] + 40).length
          assert.ok(bleus > 15, `${bleus} points bleus dans le reflet du titre`)
          assert.deepEqual(erreurs, [])
          await page.screenshot({ path: join(tmp, `reflet-titre-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      // ----------------------------------------------------------------------------------------------
      // *scrollprogress
      // ----------------------------------------------------------------------------------------------

      const fraction = (page: any, tag: string, vertical = false) => dans(page, tag, '[mjs-fx-layer="scrollprogress"]', '(l, v) => { const a = l.getBoundingClientRect(); const b = l.querySelector("i").getBoundingClientRect(); return { part: v ? b.height / a.height : b.width / a.width, native: l.hasAttribute("mjs-fx-scrollprogress-native"), now: l.getAttribute("mjs-fx-scrollprogress-valuenow") || l.getAttribute("aria-valuenow") } }', vertical)

      async function lecture(tag: string, defile: (page: any, k: number) => Promise<void>, vertical = false) {
        const { page, erreurs, ctx } = await ouvre(browser, tag, masque)
        const res: any[] = []
        for (const k of [0, 0.5, 1]) {
          await defile(page, k)
          await frames(page)
          await page.evaluate(() => new Promise((r) => setTimeout(r, 400)))
          res.push(await fraction(page, tag, vertical))
        }
        return { page, erreurs, ctx, res }
      }

      const defileBalise = (tag: string) => (page: any, k: number) => page.evaluate(([t, k]: any) => { const n = (document.querySelector(t) as any)._shadow.querySelector('.a'); n.scrollTop = (n.scrollHeight - n.clientHeight) * k }, [tag, k])

      it('*scrollprogress (source: self) : la barre vaut 0 % en haut, ~50 % au milieu, 100 % en bas ; aria-valuenow suit', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx, res } = await lecture('mjs-sp-self', defileBalise('mjs-sp-self'))
        try {
          assert.equal(res[0].native, !masque && nom === 'chromium', 'la ligne de temps du défilement là où elle existe')
          assert.ok(res[0].part < 0.01, `en haut : ${res[0].part}`)
          assert.ok(Math.abs(res[1].part - 0.5) < 0.02, `au milieu : ${res[1].part}`)
          assert.ok(res[2].part > 0.99, `en bas : ${res[2].part}`)
          assert.deepEqual(res.map((x) => x.now), ['0', '50', '100'])
          assert.deepEqual(erreurs, [])
          await dans(page, 'mjs-sp-self', '.a', '(n) => { n.scrollTop = 200 }')
          await frames(page)
          await page.screenshot({ path: join(tmp, `barre-self-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*scrollprogress (source: self) : la barre reste collée au bord de la balise pendant le défilement ; en bas, et à gauche (verticale)', async function () {
        if (!present) { this.skip(); return }
        for (const [tag, bord] of [['mjs-sp-self', 'top'], ['mjs-sp-bas', 'bottom'], ['mjs-sp-gauche', 'left']]) {
          const { page, ctx } = await ouvre(browser, tag, masque)
          try {
            await defileBalise(tag)(page, 0.5)
            await frames(page)
            const m = await dans(page, tag, '.a', '(n, b) => { const a = n.getBoundingClientRect(); const l = n.querySelector("[mjs-fx-layer=scrollprogress]").getBoundingClientRect(); return { top: l.top - a.top, bottom: a.bottom - l.bottom, left: l.left - a.left, w: l.width, h: l.height, ah: n.clientHeight } }', bord)
            if (bord === 'top') assert.ok(Math.abs(m.top) < 1.5 && Math.abs(m.h - 8) < 1, JSON.stringify(m))
            if (bord === 'bottom') assert.ok(Math.abs(m.bottom) < 1.5 && Math.abs(m.h - 8) < 1, JSON.stringify(m))
            if (bord === 'left') assert.ok(Math.abs(m.left) < 1.5 && Math.abs(m.w - 8) < 1 && Math.abs(m.h - m.ah) < 2, JSON.stringify(m))
          } finally {
            await ctx.close()
          }
        }
      })

      it('*scrollprogress (barre à gauche) : verticale, elle grandit de haut en bas', async function () {
        if (!present) { this.skip(); return }
        const { page, ctx, res } = await lecture('mjs-sp-gauche', defileBalise('mjs-sp-gauche'), true)
        try {
          assert.ok(res[0].part < 0.01, `en haut : ${res[0].part}`)
          assert.ok(Math.abs(res[1].part - 0.5) < 0.02, `au milieu : ${res[1].part}`)
          assert.ok(res[2].part > 0.99, `en bas : ${res[2].part}`)
          await page.screenshot({ path: join(tmp, `barre-gauche-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*scrollprogress (source: page) : fixée au bord de la fenêtre, 0 % en haut de la page, ~50 % au milieu, 100 % en bas', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx, res } = await lecture('mjs-sp-page', (p: any, k: number) => p.evaluate((k: number) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * k), k))
        try {
          assert.ok(res[0].part < 0.01, `en haut : ${res[0].part}`)
          assert.ok(Math.abs(res[1].part - 0.5) < 0.02, `au milieu : ${res[1].part}`)
          assert.ok(res[2].part > 0.99, `en bas : ${res[2].part}`)
          assert.deepEqual(res.map((x) => x.now), ['0', '50', '100'])
          const pos = await dans(page, 'mjs-sp-page', '[mjs-fx-layer="scrollprogress"]', '(l) => { const r = l.getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width, h: r.height, vw: innerWidth } }')
          assert.ok(pos.top === 0 && pos.left === 0 && pos.w === pos.vw && Math.abs(pos.h - 6) < 0.5, JSON.stringify(pos))
          assert.deepEqual(erreurs, [])
          await page.screenshot({ path: join(tmp, `barre-page-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*scrollprogress : rail, origine au centre, arrondi et halo ; une balise qui ne déborde pas : barre vide, sans erreur', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx, res } = await lecture('mjs-sp-centre', defileBalise('mjs-sp-centre'))
        try {
          const m = await dans(page, 'mjs-sp-centre', '[mjs-fx-layer="scrollprogress"]', '(l) => { const a = l.getBoundingClientRect(); const b = l.querySelector("i").getBoundingClientRect(); return { gauche: (b.left - a.left) / a.width, droite: (a.right - b.right) / a.width, fond: getComputedStyle(l).backgroundColor, rayon: getComputedStyle(l).borderTopLeftRadius } }')
          assert.ok(res[2].part > 0.99)
          await defileBalise('mjs-sp-centre')(page, 0.5)
          await frames(page)
          await page.evaluate(() => new Promise((r) => setTimeout(r, 400)))
          const mi = await dans(page, 'mjs-sp-centre', '[mjs-fx-layer="scrollprogress"]', '(l) => { const a = l.getBoundingClientRect(); const b = l.querySelector("i").getBoundingClientRect(); return { gauche: (b.left - a.left) / a.width, droite: (a.right - b.right) / a.width } }')
          assert.ok(Math.abs(mi.gauche - mi.droite) < 0.01 && mi.gauche > 0.2, `elle grandit depuis le milieu : ${JSON.stringify(mi)}`)
          assert.equal(m.fond, 'rgb(136, 136, 136)')
          assert.equal(m.rayon, '4px')
          await page.screenshot({ path: join(tmp, `barre-centre-${nom}${masque ? '-repli' : ''}.png`) })
          const vide = await ouvre(browser, 'mjs-sp-vide', masque)
          const f = await fraction(vide.page, 'mjs-sp-vide')
          assert.ok(f.part < 0.01, `balise sans défilement : ${f.part}`)
          assert.deepEqual([...erreurs, ...vide.erreurs], [])
          await vide.ctx.close()
        } finally {
          await ctx.close()
        }
      })

      // ----------------------------------------------------------------------------------------------
      // *path
      // ----------------------------------------------------------------------------------------------

      // le cadre du tracé (le parent positionné) et le centre de la balise, à l'écran
      const centre = (page: any, tag: string) => dans(page, tag, '.a', '(n) => { const r = n.getBoundingClientRect(); const p = n.parentNode.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, px: p.left, py: p.top, w: r.width, h: r.height, mode: n.getAttribute("mjs-fx-path-mode") } }')

      // la page défilée de façon que le cadre soit à la fraction p de la bande `bottom top`
      const defile = async (page: any, p: number) => {
        await page.evaluate((p: number) => { const h = innerHeight; window.scrollTo(0, 1.2 * h - h * (1 - p)); }, p)
        await frames(page)
        await page.evaluate(() => new Promise((r) => setTimeout(r, 120)))
      }

      // le point du tracé de référence (en unités du SVG) à la fraction p
      const ref = (page: any, tag: string, sel: string, p: number) => dans(page, tag, sel, '(n, p) => { const pt = n.getPointAtLength(n.getTotalLength() * p); return { x: pt.x, y: pt.y } }', p)

      it('*path(\'d\') : la balise est sur son tracé au début, à mi-parcours et à la fin (centre comparé à getPointAtLength)', async function () {
        if (!present) { this.skip(); return }
        for (const tag of ['mjs-tr-propre', 'mjs-tr-pos']) {
          const { page, erreurs, ctx } = await ouvre(browser, tag, masque)
          try {
            for (const p of [0, 0.5, 1]) {
              await defile(page, p)
              const c = await centre(page, tag)
              const pt = await ref(page, tag, '.ref', p)
              assert.ok(Math.abs(c.x - (c.px + pt.x)) < 2.5 && Math.abs(c.y - (c.py + pt.y)) < 2.5, `${tag} p=${p} : centre ${c.x.toFixed(1)},${c.y.toFixed(1)} attendu ${(c.px + pt.x).toFixed(1)},${(c.py + pt.y).toFixed(1)} (${c.mode})`)
              assert.equal(c.mode, masque ? 'js' : 'offset')
            }
            assert.deepEqual(erreurs, [])
            await defile(page, 0.5)
            await page.screenshot({ path: join(tmp, `trace-d-${tag.slice(6)}-${nom}${masque ? '-repli' : ''}.png`) })
          } finally {
            await ctx.close()
          }
        }
      })

      it('*path(wave) : un tracé tout fait, mis à l\'échelle du parent (repère 0 0 290 160)', async function () {
        if (!present) { this.skip(); return }
        const { page, ctx } = await ouvre(browser, 'mjs-tr-forme', masque)
        try {
          await defile(page, 0.5)
          const c  = await centre(page, 'mjs-tr-forme')
          // wave à mi-parcours : le point (145, 80) du repère, k = min(400 / 290, 300 / 160) = 1,379, centré
          const k  = Math.min(400 / 290, 300 / 160)
          const ox = (400 - 290 * k) / 2
          const oy = (300 - 160 * k) / 2
          // la mi-longueur n'est pas le point (145, 80) : on compare à un <path> du même tracé
          const mid = await page.evaluate(([d, k, ox, oy]: any) => {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            p.setAttribute('d', d)
            const pt = p.getPointAtLength(p.getTotalLength() / 2)
            return { x: pt.x * k + ox, y: pt.y * k + oy }
          }, ['M10 100 C 60 20, 100 20, 145 80 S 230 140, 280 60', k, ox, oy])
          assert.ok(Math.abs(c.x - (c.px + mid.x)) < 3 && Math.abs(c.y - (c.py + mid.y)) < 3, `centre ${c.x.toFixed(1)},${c.y.toFixed(1)} attendu ${(c.px + mid.x).toFixed(1)},${(c.py + mid.y).toFixed(1)}`)
        } finally {
          await ctx.close()
        }
      })

      it('*path(viewbox) : le tracé est mis à l\'échelle du parent', async function () {
        if (!present) { this.skip(); return }
        const { page, ctx } = await ouvre(browser, 'mjs-tr-vb', masque)
        try {
          for (const p of [0, 0.5, 1]) {
            await defile(page, p)
            const c = await centre(page, 'mjs-tr-vb')
            // M0 0 L100 50 L100 0 dans un cadre de 400 × 300 : échelle 4, centré (50 px de marge en haut) ; mesuré sur un <path> de même d
            const pt = await page.evaluate(([p]: any) => {
              const e = document.createElementNS('http://www.w3.org/2000/svg', 'path')
              e.setAttribute('d', 'M0 0 L 100 50 L 100 0')
              const q = e.getPointAtLength(e.getTotalLength() * p)
              return { x: q.x * 4, y: q.y * 4 + 50 }
            }, [p])
            assert.ok(Math.abs(c.x - (c.px + pt.x)) < 2.5 && Math.abs(c.y - (c.py + pt.y)) < 2.5, `p=${p} : centre ${c.x.toFixed(1)},${c.y.toFixed(1)} attendu ${(c.px + pt.x).toFixed(1)},${(c.py + pt.y).toFixed(1)}`)
          }
        } finally {
          await ctx.close()
        }
      })

      it('*path(from) : la balise suit le tracé LÀ OÙ IL EST DESSINÉ (position et échelle du SVG)', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx } = await ouvre(browser, 'mjs-tr-from', masque)
        try {
          for (const p of [0, 0.5, 1]) {
            await defile(page, p)
            const c  = await centre(page, 'mjs-tr-from')
            const pt = await ref(page, 'mjs-tr-from', '#trace', p)
            // le SVG est à 50, 40 dans le cadre, 300 × 150 pour un viewBox 100 × 50 : échelle 3
            const x = c.px + 50 + pt.x * 3
            const y = c.py + 40 + pt.y * 3
            assert.ok(Math.abs(c.x - x) < 2.5 && Math.abs(c.y - y) < 2.5, `p=${p} : centre ${c.x.toFixed(1)},${c.y.toFixed(1)} attendu ${x.toFixed(1)},${y.toFixed(1)}`)
          }
          assert.deepEqual(erreurs, [])
          await defile(page, 0.5)
          await page.screenshot({ path: join(tmp, `trace-from-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await ctx.close()
        }
      })

      it('*path : la balise tourne avec la courbe (une ligne verticale : la balise se couche à la verticale)', async function () {
        if (!present) { this.skip(); return }
        const { page, ctx } = await ouvre(browser, 'mjs-tr-tourne', masque)
        try {
          await defile(page, 0.5)
          const c = await centre(page, 'mjs-tr-tourne')
          assert.ok(c.w < c.h, `la balise de 40 × 10 est couchée : ${c.w} × ${c.h}`)
        } finally {
          await ctx.close()
        }
      })

      it('sur un composant : le reflet, la barre (dans le shadow root du composant) et le tracé marchent', async function () {
        if (!present) { this.skip(); return }
        const a = await ouvre(browser, 'mjs-cm-reflet', masque)
        try {
          const r = await dans(a.page, 'mjs-cm-reflet', '.a', '(n) => { const r = n.getBoundingClientRect(); return { l: r.left, b: r.bottom, mode: n.getAttribute("mjs-fx-reflect-mode") } }')
          const [c] = await couleurs(a.page, [[r.l + 100, r.b + 8 + 3]])
          // sans reflet natif ni -moz-element, un composant ne se copie pas : aucun reflet (et un avertissement)
          if (masque) assert.ok(c[0] > 245 && c[1] > 245 && c[2] > 245, `aucun reflet : ${c}`)
          else assert.ok(c[1] > c[0] + 60 && c[1] > 190, `du vert sous le composant (${r.mode}) : ${c}`)
          assert.deepEqual(a.erreurs, [])
          await a.page.screenshot({ path: join(tmp, `composant-reflet-${nom}${masque ? '-repli' : ''}.png`) })
        } finally {
          await a.ctx.close()
        }
        const b = await ouvre(browser, 'mjs-cm-barre', masque)
        try {
          const res: number[] = []
          for (const k of [0, 0.5, 1]) {
            await b.page.evaluate(([k]: any) => { const n = (document.querySelector('mjs-cm-barre') as any)._shadow.querySelector('.a'); n.scrollTop = (n.scrollHeight - n.clientHeight) * k }, [k])
            await frames(b.page)
            await b.page.evaluate(() => new Promise((r) => setTimeout(r, 400)))
            res.push(await b.page.evaluate(() => { const n = (document.querySelector('mjs-cm-barre') as any)._shadow.querySelector('.a'); const l = n._shadow.querySelector('[mjs-fx-layer="scrollprogress"]'); return l.querySelector('i').getBoundingClientRect().width / l.getBoundingClientRect().width }))
          }
          assert.ok(res[0] < 0.01 && Math.abs(res[1] - 0.5) < 0.02 && res[2] > 0.99, `${res}`)
          assert.deepEqual(b.erreurs, [])
        } finally {
          await b.ctx.close()
        }
        const c = await ouvre(browser, 'mjs-cm-trace', masque)
        try {
          await defile(c.page, 0.5)
          const m = await centre(c.page, 'mjs-cm-trace')
          assert.ok(Math.abs(m.x - (m.px + 105)) < 2.5 && Math.abs(m.y - (m.py + 100)) < 2.5, `centre ${m.x.toFixed(1)},${m.y.toFixed(1)} attendu ${m.px + 105},${m.py + 100}`)
          assert.deepEqual(c.erreurs, [])
        } finally {
          await c.ctx.close()
        }
      })

      it('*path (on: always) : en route, la balise reste sur son tracé ; « réduire les animations » : elle reste au point de départ', async function () {
        if (!present) { this.skip(); return }
        const { page, erreurs, ctx } = await ouvre(browser, 'mjs-tr-toujours', masque)
        try {
          await page.evaluate(() => window.scrollTo(0, 400))
          const pts = await ref(page, 'mjs-tr-toujours', '.ref', 0)
          void pts
          const dist = (c: any) => dans(page, 'mjs-tr-toujours', '.ref', '(n, c) => { const L = n.getTotalLength(); let m = 1e9; for (let i = 0; i <= 600; i++) { const q = n.getPointAtLength(L * i / 600); const dx = c.x - c.px - q.x, dy = c.y - c.py - q.y; m = Math.min(m, Math.hypot(dx, dy)) } return m }', c)
          const bouge = new Set<string>()
          for (let i = 0; i < 6; i++) {
            await page.evaluate(() => new Promise((r) => setTimeout(r, 230)))
            const c = await centre(page, 'mjs-tr-toujours')
            bouge.add(Math.round(c.x / 10) + ',' + Math.round(c.y / 10))
            const d = await dist(c)
            assert.ok(d < 3.5, `sur le tracé à ${d.toFixed(1)} px près (${c.mode})`)
          }
          assert.ok(bouge.size > 2, `la balise avance : ${[...bouge]}`)
          assert.deepEqual(erreurs, [])
        } finally {
          await ctx.close()
        }
        const calme = await ouvre(browser, 'mjs-tr-toujours', masque, { reducedMotion: 'reduce' })
        try {
          await calme.page.evaluate(() => window.scrollTo(0, 400))
          await frames(calme.page)
          for (let i = 0; i < 2; i++) {
            await calme.page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
            const c = await centre(calme.page, 'mjs-tr-toujours')
            assert.ok(Math.abs(c.x - (c.px + 10)) < 2.5 && Math.abs(c.y - (c.py + 100)) < 2.5, `au point de départ : ${c.x.toFixed(1)},${c.y.toFixed(1)} attendu ${c.px + 10},${c.py + 100}`)
          }
        } finally {
          await calme.ctx.close()
        }
      })
    })
  }
})
