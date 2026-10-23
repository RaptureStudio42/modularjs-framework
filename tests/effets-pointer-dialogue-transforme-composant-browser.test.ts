// *pointer et la couche du dessus, dans Chromium réel :
// - posé dans une boîte de dialogue modale centrée par `transform` (`top: 50%; left: 50%; transform: translate(-50%, -50%)`, le motif
//   courant), son calque vit dans la boîte, qui devient le bloc contenant de ses pièces fixes : le disque se dessine pourtant sous la
//   souris, pas décalé de la place de la boîte, et `hide` laisse un curseur utilisable ;
// - `<@document *pointer(hide: true)>` et un composant (shadow DOM, ouvert ou celui d'un composant MJS) dans une boîte de dialogue
//   modale : au-dessus du composant, le disque s'éteint et le curseur du système reste visible, comme sur le texte de la boîte ; hors de
//   la couche du dessus, un composant de la page cache toujours le curseur du système.

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

const SOURCES: Record<string, string> = {
  'fx-boite.mjs': [
    '<dialog class="d"><div class="z" *pointer(disc, size: 40, smooth: 1, hide: true)></div></dialog>',
    '<style>',
    '.d',
    '  top: 50%',
    '  left: 50%',
    '  transform: translate(-50%, -50%)',
    '  margin: 0',
    '  padding: 0',
    '  border: 0',
    '  width: 400px',
    '  height: 300px',
    '.z',
    '  width: 400px',
    '  height: 300px',
    '  background: #fff',
    '</style>',
    ''
  ].join('\n'),
  'fx-carte.mjs': [
    '<p class="in">dans le composant</p>',
    '<style>',
    '.in',
    '  margin: 0',
    '  height: 80px',
    '  background: #efe',
    '</style>',
    ''
  ].join('\n')
}

// un composant natif à l'ombre ouverte, hors de MJS
const CARTE = 'customElements.define("x-carte", class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: "open" }); r.innerHTML = "<p id=\\"in\\" style=\\"margin:0;height:80px;background:#fee\\">dans le composant</p>" } });'

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-pointer-dialogue-transforme')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compilation
}

describe('*pointer — boîte de dialogue centrée par transform, composant dans la couche du dessus (Chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium indisponible, tests sautés')
      return
    }
    script = await compile()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvre(corps: string) {
    const contexte = await browser.newContext({ viewport: { width: 1000, height: 800 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font:16px sans-serif}</style></head><body>${corps}<script>${CARTE}\n${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    return { contexte, page, erreurs }
  }

  // quelques pas de souris jusqu'à (x, y), puis le temps que le disque s'y pose
  async function vers(page: any, x: number, y: number) {
    for (let i = 4; i >= 0; i--) {
      await page.mouse.move(x - i * 6, y - i * 3)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(350)
  }

  it('dans une boîte de dialogue centrée par transform, le disque est sous la souris (à 1,5 px près), allumé', async function () {
    if (!present) return this.skip()
    const { contexte, page, erreurs } = await ouvre('<mjs-fx-boite></mjs-fx-boite>')
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-boite') as any)?._shadow?.querySelector('.z[mjs-fx]'))
    const boite = await page.evaluate(() => {
      const d = (document.querySelector('mjs-fx-boite') as any)._shadow.querySelector('dialog')
      d.showModal()
      const r = d.getBoundingClientRect()
      return { x: r.left, y: r.top }
    })
    await vers(page, 450, 375)
    const vu = await page.evaluate(() => {
      const sh = (document.querySelector('mjs-fx-boite') as any)._shadow
      const calque = sh.querySelector('[mjs-fx-pointer-layer]')
      const disque = calque && calque.querySelector('i')
      const r = disque ? disque.getBoundingClientRect() : null
      return { centre: r ? [r.left + r.width / 2, r.top + r.height / 2] : null, allume: calque ? calque.hasAttribute('mjs-fx-pointer-on') : null, dansLaBoite: !!(calque && calque.closest('dialog')) }
    })
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.deepEqual(boite, { x: 300, y: 250 }, 'la boîte est bien déplacée par son transform')
    assert.equal(vu.dansLaBoite, true, 'le calque vit dans la boîte')
    assert.equal(vu.allume, true, 'le disque est allumé')
    assert.ok(vu.centre && Math.abs(vu.centre[0] - 450) <= 1.5 && Math.abs(vu.centre[1] - 375) <= 1.5, 'disque sous la souris (450, 375) : ' + JSON.stringify(vu.centre))
  })

  it('<@document *pointer(hide)> : au-dessus d\'un composant dans une boîte de dialogue modale, curseur du système visible, disque éteint', async function () {
    if (!present) return this.skip()
    const corps = '<x-carte id="hors"></x-carte><dialog id="dlg" style="width:400px;padding:0;border:0"><p id="lt" style="margin:0;height:80px">texte de la boîte</p><x-carte id="xc"></x-carte><mjs-fx-carte id="mc"></mjs-fx-carte></dialog>'
    const { contexte, page, erreurs } = await ouvre(corps)
    await page.waitForFunction(() => !!(document.getElementById('mc') as any)?._shadow?.querySelector('.in'))
    await page.evaluate(() => { (window as any).µ._mjs_fx(null, document.documentElement, 'pointer', { hide: true, smooth: 1 }) })
    const lire = () => page.evaluate(() => {
      const calque = document.querySelector('[mjs-fx-pointer-layer]')
      return {
        hors: getComputedStyle((document.getElementById('hors') as any).shadowRoot.getElementById('in')).cursor,
        texte: getComputedStyle(document.getElementById('lt') as any).cursor,
        natif: getComputedStyle((document.getElementById('xc') as any).shadowRoot.getElementById('in')).cursor,
        mjs: getComputedStyle((document.getElementById('mc') as any)._shadow.querySelector('.in')).cursor,
        allume: calque ? calque.hasAttribute('mjs-fx-pointer-on') : null
      }
    })
    const centre = (sel: string) => page.evaluate((s: string) => {
      const r = (document.querySelector(s) as any).getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    }, sel)
    // hors de la couche du dessus : le composant de la page cache le curseur du système
    let c = await centre('#hors')
    await vers(page, c.x, c.y)
    const page0 = await lire()
    await page.evaluate(() => (document.getElementById('dlg') as any).showModal())
    c = await centre('#lt')
    await vers(page, c.x, c.y)
    const surTexte = await lire()
    c = await centre('#xc')
    await vers(page, c.x, c.y)
    const surNatif = await lire()
    c = await centre('#mc')
    await vers(page, c.x, c.y)
    const surMjs = await lire()
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.equal(page0.hors, 'none', 'un composant de la page cache le curseur du système : ' + JSON.stringify(page0))
    assert.equal(page0.allume, true, 'le disque est allumé sur la page : ' + JSON.stringify(page0))
    assert.deepEqual([surTexte.texte, surTexte.allume], ['auto', false], 'texte de la boîte : ' + JSON.stringify(surTexte))
    assert.deepEqual([surNatif.natif, surNatif.allume], ['auto', false], 'composant à l\'ombre ouverte dans la boîte : ' + JSON.stringify(surNatif))
    assert.deepEqual([surMjs.mjs, surMjs.allume], ['auto', false], 'composant MJS dans la boîte : ' + JSON.stringify(surMjs))
  })
})
