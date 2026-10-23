// *blend : le calque suit une balise déjà rendue quand sa taille ou son réglage change, et la mosaïque
// tombe là où le dit son décalage. Chaque cas se lit sur des pixels précis d'une capture :
// - une écriture sideways (sideways-rl) dont la boîte est redimensionnée : l'observateur de taille donne
//   la largeur et la hauteur échangées dans cette écriture, il doit les remettre d'aplomb ;
// - un <svg> racine redimensionné : sa région et ses bornes suivent (dans Safari, elles se disent dans les
//   unités de son viewBox) ;
// - une mosaïque (fit: repeat) d'une tuile 8 × 8 rouge | bleu : la couleur de chaque colonne de la boîte
//   dit où commence la première tuile (dans Safari, l'image et son décalage se disent en fractions de la
//   boîte).
// Chromium, Firefox et WebKit (si PLAYWRIGHT_BROWSERS_PATH le donne).

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
const uri   = (b: Buffer) => 'data:image/png;base64,' + b.toString('base64')
const GRIS  = uri(png(8, 8, () => [180, 180, 180]))
// 8 × 8 : rouge sur les 4 premières colonnes, bleu sur les 4 suivantes
const TUILE = uri(png(8, 8, (x) => x < 4 ? [255, 0, 0] : [0, 0, 255]))

const SOURCES: Record<string, string> = {
  'fb-red-sideways.mjs': '<div class="s" *blend(multiply, color: #ff0000, order: under)></div>\n<i class="fin"></i>\n<style>\n.s\n  writing-mode: sideways-rl\n  width: 60px\n  height: 120px\n  margin: 10px\n  background: #b4b4b4\n</style>\n',
  'fb-red-svg.mjs': '<svg class="v" viewBox="0 0 24 24" width="100" height="60" *blend(multiply, color: #ff0000)><rect width="24" height="24" fill="#b4b4b4"></rect></svg>\n<i class="fin"></i>\n<style>\nsvg\n  display: block\n  margin: 10px\n</style>\n',
  'fb-red-mosaique.mjs': `<img class="m" src="${GRIS}" alt="" *blend(normal, image: '${TUILE}', fit: repeat)>\n<i class="fin"></i>\n<style>\nimg\n  display: block\n  width: 100px\n  height: 40px\n  margin: 10px\n</style>\n`
}

type Couleur = number[]

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*blend (${nom} réel) — le calque suit la taille et le décalage`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de suivi de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-redimension-' + nom)
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
        const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.fin'), tag)
        await page.waitForFunction((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete), tag)
        await page.waitForTimeout(1000)
        await fn(page)
      } finally {
        await browser.close()
      }
    }

    // la couleur du pixel `dx:dy` de la balise `classe`, mesurée dans la capture
    async function pixels(page: any, tag: string, classe: string, specs: string[]): Promise<Record<string, Couleur>> {
      const xy = await page.evaluate(([t, c, ss]: [string, string, string[]]) => {
        const r = (document.querySelector(t) as any)._shadow.querySelector('.' + c).getBoundingClientRect()
        return ss.map((s) => { const [dx, dy] = s.split(':'); return { s, x: Math.round(r.left + +dx), y: Math.round(r.top + +dy) } })
      }, [tag, classe, specs])
      const capture = (await page.screenshot({ fullPage: true })).toString('base64')
      return page.evaluate(async ([b64, ps]: [string, any[]]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const x = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
        x.drawImage(img, 0, 0)
        const out: Record<string, number[]> = {}
        for (const p of ps) { const d = x.getImageData(p.x, p.y, 1, 1).data; out[p.s] = [d[0], d[1], d[2]] }
        return out
      }, [capture, xy])
    }
    const proche = (c: Couleur, r: number, g: number, b: number, tol = 14) => Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol

    it('une balise en écriture sideways redimensionnée après coup : le calque couvre la nouvelle boîte, de bout en bout', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-red-sideways', async (page) => {
        const avant = await pixels(page, 'mjs-fb-red-sideways', 's', ['3:3', '56:3', '3:116', '56:116', '30:60'])
        for (const k of Object.keys(avant)) assert.ok(proche(avant[k], 180, 0, 0), `avant : ${k} ${avant[k]}`)
        await page.evaluate(() => { const s = (document.querySelector('mjs-fb-red-sideways') as any)._shadow.querySelector('.s'); s.style.width = '80px'; s.style.height = '140px' })
        await page.waitForTimeout(600)
        const apres = await pixels(page, 'mjs-fb-red-sideways', 's', ['3:3', '76:3', '3:136', '76:136', '40:70', '40:100'])
        const ecarts = Object.keys(apres).filter((k) => !proche(apres[k], 180, 0, 0)).map((k) => `${k} ${apres[k]}`)
        assert.deepEqual(ecarts, [], 'points de la boîte 80 × 140 qui ne sont pas fondus (180, 0, 0)')
        const dehors = await pixels(page, 'mjs-fb-red-sideways', 's', ['85:70', '40:145'])
        for (const k of Object.keys(dehors)) assert.ok(proche(dehors[k], 255, 255, 255), `hors de la boîte : ${k} ${dehors[k]}`)
      })
    })

    it('un <svg> racine élargi après coup : le calque couvre la nouvelle boîte, sans rien au-delà', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-red-svg', async (page) => {
        // le carré gris du dessin (viewBox 24 × 24, au milieu de la boîte) fondu : (180, 0, 0) ; la boîte autour,
        // sans dessin : le calque seul, (255, 0, 0)
        const lis = async (specs: Record<string, Couleur>, quand: string) => {
          const v = await pixels(page, 'mjs-fb-red-svg', 'v', Object.keys(specs))
          const ecarts = Object.keys(specs).filter((k) => !proche(v[k], specs[k][0], specs[k][1], specs[k][2])).map((k) => `${k} ${v[k]} au lieu de ${specs[k]}`)
          assert.deepEqual(ecarts, [], `${quand} : points de la boîte qui ne sont pas teintés`)
        }
        await lis({ '3:3': [255, 0, 0], '96:56': [255, 0, 0], '50:30': [180, 0, 0] }, 'avant (100 × 60)')
        // la largeur double, la hauteur reste : le carré du dessin (60 × 60) garde sa taille et se centre, les unités du
        // viewBox de la région et des bornes changent
        await page.evaluate(() => { const s = (document.querySelector('mjs-fb-red-svg') as any)._shadow.querySelector('.v'); s.setAttribute('width', '200') })
        await page.waitForTimeout(600)
        await lis({ '3:3': [255, 0, 0], '196:3': [255, 0, 0], '3:56': [255, 0, 0], '196:56': [255, 0, 0], '100:30': [180, 0, 0], '80:50': [180, 0, 0] }, 'après (200 × 60)')
        const dehors = await pixels(page, 'mjs-fb-red-svg', 'v', ['205:30', '100:65'])
        for (const k of Object.keys(dehors)) assert.ok(proche(dehors[k], 255, 255, 255), `hors de la boîte : ${k} ${dehors[k]}`)
      })
    })

    it('une mosaïque (tuile 8 × 8 rouge | bleu) : la couleur de chaque colonne dit où commence la première tuile, à sa taille naturelle', async function () {
      if (!present) { this.skip(); return }
      await avec('mjs-fb-red-mosaique', async (page) => {
        // boîte de 100 px, point au centre : la première tuile commence à ((100 − 8) × 0,5) mod 8 = 6
        const colonnes = [2, 3, 6, 7, 9, 10, 13, 14, 15, 18, 40, 41, 95]
        const v = await pixels(page, 'mjs-fb-red-mosaique', 'm', colonnes.map((x) => `${x}:20`))
        const attendu = (x: number) => (((x - 6) % 8) + 8) % 8 < 4 ? [255, 0, 0] : [0, 0, 255]
        const ecarts = colonnes.filter((x) => { const a = attendu(x); return !proche(v[`${x}:20`], a[0], a[1], a[2], 30) }).map((x) => `colonne ${x} : ${v[`${x}:20`]} au lieu de ${attendu(x)}`)
        assert.deepEqual(ecarts, [], 'colonnes dont la couleur n\'est pas celle de la tuile attendue')
      })
    })
  })
}
