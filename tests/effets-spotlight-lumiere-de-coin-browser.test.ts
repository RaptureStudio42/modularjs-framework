// *spotlight dans de vrais navigateurs, construit en production (les sections de l'effet triées par ce que la page écrit) :
// - *spotlight.corner_glow : allumée sans la souris, la lumière se tient au coin du bas à gauche ; la souris qui passe ne la déplace pas ;
// - `origin` sans `on: always` : la lumière s'allume au coin le temps du survol, et s'éteint à la sortie ;
// - `glow` règle seul la portée du halo dans la boîte (sans lui, 0,72 fois `size` : 144 px pour 200) ;
// - *spotlight.corner_flash : la lumière s'allume par instants (une animation d'opacité qui se répète), puis s'éteint entre deux éclats.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const PAGE = `<div class="carte coin" *spotlight.corner_glow></div>
<div class="carte survol" *spotlight(origin: top-right, color: #f00, fill: 1)></div>
<div class="carte portee" *spotlight(on: always, color: #f00, fill: 1, glow: 50)></div>
<div class="carte defaut" *spotlight(on: always, color: #f00, fill: 1)></div>
<div class="carte eclat" *spotlight.corner_flash></div>
<style>
:host
  display: block
.carte
  position: relative
  width: 260px
  height: 120px
  margin: 16px
  background: #111
  border-radius: 12px
</style>
`

const TAG   = 'mjs-spot-coin'
const CARTE = (classe: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${classe}')`
const APRES = (classe: string, prop: string) => `getComputedStyle(${CARTE(classe)}, '::after').${prop}`
const VARS  = (classe: string) => `[${CARTE(classe)}.style.getPropertyValue('--mjs-fx-spot-x'), ${CARTE(classe)}.style.getPropertyValue('--mjs-fx-spot-y')]`

describe('*spotlight : la lumière de coin, dans un vrai navigateur', function () {
  this.timeout(900000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('spotlight-coin')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'spot-coin.mjs'), PAGE)
    const manifeste = join(outDir, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
    const stats     = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    script = stripEsm(readFileSync(manifeste, 'utf-8'))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    describe(nom, function () {
      let browser: any
      let page: any
      const erreurs: string[] = []

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
        page    = await (await browser.newContext({ viewport: { width: 320, height: 800 } })).newPage()
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`['coin', 'survol', 'portee', 'defaut', 'eclat'].every((c) => document.querySelector('${TAG}')?._shadow?.querySelector('.' + c)?.hasAttribute('mjs-fx'))`, null, { timeout: 60000, polling: 50 })
      })

      after(async () => { await browser?.close() })

      it('*spotlight.corner_glow : allumée sans la souris, au coin du bas à gauche, et la souris ne la déplace pas', async () => {
        await page.waitForFunction(`${CARTE('coin')}.hasAttribute('mjs-fx-spot-on') && +${APRES('coin', 'opacity')} >= 0.95`, null, { timeout: 10000, polling: 50 })
        assert.deepEqual(await page.evaluate(VARS('coin')), ['0%', '100%'])
        assert.match(await page.evaluate(APRES('coin', 'backgroundImage')), /at 0% 100%/)
        const b = await page.evaluate(`(() => { const r = ${CARTE('coin')}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()`)
        await page.mouse.move(b[0] + b[2] * 0.7, b[1] + b[3] * 0.3, { steps: 5 })
        await page.mouse.move(b[0] + b[2] * 0.4, b[1] + b[3] * 0.6, { steps: 5 })
        assert.deepEqual(await page.evaluate(VARS('coin')), ['0%', '100%'])
        assert.equal(await page.evaluate(`${CARTE('coin')}.hasAttribute('mjs-fx-live')`), false)
        await page.mouse.move(1, 790)
        assert.equal(await page.evaluate(`${CARTE('coin')}.hasAttribute('mjs-fx-spot-on')`), true)
      })

      it('`origin` sans `on: always` : allumée au coin le temps du survol', async () => {
        assert.equal(await page.evaluate(`${CARTE('survol')}.hasAttribute('mjs-fx-spot-on')`), false)
        assert.deepEqual(await page.evaluate(VARS('survol')), ['100%', '0%'])
        const b = await page.evaluate(`(() => { const r = ${CARTE('survol')}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()`)
        await page.mouse.move(b[0] + 20, b[1] + 60, { steps: 4 })
        await page.waitForFunction(`${CARTE('survol')}.hasAttribute('mjs-fx-spot-on')`, null, { timeout: 5000, polling: 50 })
        assert.deepEqual(await page.evaluate(VARS('survol')), ['100%', '0%'])
        await page.mouse.move(1, 790)
        await page.waitForFunction(`!${CARTE('survol')}.hasAttribute('mjs-fx-spot-on')`, null, { timeout: 5000, polling: 50 })
      })

      it('`glow` règle la portée du halo ; sans lui, 0,72 fois `size`', async () => {
        assert.match(await page.evaluate(APRES('portee', 'backgroundImage')), /^radial-gradient\((circle )?50px[ ,]/)
        assert.match(await page.evaluate(APRES('defaut', 'backgroundImage')), /^radial-gradient\((circle )?144px[ ,]/)
      })

      it('*spotlight.corner_flash : la lumière s\'allume par instants', async () => {
        const anims = await page.evaluate(`${CARTE('eclat')}.getAnimations({ subtree: true }).filter((a) => a.animationName === 'mjs-fx-spot-flash' && a.effect && a.effect.pseudoElement === '::after').length`)
        assert.equal(anims, 1)
        const vus = await page.evaluate(`new Promise((ok) => { const v = []; const t0 = performance.now(); const f = () => { v.push(+getComputedStyle(${CARTE('eclat')}, '::after').opacity); if (performance.now() - t0 < 3200) setTimeout(f, 40); else ok(v) }; f() })`)
        assert.ok(Math.max(...vus) >= 0.9, 'jamais allumée : ' + Math.max(...vus))
        assert.ok(Math.min(...vus) <= 0.1, 'jamais éteinte : ' + Math.min(...vus))
      })

      it('aucune erreur ni avertissement', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
