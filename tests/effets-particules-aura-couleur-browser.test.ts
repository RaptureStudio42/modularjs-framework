// *particles(mode: aura) dans Chromium : les étincelles prennent la couleur de l'effet. L'aura est posée à côté de la
// balise (les étincelles naissent sous elle), hors de la balise où le moteur écrit la variable de couleur : elles
// restaient blanches, et le rouge du préréglage *particles.aura ne se voyait pas. La couleur se lit sur l'étincelle
// elle-même (son fond calculé) : réglage écrit, préréglage au survol, réglage changé en cours de route, thème posé
// sur la balise.

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

const STYLE = '\n<style>\n.b\n  width: 160px\n  height: 48px\n  margin: 120px\n.t\n  $$particles-color: #0000ff\n</style>\n'

const COMPOSANTS: Record<string, string> = {
  'fx-pa-fixe':   '<button class="b" *particles(mode: aura, color: #e50914)>A</button>' + STYLE,
  'fx-pa-pre':    '<button class="b" *particles.aura>B</button>' + STYLE,
  'fx-pa-theme':  '<button class="b t" *particles(mode: aura)>C</button>' + STYLE,
}

describe('*particles(mode: aura) — les étincelles prennent la couleur de l\'effet (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-particules-aura-couleur-browser')
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
    page    = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage()
    await page.route('http://t.test/**', async (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  const poser = async (nom: string) => {
    await page.evaluate((nom: string) => { document.body.appendChild(document.createElement(nom)) }, nom)
    await page.waitForFunction((nom: string) => !!(document.querySelector(nom) as any)?._shadow?.querySelector('[mjs-fx-layer="particles"]'), nom, { timeout: 60000 })
  }
  // le fond calculé de la plus récente étincelle de l'aura (elle vient de naître), attendue jusqu'à 5 s
  const teinte = async (nom: string) => {
    await page.waitForFunction((nom: string) => !!(document.querySelector(nom) as any)._shadow.querySelector('[mjs-fx-layer="particles"] i'), nom, { timeout: 5000 })
    return await page.evaluate((nom: string) => {
      const toutes = (document.querySelector(nom) as any)._shadow.querySelectorAll('[mjs-fx-layer="particles"] i')
      return getComputedStyle(toutes[toutes.length - 1]).backgroundColor
    }, nom)
  }
  const retirer = async (nom: string) => { await page.evaluate((nom: string) => document.querySelector(nom)!.remove(), nom) }
  // la souris sur le bouton lui-même (la balise hôte n'a pas sa taille)
  const survoler = async (nom: string) => {
    const r = await page.evaluate((nom: string) => {
      const b = (document.querySelector(nom) as any)._shadow.querySelector('button').getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }, nom)
    await page.mouse.move(r.x, r.y)
  }

  it('color: #e50914 écrit sur la balise : les étincelles sont rouges', async () => {
    await poser('mjs-fx-pa-fixe')
    assert.equal(await teinte('mjs-fx-pa-fixe'), 'rgb(229, 9, 20)')
  })

  it('le réglage change en cours de route : les étincelles qui naissent ensuite prennent la nouvelle couleur', async () => {
    await page.evaluate(() => {
      const b = (document.querySelector('mjs-fx-pa-fixe') as any)._shadow.querySelector('button')
      ;(window as any).µ._mjs_fxSet(b, 'particles', { color: '#00ff00' }, null)
    })
    await page.waitForTimeout(300)
    const apres = await teinte('mjs-fx-pa-fixe')
    await retirer('mjs-fx-pa-fixe')
    assert.equal(apres, 'rgb(0, 255, 0)')
  })

  it('*particles.aura : au survol, les étincelles sont du rouge du préréglage', async () => {
    await poser('mjs-fx-pa-pre')
    await survoler('mjs-fx-pa-pre')
    const rouge = await teinte('mjs-fx-pa-pre')
    await page.mouse.move(5, 5)
    await retirer('mjs-fx-pa-pre')
    assert.equal(rouge, 'rgb(229, 9, 20)')
  })

  it('$$particles-color posée sur la balise par une règle de style : les étincelles la prennent', async () => {
    await poser('mjs-fx-pa-theme')
    const bleu = await teinte('mjs-fx-pa-theme')
    await retirer('mjs-fx-pa-theme')
    assert.equal(bleu, 'rgb(0, 0, 255)')
  })
})
