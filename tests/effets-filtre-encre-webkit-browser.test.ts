// *filter dans WebKit : la boîte d'encre (bordure, ombre, contour, enfants sortis) est mesurée au pixel CSS près (un pixel d'écart possible à deux pixels d'appareil ou plus),
// y compris pour une ombre à décalage ou flou fractionnaire et pour une balise transformée, et elle est relue
// quand elle change sans que la taille de la balise change (classe ajoutée, enfant déplacé, survol).
// Trois parties : la mesure (comparée à la région réelle d'un feFlood, dans WebKit ; valeurs fixes dans les trois
// moteurs, avec les gardes de l'arrondi et de l'ombre intérieure), puis le recalage de la trame, de la lumière et des
// lignes quand l'encre change. Par page, trois cas au plus : WebKit vide les premières rangées au-delà.

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

// [classe de b au départ, enfant de b au départ, classe de a (témoin), enfant de a, mutation JS sur b]
type Cas = { nom: string, b: string, enfantB: string, a: string, enfantA: string, js: string, survol?: boolean }

const OMBRE_AJOUTEE: Cas   = { nom: 'ombre ajoutée par une classe', b: '', enfantB: '', a: '', enfantA: '', js: "b.classList.add('ombre')" }
const OMBRE_RETIREE: Cas   = { nom: 'ombre retirée par une classe', b: 'ombre', enfantB: '', a: '', enfantA: '', js: "b.classList.remove('ombre')" }
const OMBRE_AGRANDIE: Cas  = { nom: 'ombre agrandie par une classe', b: 'ombre', enfantB: '', a: '', enfantA: '', js: "b.classList.add('ombre2')" }
const CONTOUR_AJOUTE: Cas  = { nom: 'contour ajouté', b: '', enfantB: '', a: '', enfantA: '', js: "b.classList.add('contour')" }
const ENFANT_SORT: Cas     = { nom: 'enfant qui sort par left', b: '', enfantB: '<div class="hg0"></div>', a: 'clip', enfantA: '<div class="hg2"></div>', js: "b.firstChild.className = 'hg2'" }
const ENFANT_TRANSFORM: Cas = { nom: 'enfant qui sort par transform', b: '', enfantB: '<div class="hg0"></div>', a: '', enfantA: '', js: "b.firstChild.className = 'hg3'" }
const OMBRE_ROT: Cas       = { nom: 'balise tournée de 3 degrés avec une ombre', b: 'ombre rot', enfantB: '', a: 'rot', enfantA: '', js: '' }
const OMBRE_ECHELLE: Cas   = { nom: 'balise agrandie de 10 % avec une ombre', b: 'ombre sc', enfantB: '', a: 'sc', enfantA: '', js: '' }
const SURVOL: Cas          = { nom: 'survol qui ajoute une échelle et une ombre', b: 'hv', enfantB: '', a: 'sc', enfantA: '', js: '', survol: true }
const OMBRE_FRAC: Cas      = { nom: 'ombre à décalage et flou fractionnaires', b: 'ofrac', enfantB: '', a: '', enfantA: '', js: '' }
const OMBRE_FRAC2: Cas     = { nom: 'ombre 0 1.5px 3px', b: 'ofrac2', enfantB: '', a: '', enfantA: '', js: '' }
const FLOU_FRAC: Cas       = { nom: 'ombre au flou de 10.3px', b: 'ofrac3', enfantB: '', a: '', enfantA: '', js: '' }

const GROUPES: { style: string, cas: Cas[] }[] = [
  { style: 'halftone', cas: [OMBRE_AJOUTEE, OMBRE_RETIREE, OMBRE_AGRANDIE] },
  { style: 'halftone', cas: [CONTOUR_AJOUTE, ENFANT_SORT, ENFANT_TRANSFORM] },
  { style: 'halftone', cas: [OMBRE_ROT, OMBRE_ECHELLE, SURVOL] },
  { style: 'halftone', cas: [OMBRE_FRAC, OMBRE_FRAC2, FLOU_FRAC] },
  { style: 'vignette', cas: [OMBRE_AJOUTEE, ENFANT_SORT, SURVOL] },
  { style: 'pixelate', cas: [OMBRE_AJOUTEE, CONTOUR_AJOUTE, SURVOL] },
  { style: 'scanlines', cas: [OMBRE_AJOUTEE, ENFANT_TRANSFORM, OMBRE_FRAC] },
  { style: 'tiltshift', cas: [OMBRE_AJOUTEE, ENFANT_SORT, OMBRE_ECHELLE] }
]

const STYLE_CSS = '\n<style>\n'
  + '.g\n  display: grid\n  grid-template-columns: repeat(2, 270px)\n  gap: 0\n'
  + '.w\n  box-sizing: border-box\n  width: 270px\n  height: 220px\n  padding: 60px 50px\n  background: #fff\n'
  + '.bx\n  position: relative\n  width: 150px\n  height: 80px\n  background: repeating-linear-gradient(0deg, #0006 0 2px, #0000 2px 5px), linear-gradient(90deg, #f4f4f4, #d33 55%, #222)\n'
  + '.clip\n  overflow: hidden\n'
  + '.ombre\n  box-shadow: 0 0 30px 10px #000\n'
  + '.ombre2\n  box-shadow: 0 0 50px 20px #000\n'
  + '.ofrac\n  box-shadow: 3.3px 2.2px 8.3px 0.5px #000\n'
  + '.ofrac2\n  box-shadow: 0 1.5px 3px #000\n'
  + '.ofrac3\n  box-shadow: 0 0 10.3px 0 #000\n'
  + '.contour\n  outline: 14px solid #06c\n'
  + '.rot\n  transform: rotate(3deg)\n'
  + '.sc\n  transform: scale(1.1)\n'
  + '.hv:hover\n  transform: scale(1.1)\n  box-shadow: 0 0 30px 10px #000\n'
  + '.hg0\n  position: absolute\n  left: 10px\n  top: 10px\n  width: 40px\n  height: 40px\n'
  + '.hg2\n  position: absolute\n  left: -40px\n  top: -25px\n  width: 40px\n  height: 40px\n'
  + '.hg3\n  position: absolute\n  left: 10px\n  top: 10px\n  width: 40px\n  height: 40px\n  transform: translate(-50px, -35px)\n'
  + '</style>\n'

function source(g: { style: string, cas: Cas[] }): string {
  return '<div class="g">\n'
    + g.cas.map((c, i) => `<div class="w"><div class="bx ${c.a} a${i}" *filter(${g.style})>${c.enfantA}</div></div>\n<div class="w"><div class="bx ${c.b} b${i}" *filter(${g.style})>${c.enfantB}</div></div>`).join('\n')
    + '\n</div>' + STYLE_CSS
}

type Zone = { w: number, h: number, data: Buffer }

// la zone sans sa bande de bord de `m` pixels : un contour ou une ombre sont flous dans la balise sur quelques pixels, c'est voulu
function dedans(a: Zone, m: number): Zone {
  const w = a.w - 2 * m
  const h = a.h - 2 * m
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) a.data.copy(data, y * w * 4, ((y + m) * a.w + m) * 4, ((y + m) * a.w + m + w) * 4)
  return { w, h, data }
}

function ecart(a: Zone, b: Zone): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let somme = 0
  for (let i = 0; i < a.data.length; i += 4) somme += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  return somme / (a.w * a.h * 3)
}

function maxi(a: Zone, b: Zone): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let m = 0
  for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[i + k] - b.data[i + k]))
  return m
}

function plage(a: Zone): number {
  let lo = 255, hi = 0
  for (let i = 0; i < a.data.length; i += 4) { const l = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l }
  return hi - lo
}

describe('*filter dans WebKit : l\'encre de la balise est mesurée et relue quand elle change', function () {
  this.timeout(600000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-filtre-encre-webkit-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    GROUPES.forEach((g, n) => writeFileSync(join(srcDir, `fx-enc${n}-page.mjs`), source(g)))
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

      it('la mesure de l\'encre arrondit au pixel supérieur et ignore l\'ombre intérieure', async function () {
        if (!present) { this.skip(); return }
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          const page = await (await browser.newContext({ viewport: { width: 600, height: 400 } })).newPage()
          await page.setContent('<!doctype html><body style="margin:0"></body>')
          await page.addScriptTag({ content: script })
          const mesures: Record<string, number[]> = await page.evaluate(() => {
            const g = globalThis as any
            const cas: Record<string, string> = {
              flou: 'box-shadow: 0 0 3px #000',
              decale: 'box-shadow: 0 1.5px 3px #000',
              fraction: 'box-shadow: 3.3px 2.2px 8.3px 0.5px #000',
              interieure: 'box-shadow: inset 0 0 20px 5px #00f',
              mixte: 'box-shadow: inset 0 0 20px 5px #00f, 0 0 3px #000',
              contour: 'outline: 6px solid #06c',
              deux: 'box-shadow: 0 0 3px #000, 12px 8px 20px 4px #060',
              tourne: 'transform: rotate(3deg); box-shadow: 0 1.5px 3px #000',
              echelle: 'transform: scale(1.1); box-shadow: 3.3px 2.2px 8.3px 0.5px #000'
            }
            const out: Record<string, number[]> = {}
            for (const k in cas) {
              const el = document.createElement('div')
              el.setAttribute('style', 'position:absolute;left:100px;top:100px;width:50px;height:40px;' + cas[k])
              document.body.appendChild(el)
              const ink = g._mjsFxInk(el, el.getBoundingClientRect())
              out[k] = [ink.l, ink.t, ink.r, ink.b]
              el.remove()
            }
            return out
          })
          assert.deepEqual(mesures.flou, [5, 5, 5, 5], 'flou 3px : 4,2 px arrondis à 5, pas à 4')
          assert.deepEqual(mesures.decale, [5, 4, 5, 7], 'ombre 0 1.5px 3px')
          assert.deepEqual(mesures.fraction, [10, 11, 16, 15], 'ombre 3.3px 2.2px 8.3px 0.5px')
          assert.deepEqual(mesures.interieure, [0, 0, 0, 0], 'une ombre inset ne déborde pas')
          assert.deepEqual(mesures.mixte, [5, 5, 5, 5], 'l\'ombre inset ne compte pas à côté d\'une ombre extérieure')
          assert.deepEqual(mesures.contour, [6, 6, 6, 6], 'contour de 6 px')
          assert.deepEqual(mesures.deux, [20, 24, 44, 40], 'deux ombres : le plus grand côté de chacune')
          assert.deepEqual(mesures.tourne, [5, 4, 5, 7], 'balise tournée : l\'ombre se mesure dans son repère, avant la transformation')
          assert.deepEqual(mesures.echelle, [10, 11, 16, 15], 'balise agrandie : l\'ombre se mesure dans son repère, avant la transformation')
        } finally {
          await browser.close()
        }
      })
    })
  }

  describe('webkit seul', function () {
    let present = false
    before(async function () { present = await navigateurPresent('webkit') })

    // la région réelle d'un feFlood en objectBoundingBox : la boîte d'encre que WebKit donne au filtre
    it('la boîte d\'encre mesurée est celle que WebKit donne au filtre (ombres fractionnaires, ombre intérieure, contour)', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright')).webkit
      const browser = await lanceur.launch()
      try {
        const ctx  = await browser.newContext({ viewport: { width: 1000, height: 200 }, deviceScaleFactor: 1 })
        const page = await ctx.newPage()
        const CAS = [
          'box-shadow: 0 0 3px #000',
          'box-shadow: 0 1.5px 3px #000',
          'box-shadow: 3.3px 2.2px 8.3px 0.5px #000',
          'box-shadow: -2.7px -4.4px 10.3px 2px #000',
          'box-shadow: 0 0 10px #000',
          'box-shadow: 0 0 10px -5px #000',
          'box-shadow: 13px 9px 17px 2px #000',
          'box-shadow: inset 0 0 20px 5px #00f',
          'box-shadow: inset 0 0 20px 5px #00f, 0 2.5px 6px #000',
          'box-shadow: 0 0 3px #000, 12px 8px 20px 4px #060',
          'outline: 6px solid #06c'
        ]
        const fautes: string[] = []
        for (let p = 0; p < CAS.length; p += 3) {
          const part = CAS.slice(p, p + 3)
          await page.setContent('<!doctype html><body style="margin:0;background:#fff"><svg width="0" height="0" style="position:absolute"><filter id="f" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox"><feFlood flood-color="#f00" x="0" y="0" width="1" height="1"/></filter></svg>'
            + part.map((s, i) => `<div class="m" style="position:absolute;left:${200 + i * 300}px;top:80px;width:50px;height:40px;background:#00f;${s};filter:url(#f)"></div>`).join('') + '</body>')
          await page.addScriptTag({ content: script })
          await page.waitForTimeout(80)
          const shot = await page.screenshot()
          const res: { vu: number[][], mesure: number[][] } = await page.evaluate(async (b64: string) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const cv = document.createElement('canvas')
            cv.width = img.width; cv.height = img.height
            const c = cv.getContext('2d') as CanvasRenderingContext2D
            c.drawImage(img, 0, 0)
            const d = c.getImageData(0, 0, cv.width, cv.height).data
            const vu: number[][] = []
            const mesure: number[][] = []
            const els = document.querySelectorAll('.m')
            for (let i = 0; i < els.length; i++) {
              let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
              for (let y = 0; y < cv.height; y++) for (let x = 200 + i * 300 - 140; x < 200 + i * 300 + 190; x++) {
                const o = (y * cv.width + x) * 4
                if (d[o] > 128 && d[o + 1] < 100 && d[o + 2] < 100) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
              }
              // le repère de la balise : la boîte non transformée, posée en (200 + 300 i, 80), de 50 x 40
              vu.push([200 + i * 300 - x0, 80 - y0, x1 + 1 - (200 + i * 300 + 50), y1 + 1 - 120])
              const el = els[i] as HTMLElement
              const ink = (globalThis as any)._mjsFxInk(el, el.getBoundingClientRect())
              mesure.push([ink.l, ink.t, ink.r, ink.b])
            }
            return { vu, mesure }
          }, shot.toString('base64'))
          part.forEach((s, i) => {
            if (res.vu[i].join() !== res.mesure[i].join()) fautes.push(`${s} : WebKit ${res.vu[i].join(',')} (g,h,d,b), mesuré ${res.mesure[i].join(',')}`)
          })
        }
        await ctx.close()
        assert.deepEqual(fautes, [], fautes.join('\n'))
      } finally {
        await browser.close()
      }
    })

    GROUPES.forEach((g, n) => {
      it(`halftone/vignette/pixelate... (${g.style}) : ${g.cas.map((c) => c.nom).join(' ; ')} : l'intérieur de la balise reste celui d'une balise sans débord`, async function () {
        if (!present) { this.skip(); return }
        const lanceur = (await import('playwright')).webkit
        const browser = await lanceur.launch()
        try {
          const ctx  = await browser.newContext({ viewport: { width: 560, height: 700 }, deviceScaleFactor: 1 })
          const page = await ctx.newPage()
          const erreurs: string[] = []
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f0f}</style></head><body><mjs-fx-enc${n}-page></mjs-fx-enc${n}-page><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b0'), `mjs-fx-enc${n}-page`)
          await page.waitForTimeout(700)
          // les changements qui laissent la taille intacte
          await page.evaluate(([t, ms]: [string, string[]]) => {
            const sh = (document.querySelector(t) as any)._shadow
            ms.forEach((js, i) => { if (js) new Function('b', js)(sh.querySelector('.b' + i)) })
          }, [`mjs-fx-enc${n}-page`, g.cas.map((c) => c.js)] as [string, string[]])
          for (let i = 0; i < g.cas.length; i++) {
            if (!g.cas[i].survol) continue
            const r = await page.evaluate(([t, k]: [string, number]) => { const q = (document.querySelector(t) as any)._shadow.querySelector('.b' + k).getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height } }, [`mjs-fx-enc${n}-page`, i] as [string, number])
            await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
          }
          await page.waitForTimeout(1200)
          const classes = g.cas.flatMap((_, i) => ['a' + i, 'b' + i])
          const rects = await page.evaluate(([t, cs]: [string, string[]]) => {
            const sh = (document.querySelector(t) as any)._shadow
            return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
          }, [`mjs-fx-enc${n}-page`, classes] as [string, string[]])
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
              const data = c.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)).data
              let texte = ''
              for (let i = 0; i < data.length; i += 8192) texte += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + 8192)))
              out[r.c] = btoa(texte)
            }
            return out
          }, [shot.toString('base64'), rects] as [string, any[]])
          await ctx.close()
          const z = (c: string): Zone => { const r = rects.find((q: any) => q.c === c); return { w: Math.round(r.w), h: Math.round(r.h), data: Buffer.from(brut[c], 'base64') } }
          const fautes: string[] = []
          const rendu: string[] = []
          g.cas.forEach((c, i) => {
            const a = dedans(z('a' + i), 14)
            const b = dedans(z('b' + i), 14)
            const diff = ecart(a, b)
            const m = maxi(a, b)
            rendu.push(`${c.nom} moyen ${diff.toFixed(2)} max ${m}`)
            if (!(plage(a) > 20)) fautes.push(`${g.style} : la balise témoin est uniforme, le test ne mesure rien`)
            if (!(m <= 16 && diff < 1)) fautes.push(`${g.style}, ${c.nom} : l'intérieur de la balise change de ${m} niveaux au plus (${diff.toFixed(1)} en moyenne)`)
          })
          console.log(`    ℹ️  webkit ${g.style} : ${rendu.join(' ; ')}`)
          assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    })
  })
})
