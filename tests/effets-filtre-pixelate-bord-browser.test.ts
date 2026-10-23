// *filter(pixelate) dans Chromium, Firefox et WebKit réels : des pixels d'une capture. Quand le pavé ne divise pas la boîte
// (une image de 180 × 120 en pavés de 8, 24, 48, 7, 9), le dernier pavé de chaque rangée et de chaque colonne est partiel.
// Il laissait la page voir à travers (une bande transparente à droite et en bas : 2 % de l'image pour des pavés de 8, 6 %
// pour 24, 20 % pour 48, le plus grand permis) : le pixel d'échantillon se prend au milieu du pavé, et celui d'un pavé partiel plus étroit que
// sa moitié tombe hors de la boîte. Le dernier pavé est rempli, d'une seule couleur — celle de son échantillon, ou, quand
// il n'en a pas dans la boîte, celle du pavé qui le touche — et la page n'est visible nulle part. Le reste de l'image
// ne change pas d'un niveau de couleur.

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

// 90 × 60 : quatre quadrants, une rampe de clarté de gauche à droite, un trait sombre tous les 9 pixels (aucune couleur proche du magenta de la page)
const BASE  = [[220, 40, 40], [40, 200, 60], [40, 70, 220], [230, 210, 50]]
const IMAGE = png(90, 60, (x, y) => {
  if (x % 9 === 0) return [25, 25, 25]
  const c = BASE[(y < 30 ? 0 : 2) + (x < 45 ? 0 : 1)]
  const k = .6 + .4 * x / 89
  return c.map((v) => Math.round(v * k))
})

// classe → taille du pavé ; `p7`…`p9` : des tailles impaires et paires, `petite` : une boîte de 183 × 123 (aucun côté multiple)
const PAVES: Record<string, number> = { p8: 8, p24: 24, p48: 48, p7: 7, p9: 9, petite: 8 }

const SOURCE = Object.entries(PAVES).map(([c, s]) => `<img class="${c}" src="/test.png" alt="" *filter(pixelate, size: ${s})>`).join('\n') + '\n<style>\nimg\n  display: block\n  width: 180px\n  height: 120px\n  margin: 0 0 4px\n.petite\n  width: 183px\n  height: 123px\n</style>\n'

type Mesure = { bg: number, partiels: number, nonUnis: number, total: number }

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*filter(pixelate), le bord de l'image (${nom} réel) — des pixels`, function () {
    this.timeout(240000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de pixelate sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-filtre-pixelate-bord-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fx-px-page.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function essai(fn: (page: any, erreurs: string[]) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 220, height: 900 } })
        const erreurs: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          const url = route.request().url()
          if (url === 'http://t.test/test.png') return route.fulfill({ contentType: 'image/png', body: IMAGE })
          if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f0f}</style></head><body><mjs-fx-px-page></mjs-fx-px-page><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-px-page') as any)?._shadow?.querySelector('.p8'))
        await page.waitForFunction(() => Array.from((document.querySelector('mjs-fx-px-page') as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete))
        await page.waitForTimeout(600)
        await fn(page, erreurs)
      } finally {
        await browser.close()
      }
    }

    // pour chaque image : la part de page magenta qu'on voit à travers, et les pavés (partiels compris) qui ne sont pas d'une seule couleur
    // (le premier rang et la première colonne d'un pavé sont écartés : un pavé pair y déborde d'un pixel sur son voisin)
    async function mesures(page: any): Promise<Record<string, Mesure>> {
      const rects = await page.evaluate((cs: string[]) => {
        const sh = (document.querySelector('mjs-fx-px-page') as any)._shadow
        return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
      }, Object.keys(PAVES))
      const shot = await page.screenshot({ fullPage: true })
      return page.evaluate(async ([b64, rs, paves]: [string, any[], Record<string, number>]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const out: Record<string, any> = {}
        for (const r of rs) {
          const W = Math.round(r.w), H = Math.round(r.h), s = paves[r.c]
          const d = c.getImageData(Math.round(r.x), Math.round(r.y), W, H).data
          const px = (x: number, y: number) => { const i = (y * W + x) * 4; return d[i] << 16 | d[i + 1] << 8 | d[i + 2] }
          let bg = 0
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 7 && d[i + 1] < 7 && Math.abs(d[i + 2] - 255) < 7) bg++
          let partiels = 0, nonUnis = 0, total = 0
          for (let ty = 0; ty < H; ty += s) {
            for (let tx = 0; tx < W; tx += s) {
              const x1 = Math.min(tx + s, W), y1 = Math.min(ty + s, H)
              const partiel = x1 - tx < s || y1 - ty < s
              if (x1 - tx < 2 || y1 - ty < 2) continue
              total++
              if (partiel) partiels++
              const ref = px(tx + 1, ty + 1)
              let ok = true
              for (let y = ty + 1; y < y1 && ok; y++) for (let x = tx + 1; x < x1; x++) if (px(x, y) !== ref) { ok = false; break }
              if (!ok) nonUnis++
            }
          }
          out[r.c] = { bg: bg / (W * H), partiels, nonUnis, total }
        }
        return out
      }, [shot.toString('base64'), rects, PAVES])
    }

    it('aucune bande transparente à droite ni en bas : la page n\'est visible nulle part, pour des pavés de 8, 24, 48, 7 et 9 px', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page, erreurs) => {
        const m = await mesures(page)
        const visibles = Object.entries(m).filter(([, v]) => v.bg > 0).map(([c, v]) => `${c} (pavés de ${PAVES[c]}) : ${(v.bg * 100).toFixed(1)} % de page visible`)
        assert.deepEqual(visibles, [], visibles.join('\n') + '\n' + erreurs.join('\n'))
        assert.deepEqual(erreurs, [])
      })
    })

    // la bande dépend de la taille de la boîte : le filtre est refait quand elle change (la boîte passe de 180 à 188 px, puis à 195 px)
    it('la boîte change de taille : la bande suit, la page n\'est toujours visible nulle part', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        for (const largeur of [188, 195]) {
          await page.evaluate((l: number) => { ((document.querySelector('mjs-fx-px-page') as any)._shadow.querySelector('.p8') as HTMLElement).style.width = l + 'px' }, largeur)
          await page.waitForTimeout(500)
          const m = (await mesures(page)).p8
          assert.equal(m.bg, 0, `largeur ${largeur} px : ${(m.bg * 100).toFixed(1)} % de page visible`)
          assert.equal(m.nonUnis, 0, `largeur ${largeur} px : ${m.nonUnis} pavés sur ${m.total} ne sont pas unis`)
        }
      })
    })

    // le reste de l'image ne change pas : chaque pavé que l'ancienne construction (sans remplissage du bord) couvrait garde ses pixels au niveau
    // de couleur près ; seule la bande qu'elle laissait transparente change. L'ancienne construction est posée à côté, dans la page (hors de l'ombre :
    // un `url(#…)` ne sort pas de son shadow root)
    it('hors de la bande, les pixels sont ceux de la construction d\'avant', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await page.evaluate(([paves]: [number[]]) => {
          const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(navigator.userAgent)
          let html = '<svg width="0" height="0" aria-hidden="true" style="position:absolute">'
          for (const s of paves) {
            const c  = Math.floor(s / 2)
            const cp = `<feComposite width="${s}" height="${s}"/>`
            const up = webkit ? [`<feFlood width="1" height="1"/>`, cp, `<feTile/>`, `<feOffset dx="${c}" dy="${c}" result="fx-a"/>`] : [`<feFlood x="${c}" y="${c}" width="1" height="1"/>`, cp, `<feTile result="fx-a"/>`]
            html += `<filter id="ancien-${s}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` + up.concat(['<feComposite in="SourceGraphic" in2="fx-a" operator="in"/>', `<feMorphology operator="dilate" radius="${c}"/>`]).join('') + '</filter>'
          }
          html += '</svg>'
          for (const s of paves) html += `<img id="ancien-img-${s}" src="/test.png" alt="" style="display:block;width:180px;height:120px;margin:0 0 4px;filter:url(#ancien-${s})">`
          document.body.insertAdjacentHTML('beforeend', html)
        }, [[8, 24, 48, 7, 9]])
        await page.waitForFunction(() => Array.from(document.querySelectorAll('img[id^="ancien-img-"]')).every((i: any) => i.complete))
        await page.waitForTimeout(400)
        const paires: Array<[string, string, number]> = [['p8', 'ancien-img-8', 8], ['p24', 'ancien-img-24', 24], ['p48', 'ancien-img-48', 48], ['p7', 'ancien-img-7', 7], ['p9', 'ancien-img-9', 9]]
        const rects = await page.evaluate((ps: Array<[string, string, number]>) => {
          const sh = (document.querySelector('mjs-fx-px-page') as any)._shadow
          const r = (el: any) => { const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height } }
          return ps.map(([neuf, ancien, taille]) => ({ neuf: r(sh.querySelector('.' + neuf)), ancien: r(document.getElementById(ancien)!), taille, nom: neuf }))
        }, paires)
        const shot = await page.screenshot({ fullPage: true })
        const r = await page.evaluate(async ([b64, rs]: [string, any[]]) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const cv = document.createElement('canvas')
          cv.width = img.width; cv.height = img.height
          const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
          c.drawImage(img, 0, 0)
          const out: Record<string, any> = {}
          for (const q of rs) {
            const W = Math.round(q.neuf.w), H = Math.round(q.neuf.h)
            const n = c.getImageData(Math.round(q.neuf.x), Math.round(q.neuf.y), W, H).data
            const a = c.getImageData(Math.round(q.ancien.x), Math.round(q.ancien.y), W, H).data
            let couverts = 0, ecart = 0
            for (let i = 0; i < a.length; i += 4) {
              if (Math.abs(a[i] - 255) < 7 && a[i + 1] < 7 && Math.abs(a[i + 2] - 255) < 7) continue
              couverts++
              ecart = Math.max(ecart, Math.abs(a[i] - n[i]), Math.abs(a[i + 1] - n[i + 1]), Math.abs(a[i + 2] - n[i + 2]))
            }
            out[q.nom] = { couverts: couverts / (W * H), ecart }
          }
          return out
        }, [shot.toString('base64'), rects])
        const faux = Object.entries(r).filter(([, v]: [string, any]) => v.ecart > 0 || v.couverts < .5).map(([n, v]: [string, any]) => `${n} : écart ${v.ecart}, ${(v.couverts * 100).toFixed(0)} % de l'image couverte par l'ancienne construction`)
        assert.deepEqual(faux, [], faux.join('\n'))
      })
    })

    it('chaque pavé, le dernier de la rangée et de la colonne compris, est d\'une seule couleur', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const m = await mesures(page)
        const faux = Object.entries(m).filter(([, v]) => v.nonUnis > 0).map(([c, v]) => `${c} (pavés de ${PAVES[c]}) : ${v.nonUnis} pavés sur ${v.total} ne sont pas unis`)
        assert.deepEqual(faux, [], faux.join('\n'))
        const sansPartiel = Object.entries(m).filter(([, v]) => v.partiels === 0).map(([c]) => c)
        assert.deepEqual(sansPartiel, [], 'chaque image de ce test a des pavés partiels : sinon le test ne dit rien')
      })
    })
  })
}
