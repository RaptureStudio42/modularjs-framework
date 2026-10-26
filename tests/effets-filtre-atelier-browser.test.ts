// *filter, l'atelier de retouche, dans Chromium, Firefox et WebKit réels : des pixels d'une capture. Une
// image de test colorée (quatre quadrants, une rampe de clarté, des traits) passe par chacun des 41
// styles : la balise est réellement modifiée (écart moyen avec l'image d'origine) ET jamais invisible
// (un filtre SVG invalide rend la balise invisible : on le voit à la page magenta derrière elle).
// Puis les propriétés de chaque effet (postérisation, seuil, pavés, vignette, lignes, bande nette…),
// la dose `amount`, les réglages fins, le fondu en CSS pur, la bascule d'un filtre SVG, la variable
// suivie sur place et le retrait sans reste.

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

// 90 × 60, affichée 180 × 120 : quatre quadrants (rouge, vert, bleu, jaune) assombris à gauche, éclaircis
// à droite (une rampe : beaucoup de couleurs distinctes), un trait sombre vertical tous les 9 pixels
const BASE  = [[220, 40, 40], [40, 200, 60], [40, 70, 220], [230, 210, 50]]
const IMAGE = png(90, 60, (x, y) => {
  if (x % 9 === 0) return [25, 25, 25]
  const c = BASE[(y < 30 ? 0 : 2) + (x < 45 ? 0 : 1)]
  const k = .6 + .4 * x / 89
  return c.map((v) => Math.round(v * k))
})

const STYLES = [
  'grayscale', 'sepia', 'vintage', 'noir', 'warm', 'cool', 'vivid', 'faded', 'dramatic', 'duotone', 'blur', 'invert',
  'polaroid', 'lomo', 'kodachrome', 'technicolor', 'cyberpunk', 'sunset', 'night', 'nightvision', 'thermal', 'xray', 'newsprint', 'bleach', 'cross', 'pastel', 'matrix',
  'posterize', 'threshold', 'sharpen', 'emboss', 'edges', 'chromatic', 'pixelate', 'grain', 'halftone', 'vignette', 'tiltshift', 'bloom', 'ripple', 'scanlines'
]

// `vigtop` est la première balise de la page, au coin (0, 0) : seule une lumière lue en coordonnées de page y tombe juste
const IMGS = [
  '<img class="vigtop" src="/test.png" alt="" *filter(vignette)>',
  '<img class="ref" src="/test.png" alt="">',
  ...STYLES.map((s) => `<img class="s-${s}" src="/test.png" alt="" *filter(${s})>`),
  '<img class="zero" src="/test.png" alt="" *filter(pixelate, amount: 0)>',
  '<img class="zero2" src="/test.png" alt="" *filter(polaroid, amount: 0)>',
  '<img class="demi" src="/test.png" alt="" *filter(posterize, amount: .5)>',
  '<img class="posters" src="/test.png" alt="" *filter(posterize, levels: 2)>',
  '<img class="pixels" src="/test.png" alt="" *filter(pixelate, size: 24)>',
  '<img class="vigfort" src="/test.png" alt="" *filter(vignette, strength: 2, radius: 10)>',
  '<img class="tritone" src="/test.png" alt="" *filter(duotone, colors: [#000000, #ff0000, #ffffff])>',
  '<img class="fins" src="/test.png" alt="" *filter(brightness: 1.5, hue: 90)>',
  '<img class="cumul" src="/test.png" alt="" *filter(sepia, contrast: 1.6)>',
  '<img class="rien" src="/test.png" alt="" *filter(none)>',
  '<img class="surv" src="/test.png" alt="" *filter(sepia, on: hover, duration: 1s)>',
  '<img class="survsvg" src="/test.png" alt="" *filter(posterize, on: hover, duration: 1s)>',
  '<div class="boite" *filter(posterize, levels: 2)><b>texte</b></div>',
  '<@fx-fa-carte class="hote" *filter(threshold)></@fx-fa-carte>',
  '<img class="ombre" src="/test.png" alt="" *filter(none, shadow: \'6px 6px 0 #000\')>',
  '<img class="duocc" src="/test.png" alt="" *filter(duotone, colors: [currentColor, #ffffff])>',
  '<img class="duovar" src="/test.png" alt="" *filter(duotone, colors: [var(--ton), #ffffff])>'
]

const SOURCES: Record<string, string> = {
  'fx-fa-page.mjs': IMGS.join('\n') + '\n<style>\nimg\n  display: block\n  width: 180px\n  height: 120px\n  margin: 0 0 4px\n.boite\n  width: 180px\n  height: 60px\n  background: #d33\n  margin: 0 0 4px\n.hote\n  display: block\n.ombre\n  margin-bottom: 30px\n.duocc\n  color: rgb(51, 102, 153)\n.duovar\n  --ton: rgb(51, 102, 153)\n</style>\n',
  'fx-fa-carte.mjs': '<div class="c"></div>\n<style>\n.c\n  width: 180px\n  height: 60px\n  background: linear-gradient(90deg, #111, #eee)\n</style>\n',
  'fx-fa-suite.mjs': '<script>\n$l = 1\n$n = 6\n</script>\n<img class="v" src="/test.png" alt="" *filter(brightness: $l)>\n<img class="w" src="/test.png" alt="" *filter(posterize, levels: $n)>\n<button class="t" @click={$l = 0.4; $n = 2}>t</button>\n<style>\nimg\n  display: block\n  width: 180px\n  height: 120px\n</style>\n',
  'fx-fa-retrait.mjs': '<script>\n$on = true\n</script>\n{if $on}<img class="a" src="/test.png" alt="" *filter(lomo)>{end}\n{if $on}<img class="b" src="/test.png" alt="" *filter(sepia)>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\nimg\n  display: block\n  width: 180px\n  height: 120px\n</style>\n'
}

type Stat = { diff: number, bg: number, mean: number[], gris: number, binaire: number, niveaux: number, egal: number, distinct: number, bruit: number, bande: number[], centre: number, coin: number, lignes: number, ac: Record<number, number>, noir: number, noirG: number, noirD: number }

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*filter, l'atelier (${nom} réel) — des pixels`, function () {
    this.timeout(240000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de *filter sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-filtre-atelier-browser-' + nom)
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

    async function ouvre(browser: any, tag: string, classe: string) {
      const page = await browser.newPage({ viewport: { width: 220, height: 800 } })
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      await page.route('http://t.test/**', (route: any) => {
        const url = route.request().url()
        if (url === 'http://t.test/test.png') return route.fulfill({ contentType: 'image/png', body: IMAGE })
        if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f0f}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
      await page.waitForFunction((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelectorAll('img')).every((i: any) => i.complete), tag)
      await page.waitForTimeout(600)
      return { page, erreurs }
    }

    // pour chaque classe : ce qu'on voit de la balise comparé à `ref` (l'image sans filtre)
    async function vu(page: any, tag: string, classes: string[], ref = 'ref'): Promise<Record<string, Stat>> {
      const rects = await page.evaluate(([t, cs]: [string, string[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
      }, [tag, [ref, ...classes]])
      const shot = await page.screenshot({ fullPage: true })
      return page.evaluate(async ([b64, rs]: [string, any[]]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const lis = (r: any) => c.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)).data
        const ref = lis(rs[0])
        const out: Record<string, any> = {}
        for (const r of rs.slice(1)) {
          const d = lis(r)
          const n = d.length / 4
          const W = Math.round(r.w), H = Math.round(r.h)
          let diff = 0, bg = 0, gris = 0, binaire = 0, niveaux = 0, bruit = 0, egal = 0
          const mean = [0, 0, 0]
          const set = new Set<number>()
          const bande = [0, 0, 0, 0, 0], nb = [0, 0, 0, 0, 0]
          let centre = 0, coin = 0, rc = 0, rk = 0
          const lum = (a: any, i: number) => .2126 * a[i] + .7152 * a[i + 1] + .0722 * a[i + 2]
          const lignes = new Array(H).fill(0)
          const LAGS = [3, 5, 7, 10], ac = LAGS.map(() => 0), acn = LAGS.map(() => 0)
          let noir = 0, noirG = 0
          for (let i = 0; i < d.length; i += 4) {
            const px = i / 4, x = px % W, y = Math.floor(px / W)
            const e = (Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2])) / 3
            diff += e
            bande[Math.min(4, Math.floor(y / (H / 5)))] += e
            nb[Math.min(4, Math.floor(y / (H / 5)))]++
            if (Math.abs(d[i] - 255) < 7 && d[i + 1] < 7 && Math.abs(d[i + 2] - 255) < 7) bg++
            mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]
            if (Math.abs(d[i] - d[i + 1]) < 6 && Math.abs(d[i + 1] - d[i + 2]) < 6) gris++
            if (d[i] <= 25 && d[i + 1] <= 25 && d[i + 2] <= 25 || d[i] >= 230 && d[i + 1] >= 230 && d[i + 2] >= 230) binaire++
            if ([d[i], d[i + 1], d[i + 2]].every((v) => [0, 85, 170, 255].some((l) => Math.abs(v - l) <= 4))) niveaux++
            set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2])
            if (x > 0 && d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2]) egal++
            const dl = lum(d, i) - lum(ref, i)
            bruit += dl * dl
            lignes[y] += dl
            LAGS.forEach((g, k) => { if (x + g < W) { ac[k] += Math.abs(lum(d, i) - lum(d, i + 4 * g)); acn[k]++ } })
            if (d[i] <= 40 && d[i + 1] <= 40 && d[i + 2] <= 40) { noir++; if (x < W / 2) noirG++ }
            if (x > W * .4 && x < W * .6 && y > H * .4 && y < H * .6) { centre += lum(d, i); rc += lum(ref, i) }
            if ((x < W * .12 || x > W * .88) && (y < H * .12 || y > H * .88)) { coin += lum(d, i); rk += lum(ref, i) }
          }
          out[r.c] = {
            diff: diff / n, bg: bg / n, mean: mean.map((v) => v / n), gris: gris / n, binaire: binaire / n, niveaux: niveaux / n, egal: egal / n,
            distinct: set.size, bruit: Math.sqrt(bruit / n), bande: bande.map((v, k) => v / nb[k]),
            centre: centre / Math.max(1, rc), coin: coin / Math.max(1, rk), lignes: lignes.map((v) => v / W),
            ac: Object.fromEntries(LAGS.map((g, k) => [g, ac[k] / Math.max(1, acn[k])])), noir: noir / n, noirG: noirG / (n / 2), noirD: (noir - noirG) / (n / 2)
          }
        }
        return out
      }, [shot.toString('base64'), rects])
    }

    // les pixels bruts de chaque balise (le cadrage de la capture) : pour comparer la même balise à deux endroits de la page
    async function pixels(page: any, tag: string, classes: string[]): Promise<Record<string, Buffer>> {
      const rects = await page.evaluate(([t, cs]: [string, string[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
      }, [tag, classes])
      const shot = await page.screenshot({ fullPage: true })
      const brut: Record<string, string> = await page.evaluate(async ([b64, rs]: [string, any[]]) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
        c.drawImage(img, 0, 0)
        const out: Record<string, string> = {}
        for (const r of rs) {
          const d = c.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)).data
          let texte = ''
          for (let i = 0; i < d.length; i += 8192) texte += String.fromCharCode.apply(null, Array.from(d.subarray(i, i + 8192)))
          out[r.c] = btoa(texte)
        }
        return out
      }, [shot.toString('base64'), rects])
      return Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, Buffer.from(v, 'base64')]))
    }

    async function essai(fn: (page: any, erreurs: string[]) => Promise<void>, tag = 'mjs-fx-fa-page', classe = 'ref') {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const { page, erreurs } = await ouvre(browser, tag, classe)
        await fn(page, erreurs)
      } finally {
        await browser.close()
      }
    }

    it('chacun des 41 styles modifie réellement la balise, et la balise ne devient jamais invisible', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page, erreurs) => {
        const v = await vu(page, 'mjs-fx-fa-page', STYLES.map((s) => 's-' + s))
        const rendu: string[] = []
        const faux: string[] = []
        for (const s of STYLES) {
          const x = v['s-' + s]
          rendu.push(`${s} ${x.diff.toFixed(1)}`)
          if (x.bg > .5) faux.push(`${s} : balise invisible (${(x.bg * 100).toFixed(0)} % de page magenta)`)
          else if (x.diff < 1.2) faux.push(`${s} : balise inchangée (écart ${x.diff.toFixed(2)})`)
        }
        console.log(`    ℹ️  ${nom} : écart moyen avec l'original — ${rendu.join(' ; ')}`)
        assert.deepEqual(faux, [], faux.join('\n') + '\n' + erreurs.join('\n'))
        assert.deepEqual(erreurs, [])
      })
    })

    it('les ambiances en CSS pur : grayscale rend des gris, invert inverse', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fx-fa-page', ['s-grayscale', 's-invert', 'rien'])
        assert.ok(v['s-grayscale'].gris > .99, `gris : ${v['s-grayscale'].gris}`)
        assert.ok(v['s-invert'].diff > 60, `négatif : ${v['s-invert'].diff}`)
        assert.ok(v.rien.diff < .5, `none : l'image d'origine (${v.rien.diff})`)
      })
    })

    it('chaque effet fait ce qu\'il dit : niveaux, seuil, pavés, trame, vignette, lignes, bande nette, grain, lueur, relief', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fx-fa-page', ['s-posterize', 'posters', 's-threshold', 's-pixelate', 'pixels', 's-halftone', 's-newsprint', 's-vignette', 'vigfort', 's-scanlines', 's-tiltshift', 's-grain', 's-bloom', 's-emboss', 's-edges', 's-sharpen', 's-chromatic', 's-ripple', 's-duotone', 'ref'])
        const ref = v.ref
        assert.ok(v['s-posterize'].niveaux > .9, `posterize (4 niveaux) : ${v['s-posterize'].niveaux}`)
        assert.ok(v.posters.binaire > .9 || v.posters.niveaux > .9, `posterize (2 niveaux) : ${v.posters.niveaux}`)
        assert.ok(v['s-threshold'].binaire > .9 && v['s-threshold'].gris > .98, `seuil : ${v['s-threshold'].binaire} noir et blanc, ${v['s-threshold'].gris} gris`)
        assert.ok(ref.egal < .6, `l'original : ${ref.egal} de voisins identiques`)
        assert.ok(v['s-pixelate'].egal > .8, `pavés de 8 : ${v['s-pixelate'].egal} de voisins identiques (7/8 attendus)`)
        assert.ok(v.pixels.egal > v['s-pixelate'].egal && v.pixels.egal > .9, `pavés de 24 : ${v.pixels.egal} (23/24 attendus)`)
        assert.ok(v['s-pixelate'].bg < .2 && v.pixels.bg < .3, `pavés : la balise reste visible (${v['s-pixelate'].bg} et ${v.pixels.bg} de page magenta)`)
        assert.ok(v['s-halftone'].binaire > .6, `trame : ${v['s-halftone'].binaire} de noir ou blanc`)
        // la trame se répète tous les `size` px : l'écart de luminance à 10 px est faible, à 5 px fort ; il y a des points noirs
        const h = v['s-halftone']
        assert.ok(h.ac[10] < h.ac[5] * .4 && h.noir > .15, `trame de 10 px : écart à 10 px ${h.ac[10].toFixed(0)}, à 5 px ${h.ac[5].toFixed(0)}, ${h.noir.toFixed(2)} de noir`)
        // la moitié gauche de l'image est sombre, la droite claire : la trame y met beaucoup plus de noir (un flou mal mis à l'échelle l'efface)
        assert.ok(h.noirG > h.noirD * 2, `trame : ${h.noirG.toFixed(2)} de noir à gauche (sombre), ${h.noirD.toFixed(2)} à droite (clair)`)
        const n = v['s-newsprint']
        assert.ok(n.ac[7] < Math.min(n.ac[3], n.ac[5]) * .4 && n.noir > .15, `newsprint (trame de 7 px) : écart à 7 px ${n.ac[7].toFixed(0)}, à 3 px ${n.ac[3].toFixed(0)}, à 5 px ${n.ac[5].toFixed(0)}, ${n.noir.toFixed(2)} de noir`)
        assert.ok(n.noirG > n.noirD * 2, `newsprint : ${n.noirG.toFixed(2)} de noir à gauche (sombre), ${n.noirD.toFixed(2)} à droite (clair)`)
        assert.ok(v['s-vignette'].coin < v['s-vignette'].centre - .12, `vignette : coins ${v['s-vignette'].coin.toFixed(2)}, centre ${v['s-vignette'].centre.toFixed(2)}`)
        assert.ok(v['s-vignette'].centre > .93, `vignette : le centre reste clair (${v['s-vignette'].centre})`)
        assert.ok(v.vigfort.coin < v['s-vignette'].coin, 'strength: 2 assombrit plus')
        // lignes : un rang sur 4 est plus sombre que l'original
        const sombres = v['s-scanlines'].lignes.filter((d) => d < -8).length
        assert.ok(sombres >= 25 && sombres <= 35, `scanlines (gap 4, 120 lignes) : ${sombres} lignes sombres`)
        // tilt-shift : le haut est flou (écart fort), le milieu net (écart faible)
        const t = v['s-tiltshift'].bande
        assert.ok(t[0] > 2 && t[2] < t[0] * .6, `tilt-shift : écart par bande ${t.map((x) => x.toFixed(1)).join(' ')}`)
        assert.ok(v['s-grain'].bruit > 3, `grain : bruit ${v['s-grain'].bruit}`)
        const clair = (x: Stat) => x.mean[0] + x.mean[1] + x.mean[2]
        assert.ok(clair(v['s-bloom']) > clair(ref) + 3, `lueur : plus clair (${clair(v['s-bloom'])} contre ${clair(ref)})`)
        assert.ok(v['s-emboss'].gris > .9, `relief : gris (${v['s-emboss'].gris})`)
        assert.ok(v['s-edges'].diff > 20, `contours : ${v['s-edges'].diff}`)
        assert.ok(v['s-ripple'].diff > 5, `ondulation : ${v['s-ripple'].diff}`)
        assert.ok(v['s-duotone'].diff > 20, `duotone : ${v['s-duotone'].diff}`)
      })
    })

    it('amount : 0 = l\'image d\'origine (SVG compris), 0.5 entre les deux ; le tritone et les réglages fins se cumulent', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fx-fa-page', ['zero', 'zero2', 'demi', 's-posterize', 'tritone', 'fins', 'cumul', 's-sepia', 'ombre'])
        assert.ok(v.zero.diff < .8, `pixelate amount 0 : ${v.zero.diff}`)
        assert.ok(v.zero2.diff < .8, `polaroid amount 0 : ${v.zero2.diff}`)
        assert.ok(v.demi.diff > 1 && v.demi.diff < v['s-posterize'].diff, `posterize amount .5 : ${v.demi.diff} entre 0 et ${v['s-posterize'].diff}`)
        assert.ok(v.tritone.diff > 20 && v.tritone.mean[0] > v.tritone.mean[2], `tritone : rouge dominant ${JSON.stringify(v.tritone.mean)}`)
        assert.ok(v.fins.diff > 20, `brightness + hue : ${v.fins.diff}`)
        assert.ok(v.cumul.diff > v['s-sepia'].diff * .5 && v.cumul.diff !== v['s-sepia'].diff, `sepia + contrast : ${v.cumul.diff} contre sepia ${v['s-sepia'].diff}`)
        assert.ok(v.ombre.bg < .5, `ombre portée : balise visible (${v.ombre.bg})`)
      })
    })

    it('un composant et une <div> à fond coloré : le filtre passe par la propriété filter, comme sur une image', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const v = await vu(page, 'mjs-fx-fa-page', ['boite', 'hote'], 'ref')
        assert.ok(v.boite.bg < .5 && v.boite.niveaux > .95 && v.boite.diff > 3, `div posterize levels 2 : ${JSON.stringify(v.boite.mean)} niveaux ${v.boite.niveaux}`)
        assert.ok(v.hote.bg < .5 && v.hote.binaire > .6, `composant threshold : noir et blanc ${v.hote.binaire}`)
      })
    })

    it('au survol : en CSS pur le fondu est progressif ; en filtre SVG la bascule est d\'un coup', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const pos = (c: string) => page.evaluate((cl: string) => { const e = (document.querySelector('mjs-fx-fa-page') as any)._shadow.querySelector('.' + cl); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, c)
        const repos = await vu(page, 'mjs-fx-fa-page', ['surv', 'survsvg'])
        assert.ok(repos.surv.diff < .8 && repos.survsvg.diff < .8, `au repos : l'original (${repos.surv.diff}, ${repos.survsvg.diff})`)
        const p = await pos('surv')
        await page.mouse.move(p.x, p.y)
        await page.waitForTimeout(350)
        const milieu = await vu(page, 'mjs-fx-fa-page', ['surv'])
        await page.waitForTimeout(1300)
        const fin = await vu(page, 'mjs-fx-fa-page', ['surv'])
        assert.ok(milieu.surv.diff > 1 && milieu.surv.diff < fin.surv.diff * .8, `fondu CSS : ${milieu.surv.diff.toFixed(1)} au tiers, ${fin.surv.diff.toFixed(1)} à la fin`)
        const q = await pos('survsvg')
        await page.mouse.move(q.x, q.y)
        await page.waitForTimeout(350)
        const svgMilieu = await vu(page, 'mjs-fx-fa-page', ['survsvg'])
        await page.waitForTimeout(1300)
        const svgFin = await vu(page, 'mjs-fx-fa-page', ['survsvg'])
        console.log(`    ℹ️  ${nom} : filtre SVG au survol — ${svgMilieu.survsvg.diff.toFixed(1)} au tiers, ${svgFin.survsvg.diff.toFixed(1)} à la fin`)
        assert.ok(svgFin.survsvg.diff > 5, 'le filtre SVG s\'applique au survol')
        await page.mouse.move(215, 3)
        await page.waitForTimeout(1500)
        const apres = await vu(page, 'mjs-fx-fa-page', ['surv', 'survsvg'])
        assert.ok(apres.surv.diff < .8 && apres.survsvg.diff < .8, `après le survol : l'original (${apres.surv.diff}, ${apres.survsvg.diff})`)
      })
    })

    it('une variable (`brightness: $l`, `levels: $n`) : la valeur suit sur place, le nœud du filtre SVG reste le même', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const avant = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fx-fa-suite') as any)._shadow
          const f = sh.querySelector('filter')
          ;(window as any).__f = f
          return { n: sh.querySelectorAll('svg').length, v: getComputedStyle(sh.querySelector('.v')).filter, valeur: sh.querySelector('.v').style.getPropertyValue('--mjs-fx-filter-value') }
        })
        assert.equal(avant.n, 1)
        assert.equal(avant.valeur, 'brightness(1)')
        // pendant le changement, aucune image n'est vue invisible
        await page.evaluate(() => (document.querySelector('mjs-fx-fa-suite') as any)._shadow.querySelector('.t').click())
        await page.waitForTimeout(80)
        const apres = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fx-fa-suite') as any)._shadow
          return { meme: sh.querySelector('filter') === (window as any).__f, n: sh.querySelectorAll('svg').length, valeur: sh.querySelector('.v').style.getPropertyValue('--mjs-fx-filter-value'), niveaux: sh.querySelector('feFuncR').getAttribute('tableValues') }
        })
        assert.equal(apres.meme, true, 'même nœud filtre')
        assert.equal(apres.n, 1)
        assert.equal(apres.valeur, 'brightness(0.4)')
        assert.equal(apres.niveaux, '0 1', 'levels: 2')
      }, 'mjs-fx-fa-suite', 'v')
    }
    )

    it('le retrait ne laisse rien : ni <svg>, ni variable, ni marque ; l\'image revient telle quelle', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const dedans = await page.evaluate(() => (document.querySelector('mjs-fx-fa-retrait') as any)._shadow.querySelectorAll('svg').length)
        assert.equal(dedans, 1)
        await page.evaluate(() => (document.querySelector('mjs-fx-fa-retrait') as any)._shadow.querySelector('.t').click())
        await page.waitForFunction(() => !(document.querySelector('mjs-fx-fa-retrait') as any)._shadow.querySelector('.a'))
        await page.waitForTimeout(100)
        const reste = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fx-fa-retrait') as any)._shadow
          return { svg: sh.querySelectorAll('svg').length, filtre: sh.querySelectorAll('filter').length, marques: sh.querySelectorAll('[mjs-fx],[mjs-fx-on]').length }
        })
        assert.deepEqual(reste, { svg: 0, filtre: 0, marques: 0 })
      }, 'mjs-fx-fa-retrait', 'a')
    })

    it('la place de la balise sur la page ne change rien : la même image, plus bas et plus à droite, rend les mêmes pixels (les styles sans bruit)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        // le bruit (grain, bleach, ripple : feTurbulence) est tiré en coordonnées de page par WebKit : le motif change, pas l'aspect
        const classes = [...STYLES.filter((s) => !['grain', 'bleach', 'ripple'].includes(s)).map((s) => 's-' + s), 'vigtop', 'pixels', 'vigfort']
        const avant = await pixels(page, 'mjs-fx-fa-page', classes)
        await page.evaluate(() => { const hote = document.querySelector('mjs-fx-fa-page') as HTMLElement; hote.style.display = 'block'; hote.style.padding = '131px 0 0 23px' })
        await page.waitForTimeout(500)
        const apres = await pixels(page, 'mjs-fx-fa-page', classes)
        const bouge: string[] = []
        for (const c of classes) {
          const a = avant[c], b = apres[c]
          let somme = 0
          for (let i = 0; i < a.length; i++) if (i % 4 !== 3) somme += Math.abs(a[i] - b[i])
          const moyen = somme / (a.length * .75)
          if (moyen > 1) bouge.push(`${c.replace(/^s-/, '')} : ${moyen.toFixed(1)} niveaux d'écart entre les deux places`)
        }
        assert.deepEqual(bouge, [], 'un filtre SVG lu en coordonnées de page rend autre chose selon la place de la balise\n' + bouge.join('\n'))
      })
    })

    it('duotone : currentColor et var() lisent la couleur de la balise elle-même, pas celle de son parent', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const tables = await page.evaluate(() => {
          const sh = (document.querySelector('mjs-fx-fa-page') as any)._shadow
          const de = (c: string) => {
            const id = /url\(#([\w-]+)\)/.exec(sh.querySelector('.' + c).style.getPropertyValue('--mjs-fx-filter-value'))?.[1]
            const f = sh.querySelector('filter#' + id)
            return ['feFuncR', 'feFuncG', 'feFuncB'].map((n) => f.querySelector(n).getAttribute('tableValues'))
          }
          return { cc: de('duocc'), va: de('duovar') }
        })
        assert.deepEqual(tables.cc, ['0.2 1', '0.4 1', '0.6 1'], 'currentColor : rgb(51, 102, 153) posé sur l\'image')
        assert.deepEqual(tables.va, ['0.2 1', '0.4 1', '0.6 1'], 'var(--ton) posé sur l\'image')
      })
    })
  })
}
