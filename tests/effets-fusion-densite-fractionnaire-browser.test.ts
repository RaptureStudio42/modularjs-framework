// *blend aux densités d'écran fractionnaires (1,25, 1,5, 1,75) : Firefox met la page en page au pixel d'appareil mais le repère de
// son filtre commence au pixel CSS entier ; quand cette origine tombe entre deux pixels d'appareil il rasterise le filtre et la
// balise elle-même à un demi-pixel du calage, et les bords du calque se mélangent aux pixels voisins. Le cadre au pixel CSS entier
// y bave moins qu'un calage fin (mesuré sur une matrice de 39 formes et des boîtes tirées au hasard) : chaque boîte à coins arrondis
// est comparée à la même page sans *blend, et le nombre de pixels faux ne dépasse pas le plafond de sa forme. Chromium, qui cale
// ses boîtes au pixel d'appareil, tient les mêmes plafonds.

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

const G = '#b4b4b4'
const BLEND = '*blend(multiply, color: #ff0000, order: under)'
// des boîtes à coins arrondis à des positions entières de phases différentes (x et y modulo 4), et une grande
type Boite = { id: string, left: number, top: number, w: number, h: number, r: number, plafond: number }
const BOITES: Boite[] = [
  { id: 'a', left: 10, top: 10, w: 100, h: 60, r: 20, plafond: 20 },
  { id: 'b', left: 361, top: 10, w: 100, h: 60, r: 20, plafond: 170 },
  { id: 'c', left: 512, top: 11, w: 100, h: 60, r: 20, plafond: 120 },
  { id: 'd', left: 663, top: 12, w: 100, h: 60, r: 20, plafond: 45 },
  { id: 'e', left: 10, top: 100, w: 400, h: 200, r: 40, plafond: 250 }
]

function source(blend: boolean): string {
  const html = BOITES.map((b) => `<div class="b ${b.id}"${blend ? ' ' + BLEND : ''}></div>`).join('\n')
  const css = BOITES.map((b) => [`.${b.id}`, `  left: ${b.left}px`, `  top: ${b.top}px`, `  width: ${b.w}px`, `  height: ${b.h}px`, `  border-radius: ${b.r}px`].join('\n')).join('\n')
  return `${html}\n<style>\n.b\n  position: absolute\n  background: ${G}\n${css}\n</style>\n`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*blend (${nom} réel) — densités fractionnaires`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des densités fractionnaires de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-fraction-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-frac-bl.mjs'), source(true))
      writeFileSync(join(srcDir, 'fb-frac-rf.mjs'), source(false))
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function ouvre(contexte: any, tag: string) {
      const page = await contexte.newPage()
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.e'), tag)
      await page.waitForTimeout(700)
      return page
    }

    // pour chaque boîte : le nombre de pixels qui ne sont pas ce que la référence demande (gris → teinté, blanc → blanc), hors des
    // pixels de bord, que l'anticrénelage rend indécis dans la référence elle-même
    async function faux(dpr: number): Promise<Record<string, number>> {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const contexte = await browser.newContext({ viewport: { width: 900, height: 340 }, deviceScaleFactor: dpr })
        const ref      = await ouvre(contexte, 'mjs-fb-frac-rf')
        const bl       = await ouvre(contexte, 'mjs-fb-frac-bl')
        const a        = (await ref.screenshot({ fullPage: true })).toString('base64')
        const b        = (await bl.screenshot({ fullPage: true })).toString('base64')
        return await bl.evaluate(async ([a64, b64, boites, k]: [string, string, any[], number]) => {
          const charge                      = async (s: string) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height) }
          const A                           = await charge(a64)
          const B                           = await charge(b64)
          const W                           = A.width
          const gris                        = (p: Uint8ClampedArray, i: number) => Math.abs(p[i] - 180) <= 4 && Math.abs(p[i + 1] - 180) <= 4 && Math.abs(p[i + 2] - 180) <= 4
          const blanc                       = (p: Uint8ClampedArray, i: number) => p[i] >= 251 && p[i + 1] >= 251 && p[i + 2] >= 251
          const pur                         = (p: Uint8ClampedArray, i: number) => gris(p, i) || blanc(p, i)
          const teinte                      = (p: Uint8ClampedArray, i: number) => Math.abs(p[i] - 180) <= 14 && p[i + 1] <= 14 && p[i + 2] <= 14
          const out: Record<string, number> = {}
          for (const r of boites) {
            const x0 = Math.max(0, Math.round(r.left * k))
            const y0 = Math.max(0, Math.round(r.top * k))
            const x1 = Math.min(W, Math.round((r.left + r.w) * k))
            const y1 = Math.min(A.height, Math.round((r.top + r.h) * k))
            let n = 0
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const i = (y * W + x) * 4
              if (!pur(A.data, i)) continue
              let franc = true
              for (let dy = -1; dy <= 1 && franc; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; const yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= A.height) continue; if (!pur(A.data, (yy * W + xx) * 4)) { franc = false; break } }
              if (!franc) continue
              if (gris(A.data, i) ? !teinte(B.data, i) : !blanc(B.data, i)) n++
            }
            out[r.id] = n
          }
          return out
        }, [a, b, BOITES, dpr] as [string, string, any[], number])
      } finally {
        await browser.close()
      }
    }

    for (const dpr of [1.25, 1.5, 1.75]) {
      it(`densité ${String(dpr).replace('.', ',')} : les pixels faux de chaque boîte à coins arrondis tiennent sous le plafond de sa forme`, async function () {
        if (!present) { this.skip(); return }
        const n = await faux(dpr)
        if (process.env.MJS_TEST_TOTAUX) console.log(`FAUX ${nom} ${dpr} ${JSON.stringify(n)}`)
        const trop = BOITES.filter((b) => n[b.id] > b.plafond).map((b) => `${b.id} (${b.left}, ${b.top}, ${b.w} × ${b.h}) : ${n[b.id]} pixels faux, ${b.plafond} au plus`)
        assert.deepEqual(trop, [], `boîtes dont le calque bave :\n${trop.join('\n')}`)
      })
    }
  })
}
