// *flipcard(on: hover), dans Chromium et WebKit réels : un lecteur d'écran qui active la commande « Retourner la carte » y porte
// d'abord le focus, puis la clique, sans touche. Le focus retourne la carte ; le clic qui le suit ne la remet pas au recto : elle reste
// retournée, pressée, le verso lisible. Un second clic la remet. Échap la remet toujours. Au clavier, rien ne change : Tab la retourne,
// Entrée la bascule.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const CARTE = '<p><a id="avant" href="#a">avant</a></p><div id="c" style="width:300px;height:120px"><div><h3>Offre</h3><a id="lien" href="#x">En savoir plus</a></div><div><p>Verso</p><button id="achat">Acheter</button></div></div>'

describe('*flipcard(on: hover) — la commande focalisée puis cliquée laisse la carte retournée', function () {
  this.timeout(240000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-carte-focus-puis-clic')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-carte.mjs'), '<div *flipcard><div>r</div><div>v</div></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    if (libelles) script += ` µ._runtimeLabels = ${libelles[1]};`
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'webkit'] as const) {
    describe(`${moteur} réel`, function () {
      let browser: any = null
      let ctx: any = null
      let page: any = null

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) {
          console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
          return this.skip()
        }
        browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => {
        if (browser) await browser.close()
      })

      beforeEach(async () => {
        ctx  = await browser.newContext({ viewport: { width: 900, height: 900 } })
        page = await ctx.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${CARTE}<script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.evaluate(() => { (window as any).µ._mjs_fx(null, document.getElementById('c'), 'flipcard', { on: 'hover', duration: '0s' }) })
        await page.waitForTimeout(150)
        // un clic de souris loin de la carte, comme avant de passer au lecteur d'écran
        await page.mouse.click(5, 880)
        await page.waitForTimeout(80)
      })

      afterEach(async () => {
        if (ctx) await ctx.close()
        ctx = null
      })

      const etat = () => page.evaluate(() => {
        const c = document.getElementById('c')!
        const b = c.querySelector(':scope > [mjs-fx-flipcard-turn]')
        const verso = c.querySelector('[mjs-fx-flipcard-face="back"]')
        return {
          t: c.style.getPropertyValue('--mjs-fx-flipcard-t'),
          pressee: b ? b.getAttribute('aria-pressed') : null,
          versoInerte: !!verso && (verso as any).inert === true,
          focus: !!b && document.activeElement === b
        }
      })

      // l'activation d'un lecteur d'écran : le focus porté sur la commande par script, puis son clic, sans touche
      const focaliser = () => page.evaluate(() => { (document.querySelector('#c > [mjs-fx-flipcard-turn]') as HTMLElement).focus() })
      const cliquer   = () => page.evaluate(() => { (document.querySelector('#c > [mjs-fx-flipcard-turn]') as HTMLElement).click() })
      const pause     = (ms = 80) => page.waitForTimeout(ms)

      it('focus puis clic, en deux temps : la carte reste retournée ; un second clic la remet, un troisième la retourne', async () => {
        await focaliser()
        await pause()
        let e = await etat()
        assert.deepEqual([e.focus, e.t, e.pressee], [true, '1', 'true'], 'le focus retourne la carte : ' + JSON.stringify(e))
        await cliquer()
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee, e.versoInerte], ['1', 'true', false], 'le clic qui suit le focus la laisse retournée, verso lisible : ' + JSON.stringify(e))
        await cliquer()
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['0', 'false'], 'un second clic la remet : ' + JSON.stringify(e))
        await cliquer()
        await pause()
        assert.equal((await etat()).t, '1', 'un troisième la retourne')
      })

      it('focus puis clic dans la même tâche : la carte reste retournée', async () => {
        await page.evaluate(() => {
          const b = document.querySelector('#c > [mjs-fx-flipcard-turn]') as HTMLElement
          b.focus()
          b.click()
        })
        await pause()
        const e = await etat()
        assert.deepEqual([e.t, e.pressee], ['1', 'true'], JSON.stringify(e))
      })

      it('Échap la remet toujours : après le focus seul, après le clic qui le suit', async () => {
        await focaliser()
        await pause()
        await page.keyboard.press('Escape')
        await pause()
        let e = await etat()
        assert.deepEqual([e.focus, e.t], [true, '0'], 'après le focus : ' + JSON.stringify(e))
        await page.mouse.click(5, 880)
        await pause()
        await focaliser()
        await pause()
        await cliquer()
        await pause()
        await page.keyboard.press('Escape')
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['0', 'false'], 'après le clic qui suit le focus : ' + JSON.stringify(e))
        // remise au recto par Échap : le clic suivant la retourne
        await cliquer()
        await pause()
        assert.equal((await etat()).t, '1', 'le clic qui suit Échap la retourne')
      })

      it('au clavier, rien ne change : Tab la retourne, Entrée la remet, Entrée la retourne', async () => {
        await page.focus('#avant')
        await page.keyboard.press('Tab')
        await pause()
        let e = await etat()
        assert.deepEqual([e.focus, e.t], [true, '1'], JSON.stringify(e))
        await page.keyboard.press('Enter')
        await pause()
        e = await etat()
        assert.deepEqual([e.t, e.pressee], ['0', 'false'], JSON.stringify(e))
        await page.keyboard.press('Enter')
        await pause()
        assert.equal((await etat()).t, '1')
      })
    })
  }
})
