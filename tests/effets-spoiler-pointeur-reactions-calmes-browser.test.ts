// Trois effets dans Chromium réel :
// *spoiler cache TOUT le contenu caché, pas seulement le texte : une image, un SVG, le fond d'un <mark> ne se voient ni à travers
// les grains ni sous `blur` (sous `blur`, le texte d'une balise du contenu reste flou, pas effacé) ; révélé, tout revient.
// *pointer(hide: true) posé dans une boîte de dialogue modale : le curseur du système est caché aussi sur ses liens (seule une
// couche du dessus ouverte DANS la zone le garde visible). *react sous « réduire les animations » : l'émoji apparaît puis s'efface
// sur place, sans voler — il ne disparaît plus tout à fait.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

const GIF   = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
const CACHE = `secret <img src="${GIF}" width="20" height="20"> <svg width="20" height="20"><rect width="20" height="20" fill="red"/></svg> <mark>surligné</mark> <b>gras</b>`
const PAGE  = `<div id="s1" style="width:400px">${CACHE}</div><div id="s2" style="width:400px">${CACHE}</div>`
  + '<dialog id="dl"><div id="pz" style="width:300px;height:80px">zone <a id="pl" href="#y">lien</a></div></dialog>'
  + '<div id="pz2" style="width:300px;height:80px">zone <dialog id="dl2"><a id="pl2" href="#z">lien</a></dialog></div>'

describe('*spoiler, *pointer(hide), *react calme (Chromium réel)', function () {
  this.timeout(240000)
  let present = false
  let script  = ''
  let browser: any = null
  let ctx: any = null
  let page: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-spoiler-pointeur-reactions-calmes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n<span *spoiler>x</span>\n<div *pointer(hide: true)>p</div>\n<button *react(🎉)>🎉</button>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) return this.skip()
    ctx  = await browser.newContext({ viewport: { width: 900, height: 700 } })
    page = await ctx.newPage()
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${PAGE}<script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
  })

  afterEach(async () => {
    if (ctx) await ctx.close()
    ctx = null
  })

  it('*spoiler caché : image, SVG, <mark> invisibles (grains) ; sous `blur`, médias cachés et texte gardé flou ; révélé, tout revient', async () => {
    await page.evaluate(() => {
      const µ = (window as any).µ
      µ._mjs_fx(null, document.getElementById('s1'), 'spoiler', {})
      µ._mjs_fx(null, document.getElementById('s2'), 'spoiler', { style: 'blur' })
    })
    // le calque arrive en fondu (`duration`, 500 ms)
    await page.waitForTimeout(700)
    const lire = () => page.evaluate(() => {
      const o = (id: string, sel: string) => getComputedStyle(document.getElementById(id)!.querySelector(sel)!).opacity
      return { grains: [o('s1', 'img'), o('s1', 'svg'), o('s1', 'mark'), o('s1', 'b'), o('s1', '[mjs-fx-layer="spoiler"]')], flou: [o('s2', 'img'), o('s2', 'svg'), o('s2', 'mark'), o('s2', 'b')] }
    })
    const cache = await lire()
    assert.deepEqual(cache, { grains: ['0', '0', '0', '0', '1'], flou: ['0', '0', '1', '1'] }, JSON.stringify(cache))
    await page.click('#s1', { position: { x: 5, y: 5 } })
    await page.click('#s2', { position: { x: 5, y: 5 } })
    await page.waitForTimeout(700)
    const revele = await lire()
    assert.deepEqual({ grains: revele.grains.slice(0, 4), flou: revele.flou }, { grains: ['1', '1', '1', '1'], flou: ['1', '1', '1', '1'] }, JSON.stringify(revele))
  })

  it('*pointer(hide: true) dans une boîte de dialogue modale : un lien n\'y montre plus le curseur du système ; une boîte ouverte DANS la zone le garde', async () => {
    const curseurs = await page.evaluate(() => {
      const µ = (window as any).µ
      ;(document.getElementById('dl') as any).showModal()
      µ._mjs_fx(null, document.getElementById('pz'), 'pointer', { hide: true })
      const dansLaBoite = [getComputedStyle(document.getElementById('pz')!).cursor, getComputedStyle(document.getElementById('pl')!).cursor]
      ;(document.getElementById('dl') as any).close()
      µ._mjs_fx(null, document.getElementById('pz2'), 'pointer', { hide: true })
      ;(document.getElementById('dl2') as any).showModal()
      const boiteDansLaZone = getComputedStyle(document.getElementById('pl2')!).cursor
      return { pose: document.getElementById('pz')!.hasAttribute('mjs-fx-pointer-hide'), dansLaBoite, boiteDansLaZone }
    })
    assert.deepEqual(curseurs, { pose: true, dansLaBoite: ['none', 'none'], boiteDansLaZone: 'pointer' }, JSON.stringify(curseurs))
  })

  it('*react sous « réduire les animations » : l\'émoji apparaît et s\'efface sur place', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const vu = await page.evaluate(async () => {
      const µ = (window as any).µ
      const ecoute: any = {}
      let salon = ''
      // une connexion simulée : l'émoji d'un autre visiteur arrive par `reactions:send`
      µ._mjs_fxSock = (_a: any, _b: any, _c: any, f: any) => { const off = f({ on: (ev: string, g: any) => { ecoute[ev] = g; return () => {} }, send() {} }); return () => off && off() }
      µ._mjs_fxPackage = () => {}
      µ._mjs_fxRoom = (_s: any, nom: string) => { salon = nom; return { leave() {} } }
      µ._mjs_fx(null, document.documentElement, 'react', { duration: '2s' })
      ecoute['reactions:send']({ room: salon.slice('reactions:'.length), e: '🎉' })
      const e = document.querySelector('[mjs-fx-react-emoji]') as HTMLElement
      const anims = e.getAnimations()
      const a = anims[0]
      const pris = (t: number) => {
        if (a) {
          a.pause()
          a.currentTime = t
        }
        const r = e.getBoundingClientRect()
        return { opacite: getComputedStyle(e).opacity, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      }
      return { animations: anims.length, debut: pris(100), milieu: pris(800), fin: pris(1950) }
    })
    assert.equal(vu.animations, 1, JSON.stringify(vu))
    assert.equal(vu.milieu.opacite, '1', 'visible au milieu : ' + JSON.stringify(vu))
    assert.ok(Number(vu.debut.opacite) < 1 && Number(vu.fin.opacite) < 1, 'un fondu à l\'entrée et à la sortie : ' + JSON.stringify(vu))
    assert.deepEqual([vu.debut.x, vu.debut.y], [vu.milieu.x, vu.milieu.y], 'sur place : ' + JSON.stringify(vu))
    assert.deepEqual([vu.fin.x, vu.fin.y], [vu.milieu.x, vu.milieu.y], 'sur place : ' + JSON.stringify(vu))
  })
})
