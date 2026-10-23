// *pointer(lens, soft: N) dans Chromium réel : le bord de la lentille devient progressif sur N px. Les pixels se lisent sur une
// capture, sur un fond de rayures verticales rouges et bleues de 4 px : une rayure nette est un rouge ou un bleu pur, une rayure
// floutée un mélange (127, 0, 127). La netteté d'un point est donc |rouge - bleu| / 255 (1 = net, 0 = flou), lue en moyenne sur une
// période de rayures (8 px) à une distance donnée de la souris. Ce qu'on prouve : soft 0 (ou absent) garde le bord franc d'aujourd'hui
// et ne pose aucun masque ; avec `outside` la netteté du cercle se fond dans le flou de la page (1 dans le cercle, la moitié à mi-bord,
// 0 au bout du bord) ; sans `outside` le flou du cercle s'efface vers l'extérieur (0 dans le cercle, la moitié à mi-bord, 1 au bout) ;
// le bord grossit avec le disque sur ce qui se clique ; soft se suit sur place ; la page autour de la balise reste nette.

import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
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

// un écran virtuel pour Firefox : le numéro d'écran est choisi par Xvfb lui-même (`-displayfd`), rien n'est deviné
async function ecranVirtuel(): Promise<{ display: string, arret: () => void } | null> {
  try {
    execFileSync('import', ['-version'], { stdio: 'ignore' })
    const x = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    const numero = await new Promise<string>((ok, ko) => {
      let texte = ''
      const delai = setTimeout(() => ko(new Error('Xvfb : pas de numéro d\'écran')), 20000)
      x.stdio[3]!.on('data', (d: Buffer) => {
        texte += d.toString()
        if (texte.includes('\n')) {
          clearTimeout(delai)
          ok(texte.trim())
        }
      })
      x.on('error', ko)
      x.on('exit', () => ko(new Error('Xvfb est parti')))
    })
    return { display: ':' + numero, arret: () => { x.kill() } }
  } catch {
    return null
  }
}

const RAYURES = 'repeating-linear-gradient(90deg, #f00 0, #f00 4px, #00f 4px, #00f 8px)'

// une balise de 400 × 300 posée à (20, 20), un lien à data-pointer à (300..400 × 120..220) en page
const scene = (fx: string) => [
  '<div class="fond">',
  `  <div class="s" ${fx}><a class="k" href="#x" data-pointer="Voir" aria-label="Voir"></a></div>`,
  '</div>',
  '<style>',
  '.fond',
  '  width: 440px',
  '  height: 340px',
  '  padding: 20px',
  `  background: ${RAYURES}`,
  '.s',
  '  position: relative',
  '  width: 400px',
  '  height: 300px',
  `  background: ${RAYURES}`,
  '.k',
  '  position: absolute',
  '  left: 280px',
  '  top: 100px',
  '  width: 100px',
  '  height: 100px',
  '</style>',
  ''
].join('\n')

const BASE = 'filter: blur, size: 100, grow: 2, press: .5, smooth: 1'

const SOURCES: Record<string, string> = {
  'pt-so-dehors.mjs':   scene(`*pointer(lens, outside: true, soft: 80, ${BASE})`),
  'pt-so-dehors0.mjs':  scene(`*pointer(lens, outside: true, ${BASE})`),
  'pt-so-dedans.mjs':   scene(`*pointer(lens, soft: 80, ${BASE})`),
  'pt-so-dedans0.mjs':  scene(`*pointer(lens, ${BASE})`),
  'pt-so-variable.mjs': [
    '<script>',
    '$mou = 0',
    '</script>',
    '<div class="fond">',
    `  <div class="s" *pointer(lens, outside: true, soft: $mou, ${BASE})></div>`,
    '</div>',
    '<button class="b" @click={$mou = 80}>b</button>',
    '<style>',
    '.fond',
    '  width: 440px',
    '  height: 340px',
    '  padding: 20px',
    `  background: ${RAYURES}`,
    '.s',
    '  width: 400px',
    '  height: 300px',
    `  background: ${RAYURES}`,
    '</style>',
    ''
  ].join('\n')
}

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-pointer-soft-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compilation
}

for (const nom of ['chromium', 'firefox'] as const) {
describe(`*pointer(lens, soft) (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null
  let ecran: { display: string, arret: () => void } | null = null

  before(async function () {
    present = await navigateurPresent(nom)
    if (present && nom === 'firefox') {
      ecran = await ecranVirtuel()
      if (!ecran) present = false
    }
    if (!present) {
      console.log(`  ℹ️  ${nom} indisponible (${nom === 'firefox' ? 'ni Firefox, ni Xvfb et ImageMagick' : 'non installé'}), test de *pointer(soft) sauté`)
      return
    }
    script = await compile()
    const { chromium, firefox } = await import('playwright')
    browser = nom === 'chromium'
      ? await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
      : await firefox.launch({ headless: false, env: { ...process.env, DISPLAY: ecran!.display } })
  })

  after(async () => {
    if (browser) await browser.close()
    if (ecran) ecran.arret()
    await terminateSharedWorkerPool()
  })

  async function ouvre(tag: string) {
    const contexte = await browser.newContext({ viewport: { width: 800, height: 700 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => true }))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => ((document.querySelector(t) as any)?._shadow?.childElementCount ?? 0) > 0, tag)
    await page.waitForTimeout(300)
    // la netteté moyenne (|rouge - bleu| / 255) sur une période de rayures (8 px), à `d` px à droite de (x, y)
    const nettete = async (x: number, y: number, distances: number[]): Promise<number[]> => {
      // Chromium fait sa capture lui-même ; Firefox ne peint pas `backdrop-filter` dans la sienne : ses pixels se lisent sur l'écran virtuel
      let png: Buffer
      if (nom === 'chromium') png = await page.screenshot()
      else {
        const o = await page.evaluate(() => ({ x: (window as any).mozInnerScreenX, y: (window as any).mozInnerScreenY }))
        png = execFileSync('import', ['-window', 'root', '-crop', `800x700+${Math.round(o.x)}+${Math.round(o.y)}`, '+repage', 'png:-'], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DISPLAY: ecran!.display } })
      }
      return page.evaluate(async ({ b64, x, y, ds }: any) => {
        const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
        const ctx   = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
        ctx.drawImage(image, 0, 0)
        return ds.map((d: number) => {
          const data = ctx.getImageData(x + d - 4, y, 8, 1).data
          let s = 0
          for (let i = 0; i < 8; i++) s += Math.abs(data[i * 4] - data[i * 4 + 2]) / 255
          return s / 8
        })
      }, { b64: png.toString('base64'), x, y, ds: distances })
    }
    // attend que le disque ait rejoint la souris et que le bord ait fini sa transition ; laisse le navigateur peindre
    const pret = async () => {
      await page.waitForFunction(() => !document.querySelector('[mjs-fx-pointer-layer][mjs-fx-pointer-live]'), null, { timeout: 15000 })
      await page.waitForTimeout(nom === 'firefox' ? 900 : 700)
    }
    return { page, contexte, erreurs, nettete, pret }
  }

  const A: [number, number] = [150, 170]
  const L: [number, number] = [350, 170]

  it('soft absent ou 0 : le bord franc d\'aujourd\'hui, aucun masque sur la lentille', async function () {
    if (!present) return this.skip()
    for (const tag of ['mjs-pt-so-dehors0', 'mjs-pt-so-dedans0']) {
      const { page, contexte, nettete, pret } = await ouvre(tag)
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret()
      const [dans, juste, loin] = await nettete(A[0], A[1], [20, 62, 100])
      if (tag.endsWith('dehors0')) {
        assert.ok(dans > 0.9 && juste < 0.15 && loin < 0.15, 'avec outside, bord franc : net dans le cercle, flou dès 12 px au-delà, ' + [dans, juste, loin])
      } else {
        assert.ok(dans < 0.15 && juste > 0.85 && loin > 0.85, 'sans outside, bord franc : flou dans le cercle, net dès 12 px au-delà, ' + [dans, juste, loin])
        const masque = await page.evaluate(() => getComputedStyle(document.querySelector('[mjs-fx-pointer-layer] > i') as Element).maskImage)
        assert.equal(masque, 'none', 'aucun masque sur la lentille sans soft')
      }
      await contexte.close()
    }
  })

  it('outside + soft : la netteté du cercle se fond dans le flou de la page (1 dans le cercle, la moitié à mi-bord, 0 au bout)', async function () {
    if (!present) return this.skip()
    const { page, contexte, nettete, pret, erreurs } = await ouvre('mjs-pt-so-dehors')
    await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
    await page.mouse.move(A[0], A[1], { steps: 3 })
    await pret()
    // size 100 : rayon 50 ; soft 80 : bord de 50 à 130
    const [dans, debut, mi, fin, loin, quart, troisQuarts] = await nettete(A[0], A[1], [20, 58, 90, 124, 160, 70, 110])
    assert.ok(dans > 0.9, 'dans le cercle : net, ' + dans)
    // le profil est une rampe (même courbe dans les deux navigateurs) : le quart du bord à 0,75, les trois quarts à 0,25, à ±0,1
    assert.ok(Math.abs(quart - 0.75) < 0.1, 'au quart du bord (20 px) : net aux trois quarts, ' + quart)
    assert.ok(Math.abs(troisQuarts - 0.25) < 0.1, 'aux trois quarts du bord (60 px) : net au quart, ' + troisQuarts)
    assert.ok(debut > 0.7 && debut < 0.95, 'au début du bord (8 px) : presque net, ' + debut)
    assert.ok(mi > 0.35 && mi < 0.65, 'à mi-bord (40 px) : à moitié net, ' + mi)
    assert.ok(fin < 0.2, 'au bout du bord : presque flou, ' + fin)
    assert.ok(loin < 0.1, 'au-delà du bord : flou, ' + loin)
    assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement de console')
    await contexte.close()
  })

  it('sans outside + soft : le flou du cercle s\'efface vers l\'extérieur (0 dans le cercle, la moitié à mi-bord, 1 au bout)', async function () {
    if (!present) return this.skip()
    const { page, contexte, nettete, pret, erreurs } = await ouvre('mjs-pt-so-dedans')
    await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
    await page.mouse.move(A[0], A[1], { steps: 3 })
    await pret()
    const [dans, debut, mi, fin, loin, quart, troisQuarts] = await nettete(A[0], A[1], [20, 58, 90, 124, 160, 70, 110])
    assert.ok(dans < 0.1, 'dans le cercle : flou, ' + dans)
    assert.ok(Math.abs(quart - 0.25) < 0.1, 'au quart du bord (20 px) : net au quart, ' + quart)
    assert.ok(Math.abs(troisQuarts - 0.75) < 0.1, 'aux trois quarts du bord (60 px) : net aux trois quarts, ' + troisQuarts)
    assert.ok(debut < 0.3 && debut > 0.05, 'au début du bord (8 px) : encore très flou, ' + debut)
    assert.ok(mi > 0.35 && mi < 0.65, 'à mi-bord (40 px) : à moitié net, ' + mi)
    assert.ok(fin > 0.8, 'au bout du bord : presque net, ' + fin)
    assert.ok(loin > 0.9, 'au-delà du bord : net, ' + loin)
    assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement de console')
    await contexte.close()
  })

  it('le bord grossit avec le disque sur ce qui se clique (grow 2 : rayon 100, bord 160) et se resserre à l\'appui', async function () {
    if (!present) return this.skip()
    const { page, contexte, nettete, pret } = await ouvre('mjs-pt-so-dehors')
    await page.mouse.move(L[0] - 30, L[1], { steps: 3 })
    await page.mouse.move(L[0], L[1], { steps: 3 })
    await pret()
    // rayon 50 × 2 = 100 ; bord 80 × 2 = 160 : à 100 + 80 = 180 la moitié
    const [dans, mi, loin, quartG, troisG] = await nettete(L[0], L[1], [-60, -180, -280, -140, -220])
    assert.ok(dans > 0.9, 'dans le cercle grossi : net, ' + dans)
    assert.ok(mi > 0.3 && mi < 0.7, 'à mi-bord grossi (80 px de plus que le rayon) : à moitié net, ' + mi)
    assert.ok(loin < 0.15, 'au-delà du bord grossi : flou, ' + loin)
    assert.ok(Math.abs(quartG - 0.75) < 0.1 && Math.abs(troisG - 0.25) < 0.1, 'le profil grossi reste une rampe (à 40 px et 120 px du rayon grossi) : ' + [quartG, troisG])
    // appuyé : rayon 50 × 2 × 0,5 = 50, bord 80 × 2 × 0,5 = 80 : à 50 + 40 = 90 la moitié
    await page.mouse.down()
    await pret()
    const [dansP, miP, loinP] = await nettete(L[0], L[1], [-30, -90, -150])
    await page.mouse.up()
    assert.ok(dansP > 0.9, 'appuyé, dans le cercle : net, ' + dansP)
    assert.ok(miP > 0.3 && miP < 0.7, 'appuyé, à mi-bord resserré : à moitié net, ' + miP)
    assert.ok(loinP < 0.15, 'appuyé, au-delà du bord : flou, ' + loinP)
    await contexte.close()
  })

  it('soft se suit sur place : posé à 0 puis changé, le bord apparaît sans reposer la lentille', async function () {
    if (!present) return this.skip()
    const { page, contexte, nettete, pret } = await ouvre('mjs-pt-so-variable')
    await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
    await page.mouse.move(A[0], A[1], { steps: 3 })
    await pret()
    const [avant] = await nettete(A[0], A[1], [90])
    assert.ok(avant < 0.15, 'soft 0 : bord franc, flou à 40 px du rayon, ' + avant)
    await page.evaluate(() => (document.querySelector('mjs-pt-so-variable') as any)._shadow.querySelector('.b').click())
    await page.mouse.move(A[0] + 1, A[1])
    await page.mouse.move(A[0], A[1])
    await pret()
    const [apres] = await nettete(A[0], A[1], [90])
    assert.ok(apres > 0.3 && apres < 0.7, 'soft 80 posé après coup : à mi-bord, ' + apres)
    await contexte.close()
  })
})
}
