// un effet n'appelle jamais une méthode de l'auteur, dans Chromium et Firefox réels : la balise porte, comme
// champs, des méthodes du DOM « écrites par l'auteur » (elles masquent celles du prototype) ; chaque effet
// joué avec ses réglages par défaut et des événements réels ne doit en appeler aucune. Le navigateur n'a
// pas de bruit d'implémentation (happy-dom lit `this.getAttribute` en interne) : tout appel compté est celui
// d'un effet.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

const EFFETS = [
  'flipcard', 'tilt', 'ripple', 'spotlight', 'shine', 'lift', 'magnet', 'parallax', 'orbit', 'grid',
  'autosize', 'spoiler', 'weight', 'glass', 'hologram', 'glitch', 'neon', 'pulse', 'shake',
  'float', 'bounce', 'attention', 'zoom', 'spin', 'underline', 'highlight', 'outline', 'dock',
  'stagger', 'scrollprogress', 'react', 'peel', 'marquee', 'reflect', 'cycle', 'count', 'filter', 'blend', 'heatmap'
]

const METHODES = [
  'contains', 'focus', 'blur', 'click', 'getBoundingClientRect', 'getClientRects', 'getAttribute',
  'setAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'closest', 'matches', 'querySelector', 'querySelectorAll', 'animate', 'getAnimations',
  'remove', 'replaceWith', 'appendChild', 'insertBefore', 'after', 'scrollIntoView', 'setPointerCapture', 'getRootNode'
]

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`effets — jamais une méthode de l'auteur sur la balise (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-methodes-auteur-prototype-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fx-banc.mjs'), EFFETS.map((e) => `<div *${e}${e === 'heatmap' ? "(server: 'wss://h.invalid/ws')" : ''}>x</div>`).join('\n') + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    it('chaque effet joué sur une balise aux méthodes d\'auteur : aucune n\'est appelée', async function () {
      if (!present) { this.skip(); return }
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      try {
        const page = await browser.newPage({ viewport: { width: 600, height: 500 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;font:16px sans-serif}</style></head><body><mjs-fx-banc></mjs-fx-banc><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fx-banc') as any)?._shadow?.querySelector('div'))
        const rapport = await page.evaluate(async ([effets, methodes]: [string[], string[]]) => {
          const µ: any = (globalThis as any).µ
          const comp = document.querySelector('mjs-fx-banc')
          const sortie: Record<string, string[]> = {}
          const fautes: Record<string, string> = {}
          for (const effet of effets) {
            const appels: string[] = []
            const el: any = document.createElement('div')
            el.innerHTML = '<span>un</span><span>deux</span>'
            el.setAttribute('tabindex', '0')
            el.style.cssText = 'width:200px;height:100px'
            document.body.appendChild(el)
            for (const m of methodes) {
              const natif = (HTMLElement.prototype as any)[m] || (Element.prototype as any)[m] || (Node.prototype as any)[m] || (EventTarget.prototype as any)[m]
              if (typeof natif !== 'function') continue
              el[m] = function (...args: any[]) { appels.push(m); return natif.apply(this, args) }
            }
            let off: any
            try {
              off = µ._mjs_fx(comp, el, effet, {}, {}, null)
              for (const type of ['pointerenter', 'mouseover', 'pointermove', 'pointerdown', 'pointerup', 'click', 'focusin', 'focusout', 'keydown', 'scroll', 'pointerleave']) {
                EventTarget.prototype.dispatchEvent.call(el, new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
              }
              await new Promise((r) => setTimeout(r, 60))
              if (typeof off === 'function') off()
            }
            catch (e: any) { fautes[effet] = String(e && e.message) }
            document.body.removeChild(el)
            sortie[effet] = [...new Set(appels)]
          }
          return { sortie, fautes }
        }, [EFFETS, METHODES])
        assert.deepEqual(rapport.fautes, {}, 'aucun effet ne lève')
        const fautifs = Object.entries(rapport.sortie).filter(([, a]) => a.length > 0)
        assert.deepEqual(fautifs, [], 'aucun effet n\'appelle la méthode de l\'auteur')
      } finally {
        await browser.close()
      }
    })
  })
}
