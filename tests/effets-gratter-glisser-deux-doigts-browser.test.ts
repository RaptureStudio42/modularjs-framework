// Deux doigts dans Chromium (toucher simulé par le protocole du navigateur) :
//   - *scratch : seul le doigt qui a commencé le geste gratte ; un second doigt ne trace pas de trait depuis la place
//     du premier (la bande entre les deux restait grattée), et le lever n'arrête pas le premier ;
//   - *goo(mode: merge, drag: true) : le doigt qui tient une forme la garde ; un second doigt ne prend pas sa place
//     (la forme qu'il touchait sautait sous le premier), et le lever ne relâche pas la forme du premier.

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

const COMPOSANTS: Record<string, string> = {
  'fx-dd-gratter': '<div class="sc" *scratch(brush: 20)>gagné</div>\n<style>\n.sc\n  width: 300px\n  height: 200px\n</style>\n',
  'fx-dd-goo': [
    '<div class="go" *goo(mode: merge, drag: true)><div class="a"></div><div class="b"></div></div>',
    '<style>',
    '.go',
    '  position: relative',
    '  width: 600px',
    '  height: 300px',
    '.a, .b',
    '  position: absolute',
    '  top: 100px',
    '  width: 80px',
    '  height: 80px',
    '  background: red',
    '.a',
    '  left: 40px',
    '.b',
    '  left: 400px',
    '</style>',
    ''
  ].join('\n'),
}

describe('*scratch et *goo(drag) — deux doigts (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any
  let cdp: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-gratter-glisser-deux-doigts-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
    page    = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
    await page.route('http://t.test/**', async (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    // les pointeurs pressés et levés, dans l'ordre (le toucher simulé numérote les siens)
    await page.evaluate(() => {
      const w: any = window
      w.__ptr = []
      for (const t of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(t, (e: any) => w.__ptr.push([t, e.pointerId]), true)
    })
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  const toucher = async (type: string, points: any[]) => await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  // le second doigt se lève : son relâchement envoyé à la balise touchée (le toucher simulé ne lève pas un seul doigt
  // d'un geste), le premier reste posé ; rend le nombre de doigts pressés
  const leverSecond = async (nom: string, sel: string) => await page.evaluate(({ nom, sel }: any) => {
    const downs = (window as any).__ptr.filter((x: any) => x[0] === 'pointerdown').map((x: any) => x[1])
    const cible = (document.querySelector(nom) as any)._shadow.querySelector(sel)
    cible.dispatchEvent(new PointerEvent('pointerup', { pointerId: downs[1], pointerType: 'touch', isPrimary: false, bubbles: true, composed: true }))
    return downs.length
  }, { nom, sel })
  afterEach(async () => {
    await toucher('touchEnd', []).catch(() => {})
    await page.evaluate(() => { (window as any).__ptr = [] })
  })
  const poser   = async (nom: string, sel: string) => {
    await page.evaluate((nom: string) => { document.body.appendChild(document.createElement(nom)) }, nom)
    await page.waitForFunction(({ nom, sel }: any) => !!(document.querySelector(nom) as any)?._shadow?.querySelector(sel), { nom, sel }, { timeout: 60000 })
    await page.waitForTimeout(400)
    return await page.evaluate(({ nom, sel }: any) => {
      const r = (document.querySelector(nom) as any)._shadow.querySelector(sel).getBoundingClientRect()
      return [r.x, r.y]
    }, { nom, sel })
  }

  it('*scratch : le second doigt ne gratte pas la bande entre les deux, le lever n\'arrête pas le premier', async () => {
    const o = await poser('mjs-fx-dd-gratter', '[mjs-fx-layer="scratch"]')
    const P = (x: number, y: number, id: number) => ({ x: o[0] + x, y: o[1] + y, id })
    await toucher('touchStart', [P(40, 100, 1)])
    await toucher('touchStart', [P(40, 100, 1), P(260, 100, 2)])
    for (let k = 1; k <= 3; k++) await toucher('touchMove', [P(40, 100 + k, 1), P(260, 100 + k, 2)])
    // le second doigt se lève, le premier continue vers le bas
    assert.equal(await leverSecond('mjs-fx-dd-gratter', '[mjs-fx-layer="scratch"]'), 2)
    for (let k = 1; k <= 4; k++) await toucher('touchMove', [P(40, 103 + k * 10, 1)])
    await toucher('touchEnd', [])
    await page.waitForTimeout(200)
    const a = await page.evaluate(() => {
      const cv = (document.querySelector('mjs-fx-dd-gratter') as any)._shadow.querySelector('[mjs-fx-layer="scratch"]')
      const k  = cv.width / cv.clientWidth
      const g  = cv.getContext('2d')
      const al = (x: number, y: number) => g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3]
      return { doigt1: al(40, 101), milieu: al(150, 101), doigt1Apres: al(40, 135), temoin: al(150, 30) }
    })
    await page.evaluate(() => document.querySelector('mjs-fx-dd-gratter')!.remove())
    assert.deepEqual(a, { doigt1: 0, milieu: 255, doigt1Apres: 0, temoin: 255 })
  })

  it('*goo(drag) : chaque doigt n\'emporte que sa forme, un second doigt ne prend pas la place du premier', async () => {
    const o = await poser('mjs-fx-dd-goo', '.go')
    await page.evaluate(() => { (window as any).__ptr = [] })
    const Q = (x: number, y: number, id: number) => ({ x: o[0] + x, y: o[1] + y, id })
    const formes = async () => await page.waitForTimeout(50).then(() => page.evaluate(() => {
      const s = (document.querySelector('mjs-fx-dd-goo') as any)._shadow
      return { A: s.querySelector('.a').style.translate, B: s.querySelector('.b').style.translate }
    }))
    await toucher('touchStart', [Q(80, 140, 1)])
    await toucher('touchStart', [Q(80, 140, 1), Q(440, 140, 2)])
    await toucher('touchMove', [Q(90, 150, 1), Q(440, 140, 2)])
    const doigt1 = await formes()
    await toucher('touchMove', [Q(90, 150, 1), Q(450, 150, 2)])
    const doigt2 = await formes()
    assert.equal(await leverSecond('mjs-fx-dd-goo', '.b'), 2)
    await toucher('touchMove', [Q(100, 160, 1)])
    const apresLever = await formes()
    const journal = await page.evaluate(() => JSON.stringify((window as any).__ptr))
    await toucher('touchEnd', [])
    await page.evaluate(() => document.querySelector('mjs-fx-dd-goo')!.remove())
    assert.deepEqual({ doigt1, doigt2, apresLever }, {
      doigt1:     { A: '10px 10px', B: '' },
      doigt2:     { A: '10px 10px', B: '' },
      apresLever: { A: '20px 20px', B: '' },
    }, 'pointeurs : ' + journal)
  })
})
