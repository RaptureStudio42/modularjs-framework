// `visible: 100%` / `visible: 50%` : la part de la balise qui doit être à l'écran pour que `on: view` se déclenche, en vrais
// navigateurs (Chromium, Firefox, WebKit) — une transition (*fade), un effet qui se joue (*stagger), un effet qui boucle (*pulse, qui
// s'arrête aussi sous sa part, comme il s'arrête hors de l'écran) ; sans `visible`, les seuils de toujours (15 %, 20 %, 10 %). Une
// balise plus haute que l'écran ne montre jamais 100 % d'elle-même : `100%` part quand elle remplit l'écran, `50%` quand elle en couvre
// la moitié ; un article de 3 000 px dans une zone de 160 px qui défile : quand la zone est entière à l'écran. Une vraie mise en page
// est nécessaire : pas de happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCE = [
  '<div class="vide"></div>',
  '<div class="b" id="t100" *fade(on: view, visible: 100%)>transition 100</div>',
  '<div class="vide"></div>',
  '<div class="b" id="t50" *fade(on: view, visible: 50%)>transition 50</div>',
  '<div class="vide"></div>',
  '<div class="b" id="tdef" *fade(on: view)>transition défaut</div>',
  '<div class="vide"></div>',
  '<div class="b" id="p100" *stagger(on: view, visible: 100%)>se joue 100</div>',
  '<div class="vide"></div>',
  '<div class="b" id="p50" *stagger(visible: 50%)>se joue 50</div>',
  '<div class="vide"></div>',
  '<div class="b" id="pdef" *stagger>se joue défaut</div>',
  '<div class="vide"></div>',
  '<div class="b" id="l100" *pulse(on: view, visible: 100%)>boucle 100</div>',
  '<div class="vide"></div>',
  '<div class="b" id="l50" *pulse(on: view, visible: 50%)>boucle 50</div>',
  '<div class="vide"></div>',
  '<div class="b" id="ldef" *pulse(on: view)>boucle défaut</div>',
  '<div class="vide"></div>',
  '<div class="haut" id="haut" *stagger(visible: 100%)>plus haute que l\'écran</div>',
  '<div class="vide"></div>',
  '<div class="haut" id="haut50" *stagger(visible: 50%)>plus haute que l\'écran, à moitié</div>',
  '<div class="vide"></div>',
  '<div class="zone" id="zone"><div class="article" id="article" *stagger(visible: 100%)>article dans sa zone</div></div>',
  '<div class="vide"></div>',
  '<style>',
  '.vide',
  '  height: 1200px',
  '.b',
  '  height: 200px',
  '.haut',
  '  height: 2000px',
  '.zone',
  '  width: 300px',
  '  height: 160px',
  '  overflow: auto',
  '.article',
  '  height: 3000px',
  '</style>',
].join('\n')

describe('visible : la part de on: view réglable (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-visible-part-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'part-ecran.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null
      let page: any = null

      before(async () => {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-part-ecran></mjs-part-ecran><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-part-ecran') as any)?._shadow?.querySelector('#article[mjs-fx]'))
        // chaque entrée d'une transition jouée est comptée sur sa balise
        await page.evaluate(() => {
          const w: any = window
          const jouer = w.µ._mjs_playTransition
          w.µ._mjs_playTransition = function(this: any, ...args: any[]) {
            if (args[2] === 'in') args[0].__entrees = (args[0].__entrees || 0) + 1
            return jouer.apply(this, args)
          }
          w.__trouve = (id: string) => (document.querySelector('mjs-part-ecran') as any)._shadow.querySelector('#' + id)
        })
      })

      after(async () => { if (browser) await browser.close() })

      // le haut de la balise placé à `haut` px du haut de l'écran (de 844 px)
      async function placer(id: string, haut: number) {
        await page.evaluate(([i, h]: [string, number]) => {
          const el: any = (window as any).__trouve(i)
          window.scrollBy(0, el.getBoundingClientRect().top - h)
        }, [id, haut])
        await page.waitForTimeout(300)
      }
      // `reste` px de la balise à l'écran, entrée par le bas
      const montrer = (id: string, reste: number) => placer(id, 844 - reste)

      const entree  = (id: string) => page.evaluate((i: string) => ((window as any).__trouve(i).__entrees || 0) > 0, id)
      const attend  = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).hasAttribute('mjs-fx-wait'), id)
      const tourne  = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).style.getPropertyValue('--mjs-fx-pulse-go') !== 'none', id)

      it('une transition : 100 % attend la balise entière, 50 % la moitié, sans visible 15 %', async function () {
        if (!present) { this.skip(); return }
        await montrer('t100', 110)
        assert.equal(await entree('t100'), false, '55 %')
        await montrer('t100', 190)
        assert.equal(await entree('t100'), false, '95 %')
        await montrer('t100', 300)
        assert.equal(await entree('t100'), true, 'entière')
        await montrer('t50', 90)
        assert.equal(await entree('t50'), false, '45 %')
        await montrer('t50', 110)
        assert.equal(await entree('t50'), true, '55 %')
        await montrer('tdef', 20)
        assert.equal(await entree('tdef'), false, '10 %')
        await montrer('tdef', 40)
        assert.equal(await entree('tdef'), true, '20 %')
      })

      it('un effet qui se joue : 100 %, 50 %, sans visible 20 %', async function () {
        if (!present) { this.skip(); return }
        await montrer('p100', 190)
        assert.equal(await attend('p100'), true, '95 %')
        await montrer('p100', 300)
        assert.equal(await attend('p100'), false, 'entière')
        await montrer('p50', 90)
        assert.equal(await attend('p50'), true, '45 %')
        await montrer('p50', 110)
        assert.equal(await attend('p50'), false, '55 %')
        await montrer('pdef', 30)
        assert.equal(await attend('pdef'), true, '15 %')
        await montrer('pdef', 50)
        assert.equal(await attend('pdef'), false, '25 %')
      })

      it('un effet qui boucle : il tourne au-dessus de sa part, s\'arrête en dessous, comme hors de l\'écran', async function () {
        if (!present) { this.skip(); return }
        await montrer('l100', 190)
        assert.equal(await tourne('l100'), false, '95 %')
        await montrer('l100', 300)
        assert.equal(await tourne('l100'), true, 'entière')
        await montrer('l100', 110)
        assert.equal(await tourne('l100'), false, 'revenue à 55 %')
        await montrer('l50', 90)
        assert.equal(await tourne('l50'), false, '45 %')
        await montrer('l50', 110)
        assert.equal(await tourne('l50'), true, '55 %')
        await montrer('ldef', 10)
        assert.equal(await tourne('ldef'), false, '5 %')
        await montrer('ldef', 30)
        assert.equal(await tourne('ldef'), true, '15 %')
      })

      it('une balise plus haute que l\'écran : 100 % part quand elle le remplit, 50 % quand elle en couvre la moitié', async function () {
        if (!present) { this.skip(); return }
        await montrer('haut', 800)
        assert.equal(await attend('haut'), true, '800 px sur 844')
        await montrer('haut', 830)
        assert.equal(await attend('haut'), true, '830 px sur 844')
        await placer('haut', -10)
        assert.equal(await attend('haut'), false, 'l\'écran rempli')
        await montrer('haut50', 380)
        assert.equal(await attend('haut50'), true, '380 px sur 844')
        await montrer('haut50', 460)
        assert.equal(await attend('haut50'), false, '460 px sur 844')
      })

      // à 152 px, l'article a déjà passé le seuil de 5 % (150 px sur 3 000) : de là à la zone entière (160 px, 5,3 %), seul le palier
      // de la balise plus grande que sa zone prévient
      it('un article de 3 000 px dans une zone de 160 px qui défile : 100 % quand la zone est entière à l\'écran', async function () {
        if (!present) { this.skip(); return }
        await montrer('zone', 140)
        assert.equal(await attend('article'), true, '140 px de la zone sur 160')
        await montrer('zone', 152)
        assert.equal(await attend('article'), true, '152 px de la zone sur 160')
        await montrer('zone', 200)
        assert.equal(await attend('article'), false, 'la zone entière')
      })
    })
  }
})
