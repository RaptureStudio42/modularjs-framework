// *filter dans Chromium, Firefox et WebKit réels : halftone, newsprint, scanlines et matrix gardent leur rendu
// à l'intérieur de la balise quand une ombre, un contour ou un enfant sorti de la boîte (en haut à gauche,
// ou par une marge négative) agrandit la région du filtre. Sans origine posée à 0 sur leurs primitives de
// remplissage, la sous-région prend la région du filtre, négative dès qu'il y a un débord, et la trame
// disparaît ou change de niveau. pixelate, tiltshift, vignette et polaroid (la lumière du vignettage) y ont le même
// garde. WebKit lit les fractions et les lumières sur la boîte qui englobe le débord
// (ombre, contour, enfants) : la trame doit y tomber au même endroit de la balise, débord ou non.

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

const STYLES = ['halftone', 'newsprint', 'scanlines', 'matrix', 'pixelate', 'tiltshift', 'vignette', 'polaroid']

// [libellé, classe de la balise, enfant sorti de la boîte]
const DEBORDS: [string, string, string][] = [
  ['une ombre de boîte', 'ombre', ''],
  ['un contour épais', 'contour', ''],
  ['un enfant sorti en haut à gauche', 'hg', '<div class="hg2"></div>'],
  ['un enfant à marge négative', 'mg', '<div class="mgn"></div>'],
  ['une ombre décalée au flou fractionnaire', 'od', '']
]

const CAS: { style: string, libelle: string, cl: string, enfant: string }[] = []
for (const style of STYLES) for (const [libelle, cl, enfant] of DEBORDS) CAS.push({ style, libelle, cl, enfant })

// pour chaque cas, une balise témoin sans rien qui déborde (a) et la même avec un débord (b)
const SOURCE = '<div class="g">\n'
  + CAS.map((c, i) => `<div class="w"><div class="bx a${i}" *filter(${c.style})></div></div>\n<div class="w"><div class="bx ${c.cl} b${i}" *filter(${c.style})>${c.enfant}</div></div>`).join('\n')
  + '\n</div>\n<style>\n.g\n  display: grid\n  grid-template-columns: repeat(2, 270px)\n  gap: 0\n'
  + '.w\n  box-sizing: border-box\n  width: 270px\n  height: 220px\n  padding: 60px 50px\n  background: #fff\n'
  + '.bx\n  position: relative\n  width: 150px\n  height: 80px\n  background: repeating-linear-gradient(0deg, #0006 0 2px, #0000 2px 5px), linear-gradient(90deg, #f4f4f4, #d33 55%, #222)\n'
  + '.ombre\n  box-shadow: 0 0 30px 10px #000\n'
  + '.od\n  box-shadow: 13px 9px 17px 2px #000\n'
  + '.contour\n  outline: 14px solid #06c\n'
  + '.hg2\n  position: absolute\n  left: -40px\n  top: -25px\n  width: 40px\n  height: 40px\n'
  + '.mgn\n  margin: 0 0 0 -35px\n  width: 80px\n  height: 40px\n</style>\n'

type Zone = { w: number, h: number, data: Buffer }

// la zone sans sa bande de bord de `m` pixels : un contour ou une ombre sont flous dans la balise sur quelques pixels, c'est voulu
function dedans(a: Zone, m: number): Zone {
  const w = a.w - 2 * m
  const h = a.h - 2 * m
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) a.data.copy(data, y * w * 4, ((y + m) * a.w + m) * 4, ((y + m) * a.w + m + w) * 4)
  return { w, h, data }
}

// l'écart moyen des trois canaux entre deux zones de même taille
function ecart(a: Zone, b: Zone): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let somme = 0
  for (let i = 0; i < a.data.length; i += 4) somme += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  return somme / (a.w * a.h * 3)
}

// le plus grand écart de canal, pixel à pixel
function maxi(a: Zone, b: Zone): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let m = 0
  for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[i + k] - b.data[i + k]))
  return m
}

// la plage de clarté de la zone : une balise toute blanche (ou toute noire) n'a plus de trame
function plage(a: Zone): number {
  let lo = 255, hi = 0
  for (let i = 0; i < a.data.length; i += 4) { const l = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l }
  return hi - lo
}

describe('*filter : halftone, newsprint, scanlines, matrix gardent leur rendu quand quelque chose déborde de la balise', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-filtre-sous-region-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-sr-page.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) console.log(`  ℹ️  ${nom} non installé, test de *filter sauté. Activer : \`npx playwright install ${nom}\``)
      })

      for (const dpr of [1, 2]) {
        it(`l'intérieur de la balise ne change pas avec un débord (écran à ${dpr} pixel${dpr > 1 ? 's' : ''} par pixel CSS)`, async function () {
          if (!present) { this.skip(); return }
          const lanceur = (await import('playwright'))[nom]
          const browser = await lanceur.launch()
          try {
            const ctx  = await browser.newContext({ viewport: { width: 560, height: 900 }, deviceScaleFactor: dpr })
            const page = await ctx.newPage()
            const erreurs: string[] = []
            page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
            page.on('pageerror', (e: any) => erreurs.push(String(e)))
            await page.route('http://t.test/**', (route: any) => {
              if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
              return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f0f}</style></head><body><mjs-fx-sr-page></mjs-fx-sr-page><script>${script}</script></body></html>` })
            })
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(() => !!(document.querySelector('mjs-fx-sr-page') as any)?._shadow?.querySelector('.b0'))
            await page.waitForTimeout(700)
            const classes = CAS.flatMap((_, i) => ['a' + i, 'b' + i])
            const rects = await page.evaluate((cs: string[]) => {
              const sh = (document.querySelector('mjs-fx-sr-page') as any)._shadow
              return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
            }, classes)
            const shot = await page.screenshot({ fullPage: true })
            const brut: Record<string, string> = await page.evaluate(async ([b64, rs, d]: [string, any[], number]) => {
              const img = new Image()
              img.src = 'data:image/png;base64,' + b64
              await img.decode()
              const cv = document.createElement('canvas')
              cv.width = img.width; cv.height = img.height
              const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
              c.drawImage(img, 0, 0)
              const out: Record<string, string> = {}
              for (const r of rs) {
                const data = c.getImageData(Math.round(r.x * d), Math.round(r.y * d), Math.round(r.w * d), Math.round(r.h * d)).data
                let texte = ''
                for (let i = 0; i < data.length; i += 8192) texte += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + 8192)))
                out[r.c] = btoa(texte)
              }
              return out
            }, [shot.toString('base64'), rects, dpr])
            await ctx.close()
            const z = (c: string): Zone => { const r = rects.find((q: any) => q.c === c); return { w: Math.round(r.w * dpr), h: Math.round(r.h * dpr), data: Buffer.from(brut[c], 'base64') } }
            const fautes: string[] = []
            const rendu: string[] = []
            CAS.forEach((c, i) => {
              const a = dedans(z('a' + i), 14 * dpr)
              const b = dedans(z('b' + i), 14 * dpr)
              const diff = ecart(a, b)
              const m = maxi(a, b)
              rendu.push(`${c.style}/${c.cl} moyen ${diff.toFixed(2)} max ${m}`)
              if (!(plage(a) > 20)) fautes.push(`${c.style} : la balise témoin est uniforme, le test ne mesure rien`)
              if (!(m <= 16 && diff < 1)) fautes.push(`${c.style} avec ${c.libelle} : l'intérieur de la balise change de ${m} niveaux au plus (${diff.toFixed(1)} en moyenne), plage de clarté ${plage(a).toFixed(0)} → ${plage(b).toFixed(0)}`)
            })
            console.log(`    ℹ️  ${nom} DPR ${dpr} : ${rendu.join(' ; ')}`)
            assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
            assert.deepEqual(erreurs, [])
          } finally {
            await browser.close()
          }
        })
      }
    })
  }
})
