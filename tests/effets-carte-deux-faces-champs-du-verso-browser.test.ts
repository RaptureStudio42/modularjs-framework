// *flipcard(on: click) dans Chromium : un clic sur un champ, un bouton ou un lien de la carte garde son action et ne la
// retourne pas — un champ du verso se remplit (le focus y reste, la carte ne revient pas au recto, le verso ne devient pas
// inerte sous la frappe) ; Entrée sur un bouton du verso (son clic natif remonte à la carte) la laisse retournée ; un clic
// ailleurs dans la carte la retourne toujours.

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
  'fx-cv-carte': [
    '<div class="card" *flipcard(on: click)><div class="face">Recto <button class="br">info</button></div><div class="face"><input class="in" placeholder="email"><button class="bt">OK</button><span class="fond">fond</span></div></div>',
    '<style>',
    '.card',
    '  width: 260px',
    '  height: 120px',
    '.face',
    '  background: #eee',
    '</style>',
    ''
  ].join('\n'),
}

describe('*flipcard(on: click) — les champs, boutons et liens de la carte gardent leur action (Chromium)', function () {
  this.timeout(120000)
  let browser: any
  let page: any

  before(async function () {
    if (!(await chromiumPresent())) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return this.skip()
    }
    const root   = mjsTmp('effets-carte-deux-faces-champs-du-verso-browser')
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
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-fx-cv-carte></mjs-fx-cv-carte><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-cv-carte') as any)?._shadow?.querySelector('[mjs-fx-flipcard-face="back"]'), null, { timeout: 60000 })
    await page.waitForTimeout(300)
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  const centre = async (sel: string) => await page.evaluate((sel: string) => {
    const r = (document.querySelector('mjs-fx-cv-carte') as any)._shadow.querySelector(sel).getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, sel)
  const etat = async () => await page.evaluate(() => {
    const s = (document.querySelector('mjs-fx-cv-carte') as any)._shadow
    const c = s.querySelector('.card')
    return { t: c.style.getPropertyValue('--mjs-fx-flipcard-t'), versoInerte: s.querySelectorAll('.face')[1].hasAttribute('inert'), actif: s.activeElement ? s.activeElement.className : null, valeur: s.querySelector('.in').value }
  })

  it('le champ du verso se remplit, Entrée sur son bouton laisse la carte retournée, un clic sur son fond la remet', async () => {
    let c = await centre('.card')
    await page.mouse.click(c[0] - 80, c[1] + 30)
    await page.waitForTimeout(700)
    assert.deepEqual(await etat(), { t: '1', versoInerte: false, actif: null, valeur: '' }, 'un clic sur le recto la retourne (la carte ne prend pas le focus : sa commande le prend au clavier)')
    c = await centre('.in')
    await page.mouse.click(c[0], c[1])
    await page.keyboard.type('abc')
    await page.waitForTimeout(700)
    assert.deepEqual(await etat(), { t: '1', versoInerte: false, actif: 'in', valeur: 'abc' }, 'un clic dans le champ du verso')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    assert.deepEqual(await etat(), { t: '1', versoInerte: false, actif: 'bt', valeur: 'abc' }, 'Entrée sur le bouton du verso')
    c = await centre('.fond')
    await page.mouse.click(c[0], c[1])
    await page.waitForTimeout(700)
    const remise = await etat()
    assert.equal(remise.t, '0', 'un clic sur le fond du verso la remet')
    assert.equal(remise.versoInerte, true)
  })

  it('un bouton du recto garde son action sans retourner la carte', async () => {
    const c = await centre('.br')
    await page.mouse.click(c[0], c[1])
    await page.waitForTimeout(700)
    const e = await etat()
    assert.equal(e.t, '0')
    assert.equal(e.actif, 'br')
  })
})
