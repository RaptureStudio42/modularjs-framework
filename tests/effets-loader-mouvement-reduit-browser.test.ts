// *loader dans Chromium réel, sous « réduire les animations » : les onze styles se figent — aucune animation de leur
// couche ne tourne, pseudo-éléments compris — et restent visibles (leurs animations sont là, en pause). La règle qui
// les fige doit gagner contre les règles d'animation des styles, plus précises, dont le raccourci `animation:` remet
// `animation-play-state` à `running`. Témoin : sans ce réglage, chaque style a au moins une animation qui tourne (le
// test ne passe pas à vide).

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

const STYLES = ['dots', 'steps', 'plus', 'neon', 'trio', '3d', 'bloom', 'spiral', 'galaxy', 'cross', 'vortex']
const TAG    = 'mjs-lm-page'
const SOURCE = '<div class="scene">' + STYLES.map((s) => `<span *loader(${s}, size: 64)></span>`).join('') + '</div>\n'

describe('*loader (Chromium réel) — « réduire les animations » fige les onze styles', function () {
  this.timeout(240000)
  let script  = ''
  let present = false
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-loader-mouvement-reduit-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'lm-page.mjs'), SOURCE)
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

  // les animations de la couche de chaque style (pseudo-éléments compris), deux images après la pose
  async function animations(calme: boolean): Promise<Array<{ style: string, couche: boolean, liste: Array<{ nom: string, etat: string, pseudo: string }> }>> {
    const page = await browser.newPage({ viewport: { width: 1200, height: 400 }, reducedMotion: calme ? 'reduce' : 'no-preference' })
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(([t, n]: [string, number]) => ((document.querySelector(t) as any)?._shadow?.querySelectorAll('[mjs-fx-layer="loader"] [mjs-fx-p]').length ?? 0) > 0 && (document.querySelector(t) as any)._shadow.querySelectorAll('[mjs-fx-layer="loader"]').length === n, [TAG, STYLES.length])
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      return await page.evaluate(([t, styles]: [string, string[]]) => {
        const sh = (document.querySelector(t) as any)._shadow
        return styles.map((style) => {
          const couche = sh.querySelector(`[mjs-fx-layer="loader"][mjs-fx-loader-style="${style}"]`)
          if (!couche) return { style, couche: false, liste: [] }
          return { style, couche: true, liste: couche.getAnimations({ subtree: true }).map((a: any) => ({ nom: a.animationName, etat: a.playState, pseudo: a.effect?.pseudoElement || '' })) }
        })
      }, [TAG, STYLES])
    }
    finally {
      await page.close()
    }
  }

  it('sous « réduire les animations », chaque style a ses animations, toutes en pause (aucune ne tourne)', async function () {
    if (!present) { this.skip(); return }
    const fautes: string[] = []
    for (const s of await animations(true)) {
      if (!s.couche) { fautes.push(`${s.style} : couche absente`); continue }
      if (s.liste.length === 0) fautes.push(`${s.style} : aucune animation (le loader doit rester visible, figé)`)
      for (const a of s.liste.filter((x) => x.etat === 'running')) fautes.push(`${s.style} : ${a.nom}${a.pseudo ? ' (' + a.pseudo + ')' : ''} tourne encore`)
    }
    assert.deepEqual(fautes, [], 'des styles tournent sous « réduire les animations » :\n' + fautes.join('\n'))
  })

  it('témoin : sans ce réglage, chaque style a au moins une animation qui tourne', async function () {
    if (!present) { this.skip(); return }
    const fautes: string[] = []
    for (const s of await animations(false)) {
      if (!s.couche) fautes.push(`${s.style} : couche absente`)
      else if (!s.liste.some((x) => x.etat === 'running')) fautes.push(`${s.style} : aucune animation qui tourne (${s.liste.length} en tout)`)
    }
    assert.deepEqual(fautes, [], fautes.join('\n'))
  })
})
