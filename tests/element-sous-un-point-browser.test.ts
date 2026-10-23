// µ.elementAt(x, y) : l'élément le plus profond sous un point de la fenêtre, jusque dans les composants.
// `document.elementFromPoint` s'arrête à la balise d'un composant (son intérieur est fermé) : un bouton
// « remonter en haut » ou un glisser-déposer ne savaient pas sur quoi ils tombaient sans lire une
// propriété interne. Ce test garantit la descente à travers deux composants imbriqués, à travers un
// composant léger, le résultat inchangé hors des composants, et `null` hors de la fenêtre.
// Chromium et pas happy-dom : il faut une vraie mise en page pour savoir ce qui est sous un point.

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
  'badge.mjs': '<span class="pastille">3</span>\n<style>\n.pastille\n  display: inline-block\n  width: 40px\n  height: 40px\n</style>\n',
  'carte.mjs': '<div class="cadre"><@badge/></div>\n<@note @lightDom/>\n',
  'note.mjs': '<em class="mot">note</em>\n'
}

describe('µ.elementAt (Chromium réel) — l\'élément sous un point, à travers les composants', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test de µ.elementAt sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('element-sous-point')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    // la page appelle µ.elementAt elle-même (la construction ne lit pas ce script) : demandée par la configuration
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['element_at'] })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('descend jusqu\'au plus profond, rend l\'élément de la page hors des composants, et `null` hors de la fenêtre', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><p class="libre">texte libre</p><mjs-carte></mjs-carte><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-carte') as any)?._shadow?.querySelector('mjs-badge')?._shadow?.querySelector('.pastille') && !!(document.querySelector('mjs-carte') as any)._shadow.querySelector('.mot'))
      const lu = await page.evaluate(() => {
        const carte: any = document.querySelector('mjs-carte')
        const centre     = (el: Element) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
        const nom        = (el: Element | null) => el ? el.tagName.toLowerCase() + (el.className ? '.' + el.className : '') : 'null'
        const pastille   = carte._shadow.querySelector('mjs-badge')._shadow.querySelector('.pastille')
        const mot        = carte._shadow.querySelector('.mot')
        const libre      = document.querySelector('.libre') as Element
        const [px, py]   = centre(pastille)
        const [mx, my]   = centre(mot)
        const [lx, ly]   = centre(libre)
        const µ: any     = (window as any).µ
        return {
          type: typeof µ.elementAt,
          navigateur: nom(document.elementFromPoint(px, py)),
          pastille: typeof µ.elementAt === 'function' ? nom(µ.elementAt(px, py)) : 'absente',
          leger: typeof µ.elementAt === 'function' ? nom(µ.elementAt(mx, my)) : 'absente',
          libre: typeof µ.elementAt === 'function' ? nom(µ.elementAt(lx, ly)) : 'absente',
          dehors: typeof µ.elementAt === 'function' ? nom(µ.elementAt(-50, -50)) : 'absente'
        }
      })
      assert.equal(lu.navigateur, 'mjs-carte', 'précondition : le navigateur s\'arrête à la balise du composant')
      assert.equal(lu.type, 'function', 'µ.elementAt existe')
      assert.equal(lu.pastille, 'span.pastille', 'à travers deux composants fermés')
      assert.equal(lu.leger, 'em.mot', 'à travers un composant léger posé dans un composant')
      assert.equal(lu.libre, 'p.libre', 'hors des composants : comme le navigateur')
      assert.equal(lu.dehors, 'null', 'hors de la fenêtre : rien')
    } finally {
      await browser.close()
    }
  })
})
