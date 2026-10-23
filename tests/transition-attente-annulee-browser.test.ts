// navigateurs réels (Chromium, Firefox, WebKit) : une intro menée au bout ne laisse aucune animation derrière elle. Si l'animation d'attente
// (image de départ, remplissage conservé) n'était pas annulée au démarrage de la vraie, elle resterait posée et le nœud retomberait
// invisible à la fin de l'intro. Un moteur absent de la machine saute son cas

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_easing.ts'), 'utf-8')

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

describe('transition css : attente annulée, navigateurs réels', function () {
  this.timeout(60000)

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let browser: any, page: any
      before(async function () {
        if (!(await navigateurPresent(nom))) return this.skip()
        const playwright: any = await import('playwright')
        browser = await playwright[nom].launch()
        page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage()
        await page.setContent('<!doctype html><html><body><div id="cible" style="width:100px;height:40px;background:#369"></div></body></html>')
        await page.evaluate((src: string) => {
          const µ: any = { debug: false, Ticker: { add() {} } }
          µ.warn = () => {}
          µ.log = () => {}
          µ._mjs_txt = (_k: string, _p: any, defaut: string) => defaut
          ;(window as any).µ = µ
          new Function('µ', src)(µ)
        }, SRC)
      })
      after(async function () { if (browser) await browser.close() })

      it('intro avec retard menée au bout : aucune animation restante, opacité naturelle', async function () {
        const r = await page.evaluate(async () => {
          const node: any = document.getElementById('cible')
          const µ: any = (window as any).µ
          const cfg = { css: (t: number) => ({ opacity: t }), delay: 40, duration: 120, easing: 'linear' }
          const p = µ._mjs_runTransition(node, cfg, 'in')
          const pendant = document.getAnimations().length
          const fin = await p
          return { pendant, fin, restantes: document.getAnimations().length, opacite: getComputedStyle(node).opacity }
        })
        assert.equal(r.pendant, 1, 'seule l\'attente tient le nœud pendant le retard')
        assert.equal(r.fin, 'in')
        assert.equal(r.restantes, 0)
        assert.equal(r.opacite, '1')
      })

      it('pendant la vraie animation : une seule animation posée (l\'attente est partie)', async function () {
        const n = await page.evaluate(async () => {
          const node: any = document.getElementById('cible')
          const µ: any = (window as any).µ
          const p = µ._mjs_runTransition(node, { css: (t: number) => ({ opacity: t }), delay: 20, duration: 300, easing: 'linear' }, 'in')
          await new Promise((res) => setTimeout(res, 120))
          const compte = document.getAnimations().length
          await p
          return compte
        })
        assert.equal(n, 1)
      })
    })
  }
})
