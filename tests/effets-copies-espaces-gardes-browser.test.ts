// Les copies du texte en pseudo-élément (*split, *glitch, *neon(breathe)) gardent les espaces d'une balise qui les garde
// (`pre`, `pre-wrap`, `break-spaces`) : sans quoi la copie replie « a     b » en « a b » et ne se pose plus sur le texte
// qu'elle double. Dans une balise ordinaire, elle replie les espaces comme le texte, et garde seulement le saut d'un <br>.
// Une balise qui passe de `pre` à `normal` (une classe) est relue au changement suivant de son texte. Retiré, rien ne reste.

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

const P    = (id: string, ws: string, txt = 'a     b') => `<p id="${id}" style="font:20px monospace;width:400px${ws ? ';white-space:' + ws : ''}">${txt}</p>`
const PAGE = P('sw', 'pre-wrap') + P('gp', 'pre') + P('nw', 'pre-wrap') + P('sb', 'break-spaces') + P('sn', '', 'a<br>b') + P('gn', '')

describe('copies du texte en pseudo-élément (*split, *glitch, *neon) : les espaces d\'une balise `pre` gardés (Chromium réel)', function () {
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
    const root   = mjsTmp('effets-copies-espaces-gardes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<p *split>x</p>\n<p *glitch>x</p>\n<p *neon(breathe: true)>x</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('pre, pre-wrap, break-spaces : la copie garde les espaces ; balise ordinaire : repliés, le saut du <br> gardé', async () => {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${PAGE}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const vu = await page.evaluate(async () => {
        const µ = (window as any).µ
        const $ = (id: string) => document.getElementById(id)!
        const offs = [
          µ._mjs_fx(null, $('sw'), 'split', {}), µ._mjs_fx(null, $('gp'), 'glitch', {}), µ._mjs_fx(null, $('nw'), 'neon', { breathe: true }),
          µ._mjs_fx(null, $('sb'), 'split', {}), µ._mjs_fx(null, $('sn'), 'split', {}), µ._mjs_fx(null, $('gn'), 'glitch', {})
        ]
        await new Promise((r) => setTimeout(r, 100))
        const copie = (id: string) => {
          const b = getComputedStyle($(id), '::before')
          return b.whiteSpaceCollapse + (b.content.indexOf('a     b') >= 0 ? ' (5 espaces)' : '')
        }
        const avant = { sw: copie('sw'), gp: copie('gp'), nw: copie('nw'), sb: copie('sb'), sn: copie('sn'), gn: copie('gn') }
        // la balise ne garde plus ses espaces : relue au changement suivant de son texte
        $('sw').style.whiteSpace = 'normal'
        $('sw').firstChild!.textContent = 'a     c'
        await new Promise((r) => setTimeout(r, 100))
        const apres = getComputedStyle($('sw'), '::before').whiteSpaceCollapse
        offs.forEach((f: any) => f())
        const restes = ['sw', 'gp', 'nw', 'sb'].filter((id) => Array.from($(id).attributes).some((a) => /^mjs-fx-/.test(a.name)))
        return { avant, apres, restes }
      })
      assert.deepEqual(vu, {
        avant: { sw: 'preserve (5 espaces)', gp: 'preserve (5 espaces)', nw: 'preserve (5 espaces)', sb: 'break-spaces (5 espaces)', sn: 'preserve-breaks', gn: 'preserve-breaks (5 espaces)' },
        apres: 'preserve-breaks',
        restes: []
      }, JSON.stringify(vu))
      assert.deepEqual(erreurs, [])
    }
    finally {
      await ctx.close()
    }
  })
})
