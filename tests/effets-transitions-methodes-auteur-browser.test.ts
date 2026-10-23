// les transitions et *backlight n'appellent jamais une méthode de l'auteur, dans Chromium et Firefox réels : la balise (et, pour
// *backlight posé avec sa légende, son parent qu'il isole) porte, comme champs, des méthodes du DOM « écrites par l'auteur » (elles
// masquent celles du prototype, comme `@getBoundingClientRect` dans un composant) ; chaque transition jouée (`on: load`), le vol
// de *crossfade entre deux balises, la pose et le retrait de *backlight ne doivent en appeler aucune — `µ._mjs_dom` prend celles
// du prototype. Et *ink garde au plus huit planches : une liste dont chaque ligne a sa graine ne les garde plus toutes pour toujours.

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

const IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%2280%22%3E%3Crect width=%22120%22 height=%2280%22 fill=%22%23e11d48%22/%3E%3C/svg%3E'

const SOURCE = [
  '<script>', '$vu = true', '</script>',
  '<div *iris(on: load)>a</div>', '<div *blocks(on: load)>b</div>', '<div *pixelate(on: load)>c</div>', '<div *ink(on: load)>d</div>', '<div *fade(on: load)>e</div>',
  '{if $vu}<p @transition=*crossfade(key: 1)>x</p>{end}',
  `<div><img src="${IMAGE}" alt="" *backlight(legend: true)></div>`, ''
].join('\n')

const TRANSITIONS = ['iris', 'blocks', 'pixelate', 'ink', 'fade']

const METHODES = [
  'contains', 'getBoundingClientRect', 'getClientRects', 'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'addEventListener',
  'removeEventListener', 'closest', 'matches', 'querySelector', 'querySelectorAll', 'animate', 'getAnimations', 'remove', 'appendChild', 'insertBefore', 'getRootNode'
]

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`transitions et *backlight — jamais une méthode de l'auteur sur la balise (${nom} réel)`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-transitions-methodes-auteur-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fx-banc.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    const ouvrir = async () => {
      const { chromium, firefox } = await import('playwright')
      const browser = await (nom === 'chromium' ? chromium : firefox).launch()
      const page    = await browser.newPage({ viewport: { width: 600, height: 500 } })
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;font:16px sans-serif}</style></head><body><mjs-fx-banc></mjs-fx-banc><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-fx-banc') as any)?._shadow?.querySelector('img'))
      return { browser, page }
    }

    it('chaque transition jouée, le vol de *crossfade, la pose et le retrait de *backlight : aucune méthode de l\'auteur n\'est appelée', async function () {
      if (!present) { this.skip(); return }
      const { browser, page } = await ouvrir()
      try {
        const rapport = await page.evaluate(async ([transitions, methodes, image]: [string[], string[], string]) => {
          const µ: any = (globalThis as any).µ
          const comp = document.querySelector('mjs-fx-banc')
          const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))
          const sortie: Record<string, string[]> = {}
          const fautes: Record<string, string> = {}
          // une balise aux méthodes « de l'auteur » : chaque appel est compté
          const balise = (tag: string, appels: string[]) => {
            const el: any = document.createElement(tag)
            for (const m of methodes) {
              const natif = (HTMLElement.prototype as any)[m] || (Element.prototype as any)[m] || (Node.prototype as any)[m] || (EventTarget.prototype as any)[m]
              if (typeof natif !== 'function') continue
              el[m] = function (...args: any[]) { appels.push(m); return natif.apply(this, args) }
            }
            return el
          }
          const retirer = (el: any) => { if (el.parentNode) Node.prototype.removeChild.call(el.parentNode, el) }
          for (const t of transitions) {
            const appels: string[] = []
            const el = balise('div', appels)
            el.textContent = 'texte'
            el.style.cssText = 'width:120px;height:80px;background:teal'
            document.body.appendChild(el)
            try {
              const off = µ._mjs_fx(comp, el, t, { on: 'load', duration: '200ms' })
              await attendre(450)
              if (typeof off === 'function') off()
            }
            catch (e: any) { fautes[t] = String(e && e.message) }
            retirer(el)
            sortie[t] = [...new Set(appels)]
          }
          // *crossfade : une sortie et une entrée de même clé
          {
            const appels: string[] = []
            const a = balise('div', appels)
            const b = balise('div', appels)
            for (const x of [a, b]) {
              x.textContent = 'carte'
              x.style.cssText = 'width:120px;height:80px;background:teal'
              document.body.appendChild(x)
            }
            try {
              µ.anim.crossfade('banc', {})
              const pa = µ.anim.bancSend({ key: 7 }).outro(a)
              const pb = µ.anim.bancReceive({ key: 7 }).intro(b)
              await Promise.race([Promise.all([pa, pb]), attendre(3000)])
            }
            catch (e: any) { fautes.crossfade = String(e && e.message) }
            retirer(a)
            retirer(b)
            sortie.crossfade = [...new Set(appels)]
          }
          // *backlight avec sa légende : il isole le parent de la balise, et le rend tel qu'il était au retrait
          {
            const appels: string[] = []
            const parent = balise('div', appels)
            const img    = balise('img', appels)
            img.src = image
            img.alt = ''
            img.style.cssText = 'width:120px;height:80px;display:block'
            Node.prototype.appendChild.call(parent, img)
            document.body.appendChild(parent)
            try {
              const off = µ._mjs_fx(comp, img, 'backlight', { legend: true })
              await attendre(200)
              if (typeof off === 'function') off()
            }
            catch (e: any) { fautes.backlight = String(e && e.message) }
            sortie.backlightStyle = [String(parent.getAttribute === Element.prototype.getAttribute ? '' : Element.prototype.getAttribute.call(parent, 'style'))]
            retirer(parent)
            sortie.backlight = [...new Set(appels)]
          }
          return { sortie, fautes }
        }, [TRANSITIONS, METHODES, IMAGE] as [string[], string[], string])
        assert.deepEqual(rapport.fautes, {}, 'aucune transition ne lève')
        assert.deepEqual(rapport.sortie.backlightStyle, ['null'], 'le parent est rendu sans attribut style')
        delete rapport.sortie.backlightStyle
        const fautifs = Object.entries(rapport.sortie).filter(([, a]) => a.length > 0)
        assert.deepEqual(fautifs, [], 'aucune transition n\'appelle la méthode de l\'auteur')
      } finally {
        await browser.close()
      }
    })

    it('*ink garde au plus huit planches : la plus ancienne, chassée, est refaite quand on la redemande', async function () {
      if (!present || nom !== 'chromium') { this.skip(); return }
      const { browser, page } = await ouvrir()
      try {
        const r = await page.evaluate(() => {
          const µ: any = (globalThis as any).µ
          let faites = 0
          const natif = HTMLCanvasElement.prototype.toDataURL
          HTMLCanvasElement.prototype.toDataURL = function (...args: any[]) { faites++; return natif.apply(this, args as any) }
          // la planche d'une graine, sur une balise de 300 × 100
          const planche = (graine: number) => {
            const el = document.createElement('div')
            el.style.cssText = 'width:300px;height:100px'
            document.body.appendChild(el)
            const cfg = µ.anim.ink({ seed: graine }).intro(el)
            cfg.tick(0.5, 0.5)
            const masque = el.style.getPropertyValue('mask-image') || el.style.getPropertyValue('-webkit-mask-image')
            el.remove()
            return masque
          }
          const premiere = planche(1)
          for (let g = 2; g <= 10; g++) planche(g)
          const dix = faites
          planche(10)
          const derniere = faites
          planche(1)
          return { masque: premiere.length > 0, dix, derniere, refaite: faites }
        })
        assert.ok(r.masque, 'une planche de masque est posée')
        assert.equal(r.dix, 10, 'dix graines : dix planches')
        assert.equal(r.derniere, 10, 'la planche récente est reprise telle quelle')
        assert.equal(r.refaite, 11, 'la première, chassée par les huit plus récentes, est refaite')
      } finally {
        await browser.close()
      }
    })
  })
}
