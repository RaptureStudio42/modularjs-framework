// *blend : le calque couvre exactement la boîte que le navigateur peint — ni un liseré non teinté sur le
// bord droit ou bas, ni une bande teintée en dehors — à toute position (entière ou fractionnaire), toute
// taille fractionnaire, avec ou sans coins arrondis, avec une bordure et un zoom, à la densité d'écran 1 et
// 2, et sous Chromium aux densités 1,25, 1,5 et 1,75 (Firefox y est mesuré par
// effets-fusion-densite-fractionnaire-browser.test.ts). Chaque boîte est comparée à la même page sans *blend : un pixel
// gris de la référence doit être
// teinté (180, 0, 0), un pixel blanc doit rester blanc. Chromium est essayé à la densité 2 de deux façons :
// en émulation (DevTools, Playwright : la page se met en page au pixel CSS) et réelle (drapeau
// --force-device-scale-factor : la page se met en page au pixel d'appareil, comme un écran Retina) ;
// Firefox cale ses boîtes au pixel d'appareil mais le repère de son filtre au pixel CSS entier.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne : ses bornes se disent en fractions de la
// boîte (voir effets-fusion-browser.test.ts), il n'est pas mesuré ici.

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
// 16 couples (décalage de la position, fraction de la taille) : entier, .3, .5, .7 × 0, .4, .5, .6
const COMBOS: number[][] = []
for (const f of [0, 0.3, 0.5, 0.7]) for (const s of [0, 0.4, 0.5, 0.6]) COMBOS.push([f, s])

type Boite = { id: string, left: number, top: number, w: number, h: number, extra: string[] }
const BOITES: Boite[] = []
for (let n = 0; n < 16; n++) {
  const cx = COMBOS[n]
  const cy = COMBOS[(n * 7 + 2) % 16]
  const col = n % 8
  const lig = Math.floor(n / 8)
  BOITES.push({ id: 'p' + n, left: 20 + col * 150 + cx[0], top: 20 + lig * 110 + cy[0], w: 100 + cx[1], h: 60 + cy[1], extra: [] })
  BOITES.push({ id: 'r' + n, left: 20 + col * 150 + cx[0], top: 240 + lig * 110 + cy[0], w: 100 + cx[1], h: 60 + cy[1], extra: ['border-radius: 10px'] })
}
// 100,4 × 60,6 à la position entière (la dernière ligne sous-teintée de Firefox), puis un zoom avec bordure
BOITES.push({ id: 'g1', left: 20, top: 460, w: 100.4, h: 60.6, extra: [] })
BOITES.push({ id: 'g2', left: 170, top: 460, w: 100.4, h: 60.6, extra: ['border-radius: 10px'] })
BOITES.push({ id: 'z1', left: 320, top: 460, w: 64, h: 42, extra: ['zoom: 1.5', 'border: 5px solid ' + G, 'border-radius: 20px'] })
BOITES.push({ id: 'z2', left: 480, top: 460, w: 100, h: 60, extra: ['zoom: 1.25', 'border: 1px solid ' + G] })
// un zoom sur une taille fractionnaire : le navigateur peint la boîte sur des pixels d'appareil entiers, que le calque
// doit couvrir sans en déborder, coins arrondis compris (le masque des coins se trame à la densité fois le zoom)
BOITES.push({ id: 'z3', left: 20, top: 560, w: 100.4, h: 60.6, extra: ['zoom: 1.5', 'border-radius: 10px'] })
BOITES.push({ id: 'z4', left: 230, top: 560, w: 100.4, h: 60.6, extra: ['zoom: 1.25', 'border-radius: 10px'] })
BOITES.push({ id: 'z5', left: 400, top: 560, w: 100.4, h: 60.6, extra: ['zoom: 2', 'border-radius: 10px'] })
BOITES.push({ id: 'z6', left: 640, top: 560, w: 100.4, h: 60.6, extra: ['zoom: 1.5'] })

function source(blend: boolean): string {
  const html = BOITES.map((b) => `<div class="b ${b.id}"${blend ? ' ' + BLEND : ''}></div>`).join('\n')
  const css = BOITES.map((b) => [`.${b.id}`, `  left: ${b.left}px`, `  top: ${b.top}px`, `  width: ${b.w}px`, `  height: ${b.h}px`, ...b.extra.map((l) => '  ' + l)].join('\n')).join('\n')
  return `${html}\n<style>\n.b\n  position: absolute\n  background: ${G}\n${css}\n</style>\n`
}

// `flou` : à une densité fractionnaire un pixel de bord peut n'être teinté qu'à moitié : aucun pixel entièrement faux (`manque`,
// `deborde`), et les pixels à moitié teintés (`autre`) plafonnés par `flou`, la somme sur les 40 boîtes
type Config = { nom: string, dpr: number, reel?: boolean, flou?: number }
type Ecarts = { mal: string[], manque: number, deborde: number, autre: number }

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*blend (${nom} réel) — les bornes du calque collent à la boîte peinte`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des bornes de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-bornes-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-bornes-bl.mjs'), source(true))
      writeFileSync(join(srcDir, 'fb-bornes-rf.mjs'), source(false))
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
      await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.z6'), tag)
      await page.waitForTimeout(700)
      return page
    }

    // pour chaque boîte : les pixels gris de la référence qui ne sont pas teintés, les pixels blancs qui le sont
    async function ecarts(config: Config): Promise<Ecarts> {
      const lanceur = (await import('playwright'))[nom]
      const args = config.reel ? { args: [`--force-device-scale-factor=${config.dpr}`, '--window-size=1320,700'] } : {}
      const browser = await lanceur.launch(args)
      try {
        const contexte = config.reel ? await browser.newContext({ viewport: null }) : await browser.newContext({ viewport: { width: 1300, height: 700 }, deviceScaleFactor: config.dpr })
        const ref      = await ouvre(contexte, 'mjs-fb-bornes-rf')
        const bl       = await ouvre(contexte, 'mjs-fb-bornes-bl')
        const rects    = await ref.evaluate((ids: string[]) => {
          const sh = (document.querySelector('mjs-fb-bornes-rf') as any)._shadow
          return ids.map((id) => { const r = sh.querySelector('.' + id).getBoundingClientRect(); return { id, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } })
        }, BOITES.map((b) => b.id))
        const a = (await ref.screenshot({ fullPage: true })).toString('base64')
        const b = (await bl.screenshot({ fullPage: true })).toString('base64')
        const dpr = await bl.evaluate(() => devicePixelRatio)
        return await bl.evaluate(async ([a64, b64, rs, k]: [string, string, any[], number]): Promise<Ecarts> => {
          const charge = async (s: string) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height) }
          const A      = await charge(a64)
          const B      = await charge(b64)
          const W      = A.width
          const gris   = (p: Uint8ClampedArray, i: number) => Math.abs(p[i] - 180) <= 4 && Math.abs(p[i + 1] - 180) <= 4 && Math.abs(p[i + 2] - 180) <= 4
          const blanc  = (p: Uint8ClampedArray, i: number) => p[i] >= 251 && p[i + 1] >= 251 && p[i + 2] >= 251
          const pur    = (p: Uint8ClampedArray, i: number) => gris(p, i) || blanc(p, i)
          const proche = (p: Uint8ClampedArray, i: number, r: number, g: number, bb: number) => Math.abs(p[i] - r) <= 14 && Math.abs(p[i + 1] - g) <= 14 && Math.abs(p[i + 2] - bb) <= 14
          // teinté : le vert et le bleu éteints ; le rouge vaut 180 sur le gris fondu, 255 là où Firefox peint la boîte
          // d'un pixel d'appareil plus loin dans son filtre (à densité 2, position fractionnaire) : le calque seul
          const teinte = (p: Uint8ClampedArray, i: number) => p[i + 1] <= 14 && p[i + 2] <= 14 && p[i] >= 166
          const nb = k >= 2 ? 2 : 1
          const out: string[] = []
          let tm = 0
          let td = 0
          let ta = 0
          for (const r of rs) {
            const x0 = Math.max(0, Math.floor((r.x - 3) * k))
            const y0 = Math.max(0, Math.floor((r.y - 3) * k))
            const x1 = Math.min(W, Math.ceil((r.x + r.w + 3) * k))
            const y1 = Math.min(A.height, Math.ceil((r.y + r.h + 3) * k))
            let manque = 0
            let deborde = 0
            let autre = 0
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const i = (y * W + x) * 4
              if (!pur(A.data, i)) continue
              let franc = true
              // une boîte sans coins arrondis ni zoom a des bords nets : rien n'est écarté, un seul pixel d'appareil de décalage se voit
              const marge = /^(p\d+|g1)$/.test(r.id) ? 0 : nb
              for (let dy = -marge; dy <= marge && franc; dy++) for (let dx = -marge; dx <= marge; dx++) { const xx = x + dx; const yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= A.height) continue; if (!pur(A.data, (yy * W + xx) * 4)) { franc = false; break } }
              if (!franc) continue
              if (gris(A.data, i)) {
                if (teinte(B.data, i)) continue
                if (proche(B.data, i, 180, 180, 180)) manque++
                else autre++
              }
              else {
                if (blanc(B.data, i)) continue
                if (B.data[i] >= 240 && B.data[i + 1] <= 20 && B.data[i + 2] <= 20) deborde++
                else autre++
              }
            }
            tm += manque
            td += deborde
            ta += autre
            if (manque + deborde + autre > 0) out.push(`${r.id} (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.w.toFixed(2)} × ${r.h.toFixed(2)}) : ${manque} non teintés, ${deborde} teintés en dehors, ${autre} autres`)
          }
          return { mal: out, manque: tm, deborde: td, autre: ta }
        }, [a, b, rects, dpr] as [string, string, any[], number])
      } finally {
        await browser.close()
      }
    }

    const configs: Config[] = nom === 'chromium'
      ? [{ nom: 'densité 1', dpr: 1 }, { nom: 'densité 1,25', dpr: 1.25, flou: 200 }, { nom: 'densité 1,5', dpr: 1.5, flou: 350 }, { nom: 'densité 1,75', dpr: 1.75, flou: 650 }, { nom: 'densité 2 émulée (DevTools, Playwright)', dpr: 2 }, { nom: 'densité 2 réelle (écran Retina)', dpr: 2, reel: true }]
      : [{ nom: 'densité 1', dpr: 1 }, { nom: 'densité 2', dpr: 2 }]
    for (const config of configs) {
      it(`${config.nom} : ${BOITES.length} boîtes (position et taille entières ou fractionnaires, coins arrondis, bordure, zoom) — aucun pixel non teinté, aucun teinté en dehors`, async function () {
        if (!present) { this.skip(); return }
        const r = await ecarts(config)
        if (process.env.MJS_TEST_TOTAUX) console.log(`TOTAUX ${nom} ${config.nom} manque=${r.manque} deborde=${r.deborde} autre=${r.autre}`)
        if (config.flou === undefined) assert.deepEqual(r.mal, [], `boîtes dont le calque ne colle pas à la boîte peinte :\n${r.mal.join('\n')}`)
        else {
          assert.equal(r.manque + r.deborde, 0, `pixels entièrement faux (non teintés ${r.manque}, teintés en dehors ${r.deborde}) :\n${r.mal.join('\n')}`)
          assert.ok(r.autre <= config.flou, `pixels de bord à moitié teintés : ${r.autre} au lieu de ${config.flou} au plus :\n${r.mal.join('\n')}`)
        }
      })
    }
  })
}
