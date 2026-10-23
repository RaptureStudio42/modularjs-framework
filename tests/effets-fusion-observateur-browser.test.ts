// *blend : l'observateur de visibilité (IntersectionObserver) n'est posé que sur une balise vraiment
// cachée. Au premier rendu d'un composant, son hôte est caché jusqu'à la fin du rendu : une balise visible
// n'a pas encore de boîte quand son effet se pose, et ne doit pas être observée pour autant (300 balises :
// 300 observateurs vivants tant qu'elles ne passent pas à l'écran). Une balise cachée est observée une
// fois, l'observateur part avec elle quand elle est retirée, et une balise visible qui se cache puis se
// montre en ligne se redessine. Chromium, Firefox et WebKit (si PLAYWRIGHT_BROWSERS_PATH le donne).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG gris uni de 8 × 8
function gris(): string {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (x: Buffer) => { let c = 0xffffffff; for (const v of x) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(8, 0); tete.writeUInt32BE(8, 4); tete[8] = 8; tete[9] = 2
  const brut = Buffer.alloc((8 * 3 + 1) * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = y * 25 + 1 + x * 3; brut[o] = 180; brut[o + 1] = 180; brut[o + 2] = 180 }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
  return 'data:image/png;base64,' + png.toString('base64')
}
const GRIS = gris()

// compte les observateurs posés sur une balise à effet *blend : `__ioTotal` posés, `__io` encore vivants
const HOOK = 'window.__io = 0; window.__ioTotal = 0; const O = window.IntersectionObserver; window.IntersectionObserver = class extends O { observe(el) { if (el.hasAttribute("mjs-fx-blend-use")) { this.mien = true; window.__io++; window.__ioTotal++ } return super.observe(el) } disconnect() { if (this.mien) { this.mien = false; window.__io-- } return super.disconnect() } }'

const ITEMS = Array.from({ length: 300 }, (_, i) => i)
const SOURCES: Record<string, string> = {
  'fb-obs-liste.mjs': `<script>\n$items = ${JSON.stringify(ITEMS)}\n</script>\n<div class="wrap">{for i in $items by i}<img class="g" src="${GRIS}" alt="" *blend(multiply, color: #ff0000)>{end}</div>\n<i class="fin"></i>\n<style>\nimg\n  display: block\n  width: 40px\n  height: 20px\n  margin: 2px\n</style>\n`,
  'fb-obs-retrait.mjs': '<script>\n$on = true\n</script>\n{if $on}<div class="h" *blend(multiply, color: #ff0000, order: under)></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<i class="fin"></i>\n<style>\n.h\n  display: none\n  width: 100px\n  height: 60px\n  background: #b4b4b4\n</style>\n',
  'fb-obs-cache.mjs': '<div class="v" *blend(multiply, color: #ff0000, order: under)>texte</div>\n<i class="fin"></i>\n<style>\n.v\n  width: 100px\n  height: 60px\n  background: #b4b4b4\n  font: 20px/30px sans-serif\n  color: #b4b4b4\n</style>\n'
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*blend (${nom} réel) — l'observateur de visibilité`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de l'observateur de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-observateur-' + nom)
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

    async function avec(tag: string, fn: (page: any) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 400, height: 600 } })
        await page.addInitScript(HOOK)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.fin'), tag)
        await page.waitForFunction((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete), tag)
        await page.waitForTimeout(1200)
        await fn(page)
      } finally {
        await browser.close()
      }
    }
    const io = (page: any) => page.evaluate(() => ({ vivants: (window as any).__io, poses: (window as any).__ioTotal }))

    it('300 balises *blend visibles au premier rendu : aucun observateur de visibilité n\'est posé', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-obs-liste', async (page) => {
        const filtres = await page.evaluate(() => (document.querySelector('mjs-fb-obs-liste') as any)._shadow.querySelectorAll('svg[mjs-fx-blend-svg]').length)
        assert.equal(filtres, 300, 'les 300 filtres sont posés')
        const n = await io(page)
        assert.deepEqual(n, { vivants: 0, poses: 0 }, 'une balise visible n\'est jamais observée')
      })
    })

    it('une balise cachée est observée une fois, et l\'observateur part avec elle quand elle est retirée', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-obs-retrait', async (page) => {
        assert.deepEqual(await io(page), { vivants: 1, poses: 1 }, 'la balise cachée est observée')
        await page.evaluate(() => (document.querySelector('mjs-fb-obs-retrait') as any)._shadow.querySelector('.t').click())
        await page.waitForFunction(() => !(document.querySelector('mjs-fb-obs-retrait') as any)._shadow.querySelector('.h'))
        await page.waitForTimeout(300)
        assert.deepEqual(await io(page), { vivants: 0, poses: 1 }, 'retirée, la balise ne laisse aucun observateur')
      })
    })

    it('une balise visible qui se cache attend une observation, puis se redessine quand elle est montrée en ligne', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-obs-cache', async (page) => {
        assert.deepEqual(await io(page), { vivants: 0, poses: 0 }, 'visible, elle n\'est pas observée')
        await page.evaluate(() => { ((document.querySelector('mjs-fb-obs-cache') as any)._shadow.querySelector('.v') as any).style.display = 'none' })
        await page.waitForTimeout(500)
        assert.deepEqual(await io(page), { vivants: 1, poses: 1 }, 'cachée, elle est observée')
        await page.evaluate(() => { ((document.querySelector('mjs-fb-obs-cache') as any)._shadow.querySelector('.v') as any).style.display = 'inline' })
        await page.waitForTimeout(800)
        assert.deepEqual(await io(page), { vivants: 0, poses: 1 }, 'montrée, elle n\'est plus observée')
        const png = (await page.screenshot({ fullPage: true })).toString('base64')
        const xy = await page.evaluate(() => { const r = ((document.querySelector('mjs-fb-obs-cache') as any)._shadow.querySelector('.v') as any).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width } })
        assert.ok(xy.w > 20 && xy.w < 100, `la balise est en ligne, plus étroite que sa boîte de départ (${xy.w})`)
        const c = await page.evaluate(async ([b64, p]: [string, { x: number, y: number }]) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const x = cv.getContext('2d') as CanvasRenderingContext2D
          x.drawImage(img, 0, 0)
          const d = x.getImageData(p.x, p.y, 1, 1).data
          return [d[0], d[1], d[2]]
        }, [png, xy])
        // le fond gris de la balise en ligne, fondu avec le calque rouge : (180, 0, 0) ; sans le redessin, rien ne la teinte
        assert.ok(c[0] > 150 && c[1] < 40 && c[2] < 40, `le centre de la balise en ligne est teinté : ${c}`)
      })
    })
  })
}
