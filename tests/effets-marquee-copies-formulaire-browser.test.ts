// *marquee(unit: child) dans un formulaire, dans Chromium réel : les copies des enfants ne partent pas avec le formulaire (une case
// cochée n'est envoyée qu'une fois, par l'original), ne l'empêchent pas de partir (un champ obligatoire rempli dans l'original, resté
// vide dans ses copies, ne retient pas l'envoi) et ne portent aucun gestionnaire en ligne (`onclick`…). Les copies gardent leur aspect.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCE = '<form class="f"><div class="m" *marquee(unit: child, gap: 10)><label class="c"><input type="checkbox" name="choix" value="a" checked> A</label><label class="c" onclick="window.__clics = (window.__clics || 0) + 1"><input class="t" name="titre" required> B</label></div></form>\n<style>\n.m\n  width: 800px\n.c\n  display: block\n  width: 120px\n</style>\n'

describe('*marquee dans Chromium réel — les copies dans un formulaire', function () {
  this.timeout(240000)
  let script = ''
  let browser: any = null
  let present = false

  before(async function () {
    present = await navigateurPresent('chromium')
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-marquee-formulaire')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-form.mjs'), SOURCE)
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

  it('une case cochée part une fois, un champ obligatoire rempli dans l\'original laisse partir le formulaire, aucune copie ne porte de gestionnaire en ligne', async function () {
    if (!present) return this.skip()
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-fx-form></mjs-fx-form><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-form') as any)?._shadow?.querySelector('[mjs-fx-marquee-copy]'))
    const vu = await page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-fx-form') as any)._shadow
      const form = sh.querySelector('form')
      // l'original est rempli ; ses copies, faites avant, restent vides
      const titre = sh.querySelector('[mjs-fx-marquee-run] > label > input.t')
      titre.value = 'Bonjour'
      const fd = new FormData(form)
      const copies = sh.querySelectorAll('[mjs-fx-marquee-copy]')
      const cases  = Array.from(sh.querySelectorAll('[mjs-fx-marquee-copy] input[type=checkbox]')) as any[]
      return {
        copies: copies.length,
        choix: fd.getAll('choix'),
        titre: fd.getAll('titre'),
        valide: form.checkValidity(),
        gestionnaires: sh.querySelectorAll('[mjs-fx-marquee-copy] [onclick]').length,
        cochees: cases.length > 0 && cases.every((c) => c.checked)
      }
    })
    await page.close()
    assert.deepEqual(erreurs, [])
    assert.ok(vu.copies > 0, 'des copies sont posées')
    assert.deepEqual(vu.choix, ['a'], 'la case cochée part une fois, par l\'original')
    assert.deepEqual(vu.titre, ['Bonjour'], 'le champ part une fois, avec la valeur de l\'original')
    assert.equal(vu.valide, true, 'les copies vides du champ obligatoire ne retiennent pas le formulaire')
    assert.equal(vu.gestionnaires, 0, 'aucune copie ne porte de gestionnaire en ligne')
    assert.equal(vu.cochees, true, 'les copies de la case restent cochées, comme l\'original (même aspect)')
  })
})
