// Deux effets dans Chromium réel, ce que happy-dom ne montre pas (couche du dessus, rendu des pseudo-éléments) :
// - *pointer posé DANS une boîte de dialogue modale (ouverte par showModal(), dans la couche du dessus que nul z-index ne
//   dépasse) : son disque se voit, dans un composant comme hors composant ;
// - *split : un <br> coupe aussi ses moitiés (deux lignes à l'écran, pas une) ; un titre écrit sur plusieurs lignes dans le
//   gabarit n'y gagne aucune ligne vide en tête. Les copies de *glitch et de *neon gardent le même saut de ligne.
// Les pixels se lisent sur une capture.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'essai-boite.mjs': [
    '<dialog class="d"><div class="z" *pointer(disc, size: 40, smooth: 1)></div></dialog>',
    '<style>',
    '.d',
    '  padding: 0',
    '  border: 0',
    '.z',
    '  width: 300px',
    '  height: 200px',
    '  background: #fff',
    '</style>',
    ''
  ].join('\n'),
  'essai-coupe.mjs': [
    '<h2 class="a" *split>Ligne un<br>Ligne deux</h2>',
    '<h2 class="b" *split>',
    '  Un titre',
    '</h2>',
    '<h3 class="g" *glitch(mode: text)>Ligne un<br>Ligne deux</h3>',
    '<h3 class="n" *neon(breathe: true)>Ligne un<br>Ligne deux</h3>',
    '<style>',
    'h2, h3',
    '  margin: 0',
    '  width: 600px',
    '  font: 700 32px/40px sans-serif',
    '  color: #000',
    '</style>',
    ''
  ].join('\n')
}

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-pointer-dialogue-copies')
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

describe('*pointer dans une boîte de dialogue modale, *split et le <br> (Chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium indisponible, tests sautés')
      return
    }
    script = await compile()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvre(tag: string) {
    const contexte = await browser.newContext({ viewport: { width: 800, height: 600 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => ((document.querySelector(t) as any)?._shadow?.childElementCount ?? 0) > 0, tag)
    const images = (n: number) => page.evaluate((k: number) => new Promise<void>((ok) => {
      const pas = () => (--k <= 0 ? ok() : requestAnimationFrame(pas))
      requestAnimationFrame(pas)
    }), n)
    // les pixels d'une zone de l'écran (r, g, b, a à la suite), lus sur une capture
    const pixels = async (clip: { x: number, y: number, width: number, height: number }) => {
      const png = await page.screenshot({ clip })
      return page.evaluate(async (b64: string) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const c = document.createElement('canvas')
        c.width  = img.width
        c.height = img.height
        const x = c.getContext('2d') as CanvasRenderingContext2D
        x.drawImage(img, 0, 0)
        return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) }
      }, png.toString('base64'))
    }
    return { page, contexte, erreurs, images, pixels }
  }

  it('*pointer dans une boîte de dialogue modale : le disque se voit, dans un composant comme hors composant', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images, pixels } = await ouvre('mjs-essai-boite')
    // la même boîte hors composant
    await page.evaluate(() => {
      const d = document.createElement('dialog')
      d.className = 'd2'
      d.style.cssText = 'padding:0;border:0'
      d.innerHTML = '<div class="z2" style="width:300px;height:200px;background:#fff"></div>'
      document.body.appendChild(d)
      ;(window as any).µ._mjs_fx(null, d.querySelector('.z2'), 'pointer', { style: 'disc', size: 40, smooth: 1 })
    })
    const vu: any = {}
    for (const [racine, dlg, zone] of [[true, '.d', '.z'], [false, '.d2', '.z2']] as Array<[boolean, string, string]>) {
      const nom = racine ? 'composant' : 'page'
      const centre = await page.evaluate(({ racine, dlg, zone }: any) => {
        const r: any = racine ? (document.querySelector('mjs-essai-boite') as any)._shadow : document
        r.querySelector(dlg).showModal()
        const b = r.querySelector(zone).getBoundingClientRect()
        return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]
      }, { racine, dlg, zone })
      await page.mouse.move(centre[0] - 20, centre[1] - 10)
      await page.mouse.move(centre[0], centre[1])
      await images(4)
      await page.waitForTimeout(350)
      await images(2)
      // le disque blanc en différence sur la zone blanche : du noir sous la souris ; sans lui, du blanc
      const p = await pixels({ x: centre[0] - 4, y: centre[1] - 4, width: 8, height: 8 })
      let somme = 0
      for (let i = 0; i < p.d.length; i += 4) somme += p.d[i] + p.d[i + 1] + p.d[i + 2]
      vu[nom] = Math.round(somme / (p.d.length / 4) / 3)
      await page.evaluate(({ racine, dlg }: any) => {
        const r: any = racine ? (document.querySelector('mjs-essai-boite') as any)._shadow : document
        r.querySelector(dlg).close()
      }, { racine, dlg })
      await page.mouse.move(5, 590)
      await images(2)
    }
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.ok(vu.composant < 60, 'disque visible dans la boîte du composant (gris moyen sous la souris) : ' + JSON.stringify(vu))
    assert.ok(vu.page < 60, 'disque visible dans la boîte hors composant : ' + JSON.stringify(vu))
  })

  it('*split : un <br> coupe aussi ses moitiés (deux lignes à l\'écran) ; un titre écrit sur plusieurs lignes reste sans ligne vide ; *glitch et *neon gardent le saut', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images, pixels } = await ouvre('mjs-essai-coupe')
    await page.waitForTimeout(200)
    await images(3)
    // les bandes de texte d'une balise : les lignes de pixels sombres, regroupées
    const bandes = async (sel: string) => {
      const b = await page.evaluate((s: string) => {
        const r = (document.querySelector('mjs-essai-coupe') as any)._shadow.querySelector(s).getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      }, sel)
      const p = await pixels(b)
      const out: number[][] = []
      for (let y = 0; y < p.h; y++) {
        let sombre = false
        for (let x = 0; x < p.w && !sombre; x++) {
          const i = (y * p.w + x) * 4
          if (p.d[i] + p.d[i + 1] + p.d[i + 2] < 300) sombre = true
        }
        if (!sombre) continue
        const der = out[out.length - 1]
        if (der && y - der[1] <= 2) der[1] = y
        else out.push([y, y])
      }
      return { hauteur: b.height, bandes: out }
    }
    const a = await bandes('.a')
    const t = await bandes('.b')
    const copies = await page.evaluate(() => {
      const r = (document.querySelector('mjs-essai-coupe') as any)._shadow
      const vu: any = {}
      for (const [nom, sel, attr] of [['glitch', '.g', 'mjs-fx-glitch-text'], ['neon', '.n', 'mjs-fx-neon-text']]) {
        const el = r.querySelector(sel)
        vu[nom] = { texte: el.getAttribute(attr), sauts: (getComputedStyle(el, '::before') as any).whiteSpaceCollapse }
      }
      return vu
    })
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.equal(a.hauteur, 80, 'deux lignes de 40 px : ' + JSON.stringify(a))
    assert.equal(a.bandes.length, 2, 'deux lignes de texte à l\'écran : ' + JSON.stringify(a))
    assert.ok(a.bandes[1][0] >= 40, 'la seconde ligne sous la première : ' + JSON.stringify(a))
    assert.equal(t.bandes.length, 1, 'une ligne : ' + JSON.stringify(t))
    assert.ok(t.bandes[0][1] < 40, 'dans la première ligne, sans ligne vide en tête : ' + JSON.stringify(t))
    for (const nom of ['glitch', 'neon']) {
      assert.equal(copies[nom].texte, 'Ligne un\nLigne deux', nom + ' : ' + JSON.stringify(copies))
      assert.equal(copies[nom].sauts, 'preserve-breaks', nom + ' : ' + JSON.stringify(copies))
    }
  })
})
