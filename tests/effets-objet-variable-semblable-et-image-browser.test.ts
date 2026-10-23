// Un effet donné avec ses réglages par une variable (`{ fx: 'gradient', s: {…} }`, le `fx` de *delta, de *guard, de *offline) peut venir
// d'une donnée de l'utilisateur, en JSON. Dans Chromium réel :
// - un objet « semblable à une liste » (`{ "0": …, "1": …, "length": 3 }`, du JSON valide) n'est pas une liste : il est écarté comme une
//   valeur CSS qui sort de sa fonction — *gradient(pattern) le lisait par index et chargeait l'adresse cachée dans un de ses éléments ;
//   l'effet est joué avec ses couleurs par défaut, aucune requête ne part ;
// - une image (`image`, une adresse `data:` qui porte un `;`, ou l'objet que rend µimage) prend la voie de l'image, comme écrite en
//   réglage : elle est posée.

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

const MAL  = 'red 0 3px,transparent 3.5px),url(http://evil.test/MARQUE.png),radial-gradient(circle,red'
const DATA = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22red%22/%3E%3C/svg%3E'

describe('effet imbriqué venu d\'une variable (Chromium réel) — objet semblable à une liste écarté, image posée', function () {
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
    const root   = mjsTmp('effets-objet-variable-semblable-et-image')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<p *gradient>g</p>\n')
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

  it('un objet semblable à une liste ne fait charger aucune adresse ; une image data: ou µimage est posée', async () => {
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    const erreurs: string[] = []
    const requetes: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://evil.test/**', (route: any) => {
        requetes.push(route.request().url())
        return route.fulfill({ status: 404, body: '' })
      })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><p id="tableau">a</p><p id="semblable">b</p><p id="damier">c</p><p id="image">d</p><p id="objet">e</p><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const r: any = await page.evaluate(async ({ MAL, DATA }: any) => {
        const µ     = (window as any).µ
        const pause = (ms: number) => new Promise((f) => setTimeout(f, ms))
        const jouer = (id: string, s: any) => µ._mjs_fxOnce(null, document.getElementById(id), { fx: 'gradient', s, byVar: true })
        jouer('tableau', { pattern: 'dots', colors: ['red', MAL.replace('MARQUE', 'tableau-dots'), 'blue'] })
        jouer('semblable', { pattern: 'dots', colors: { 0: 'red', 1: MAL.replace('MARQUE', 'semblable-dots'), 2: 'blue', length: 3 } })
        jouer('damier', { pattern: 'checks', colors: JSON.parse(JSON.stringify({ 0: MAL.replace('MARQUE', 'semblable-checks'), 1: 'blue', length: 2 })) })
        jouer('image', { image: DATA })
        jouer('objet', { image: { src: DATA } })
        await pause(600)
        const style = (id: string) => document.getElementById(id)!.style.getPropertyValue('--mjs-fx-gradient')
        return { tableau: style('tableau'), semblable: style('semblable'), damier: style('damier'), image: style('image'), objet: style('objet') }
      }, { MAL, DATA })
      await page.waitForTimeout(300)
      assert.deepEqual(requetes, [], `aucune requête vers l'adresse cachée — ${JSON.stringify(r)}`)
      for (const k of ['tableau', 'semblable', 'damier']) {
        assert.ok(!/evil/.test(r[k]), `${k} : l'adresse n'entre pas dans le fond — ${r[k]}`)
        assert.ok(r[k] !== '', `${k} : l'effet est joué (couleurs par défaut) — ${JSON.stringify(r)}`)
      }
      assert.match(r.semblable, /^radial-gradient\(circle,#22d3ee 0 3px/, `l'objet semblable écarté : les pois aux couleurs par défaut — ${r.semblable}`)
      assert.ok(r.image.includes('url("data:image/svg+xml;utf8,'), `l'image data: est posée — ${r.image}`)
      assert.ok(r.objet.includes('url("data:image/svg+xml;utf8,'), `l'image donnée en objet { src } est posée — ${r.objet}`)
      assert.deepEqual(erreurs, [])
    }
    finally {
      await ctx.close()
    }
  })
})
