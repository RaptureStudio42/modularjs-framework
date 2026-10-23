// *liquid, *chromatic et *crt dans Chromium et Firefox réels : des pixels d'une capture. L'image
// survolée diffère de l'image au repos et n'est pas devenue invisible (un filtre SVG invalide rend la
// balise invisible) ; des franges rouges et bleues (ou cyan et jaunes) bordent une forme blanche ;
// les lignes de balayage sont là et le calque ne capte pas les clics. MJS_FX_CAPTURES=<dossier> :
// les captures y sont aussi écrites en PNG.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG de w × h : `couleur(x, y)` rend [r, g, b]
function png(w: number, h: number, couleur: (x: number, y: number) => number[]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (x: Buffer) => { let c = 0xffffffff; for (const v of x) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 2
  const brut = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const c = couleur(x, y); brut[o] = c[0]; brut[o + 1] = c[1]; brut[o + 2] = c[2] }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}
const uri = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64')

// 160 × 120 : des rayures verticales noires et blanches de 8 px
const RAYURES = uri(png(160, 120, (x) => (x >> 3) % 2 ? [255, 255, 255] : [0, 0, 0]))
// 200 × 100 : un rectangle blanc sur du noir
const FORME   = uri(png(200, 100, (x, y) => x >= 50 && x < 150 && y >= 30 && y < 70 ? [255, 255, 255] : [0, 0, 0]))

const SOURCES: Record<string, string> = {
  'fl-liquide.mjs': `<img class="l" src="${RAYURES}" alt="" *liquid(60, rest: 0, animate: false, duration: 0ms)>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fl-liquide-fixe.mjs': `<img class="l" src="${RAYURES}" alt="" *liquid(60, rest: 0.5, duration: 0ms, on: always)>\n<style>\n.l\n  display: block\n  margin: 40px\n</style>\n`,
  'fl-decalage.mjs': `<div class="c" *chromatic(8, grow: 8, duration: 0ms, on: always)><i class="w"></i></div>\n<style>\n.c\n  position: relative\n  width: 200px\n  height: 100px\n  margin: 30px\n  background: #000\n.w\n  position: absolute\n  left: 50px\n  top: 30px\n  width: 100px\n  height: 40px\n  background: #fff\n</style>\n`,
  'fl-decalage-cmy.mjs': `<div class="c" *chromatic(8, grow: 8, mode: cmy, duration: 0ms, on: always)><i class="w"></i></div>\n<style>\n.c\n  position: relative\n  width: 200px\n  height: 100px\n  margin: 30px\n  background: #000\n.w\n  position: absolute\n  left: 50px\n  top: 30px\n  width: 100px\n  height: 40px\n  background: #fff\n</style>\n`,
  'fl-decalage-image.mjs': `<img class="c" src="${FORME}" alt="" *chromatic(8, grow: 8, duration: 0ms, on: always)>\n<style>\n.c\n  display: block\n  margin: 30px\n</style>\n`,
  'fl-cathode.mjs': `<div class="d" *crt(4, opacity: 1, flicker: 0, roll: false, vignette: 0, glow: 0)></div>\n<style>\n.d\n  width: 200px\n  height: 100px\n  margin: 30px\n  background: #fff\n</style>\n`,
  'fl-cathode-bande.mjs': `<div class="d" *crt(4)></div>\n<style>\n.d\n  width: 200px\n  height: 100px\n  margin: 30px\n  background: #fff\n</style>\n`
}

type Px = { w: number, h: number, d: number[] }

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*liquid, *chromatic, *crt (${nom} réel) — des pixels`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-liquide-couleurs-ecran-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    // la page : fond gris (une balise devenue invisible laisse voir ce gris)
    async function ouvre(browser: any, tag: string, sel: string) {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#808080}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, s]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector(s), [tag, sel])
      await page.waitForTimeout(150)
      return { page, erreurs, tag, sel }
    }

    const boite = (o: any) => o.page.evaluate(([t, s]: string[]) => {
      const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }, [o.tag, o.sel])

    // la capture de la balise (avec une marge), lue pixel par pixel
    async function vu(o: any, marge = 20, fichier = ''): Promise<Px> {
      const r   = await boite(o)
      const x   = Math.max(0, r.x - marge)
      const y   = Math.max(0, r.y - marge)
      const buf = await o.page.screenshot({ clip: { x, y, width: Math.min(400 - x, r.width + 2 * marge), height: Math.min(300 - y, r.height + 2 * marge) } })
      if (fichier && process.env.MJS_FX_CAPTURES) {
        mkdirSync(process.env.MJS_FX_CAPTURES, { recursive: true })
        writeFileSync(join(process.env.MJS_FX_CAPTURES, `${nom}-${fichier}.png`), buf)
      }
      return o.page.evaluate(async (b64: string) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d') as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        return { w: img.width, h: img.height, d: Array.from(c.getImageData(0, 0, cv.width, cv.height).data) }
      }, buf.toString('base64'))
    }

    const compte = (p: Px, f: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < p.d.length; i += 4) if (f(p.d[i], p.d[i + 1], p.d[i + 2])) n++; return n }
    const ecart  = (a: Px, b: Px) => { let n = 0; for (let i = 0; i < a.d.length; i += 4) if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) > 90) n++; return n }
    const noirOuBlanc = (r: number, g: number, b: number) => (r < 40 && g < 40 && b < 40) || (r > 215 && g > 215 && b > 215)

    it('*liquid : l\'image survolée diffère de l\'image au repos, n\'est pas devenue invisible, et redevient nette', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-liquide', '.l')
        const repos = await vu(o, 40, 'liquide-repos')
        const r = await boite(o)
        await o.page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
        await o.page.waitForFunction(() => {
          const f: any = (document.querySelector('mjs-fl-liquide') as any)._shadow.querySelector('feDisplacementMap')
          return parseFloat(f.getAttribute('scale')) > 59
        })
        await o.page.waitForTimeout(150)
        const survol = await vu(o, 40, 'liquide-survol')
        assert.ok(ecart(repos, survol) > survol.d.length / 4 * 0.03, `pixels changés : ${ecart(repos, survol)} / ${survol.d.length / 4}`)
        assert.ok(compte(survol, noirOuBlanc) > 160 * 120 * 0.6, `image visible : ${compte(survol, noirOuBlanc)} pixels noirs ou blancs (160 × 120 attendus)`)
        await o.page.mouse.move(390, 290)
        await o.page.waitForFunction(() => !(document.querySelector('mjs-fl-liquide') as any)._shadow.querySelector('.l').hasAttribute('mjs-fx-liquid-on'))
        await o.page.waitForTimeout(100)
        const net = await vu(o, 40)
        assert.ok(ecart(repos, net) < repos.d.length / 4 * 0.005, `redevenue nette : ${ecart(repos, net)} pixels de différence`)
        assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
      } finally {
        await browser.close()
      }
    })

    it('*liquid(on: always, rest: 0.5) : déformée sans le survol, visible', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-liquide-fixe', '.l')
        const p = await vu(o, 40)
        assert.ok(compte(p, noirOuBlanc) > 160 * 120 * 0.6, `image visible : ${compte(p, noirOuBlanc)} pixels noirs ou blancs`)
        const brute = await o.page.evaluate(() => getComputedStyle((document.querySelector('mjs-fl-liquide-fixe') as any)._shadow.querySelector('.l')).filter)
        assert.match(brute, /url\(/, `filtre appliqué : ${brute}`)
      } finally {
        await browser.close()
      }
    })

    it('*chromatic : des franges rouges à gauche et bleues à droite d\'une forme blanche, la forme reste visible', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-decalage', '.c')
        const p = await vu(o, 20, 'decalage')
        const rouge = compte(p, (r, g, b) => r > 200 && g < 60 && b < 60)
        const bleu  = compte(p, (r, g, b) => b > 200 && r < 60 && g < 60)
        assert.ok(rouge > 100, `franges rouges : ${rouge}`)
        assert.ok(bleu > 100, `franges bleues : ${bleu}`)
        assert.ok(compte(p, (r, g, b) => r > 230 && g > 230 && b > 230) > 1500, 'la forme blanche est là')
        // le rouge est à gauche de la forme, le bleu à droite
        let moyR = 0, nR = 0, moyB = 0, nB = 0
        for (let i = 0; i < p.d.length; i += 4) {
          const x = (i / 4) % p.w
          if (p.d[i] > 200 && p.d[i + 1] < 60 && p.d[i + 2] < 60) { moyR += x; nR++ }
          if (p.d[i + 2] > 200 && p.d[i] < 60 && p.d[i + 1] < 60) { moyB += x; nB++ }
        }
        assert.ok(moyR / nR < moyB / nB, `rouge à gauche (${moyR / nR}), bleu à droite (${moyB / nB})`)
        assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
      } finally {
        await browser.close()
      }
    })

    it('*chromatic(mode: cmy) : des franges cyan et jaunes', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-decalage-cmy', '.c')
        const p = await vu(o, 20, 'decalage-cmy')
        assert.ok(compte(p, (r, g, b) => r < 60 && g > 200 && b > 200) > 100, 'cyan')
        assert.ok(compte(p, (r, g, b) => r > 200 && g > 200 && b < 60) > 100, 'jaune')
        assert.ok(compte(p, (r, g, b) => r > 230 && g > 230 && b > 230) > 1500, 'la forme blanche est là')
      } finally {
        await browser.close()
      }
    })

    it('*chromatic sur une <img> : les franges rouges et bleues y sont aussi', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-decalage-image', '.c')
        const p = await vu(o, 20, 'decalage-image')
        assert.ok(compte(p, (r, g, b) => r > 200 && g < 60 && b < 60) > 100, 'rouge')
        assert.ok(compte(p, (r, g, b) => b > 200 && r < 60 && g < 60) > 100, 'bleu')
        assert.ok(compte(p, (r, g, b) => r > 230 && g > 230 && b > 230) > 1500, 'la forme blanche est là')
      } finally {
        await browser.close()
      }
    })

    it('*crt : des lignes de balayage sombres sur un fond blanc, un calque qui ne capte pas les clics, la bande et le scintillement animés', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const o = await ouvre(browser, 'mjs-fl-cathode', '.d')
        const p = await vu(o, 0, 'cathode')
        // une colonne au milieu : environ un tiers des lignes sont sombres (1,33 px tous les 4 px)
        const x = Math.floor(p.w / 2)
        let sombres = 0, claires = 0
        for (let y = 20; y < p.h - 20; y++) {
          const l = p.d[(y * p.w + x) * 4]
          if (l < 140) sombres++
          if (l > 240) claires++
        }
        const n = p.h - 40
        assert.ok(sombres > n * 0.2 && sombres < n * 0.6, `lignes sombres : ${sombres} / ${n}`)
        assert.ok(claires > n * 0.3, `lignes claires : ${claires} / ${n}`)
        const pe = await o.page.evaluate(() => getComputedStyle((document.querySelector('mjs-fl-cathode') as any)._shadow.querySelector('[mjs-fx-layer="crt"]')).pointerEvents)
        assert.equal(pe, 'none')
        const o2 = await ouvre(browser, 'mjs-fl-cathode-bande', '.d')
        const anim = await o2.page.evaluate(() => {
          const l: any = (document.querySelector('mjs-fl-cathode-bande') as any)._shadow.querySelector('[mjs-fx-layer="crt"]')
          return { bande: l.querySelector('.mjs-fx-crt-roll').getAnimations().length, scint: l.querySelector('.mjs-fx-crt-flick').getAnimations().length }
        })
        assert.deepEqual(anim, { bande: 1, scint: 1 })
        assert.deepEqual(o.erreurs, [], o.erreurs.join(' | '))
      } finally {
        await browser.close()
      }
    })
  })
}
