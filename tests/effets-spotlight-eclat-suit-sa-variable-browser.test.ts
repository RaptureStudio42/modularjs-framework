// *spotlight(every: $e) dans Chromium réel, construit en production (les sections de l'effet triées par ce que la page écrit) :
// l'éclat suit sa variable dans les deux sens — passée de rien à 1s, la lumière s'allume par instants ; de 1s à rien, elle ne clignote
// plus —, que la lumière suive la souris ou se tienne en un point (`origin`).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

const PAGE = `<script>
$a = null
$b = '1s'
$c = null
</script>
<div class="carte a" *spotlight(on: always, every: $a)></div>
<div class="carte b" *spotlight(on: always, every: $b)></div>
<div class="carte c" *spotlight(origin: bottom-left, on: always, every: $c)></div>
<button class="a-allume" @click={$a = '1s'}>a</button>
<button class="a-eteint" @click={$a = null}>a</button>
<button class="b-eteint" @click={$b = null}>b</button>
<button class="c-allume" @click={$c = '1s'}>c</button>
<button class="c-eteint" @click={$c = null}>c</button>
<style>
:host
  display: block
.carte
  position: relative
  width: 260px
  height: 80px
  margin: 16px
  background: #111
</style>
`

const TAG   = 'mjs-spot-eclat'
const BOITE = (classe: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${classe}')`

describe('*spotlight : l\'éclat suit sa variable, dans un vrai navigateur', function () {
  this.timeout(300000)
  let script  = ''
  let browser: any = null
  let page: any    = null
  const erreurs: string[] = []

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('spotlight-eclat-variable')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'spot-eclat.mjs'), PAGE)
    const manifeste = join(outDir, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
    const stats     = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    script  = stripEsm(readFileSync(manifeste, 'utf-8'))
    browser = await (await import('playwright')).chromium.launch()
    page    = await (await browser.newContext({ viewport: { width: 320, height: 800 } })).newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(`['a', 'b', 'c'].every((c) => document.querySelector('${TAG}')?._shadow?.querySelector('.' + c)?.hasAttribute('mjs-fx-spot-on'))`, null, { timeout: 60000, polling: 50 })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  // l'attribut de l'éclat et l'animation du halo, lus sur une carte
  const eclat = (classe: string) => page.evaluate(`(() => { const e = ${BOITE(classe)}; return { attr: e.hasAttribute('mjs-fx-spot-every'), anim: getComputedStyle(e, '::after').animationName } })()`)
  const clic  = async (classe: string) => {
    await page.evaluate(`${BOITE(classe)}.click()`)
    await page.waitForTimeout(150)
  }

  it('la lumière qui suit la souris : de rien à 1s, l\'éclat part ; de 1s à rien, il s\'arrête', async () => {
    assert.deepEqual(await eclat('a'), { attr: false, anim: 'none' }, 'sans every, aucun éclat')
    assert.deepEqual(await eclat('b'), { attr: true, anim: 'mjs-fx-spot-flash' }, 'every: 1s, l\'éclat')
    await clic('a-allume')
    assert.deepEqual(await eclat('a'), { attr: true, anim: 'mjs-fx-spot-flash' }, '$a passée à 1s : l\'éclat part')
    await clic('b-eteint')
    assert.deepEqual(await eclat('b'), { attr: false, anim: 'none' }, '$b passée à rien : plus d\'éclat')
    await clic('a-eteint')
    assert.deepEqual(await eclat('a'), { attr: false, anim: 'none' }, '$a revenue à rien : plus d\'éclat')
    assert.deepEqual(erreurs, [])
  })

  it('la lumière tenue en un point (`origin`) : l\'éclat suit sa variable aussi', async () => {
    assert.deepEqual(await eclat('c'), { attr: false, anim: 'none' }, 'sans every, aucun éclat')
    await clic('c-allume')
    assert.deepEqual(await eclat('c'), { attr: true, anim: 'mjs-fx-spot-flash' }, '$c passée à 1s : l\'éclat part')
    await clic('c-eteint')
    assert.deepEqual(await eclat('c'), { attr: false, anim: 'none' }, '$c revenue à rien : plus d\'éclat')
    assert.deepEqual(erreurs, [])
  })
})
