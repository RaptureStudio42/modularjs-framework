// *border (dégradé) et *spotlight sur la même balise, dans Chromium, Firefox et WebKit, construits en production. Les deux dessinent
// d'ordinaire dans les deux pseudo-éléments de leur balise (`::before`, `::after`) ; ensemble, *spotlight les garde et le liseré et le
// halo du dégradé passent dans un calque de la balise, qui en porte les deux pseudo-éléments :
// - les pseudo-éléments de la balise ont exactement les styles de *spotlight posé seul (son halo, son liseré) ;
// - ceux du calque ont exactement les styles du dégradé posé seul (liseré, halo, tour des couleurs avec `animate`) ;
// - quel que soit l'ordre d'écriture (*border d'abord, ou *spotlight), et sur la balise d'un composant (le calque dans le composant) ;
// - posé seul, *border dessine comme avant dans les pseudo-éléments de sa balise, sans calque ; *spotlight retiré, il y revient ;
// - le halo du dégradé se voit hors de la balise comme celui de *border posé seul (pixels).

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

const SCENE = `<div class="b" *border>B</div>
<div class="p" *spotlight(on: always)>P</div>
<div class="bp" *border *spotlight(on: always)>BP</div>
<div class="pb" *spotlight(on: always) *border(animate: true)>PB</div>
<div class="ba" *border(animate: true)>BA</div>
<@bsp-carte class="cc" *border *spotlight(on: always)></@bsp-carte>
<style>
:host
  display: block
  padding: 50px
  background: #223
.b, .p, .bp, .pb, .ba, .cc
  display: block
  width: 200px
  height: 80px
  margin: 0 0 70px 0
  border-radius: 12px
  background: #334
  color: #fff
</style>
`

const CARTE = `<p>C</p>
<style>
:host
  display: block
</style>
`

const TAG    = 'mjs-bsp-scene'
const BALISE = (c: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${c}')`
// le calque du dégradé : dans la balise, ou dans le composant quand la balise en est un
const CALQUE = (c: string) => `((b) => Array.from((b._shadow || b.shadowRoot || b).children).find((e) => e.getAttribute('mjs-fx-layer') === 'border-gradient') || null)(${BALISE(c)})`
// ce que montre un pseudo-élément : les propriétés qui dessinent le liseré, le halo, la lumière
const PROPS  = ['content', 'position', 'backgroundImage', 'paddingTop', 'zIndex', 'opacity', 'filter', 'top', 'left', 'width', 'height', 'borderTopLeftRadius', 'animationName']
const STYLES = (cible: string, pseudo: string) => `((e) => { if (!e) return null; const s = getComputedStyle(e, '${pseudo}'); return Object.fromEntries(${JSON.stringify(PROPS)}.map((k) => [k, s[k]])) })(${cible})`
// la scène au repos : plus aucune transition sur ses balises, ses calques et leurs pseudo-éléments (l'allumage de *spotlight, un fondu de 0,3 s, fini et retiré)
const REPOS  = `(() => { const s = document.querySelector('${TAG}')._shadow; return [...s.querySelectorAll('*'), ...s.querySelector('.cc')._shadow.querySelectorAll('*')].every((e) => e.getAnimations({ subtree: true }).every((a) => !(a instanceof CSSTransition))) })()`

describe('*border (dégradé) et *spotlight ensemble sur une balise : chacun dessine comme seul', function () {
  this.timeout(900000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('border-spotlight-ensemble')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'bsp-scene.mjs'), SCENE)
    writeFileSync(join(srcDir, 'bsp-carte.mjs'), CARTE)
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
        page    = await (await browser.newContext({ viewport: { width: 400, height: 1000 } })).newPage()
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#223}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(`(() => { const s = document.querySelector('${TAG}')?._shadow; if (!s) return false; const a = (c, n) => n.split(' ').every((x) => (s.querySelector('.' + c)?.getAttribute('mjs-fx') || '').split(' ').includes(x)); return a('b', 'border') && a('p', 'spotlight') && a('bp', 'border spotlight') && a('pb', 'border spotlight') && a('ba', 'border') && a('cc', 'border spotlight') && s.querySelector('.cc')._shadow })()`, null, { timeout: 60000, polling: 50 })
        // les pseudo-éléments se comparent au repos, attendu image par image et non une durée : WebKit ne relit le style d'une transition
        // qu'à l'image qui suit, et une page qui ne dessine plus (machine chargée) garde celui d'un fondu à mi-course, fini à son horloge
        await page.waitForFunction(REPOS, null, { timeout: 10000, polling: 'raf' })
      })

      after(async () => { await browser?.close() })

      it('posé seul, *border dessine dans les pseudo-éléments de sa balise, sans calque', async () => {
        assert.equal(await page.evaluate(CALQUE('b')), null)
        const apres = await page.evaluate(STYLES(BALISE('b'), '::after'))
        const avant = await page.evaluate(STYLES(BALISE('b'), '::before'))
        assert.match(apres.backgroundImage, /^linear-gradient/, 'le liseré : ' + apres.backgroundImage)
        assert.equal(apres.paddingTop, '4px')
        assert.equal(apres.zIndex, '-1')
        assert.match(avant.filter, /blur\(15px\)/, 'le halo : ' + avant.filter)
        assert.equal(avant.top, '-30px')
      })

      for (const c of ['bp', 'pb', 'cc']) {
        it(`.${c} : les pseudo-éléments de la balise sont ceux de *spotlight posé seul`, async () => {
          for (const pseudo of ['::before', '::after']) {
            assert.deepEqual(await page.evaluate(STYLES(BALISE(c), pseudo)), await page.evaluate(STYLES(BALISE('p'), pseudo)), pseudo)
          }
        })

        it(`.${c} : le liseré et le halo du dégradé sont dans un calque, aux styles de *border posé seul`, async () => {
          const seul = c === 'pb' ? 'ba' : 'b'
          assert.notEqual(await page.evaluate(CALQUE(c)), null, 'aucun calque du dégradé')
          for (const pseudo of ['::before', '::after']) {
            assert.deepEqual(await page.evaluate(STYLES(CALQUE(c), pseudo)), await page.evaluate(STYLES(BALISE(seul), pseudo)), pseudo)
          }
          const calque = await page.evaluate(`((l) => [l.getAttribute('aria-hidden'), getComputedStyle(l).pointerEvents, getComputedStyle(l).position])(${CALQUE(c)})`)
          assert.deepEqual(calque, ['true', 'none', 'absolute'])
        })
      }

      it('le halo du dégradé se voit hors de la balise, comme celui de *border posé seul (pixels)', async () => {
        const pixel = async (c: string) => {
          const r = await page.evaluate(`((r) => [r.left, r.top, r.width, r.height])(${BALISE(c)}.getBoundingClientRect())`)
          const png: Buffer = await page.screenshot({ clip: { x: Math.round(r[0] - 10), y: Math.round(r[1] + r[3] / 2), width: 1, height: 1 } })
          return page.evaluate(async (s: string) => {
            const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
            const k   = new OffscreenCanvas(1, 1)
            const g   = k.getContext('2d') as OffscreenCanvasRenderingContext2D
            g.drawImage(bmp, 0, 0)
            return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3)
          }, png.toString('base64'))
        }
        const seul     = await pixel('b')
        const ensemble = await pixel('bp')
        assert.ok(Math.abs(seul[0] - 34) + Math.abs(seul[1] - 34) + Math.abs(seul[2] - 51) > 40, 'le halo de *border seul se voit : ' + seul.join(','))
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(seul[i] - ensemble[i]) <= 8, `même halo hors de la balise : ${seul.join(',')} / ${ensemble.join(',')}`)
      })

      it('*spotlight retiré : *border revient dans les pseudo-éléments de sa balise, le calque part', async () => {
        // le retrait de *spotlight par le moteur : sa poignée, rangée sur la balise sous un nom que la production raccourcit (la table
        // des effets posés, un objet qui porte une fonction `spotlight`)
        await page.evaluate(`((b) => Object.keys(b).map((k) => b[k]).find((v) => v && typeof v === 'object' && typeof v.spotlight === 'function' && typeof v.border === 'function').spotlight())(${BALISE('bp')})`)
        await page.waitForFunction(`${CALQUE('bp')} === null`, null, { timeout: 5000, polling: 20 })
        for (const pseudo of ['::before', '::after']) {
          assert.deepEqual(await page.evaluate(STYLES(BALISE('bp'), pseudo)), await page.evaluate(STYLES(BALISE('b'), pseudo)), pseudo)
        }
      })

      it('aucune erreur ni avertissement', () => {
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
