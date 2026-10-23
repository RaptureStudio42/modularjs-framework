// *flipcard(on: click) dans Chromium réel, souris réelle : un élément d'une face à `tabindex="-1"` — un titre qui reçoit le focus par
// script après le retournement, motif accessible courant — n'est pas un contrôle : un clic sur lui retourne la carte, même s'il prend le
// focus au clic. Un lien, un bouton (à `tabindex="-1"` compris), un élément qu'atteint la touche Tab (`tabindex="0"`) gardent leur action.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

const STYLE = 'html,body{margin:0;font:16px sans-serif}.card{width:300px;height:120px;margin:10px}.card>div{background:#cde;height:120px}h3{margin:0;padding:20px;background:#fc9}'
const carte = (id: string, recto: string) => `<div class="card" id="${id}"><div>${recto}</div><div>Verso ${id}</div></div>`
const PAGE  = carte('c1', '<h3 id="t1" tabindex="-1">Titre (tabindex -1)</h3>') + carte('c2', '<h3 id="t2">Titre simple</h3>')
  + carte('c3', '<p>texte <button id="b3" tabindex="-1">bouton</button></p>') + carte('c4', '<p>texte <span id="s4" tabindex="0">pastille</span></p>')

describe('*flipcard (Chromium réel) — un élément à tabindex négatif d\'une face retourne la carte', function () {
  this.timeout(240000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-carte-retournee-tabindex-negatif')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *flipcard(on: click)><div>r</div><div>v</div></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('clic sur un titre à tabindex -1 : retournée ; sur un bouton à tabindex -1 ou une pastille à tabindex 0 : la carte reste', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 800, height: 700 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${PAGE}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.evaluate(() => { for (const id of ['c1', 'c2', 'c3', 'c4']) (window as any).µ._mjs_fx(null, document.getElementById(id), 'flipcard', { on: 'click', duration: '0s' }) })
      await page.waitForTimeout(300)
      const etat = (id: string) => page.evaluate((id: string) => { const f = document.getElementById(id)!.querySelectorAll(':scope > [mjs-fx-flipcard-face]') as any; return f[1].inert === false && f[0].inert === true ? 'retournée' : f[0].inert === false ? 'recto' : '?' }, id)
      const r: any = {}
      for (const [id, cible] of [['c1', '#t1'], ['c2', '#t2'], ['c3', '#b3'], ['c4', '#s4']]) {
        await page.click(cible)
        await page.waitForTimeout(200)
        r[id] = await etat(id)
      }
      assert.deepEqual(r, { c1: 'retournée', c2: 'retournée', c3: 'recto', c4: 'recto' }, JSON.stringify(r))
      assert.deepEqual(erreurs, [])
    }
    finally {
      await ctx.close()
    }
  })
})
