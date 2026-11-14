// la taille du texte écrite en px suit la largeur de l'écran (Chromium réel) : `41.5px` vaut 28,4 px à 390 de large, 34,5 à 768
// et 41,5 au PC (1 400), dans un composant à racine d'ombre, dans le même composant sans ombre (`mjs-light`) et dans la page
// (feuille racine) ; `12px` (au seuil ou dessous) et `2rem` ne bougent jamais. Avant le script, la tête posée par le serveur
// donne déjà la taille adaptée à la feuille racine

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { buildSsrHead } from '../src/server/ssr-head.js'

const CORPS = '<mjs-titre id="ombre"></mjs-titre><mjs-titre id="leger" mjs-light></mjs-titre><p class="grand" id="page">page</p>'

async function construire(): Promise<{ base: string, server: Server }> {
  const root = mjsTmp('taille-texte-ecran')
  write(join(root, 'mjs.config.json'), `${JSON.stringify({ sourceDir: 'app', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', stylesheetsDir: 'app/styles' }, null, 2)}\n`)
  write(join(root, 'app/titre.mjs'), '<p class="t">titre</p>\n<p class="p">petit</p>\n<p class="r">rem</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n  .r\n    font-size: 2rem\n</style>\n')
  write(join(root, 'app/styles/mjs_root.scss'), '.grand { font-size: 41.5px; }\n')
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const outDir = join(root, 'out')
  // page sans script : la seule tête posée par le serveur
  const tete   = buildSsrHead(found.config, found.configDir, join(outDir, 'bundle.js'))
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><script type="module" src="/out/bundle.js"></script></head><body>${CORPS}</body></html>`)
      return
    }
    if (chemin === '/avant-script') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${tete}</head><body><p class="grand" id="page">page</p></body></html>`)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': fichier.endsWith('.js') ? 'text/javascript; charset=utf-8' : fichier.endsWith('.css') ? 'text/css' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

function garderLesOmbres(): void {
  const attacher = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (this: any, init: ShadowRootInit) { const r = attacher.call(this, init); this.__ombre = r; return r }
}

function relever(): Record<string, number> {
  const taille = (el: Element | null | undefined) => el ? parseFloat(getComputedStyle(el).fontSize) : NaN
  const ombre  = (document.getElementById('ombre') as any).__ombre as ShadowRoot
  const leger  = document.getElementById('leger')!
  return {
    ombreT: taille(ombre.querySelector('.t')), ombreP: taille(ombre.querySelector('.p')), ombreR: taille(ombre.querySelector('.r')),
    legerT: taille(leger.querySelector('.t')), legerP: taille(leger.querySelector('.p')), legerR: taille(leger.querySelector('.r')),
    page:   taille(document.getElementById('page')),
    legerSansOmbre: (leger as any).__ombre ? 0 : 1,
  }
}

async function chromiumPret(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('taille du texte adaptée à l\'écran — Chromium réel', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('41.5px : 28,4 / 34,5 / 41,5 px à 390 / 768 / 1 400 de large, avec et sans ombre et dans la page ; 12px et 2rem fixes', async function () {
    if (!(await chromiumPret())) {
      console.log('  ℹ️  Chromium non installé, test navigateur sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    const { base, server } = await construire()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      for (const [largeur, attendu] of [[390, 28.4], [768, 34.5], [1400, 41.5]] as const) {
        const page = await browser.newPage({ viewport: { width: largeur, height: 800 } })
        await page.addInitScript(garderLesOmbres)
        await page.goto(base)
        await page.waitForFunction(() => !!(document.getElementById('ombre') as any)?.__ombre?.querySelector('.t') && !!document.querySelector('#leger .t'))
        const r = await page.evaluate(relever)
        await page.close()
        assert.equal(r.legerSansOmbre, 1, 'mjs-light : aucune racine d\'ombre')
        for (const cle of ['ombreT', 'legerT', 'page']) assert.ok(Math.abs(r[cle] - attendu) <= 0.1, `${largeur} px de large, ${cle} : ${r[cle]} au lieu de ${attendu}`)
        for (const cle of ['ombreP', 'legerP']) assert.equal(r[cle], 12, `${largeur} px de large, ${cle}`)
        for (const cle of ['ombreR', 'legerR']) assert.equal(r[cle], 32, `${largeur} px de large, ${cle}`)
      }
    }
    finally {
      await browser.close()
      server.close()
    }
  })

  it('avant le script, la tête posée par le serveur : 41.5px de la feuille racine vaut 28,4 px à 390 de large', async function () {
    if (!(await chromiumPret())) {
      console.log('  ℹ️  Chromium non installé, test navigateur sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    const { base, server } = await construire()
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
      await page.goto(`${base}/avant-script`)
      const r = await page.evaluate(() => ({ scripts: document.scripts.length, taille: parseFloat(getComputedStyle(document.getElementById('page')!).fontSize) }))
      await page.close()
      assert.equal(r.scripts, 0, 'aucun script dans la page')
      assert.ok(Math.abs(r.taille - 28.4) <= 0.1, `390 px de large, avant le script : ${r.taille} au lieu de 28.4`)
    }
    finally {
      await browser.close()
      server.close()
    }
  })
})
