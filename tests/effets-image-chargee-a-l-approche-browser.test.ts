// Une image donnée en réglage à un effet (*blend, *gradient, *ink, *peel, *scratch) : pourquoi ce
// fichier existe. Sur la page d'accueil du site, une balise sous le premier écran portait
// `*blend(image: …)` : l'image de 100 Ko partait dès l'ouverture de la page, pour une balise que
// personne ne voyait avant plusieurs écrans. Et une image déclinée en largeurs (`µimage('…', 320,
// 640)`), choisie avant que la balise soit posée, retombait sur l'ORIGINAL au lieu de la plus
// grande variante. Ce que le test garde, dans Chromium réel (une vraie mise en page, de vraies
// requêtes comptées par la page) :
// - une balise à 4 000 px sous l'écran ne demande pas l'image au chargement, quel que soit `on` ;
//   au défilement, quand elle approche, l'image est demandée UNE fois et l'effet est posé ;
// - la même balise déjà à l'écran demande son image tout de suite, effet posé, comme avant ;
// - une balise retirée avant d'approcher ne demande rien et ne laisse aucun observateur ;
// - un réglage changé pendant l'attente (l'éditeur d'effets rejoue l'effet à chaque réglage) ne
//   déclenche rien et sert à la pose ;
// - le choix de la variante : la plus grande quand aucune n'atteint la largeur voulue (jamais
//   l'original), d'après la balise elle-même quand elle est posée (× la densité d'écran).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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

// un PNG en niveaux de gris, 64 × 8
function degrade(): Buffer {
  const w = 64, h = 8
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc   = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloc  = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const tete = Buffer.alloc(13); tete.writeUInt32BE(w, 0); tete.writeUInt32BE(h, 4); tete[8] = 8; tete[9] = 0
  const brut = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) brut[y * (w + 1) + 1 + x] = Math.round(x / (w - 1) * 255)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', tete), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
}
const PNG = degrade()
const URI = 'data:image/png;base64,' + PNG.toString('base64')

const BOITE = 'width: 400px\n  height: 200px\n  background: #0f0'
const LOIN  = '<div class="loin"></div>'
const CSS   = `<style>\n.loin\n  height: 4000px\n.b\n  ${BOITE}\n</style>\n`
const CSS_E = `<style>\n.b\n  ${BOITE}\n</style>\n`

// chaque effet, avec ce qui prouve qu'il est posé : un sélecteur dans la balise, ou son style
const EFFETS: Record<string, { balise: (on: string) => string, pose: string }> = {
  blend:     { balise: (on) => `<div class="b" *blend(multiply, image: '/img.png'${on})>x</div>`, pose: '[mjs-fx-layer="blend"]' },
  filtre:    { balise: (on) => `<img class="b" alt="" src="${URI}" *blend(multiply, image: '/img.png'${on})>`, pose: '' },
  gradient:  { balise: (on) => `<div class="b" *gradient(image: '/img.png'${on})>x</div>`, pose: '' },
  peel:      { balise: (on) => `<div class="b" *peel(image: '/img.png'${on})>x</div>`, pose: '[mjs-fx-layer="peel"]' },
  scratch:   { balise: (on) => `<div class="b" *scratch(image: '/img.png'${on})>x</div>`, pose: '[mjs-fx-layer="scratch"]' },
  ink:       { balise: (on) => `<div class="b" *ink(image: '/img.png', duration: 8s${on || ', on: load'})>x</div>`, pose: '' }
}
// les valeurs de `on` que chaque effet accepte (le compilateur refuse les autres)
const ONS: Record<string, Record<string, string>> = {
  blend:    { 'sans on': '', 'on: view': ', on: view', 'on: always': ', on: always' },
  filtre:   { 'sans on': '', 'on: view': ', on: view', 'on: always': ', on: always' },
  gradient: { 'sans on': '', 'on: view': ', on: view', 'on: load': ', on: load' },
  peel:     { 'sans on': '', 'on: view': ', on: view', 'on: always': ', on: always' },
  scratch:  { 'sans on': '' },
  ink:      { 'sans on': '', 'on: view': ', on: view', 'on: load': ', on: load' }
}

const SOURCES: Record<string, string> = {}
for (const [nom, e] of Object.entries(EFFETS)) {
  for (const [lib, on] of Object.entries(ONS[nom])) {
    const cle = `${nom}-${lib.replace(/\W+/g, '')}`
    SOURCES[`loin-${cle}.mjs`]  = `${LOIN}${e.balise(on)}\n${CSS}`
    SOURCES[`ecran-${cle}.mjs`] = `${e.balise(on)}\n${CSS_E}`
  }
}
// les variantes : une image déclinée en largeurs, posée à l'écran, dans une fenêtre de 1 400 px
SOURCES['variantes.mjs'] = `<script>\n  $photo = { src: '/o.png', srcset: '/v320.png 320w, /v640.png 640w' }\n</script>\n<div class="b" *blend(multiply, image: $photo)>x</div>\n${CSS_E}`

describe('image en réglage d\'un effet — demandée à l\'approche de la balise (Chromium réel)', function () {
  this.timeout(180000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-image-a-l-approche-browser')
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
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  // la page à une vraie adresse ; chaque demande d'image est comptée par adresse. Un compteur d'observateurs
  // d'intersection vivants (observe sans disconnect) est posé avant tout script
  async function ouvre(browser: any, tag: string, opts: any = {}) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, ...opts })
    const demandes: Record<string, number> = {}
    await page.addInitScript(() => {
      const vivants = new Set<any>()
      ;(window as any).__vivants = vivants
      const Vrai = window.IntersectionObserver
      window.IntersectionObserver = class extends Vrai {
        _n = 0
        observe(t: any) { this._n++; vivants.add(this); return super.observe(t) }
        unobserve(t: any) { this._n--; if (this._n <= 0) vivants.delete(this); return super.unobserve(t) }
        disconnect() { this._n = 0; vivants.delete(this); return super.disconnect() }
      } as any
    })
    await page.route('http://t.test/**', (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f00}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      if (/\.png$/.test(url.pathname)) {
        demandes[url.pathname] = (demandes[url.pathname] || 0) + 1
        return route.fulfill({ contentType: 'image/png', body: PNG })
      }
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.b'), tag)
    return { page, demandes }
  }

  // ce qui prouve que l'effet est posé sur la balise du composant
  const estPose = ([t, sel, n]: string[]) => {
    const racine = (document.querySelector(t) as any)._shadow
    const b: any = racine.querySelector('.b')
    if (sel) return !!racine.querySelector(sel)
    if (n === 'filtre') return !!b.style.getPropertyValue('--mjs-fx-blend-filter')
    if (n === 'gradient') return b.style.getPropertyValue('--mjs-fx-gradient').includes('/img.png')
    if (n === 'ink') { const cs = getComputedStyle(b); return (cs.maskImage || (cs as any).webkitMaskImage || '').startsWith('url(') }
    return false
  }
  const pose = (page: any, tag: string, nom: string) => page.evaluate(estPose, [tag, EFFETS[nom].pose, nom])

  // la requête part un peu après la pose (le navigateur la lance à sa prochaine mise en page)
  const attend = async (demandes: Record<string, number>, url: string) => {
    for (let i = 0; i < 60 && !demandes[url]; i++) await new Promise((r) => setTimeout(r, 50))
  }

  const vivants = (page: any) => page.evaluate(() => (window as any).__vivants.size)

  for (const [nom] of Object.entries(EFFETS)) {
    for (const lib of Object.keys(ONS[nom])) {
      const cle = `${nom}-${lib.replace(/\W+/g, '')}`
      it(`${nom} (${lib}) : loin sous l'écran, zéro requête au chargement ; l'image vient une fois à l'approche et l'effet est posé`, async function () {
        if (!present) { this.skip(); return }
        const { chromium } = await import('playwright')
        const browser = await chromium.launch()
        try {
          const { page, demandes } = await ouvre(browser, `mjs-loin-${cle}`)
          await page.waitForTimeout(500)
          assert.equal(demandes['/img.png'] || 0, 0, `balise à 4 000 px : l'image ne doit pas partir au chargement (${demandes['/img.png']})`)
          assert.equal(await pose(page, `mjs-loin-${cle}`, nom), false, 'effet non posé tant que la balise est loin')
          await page.evaluate(() => window.scrollTo(0, 3800))
          await page.waitForFunction(estPose, [`mjs-loin-${cle}`, EFFETS[nom].pose, nom], { timeout: 8000 })
          await attend(demandes, '/img.png')
          assert.ok((demandes['/img.png'] || 0) >= 1, 'arrivée : l\'image est demandée')
          if (nom === 'blend' || nom === 'peel' || nom === 'filtre') assert.equal(demandes['/img.png'], 1, 'demandée une seule fois')
        } finally {
          await browser.close()
        }
      })

      it(`${nom} (${lib}) : déjà à l'écran, l'image est demandée tout de suite et l'effet est posé`, async function () {
        if (!present) { this.skip(); return }
        const { chromium } = await import('playwright')
        const browser = await chromium.launch()
        try {
          const { page, demandes } = await ouvre(browser, `mjs-ecran-${cle}`)
          await page.waitForFunction(estPose, [`mjs-ecran-${cle}`, EFFETS[nom].pose, nom], { timeout: 8000 })
          await attend(demandes, '/img.png')
          assert.ok((demandes['/img.png'] || 0) >= 1, 'à l\'écran : image demandée')
        } finally {
          await browser.close()
        }
      })
    }
  }

  it('balise retirée avant d\'approcher : aucune requête, aucun observateur laissé', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page, demandes } = await ouvre(browser, 'mjs-loin-blend-sanson')
      await page.waitForTimeout(300)
      const avant = await vivants(page)
      assert.ok(avant >= 1, `la balise qui attend est observée (${avant})`)
      await page.evaluate(() => {
        const b: any = (document.querySelector('mjs-loin-blend-sanson') as any)._shadow.querySelector('.b')
        ;(window as any).µ._mjs_fxClear(b)
      })
      assert.equal(await vivants(page), 0, 'retrait : plus aucun observateur')
      await page.evaluate(() => window.scrollTo(0, 3800))
      await page.waitForTimeout(500)
      assert.equal(demandes['/img.png'] || 0, 0, 'retirée : l\'image n\'est jamais demandée')
      const calque = await page.evaluate(() => !!(document.querySelector('mjs-loin-blend-sanson') as any)._shadow.querySelector('[mjs-fx-layer="blend"]'))
      assert.equal(calque, false, 'aucun calque')
    } finally {
      await browser.close()
    }
  })

  it('réglage changé pendant l\'attente (l\'éditeur rejoue l\'effet) : rien ne part, un seul observateur, le nouveau réglage sert à la pose', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page, demandes } = await ouvre(browser, 'mjs-loin-blend-sanson')
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const b: any = (document.querySelector('mjs-loin-blend-sanson') as any)._shadow.querySelector('.b')
        ;(window as any).µ._mjs_fxSet(b, 'blend', { mode: 'screen' })
      })
      await page.waitForTimeout(200)
      assert.equal(demandes['/img.png'] || 0, 0, 'réglage changé : toujours aucune requête')
      assert.equal(await vivants(page), 1, 'un seul observateur après la relance')
      await page.evaluate(() => window.scrollTo(0, 3800))
      await page.waitForFunction(() => !!(document.querySelector('mjs-loin-blend-sanson') as any)._shadow.querySelector('[mjs-fx-layer="blend"]'), null, { timeout: 8000 })
      const mode = await page.evaluate(() => ((document.querySelector('mjs-loin-blend-sanson') as any)._shadow.querySelector('.b') as HTMLElement).style.getPropertyValue('--mjs-fx-blend-mode'))
      assert.equal(mode, 'screen', 'le réglage changé pendant l\'attente est celui de la pose')
      assert.equal(await vivants(page), 0, 'posé : l\'observateur d\'attente est rendu')
    } finally {
      await browser.close()
    }
  })

  it('variantes 320/640 : la variante demandée est taillée pour la balise posée (400 px → 640), jamais l\'original', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const { page, demandes } = await ouvre(browser, 'mjs-variantes', { viewport: { width: 1400, height: 600 } })
      await page.waitForFunction(() => !!(document.querySelector('mjs-variantes') as any)._shadow.querySelector('[mjs-fx-layer="blend"]'), null, { timeout: 8000 })
      await attend(demandes, '/v640.png')
      await page.waitForTimeout(300)
      assert.equal(demandes['/o.png'] || 0, 0, 'l\'original n\'est pas demandé')
      assert.equal(demandes['/v640.png'], 1, 'la variante 640 est demandée')
    } finally {
      await browser.close()
    }
  })

  it('choix d\'après la balise posée : 300 px à densité 1 → 320 ; à densité 2 → 640 ; sans balise, la fenêtre', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      for (const [densite, attendu] of [[1, '/v320.png'], [2, '/v640.png']] as const) {
        const { page } = await ouvre(browser, 'mjs-variantes', { viewport: { width: 1400, height: 600 }, deviceScaleFactor: densite })
        const choix = await page.evaluate(() => {
          const µ: any = (window as any).µ
          const v = { src: '/o.png', srcset: '/v320.png 320w, /v640.png 640w' }
          const el = document.createElement('div')
          el.style.cssText = 'width:300px;height:10px'
          document.body.appendChild(el)
          const posee = µ._mjs_fxImage(v, el)
          el.remove()
          return { posee, sans: µ._mjs_fxImage(v, null), petite: µ._mjs_fxImage({ src: '/o.png', srcset: '/v320.png 320w, /v640.png 640w' }, null) }
        })
        assert.equal(choix.posee, attendu, `densité ${densite} : balise de 300 px`)
        assert.equal(choix.sans, '/o.png', `densité ${densite} : sans balise, fenêtre de 1 400 px, plus large que toutes les variantes : l'image d'origine`)
      }
    } finally {
      await browser.close()
    }
  })
})
