// *filter dans Chromium, Firefox et WebKit réels : ce que les autres tests ne voient pas. Un style suivi
// par une variable qui passe de fractions de la boîte à des px (WebKit ne relit pas un attribut retiré) ;
// la lumière du vignettage centrée sur la balise même quand une ombre, un contour ou un enfant déborde ;
// la période de la trame à origine et largeur fractionnaires ; WebKit reconnu par un signe que l'agent
// d'utilisateur d'une émulation ne change pas ; les transition-* posées en ligne, laissées telles quelles
// par duotone.

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

// 90 × 60, affichée 180 × 120 : quatre quadrants (rouge, vert, bleu, jaune), une rampe de clarté, un trait sombre tous les 9 pixels
const BASE  = [[220, 40, 40], [40, 200, 60], [40, 70, 220], [230, 210, 50]]
const IMAGE = png(90, 60, (x, y) => {
  if (x % 9 === 0) return [25, 25, 25]
  const c = BASE[(y < 30 ? 0 : 2) + (x < 45 ? 0 : 1)]
  const k = .6 + .4 * x / 89
  return c.map((v) => Math.round(v * k))
})

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const CHROME_LINUX  = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

// 1. un style suivi par une variable : l'ordre visite les passages px → fractions, fractions → px, fractions → fractions
const DEPART = 'pixelate'
const SUITE  = ['halftone', 'pixelate', 'vignette', 'chromatic', 'vignette', 'tiltshift', 'vignette', 'halftone', 'vignette', 'tiltshift', 'halftone', 'scanlines', 'newsprint', 'pixelate']
const EN_PX  = ['pixelate', 'chromatic', 'tiltshift', 'scanlines']
const REFS   = [...new Set([DEPART, ...SUITE])]

// 2. la balise (ou sa jumelle qui déborde) : [libellé, balise, réglage, classe de la jumelle]
const DEBORDS: [string, string, string, string][] = [
  ['une image à grande ombre (vignette)', 'img', 'vignette', 'ombre'],
  ['une image à contour épais (polaroid)', 'img', 'polaroid', 'contour'],
  ['une boîte dont un enfant sort à droite (lomo)', 'div', 'lomo', 'hors'],
  ['une boîte à grande ombre (nightvision)', 'div', 'nightvision', 'ombre'],
  ['une boîte dont un enfant sort en haut à gauche (vignette)', 'div', 'vignette', 'hors2']
]
const balise = (tag: string, cl: string, reglage: string, dehors: string) => {
  const enfant = dehors === 'hors' ? '<div class="abs">x</div>' : dehors === 'hors2' ? '<div class="abs2">x</div>' : ''
  return tag === 'img' ? `<img class="${cl}" src="/test.png" alt="" *filter(${reglage})>` : `<div class="boite ${cl}" *filter(${reglage})>${enfant}</div>`
}

// 3. la trame : des boîtes grises à origine et taille fractionnaires, au pixel près ; [style, période]
const TRAMES: [string, number][] = [['halftone', 10], ['newsprint', 7]]
const TAILLES: [number, number][] = [[150, 100], [150.3, 100.3], [233.2, 77.4]]
const FRACTIONS = [0, .25, .5, .75]
const CASES: { style: string, periode: number, w: number, h: number, f: number, x: number, y: number }[] = []
for (const [style, periode] of TRAMES) for (const [w, h] of TAILLES) for (const f of FRACTIONS) {
  const rang = CASES.length
  CASES.push({ style, periode, w, h, f, x: 20 + (rang % 4) * 330 + f, y: 10 + Math.floor(rang / 4) * 112 + f })
}

// 4. l'agent d'utilisateur : ce qui doit rester le même dans un moteur, quel que soit l'agent
const AGENTS: [string, string | undefined][] = [['agent d\'origine', undefined], ['agent de Safari sur iPhone', SAFARI_IPHONE], ['agent de Chrome', CHROME_LINUX]]

const SOURCES: Record<string, string> = {
  'fx-sa-suite.mjs': `<script>\n$s = '${DEPART}'\n</script>\n<img class="dyn" src="/test.png" alt="" *filter(style: $s)>\n`
    + REFS.map((r) => `<img class="r-${r}" src="/test.png" alt="" *filter(${r})>`).join('\n') + '\n'
    + SUITE.map((s, i) => `<button class="g${i}" @click={$s = '${s}'}>${i}</button>`).join('\n')
    + '\n<style>\nimg\n  display: block\n  width: 180px\n  height: 120px\n  margin: 0 0 4px\n</style>\n',
  'fx-sa-debord.mjs': '<div class="g">\n'
    + DEBORDS.map(([, tag, reglage, dehors], i) => `<div class="w">${balise(tag, 'a' + i, reglage, '')}</div>\n<div class="w">${balise(tag, 'b' + i + ' ' + dehors, reglage, dehors)}</div>`).join('\n')
    + '\n</div>\n<style>\n.g\n  display: grid\n  grid-template-columns: repeat(2, 320px)\n  gap: 10px\n'
    + '.w\n  box-sizing: border-box\n  width: 320px\n  height: 240px\n  padding: 50px\n'
    + 'img\n  display: block\n  width: 180px\n  height: 120px\n'
    + '.boite\n  width: 150px\n  height: 80px\n  background: #d33\n'
    + '.ombre\n  box-shadow: 0 0 30px 10px #000\n.contour\n  outline: 14px solid #06c\n'
    + '.hors, .hors2\n  position: relative\n'
    + '.abs\n  position: absolute\n  left: 170px\n  top: 10px\n  width: 60px\n  height: 60px\n  background: #36d\n'
    + '.abs2\n  position: absolute\n  left: -60px\n  top: -25px\n  width: 40px\n  height: 40px\n  background: #3d3\n</style>\n',
  'fx-sa-trame.mjs': CASES.map((c, i) => `<div class="box t${i}" *filter(${c.style})></div>`).join('\n')
    + '\n<style>\n.box\n  position: absolute\n  background: #777\n'
    + CASES.map((c, i) => `.t${i}\n  left: ${c.x}px\n  top: ${c.y}px\n  width: ${c.w}px\n  height: ${c.h}px\n`).join('')
    + '</style>\n',
  'fx-sa-agent.mjs': '<div class="box ha" *filter(halftone)></div>\n<div class="box ne" *filter(newsprint)></div>\n<div class="box pi" *filter(pixelate)></div>\n<div class="box ti" *filter(tiltshift)></div>\n<div class="box vi" *filter(vignette)></div>\n<div class="box po" *filter(polaroid)></div>\n'
    + '<style>\n.box\n  position: absolute\n  left: 20px\n  width: 150px\n  height: 100px\n  background: #777\n.ha\n  top: 10px\n.ne\n  top: 120px\n.pi\n  top: 230px\n.ti\n  top: 340px\n.vi\n  top: 450px\n.po\n  top: 560px\n</style>\n',
  'fx-sa-duo.mjs': ['t1 style="transition-duration: 2s; transition-property: opacity; color: rgb(51, 102, 153)"', 't2 style="transition: opacity 3s !important; color: rgb(51, 102, 153)"', 't3 style="transition: opacity 3s 1s ease-in; color: rgb(51, 102, 153)"', 't4 style="color: rgb(51, 102, 153)"']
    .map((a) => { const [c, ...reste] = a.split(' '); return `<img class="${c}" ${reste.join(' ')} src="/test.png" alt="" *filter(duotone, colors: [currentColor, #ffffff])>\n<img class="c${c.slice(1)}" ${reste.join(' ')} src="/test.png" alt="">` }).join('\n')
    + '\n<style>\nimg\n  display: block\n  width: 60px\n  height: 40px\n.t4, .c4\n  transition: caret-color 1s\n</style>\n'
}

type Zone = { w: number, h: number, data: Buffer }

const lum = (d: Buffer, i: number) => .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]

// l'écart moyen des trois canaux entre deux zones de même taille
function ecart(a: Zone, b: Zone): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let somme = 0
  for (let i = 0; i < a.data.length; i += 4) somme += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  return somme / (a.w * a.h * 3)
}

// la part de la zone qui montre la page magenta derrière la balise : une balise invisible
function magenta(a: Zone): number {
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] > 248 && a.data[i + 1] < 7 && a.data[i + 2] > 248) n++
  return n / (a.w * a.h)
}

// la trame d'une zone : l'écart-type de la clarté, puis l'écart de clarté à `s - 1`, `s` et `s + 1` px sur chaque axe
// (le plus petit dit la période : une trame de période `s` y est identique à elle-même à `s` px, et à `s` px seulement)
function trame(z: Zone, s: number, dpr: number) {
  const m = Math.round(4 * dpr)
  const W = z.w - 2 * m
  const H = z.h - 2 * m
  const L = (x: number, y: number) => lum(z.data, ((y + m) * z.w + x + m) * 4)
  let moy = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) moy += L(x, y)
  moy /= W * H
  let sd = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sd += (L(x, y) - moy) ** 2
  const lags = [-1, 0, 1].map((k) => Math.round((s + k) * dpr))
  const ax = lags.map((g) => { let a = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x + g < W; x++) { a += Math.abs(L(x, y) - L(x + g, y)); n++ } return a / Math.max(1, n) })
  const ay = lags.map((g) => { let a = 0, n = 0; for (let y = 0; y + g < H; y++) for (let x = 0; x < W; x++) { a += Math.abs(L(x, y) - L(x, y + g)); n++ } return a / Math.max(1, n) })
  return { sd: Math.sqrt(sd / (W * H)), ax, ay }
}

// vrai si la trame a la période voulue sur l'axe : l'écart à `s` px est franchement sous ceux de `s - 1` et de `s + 1`
const juste = (a: number[]) => a[1] < .35 * Math.min(a[0], a[2])

describe('*filter dans les trois moteurs : styles en direct, débordements, trame fractionnaire, agent d\'utilisateur, transitions en ligne', function () {
  this.timeout(300000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-filtre-moteurs-browser')
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

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) console.log(`  ℹ️  ${nom} non installé, test de *filter sauté. Activer : \`npx playwright install ${nom}\``)
      })

      // une page ouverte sur le composant `tag`, quand sa balise de classe `classe` est là et ses images chargées
      async function ouvre(browser: any, tag: string, classe: string, opts: { w?: number, h?: number, dpr?: number, ua?: string } = {}) {
        const ctx  = await browser.newContext({ viewport: { width: opts.w || 1400, height: opts.h || 800 }, deviceScaleFactor: opts.dpr || 1, ...(opts.ua ? { userAgent: opts.ua } : {}) })
        const page = await ctx.newPage()
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
        await page.waitForTimeout(700)
        return { page, ctx, erreurs }
      }

      // les pixels bruts (RGBA, en pixels de l'appareil) de chaque balise de la capture de la page
      async function pixels(page: any, tag: string, classes: string[]): Promise<Record<string, Zone>> {
        const rects = await page.evaluate(([t, cs]: [string, string[]]) => {
          const sh = (document.querySelector(t) as any)._shadow
          return cs.map((c) => { const r = sh.querySelector('.' + c).getBoundingClientRect(); return { c, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
        }, [tag, classes])
        const dpr  = await page.evaluate(() => window.devicePixelRatio)
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
        return Object.fromEntries(rects.map((r: any) => [r.c, { w: Math.round(r.w * dpr), h: Math.round(r.h * dpr), data: Buffer.from(brut[r.c], 'base64') }]))
      }

      async function essai(fn: (browser: any) => Promise<void>) {
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          await fn(browser)
        } finally {
          await browser.close()
        }
      }

      it('un style suivi par une variable, de l\'un à l\'autre (px, fractions de la boîte) : la balise reste visible et rend comme posée d\'emblée', async function () {
        if (!present) { this.skip(); return }
        await essai(async (browser) => {
          const { page, ctx, erreurs } = await ouvre(browser, 'mjs-fx-sa-suite', 'dyn', { w: 220, h: 900 })
          const unites = () => page.evaluate(() => {
            const sh = (document.querySelector('mjs-fx-sa-suite') as any)._shadow
            const id = /url\(#([\w-]+)\)/.exec(sh.querySelector('.dyn').style.getPropertyValue('--mjs-fx-filter-value'))?.[1]
            return sh.querySelector('filter#' + id).getAttribute('primitiveUnits')
          })
          // le filtre SVG de la balise, tel qu'il s'écrit : il change quand la variable change, sous charge comme à vide
          const lire = `(() => { const sh = document.querySelector('mjs-fx-sa-suite')._shadow; const id = /url\\(#([\\w-]+)\\)/.exec(sh.querySelector('.dyn').style.getPropertyValue('--mjs-fx-filter-value'))?.[1]; return sh.querySelector('filter#' + id).innerHTML })()`
          const fautes: string[] = []
          let courant = DEPART
          for (let i = 0; i < SUITE.length; i++) {
            const quoi = `${courant} → ${SUITE[i]}`
            courant = SUITE[i]
            const avant = await page.evaluate(lire)
            await page.evaluate((c: string) => (document.querySelector('mjs-fx-sa-suite') as any)._shadow.querySelector('.' + c).click(), 'g' + i)
            await page.waitForFunction(`${lire} !== ${JSON.stringify(avant)}`)
            await page.waitForTimeout(300)
            const z = await pixels(page, 'mjs-fx-sa-suite', ['dyn', 'r-' + courant])
            const vide = magenta(z.dyn)
            const diff = ecart(z.dyn, z['r-' + courant])
            if (vide > .5) fautes.push(`${quoi} : balise invisible (${(vide * 100).toFixed(1)} % de page magenta)`)
            else if (diff > 3) fautes.push(`${quoi} : ${diff.toFixed(1)} niveaux d'écart avec le même style posé d'emblée`)
            if (EN_PX.includes(courant)) {
              const u = await unites()
              if (u !== 'userSpaceOnUse') fautes.push(`${quoi} : primitiveUnits vaut ${u}, pas userSpaceOnUse (WebKit ne relit pas un attribut retiré)`)
            }
          }
          await ctx.close()
          assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
          assert.deepEqual(erreurs, [])
        })
      })

      it('vignette, polaroid, lomo, nightvision : la lumière reste centrée sur la balise, qu\'une ombre, un contour ou un enfant déborde ou non', async function () {
        if (!present) { this.skip(); return }
        await essai(async (browser) => {
          const { page, ctx, erreurs } = await ouvre(browser, 'mjs-fx-sa-debord', 'a0', { w: 700, h: 800 })
          const z = await pixels(page, 'mjs-fx-sa-debord', DEBORDS.flatMap((_, i) => ['a' + i, 'b' + i]))
          const fautes: string[] = []
          const rendu: string[] = []
          DEBORDS.forEach(([libelle], i) => {
            const diff = ecart(z['a' + i], z['b' + i])
            rendu.push(`${libelle} ${diff.toFixed(2)}`)
            if (!(diff < 1.2)) fautes.push(`${libelle} : l'intérieur de la balise change de ${diff.toFixed(1)} niveaux quand quelque chose déborde (la lumière a quitté son centre)`)
          })
          console.log(`    ℹ️  ${nom} : écart de l'intérieur, avec et sans débord — ${rendu.join(' ; ')}`)
          await ctx.close()
          // WebKit lit la lumière en fractions de sa boîte, qui englobe aussi ce qui déborde : son écart est mesuré (3 à 18 niveaux), pas corrigé
          if (nom === 'webkit') return
          assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
        })
      })

      for (const dpr of [1, 2]) {
        it(`halftone et newsprint : la période de la trame est la bonne à origine et largeur fractionnaires (écran à ${dpr} pixel${dpr > 1 ? 's' : ''} par pixel CSS)`, async function () {
          if (!present) { this.skip(); return }
          await essai(async (browser) => {
            const { page, ctx, erreurs } = await ouvre(browser, 'mjs-fx-sa-trame', 't0', { dpr })
            const z = await pixels(page, 'mjs-fx-sa-trame', CASES.map((_, i) => 't' + i))
            const fautes: string[] = []
            CASES.forEach((c, i) => {
              const t = trame(z['t' + i], c.periode, dpr)
              const lib = `${c.style} ${c.w} × ${c.h} px, origine +${c.f} px`
              if (t.sd < 6) fautes.push(`${lib} : pas de trame (uniforme)`)
              else {
                if (!juste(t.ax)) fautes.push(`${lib} : période horizontale fausse (écart à ${c.periode - 1}, ${c.periode}, ${c.periode + 1} px : ${t.ax.map((v) => v.toFixed(1)).join(', ')})`)
                if (!juste(t.ay)) fautes.push(`${lib} : période verticale fausse (écart à ${c.periode - 1}, ${c.periode}, ${c.periode + 1} px : ${t.ay.map((v) => v.toFixed(1)).join(', ')})`)
              }
            })
            await ctx.close()
            assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
          })
        })
      }

      it('le moteur est reconnu par un signe que l\'agent d\'utilisateur ne change pas : le même filtre, et la même trame, sous trois agents', async function () {
        if (!present) { this.skip(); return }
        await essai(async (browser) => {
          const classes = ['ha', 'ne', 'pi', 'ti', 'vi', 'po']
          const fautes: string[] = []
          let reference: Record<string, string> | null = null
          for (const [libelle, ua] of AGENTS) {
            const { page, ctx, erreurs } = await ouvre(browser, 'mjs-fx-sa-agent', 'po', { ua })
            const marques: Record<string, string> = await page.evaluate((cs: string[]) => {
              const sh = (document.querySelector('mjs-fx-sa-agent') as any)._shadow
              const out: Record<string, string> = {}
              for (const c of cs) {
                const id = /url\(#([\w-]+)\)/.exec(sh.querySelector('.' + c).style.getPropertyValue('--mjs-fx-filter-value'))?.[1]
                const f = sh.querySelector('filter#' + id)
                out[c] = f.getAttribute('primitiveUnits') + ' ' + f.innerHTML
              }
              return out
            }, classes)
            if (!reference) reference = marques
            else for (const c of classes) if (marques[c] !== reference[c]) fautes.push(`${libelle} : le filtre de .${c} n'est plus celui de l'agent d'origine`)
            const z = await pixels(page, 'mjs-fx-sa-agent', ['ha', 'ne'])
            const th = trame(z.ha, 10, 1)
            const tn = trame(z.ne, 7, 1)
            if (!(th.sd >= 6 && juste(th.ax) && juste(th.ay))) fautes.push(`${libelle} : la trame de halftone n'a plus sa période de 10 px (écart-type ${th.sd.toFixed(0)}, écarts ${th.ax.map((v) => v.toFixed(1)).join(', ')})`)
            if (!(tn.sd >= 6 && juste(tn.ax) && juste(tn.ay))) fautes.push(`${libelle} : la trame de newsprint n'a plus sa période de 7 px (écart-type ${tn.sd.toFixed(0)}, écarts ${tn.ax.map((v) => v.toFixed(1)).join(', ')})`)
            if (erreurs.length) fautes.push(`${libelle} : erreurs de page ${erreurs.join(' | ')}`)
            await ctx.close()
          }
          assert.deepEqual(fautes, [], fautes.join('\n'))
        })
      })

      it('duotone avec une couleur qui se lit sur la balise : les transition-* écrites en ligne par l\'auteur restent telles quelles', async function () {
        if (!present) { this.skip(); return }
        await essai(async (browser) => {
          const { page, ctx, erreurs } = await ouvre(browser, 'mjs-fx-sa-duo', 't1', { w: 200, h: 400 })
          const lu = await page.evaluate(() => {
            const sh = (document.querySelector('mjs-fx-sa-duo') as any)._shadow
            const dire = (el: any) => ({ propriete: el.style.transitionProperty, duree: el.style.transitionDuration, courbe: el.style.transitionTimingFunction, delai: el.style.transitionDelay, priorite: el.style.getPropertyPriority('transition-duration'), tout: el.style.transition })
            const out: Record<string, any> = {}
            for (const n of ['1', '2', '3', '4']) out[n] = { filtree: dire(sh.querySelector('.t' + n)), temoin: dire(sh.querySelector('.c' + n)) }
            return out
          })
          await ctx.close()
          const fautes: string[] = []
          for (const n of ['1', '2', '3', '4']) {
            if (JSON.stringify(lu[n].filtree) !== JSON.stringify(lu[n].temoin)) fautes.push(`t${n} : après duotone ${JSON.stringify(lu[n].filtree)}, l'auteur avait écrit ${JSON.stringify(lu[n].temoin)}`)
          }
          assert.equal(lu['1'].filtree.duree, '2s', 'transition-duration: 2s écrite en ligne')
          assert.equal(lu['1'].filtree.propriete, 'opacity', 'transition-property: opacity écrite en ligne')
          assert.equal(lu['4'].filtree.tout, '', 'rien d\'écrit en ligne : rien de laissé en ligne')
          assert.deepEqual(fautes, [], fautes.join('\n') + '\n' + erreurs.join('\n'))
        })
      })
    })
  }
})
