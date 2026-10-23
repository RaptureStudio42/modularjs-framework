// *ink dans Chromium réel : la planche de masque posée sur la balise, qui avance image par image
// (mask-position), puis rendue sans rien laisser ; l'image de masque à soi (le sombre apparaît
// d'abord) ; le repli en fondu, avec un seul avertissement, quand l'image est introuvable. Une vraie
// toile 2D et une vraie mise en page sont nécessaires : pas de happy-dom. Mesure aussi, pour chaque
// style, le temps de fabrication de la planche d'une balise de 1280 × 600.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG en niveaux de gris, 64 × 8 : du noir (à gauche) au blanc (à droite)
function degrade(): string {
  const w = 64, h = 8
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 0
  const brut = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) brut[y * (w + 1) + 1 + x] = Math.round(x / (w - 1) * 255)
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
  return 'data:image/png;base64,' + png.toString('base64')
}

const STYLES = ['blots', 'brush', 'wash', 'smoke', 'drip', 'dots', 'shards', 'swirl', 'tear', 'burn', 'frost', 'rain', 'cells', 'cracks', 'ripple', 'scribble', 'petals', 'glitch', 'topo', 'maze']
const NEUFS  = STYLES.slice(9)
const BOITE  = 'width: 400px\n  height: 200px\n  background: #0f0'
const style  = `<style>\n.b\n  ${BOITE}\n</style>\n`

const SOURCES: Record<string, string> = {
  'ink-a.mjs': `<div class="b" *ink(on: load, duration: 3s)>vert</div>\n${style}`,
  'ink-b.mjs': `<div class="b" *ink(on: load, duration: 600ms)>vert</div>\n${style}`,
  'ink-c.mjs': `<div class="b" *ink(image: '${degrade()}', on: load, duration: 3s)>vert</div>\n${style}`,
  'ink-d.mjs': `<div class="b" *ink(image: '/absente.png', on: load, duration: 3s)>vert</div>\n${style}`,
  'ink-e.mjs': `<div class="b" *ink(image: '/lente.png', on: load, duration: 300ms)>vert</div>\n${style}`,
  // une balise loin sous l'écran, puis la même à l'écran
  'ink-f.mjs': `<div class="loin"></div><div class="b" *ink(burn, on: view, duration: 600ms)>vert</div>\n<style>\n.loin\n  height: 4000px\n.b\n  ${BOITE}\n</style>\n`,
  'ink-g.mjs': `<div class="b" *ink(burn, on: view, duration: 600ms)>vert</div>\n${style}`
}

describe('*ink (Chromium réel) — le masque qui s\'étale', function () {
  this.timeout(120000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test de *ink sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-encre-masque-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  // la page à une vraie adresse (l'image '/absente.png' s'y résout en un 404), fond rouge
  async function ouvre(browser: any, tag: string, until = 'load') {
    const page = await browser.newPage()
    const avertissements: string[] = []
    page.on('console', (m: any) => { if (m.type() === 'warning' && m.text().includes('*ink')) avertissements.push(m.text()) })
    await page.route('http://t.test/**', (route: any) => {
      // une image de masque qui ne répond pas avant longtemps
      if (route.request().url() === 'http://t.test/lente.png') return void setTimeout(() => route.fulfill({ status: 404, body: '' }).catch(() => {}), 6000)
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f00}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: until })
    await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b'), tag)
    return { page, avertissements }
  }

  const lit = (page: any) => page.evaluate(() => {
    const b: any  = Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.b')).find(Boolean)
    const cs      = getComputedStyle(b)
    return { image: cs.maskImage || (cs as any).webkitMaskImage || '', position: cs.maskPosition || (cs as any).webkitMaskPosition || '', opacite: cs.opacity, enStyle: b.style.cssText }
  })

  // le rouge et le vert vus dans une zone de la boîte (x0..x1 en part de la largeur), par une capture
  async function vu(page: any, x0 = 0, x1 = 1) {
    const rect = await page.evaluate(() => {
      const b: any = Array.from(document.body.children).map((c: any) => c._shadow?.querySelector('.b')).find(Boolean)
      const r = b.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    })
    const png = await page.screenshot({ clip: { x: rect.x + rect.width * x0 + 4, y: rect.y + 4, width: rect.width * (x1 - x0) - 8, height: rect.height - 8 } })
    return page.evaluate(async (b64: string) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const c = cv.getContext('2d') as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      const d = c.getImageData(0, 0, cv.width, cv.height).data
      let vert = 0, rouge = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 200 && d[i] < 60) vert++
        else if (d[i] > 200 && d[i + 1] < 60) rouge++
      }
      return { vert, rouge, total: d.length / 4 }
    }, png.toString('base64'))
  }

  const posX = (s: string) => parseFloat(s)

  it('à mi-course : le masque est posé, avance, et la boîte montre du vert et du rouge ; à la fin plus rien sur la balise', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-a')
      await page.waitForFunction(() => {
        const b: any = (document.querySelector('mjs-ink-a') as any)._shadow.querySelector('.b')
        const p = parseFloat(getComputedStyle(b).maskPosition || (getComputedStyle(b) as any).webkitMaskPosition || '')
        return p > 30 && p < 70
      })
      const mi = await lit(page)
      assert.ok(mi.image.startsWith('url("data:image/png'), `maskImage : ${mi.image.slice(0, 40)}`)
      assert.ok(posX(mi.position) > 5 && posX(mi.position) < 95, `maskPosition : ${mi.position}`)
      const v = await vu(page)
      assert.ok(v.vert > 0, 'du vert à mi-course')
      assert.ok(v.rouge > 0, 'du rouge à mi-course')
      await page.waitForFunction(() => {
        const b: any = (document.querySelector('mjs-ink-a') as any)._shadow.querySelector('.b')
        return b.style.cssText === ''
      }, null, { timeout: 8000 })
      const fin = await lit(page)
      assert.equal(fin.enStyle, '')
      assert.ok(fin.image === 'none' || fin.image === '', `maskImage rendu : ${fin.image}`)
      const f = await vu(page)
      assert.equal(f.rouge, 0, 'plus de rouge à la fin')
      assert.ok(f.vert > f.total * 0.99, `${f.vert} / ${f.total} verts`)
    } finally {
      await browser.close()
    }
  })

  it('un jeu de 600 ms : fini, la boîte est toute verte et rien ne reste en style', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-b')
      await page.waitForTimeout(1500)
      const fin = await lit(page)
      assert.equal(fin.enStyle, '')
      const f = await vu(page)
      assert.equal(f.rouge, 0)
    } finally {
      await browser.close()
    }
  })

  it('image: un dégradé du noir au blanc : à mi-course, la moitié sombre est révélée, pas la claire', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-c')
      await page.waitForFunction(() => {
        const b: any = (document.querySelector('mjs-ink-c') as any)._shadow.querySelector('.b')
        const p = parseFloat(getComputedStyle(b).maskPosition || (getComputedStyle(b) as any).webkitMaskPosition || '')
        return p > 45 && p < 55
      })
      const gauche = await vu(page, 0, 0.25)
      const droite = await vu(page, 0.75, 1)
      assert.ok(gauche.vert > gauche.total * 0.9, `à gauche : ${gauche.vert} verts / ${gauche.total}`)
      assert.ok(droite.rouge > droite.total * 0.9, `à droite : ${droite.rouge} rouges / ${droite.total}`)
    } finally {
      await browser.close()
    }
  })

  it('image introuvable : repli en fondu (opacité intermédiaire à mi-course) et un seul avertissement', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page, avertissements } = await ouvre(browser, 'mjs-ink-d')
      await page.waitForFunction(() => {
        const b: any = (document.querySelector('mjs-ink-d') as any)._shadow.querySelector('.b')
        const o = parseFloat(getComputedStyle(b).opacity)
        return o > 0.25 && o < 0.75
      })
      const mi = await lit(page)
      assert.ok(mi.image === 'none' || mi.image === '', 'pas de masque en repli')
      await page.waitForFunction(() => (document.querySelector('mjs-ink-d') as any)._shadow.querySelector('.b').style.cssText === '', null, { timeout: 8000 })
      assert.equal(avertissements.length, 1, avertissements.join('\n'))
      assert.match(avertissements[0], /\/absente\.png/)
    } finally {
      await browser.close()
    }
  })

  it('image de masque pas encore arrivée à la fin du jeu : la balise est montrée, jamais laissée cachée', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-e', 'domcontentloaded')
      await page.waitForTimeout(1500)
      const vu = await page.evaluate(() => {
        const b: any = (document.querySelector('mjs-ink-e') as any)._shadow.querySelector('.b')
        return { opacite: getComputedStyle(b).opacity, style: b.style.cssText }
      })
      assert.equal(vu.opacite, '1', 'le jeu de 300 ms est fini depuis longtemps : la balise se voit')
      assert.equal(vu.style, '', 'rien ne reste en style')
    } finally {
      await browser.close()
    }
  })

  it('les onze styles neufs : une carte ni toute noire ni toute blanche, des valeurs de 0 à 255, une autre graine une autre carte', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-b')
      const bilan = await page.evaluate((styles: string[]) => {
        const µ: any = (window as any).µ
        const out: Record<string, any> = {}
        styles.forEach((s) => {
          const o = { seed: 3, angle: 135, ox: .5, oy: .5, count: 6 }
          const a = µ.anim.ink.inkMap(s, 512, 256, o)
          const b = µ.anim.ink.inkMap(s, 512, 256, { ...o, seed: 4 })
          const bins = new Array(10).fill(0)
          let diff = 0
          for (let i = 0; i < a.length; i++) {
            bins[Math.min(9, Math.floor(a[i] * 10))]++
            if (a[i] !== b[i]) diff++
          }
          out[s] = { bins: bins.map((n: number) => n / a.length), diff: diff / a.length }
        })
        return out
      }, NEUFS)
      for (const s of NEUFS) {
        const { bins, diff } = bilan[s]
        // le premier et le dernier dixième de la plage portent au moins 0,5 % de la carte, et chaque cinquième au moins 1 % :
        // le masque ne saute ni au début ni à la fin, ni au milieu (glitch avance par salves, donc par paliers)
        assert.ok(bins[0] >= 0.005 && bins[9] >= 0.005, `${s} : les bouts de la plage sont vides (${JSON.stringify(bins)})`)
        for (let q = 0; q < 5; q++) assert.ok(bins[2 * q] + bins[2 * q + 1] >= 0.01, `${s} : le cinquième ${q} de la plage est vide (${JSON.stringify(bins)})`)
        assert.ok(Math.max(...bins) < 0.5, `${s} : une valeur domine la carte (${JSON.stringify(bins)})`)
        assert.ok(diff > 0.1, `${s} : une autre graine donne presque la même carte (${diff})`)
      }
    } finally {
      await browser.close()
    }
  })

  // pourquoi ce test : la planche de masque coûte des dizaines de ms de calcul. Elle était fabriquée dès
  // l'attache de l'effet, même pour une balise loin sous l'écran (170 ms perdues au démarrage d'une page
  // qui en avait deux). Elle n'est préparée d'avance que pour une balise à l'écran ; hors écran, elle
  // attend le premier jeu, et l'effet joue alors comme avant
  it('une balise hors écran ne fabrique pas sa planche au démarrage ; elle la fabrique en arrivant à l\'écran et l\'effet joue', async function () {
    if (!present) this.skip()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const compte = async (tag: string) => {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        await page.route('http://t.test/**', (route: any) => route.request().url() !== 'http://t.test/'
          ? route.fulfill({ status: 404, body: '' })
          : route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f00}</style></head><body><script>window.__planches = 0; const _t = HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL = function() { window.__planches++; return _t.apply(this, arguments) }</script><${tag}></${tag}><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b'), tag)
        await page.waitForTimeout(300)
        return { page, planches: await page.evaluate(() => (window as any).__planches) }
      }
      const vue = await compte('mjs-ink-g')
      assert.ok(vue.planches >= 1, `balise à l'écran : planche fabriquée dès le démarrage (${vue.planches})`)
      const loin = await compte('mjs-ink-f')
      assert.equal(loin.planches, 0, 'balise hors écran : aucune planche fabriquée au démarrage')
      await loin.page.evaluate(() => window.scrollTo(0, 3800))
      await loin.page.waitForFunction(() => (window as any).__planches >= 1, null, { timeout: 5000 })
      const masque = await loin.page.waitForFunction(() => {
        const b: any = (document.querySelector('mjs-ink-f') as any)._shadow.querySelector('.b')
        const cs     = getComputedStyle(b)
        return (cs.maskImage || (cs as any).webkitMaskImage || '').startsWith('url(')
      }, null, { timeout: 5000 }).then(() => true, () => false)
      assert.ok(masque, 'arrivée à l\'écran : le masque est posé, l\'effet joue')
      await loin.page.waitForTimeout(1200)
      const fin = await loin.page.evaluate(() => (document.querySelector('mjs-ink-f') as any)._shadow.querySelector('.b').style.cssText)
      assert.equal(fin, '', 'fin du jeu : rien ne reste sur la balise')
    } finally {
      await browser.close()
    }
  })

  it('mesure : le temps de fabrication de la planche de chaque style, balise de 1280 × 600', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page } = await ouvre(browser, 'mjs-ink-b')
      const temps = await page.evaluate((styles: string[]) => {
        const µ: any = (window as any).µ
        const out: Record<string, number> = {}
        styles.forEach((s, i) => {
          const el = document.createElement('div')
          // hauteur propre à chaque style : jamais la planche d'un style déjà en cache
          el.style.cssText = 'width:1280px;height:600px;position:absolute;left:0;top:0'
          document.body.appendChild(el)
          const t0  = performance.now()
          const cfg = µ.anim.ink({ style: s, seed: 50 + i }).intro(el)
          cfg.tick(0.5)
          out[s] = Math.round(performance.now() - t0)
          if (!el.style.maskImage && !(el.style as any).webkitMaskImage) out[s] = -1
          cfg.cleanup()
          el.remove()
        })
        return out
      }, STYLES)
      console.log('  planche (ms, 1280 × 600) :', JSON.stringify(temps))
      for (const s of STYLES) assert.ok(temps[s] > 0, `${s} : planche non posée`)
      // borne relative : une machine chargée ralentit tous les styles, pas seulement les neufs
      const anciens = STYLES.filter((s) => !NEUFS.includes(s)).map((s) => temps[s])
      const borne   = Math.max(600, 4 * Math.max(...anciens))
      for (const s of NEUFS) assert.ok(temps[s] < borne, `${s} : ${temps[s]} ms, au-delà de ${borne} ms (la planche d'un style neuf reste du même ordre que celle des neuf premiers)`)
    } finally {
      await browser.close()
    }
  })
})
