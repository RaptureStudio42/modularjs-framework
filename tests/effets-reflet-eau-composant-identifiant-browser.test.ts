// *reflect dans de vrais navigateurs :
//   - l'eau (`water: true`) ondule, sur un titre comme sur une image : la fréquence du bruit change d'une image à l'autre
//     et le reflet rendu aussi (Chromium laissait l'animation SMIL du filtre figée, sa valeur jamais appliquée) ;
//   - une balise qui CONTIENT un composant n'est pas copiée : la copie ferait naître un second composant (constructeur et
//     connectedCallback relancés, puis encore à chaque changement du contenu) ; blur et water y sont refusés avec un
//     avertissement, le reflet reste simple (-webkit-box-reflect dans Chromium) ; un composant arrivé plus tard fait de même ;
//   - Firefox (-moz-element) : un identifiant d'auteur qui commence par un chiffre ou contient un point donne un reflet.

import assert from 'node:assert/strict'
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

const RAYE  = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#fff"/>' + Array.from({ length: 10 }, (_, i) => '<rect x="' + (i * 20) + '" width="10" height="100" fill="#000"/>').join('') + '</svg>')
const ROUGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#f00"/></svg>')

// un composant de l'auteur qui compte ses naissances et ses entrées dans la page
const CARTE = `customElements.define('x-carte', class extends HTMLElement {
  constructor() { super(); window.__nees = (window.__nees || 0) + 1 }
  connectedCallback() { window.__entrees = (window.__entrees || 0) + 1; if (!this.textContent) this.textContent = 'carte' }
});`

const COMPOSANTS: Record<string, string> = {
  'fx-rf-titre':    '<h2 class="t" *reflect(water: true)>Un titre sur l\'eau</h2>\n<style>\n.t\n  margin: 0 0 80px\n  font-size: 40px\n</style>\n',
  'fx-rf-image':    '<img class="i" alt="" src="' + RAYE + '" *reflect(water: true)>\n<style>\n.i\n  display: block\n  width: 200px\n  height: 100px\n  margin-bottom: 80px\n</style>\n',
  'fx-rf-contient': '<div class="c" *reflect(blur: 2)><x-carte></x-carte> texte</div>\n',
  'fx-rf-tard':     '<div class="c" *reflect(blur: 2)>texte</div>\n',
  'fx-rf-ids':      '<img class="a" id="photo-a" alt="" src="' + ROUGE + '" *reflect><img class="b" id="2024-photo" alt="" src="' + ROUGE + '" *reflect><img class="c" id="user.avatar" alt="" src="' + ROUGE + '" *reflect>\n',
}

describe('*reflect — l\'eau qui ondule, une balise qui contient un composant, un identifiant à échapper (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-reflet-eau-composant-identifiant-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = CARTE + '\n' + [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  const ouvrir = async (nom: 'chromium' | 'firefox', ctx: any) => {
    const playwright = await import('playwright')
    ctx.browser = await playwright[nom].launch()
    ctx.page    = await (await ctx.browser.newContext({ viewport: { width: 900, height: 700 } })).newPage()
    ctx.avertissements = []
    ctx.page.on('console', (m: any) => { if (m.type() === 'warning') ctx.avertissements.push(m.text()) })
    await ctx.page.route('http://t.test/**', async (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>` })
    })
    await ctx.page.goto('http://t.test/', { waitUntil: 'load' })
  }

  describe('chromium', function () {
    const ctx: any = {}

    before(async function () {
      if (!(await navigateurPresent('chromium'))) {
        console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
        return this.skip()
      }
      await ouvrir('chromium', ctx)
    })

    after(async () => { await ctx.browser?.close() })

    for (const [quoi, nom, sel] of [['un titre', 'mjs-fx-rf-titre', '.t'], ['une image', 'mjs-fx-rf-image', '.i']]) {
      it(`l'eau ondule sous ${quoi} : la fréquence du bruit et le reflet rendu changent`, async () => {
        const geo = await ctx.page.evaluate(async ({ nom, sel }: any) => {
          const h: any = document.createElement(nom)
          document.body.appendChild(h)
          await new Promise((r) => setTimeout(r, 700))
          const s = h._shadow || h.shadowRoot
          const b = s.querySelector('[mjs-fx-layer="reflect"]')
          const r = b.getBoundingClientRect()
          return { mode: s.querySelector(sel).getAttribute('mjs-fx-reflect-mode'), box: [r.x, r.y, r.width, r.height] }
        }, { nom, sel })
        assert.equal(geo.mode, 'copy')
        const clip = { x: geo.box[0], y: geo.box[1], width: geo.box[2], height: geo.box[3] }
        const frequences: number[] = []
        const images: Buffer[] = []
        for (let k = 0; k < 3; k++) {
          frequences.push(await ctx.page.evaluate((nom: string) => { const h: any = document.querySelector(nom); return (h._shadow || h.shadowRoot).querySelector('feTurbulence').baseFrequencyX.animVal }, nom))
          images.push(await ctx.page.screenshot({ clip }))
          await ctx.page.waitForTimeout(350)
        }
        await ctx.page.evaluate((nom: string) => document.querySelector(nom)!.remove(), nom)
        assert.ok(new Set(frequences).size >= 2, 'fréquences lues à 350 ms d\'écart : ' + JSON.stringify(frequences))
        assert.ok(!(images[0].equals(images[1]) && images[1].equals(images[2])), 'trois images du reflet identiques à 350 ms d\'écart')
      })
    }

    it('une balise qui contient un composant : aucune copie, le composant ne naît qu\'une fois, le reflet reste simple', async () => {
      const r = await ctx.page.evaluate(async () => {
        const w: any = window
        w.__nees = 0
        w.__entrees = 0
        const h: any = document.createElement('mjs-fx-rf-contient')
        document.body.appendChild(h)
        await new Promise((f) => setTimeout(f, 500))
        const s = h._shadow || h.shadowRoot
        const c = s.querySelector('.c')
        const pose = { nees: w.__nees, entrees: w.__entrees, mode: c.getAttribute('mjs-fx-reflect-mode'), copies: s.querySelectorAll('[mjs-fx-layer="reflect"]').length }
        c.appendChild(document.createTextNode(' de plus'))
        c.classList.add('autre')
        await new Promise((f) => setTimeout(f, 300))
        const apres = { nees: w.__nees, entrees: w.__entrees }
        h.remove()
        return { pose, apres }
      })
      assert.deepEqual(r, { pose: { nees: 1, entrees: 1, mode: 'box', copies: 0 }, apres: { nees: 1, entrees: 1 } })
      assert.ok(ctx.avertissements.some((t: string) => /x-carte/.test(t) && /blur/.test(t)), 'avertissements : ' + JSON.stringify(ctx.avertissements))
    })

    it('un composant arrivé plus tard dans la balise copiée : la copie s\'arrête, le reflet reste simple', async () => {
      const r = await ctx.page.evaluate(async () => {
        const w: any = window
        const h: any = document.createElement('mjs-fx-rf-tard')
        document.body.appendChild(h)
        await new Promise((f) => setTimeout(f, 500))
        const s = h._shadow || h.shadowRoot
        const c = s.querySelector('.c')
        const avant = c.getAttribute('mjs-fx-reflect-mode')
        w.__nees = 0
        w.__entrees = 0
        c.appendChild(document.createElement('x-carte'))
        await new Promise((f) => setTimeout(f, 300))
        const out = { avant, nees: w.__nees, entrees: w.__entrees, mode: c.getAttribute('mjs-fx-reflect-mode'), copies: s.querySelectorAll('[mjs-fx-layer="reflect"]').length }
        h.remove()
        return out
      })
      assert.deepEqual(r, { avant: 'copy', nees: 1, entrees: 1, mode: 'box', copies: 0 })
    })
  })

  describe('firefox', function () {
    const ctx: any = {}

    before(async function () {
      if (!(await navigateurPresent('firefox'))) {
        console.log('  ℹ️  firefox non installé, test sauté. Activer : `npx playwright install firefox`')
        return this.skip()
      }
      await ouvrir('firefox', ctx)
    })

    after(async () => { await ctx.browser?.close() })

    it('-moz-element : un identifiant qui commence par un chiffre ou porte un point donne un reflet', async () => {
      const out = await ctx.page.evaluate(async () => {
        const h: any = document.createElement('mjs-fx-rf-ids')
        document.body.appendChild(h)
        await new Promise((f) => setTimeout(f, 800))
        const s = h._shadow || h.shadowRoot
        return ['a', 'b', 'c'].map((k) => {
          const i = s.querySelector('.' + k)
          const b = i.nextElementSibling
          return { id: i.id, mode: i.getAttribute('mjs-fx-reflect-mode'), fond: b ? getComputedStyle(b).backgroundImage : null }
        })
      })
      for (const o of out) {
        assert.equal(o.mode, 'moz', JSON.stringify(o))
        assert.ok(o.fond && o.fond !== 'none', 'aucun reflet pour #' + o.id + ' : ' + JSON.stringify(o))
      }
    })
  })
})
