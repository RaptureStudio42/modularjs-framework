// module cœur knob (<@@knob>) dans Chromium, Firefox et WebKit réels, en développement et en production, sous mouvement réduit
// (prefers-reduced-motion: reduce) : l'arc de la valeur suit d'un coup, sans sa transition d'un dixième de seconde, comme les autres modules
// animés. Sans mouvement réduit, l'arc garde sa transition (témoin : le test lit bien l'arc).

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'knm-page.mjs': `<@@knob value="40" aria-label="volume"></@@knob>
`,
}

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('knob-mouvement-reduit', SOURCES, prod))

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@knob> : sous mouvement réduit, l'arc perd sa transition (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // la durée de transition calculée de l'arc de la valeur, sous la préférence donnée
  async function duree(reducedMotion: 'reduce' | 'no-preference'): Promise<string> {
    const ctx  = await browser.newContext({ viewport: { width: 600, height: 500 }, reducedMotion })
    const page = await ctx.newPage()
    const plantages: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://k.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><mjs-knm-page></mjs-knm-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://k.test/', { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-knm-page') as any)?._shadow?.querySelector('mjs-core-knob')?._shadow?.querySelector('.bar'), null, { timeout: 15000 })
    const d = await page.evaluate(() => getComputedStyle((document.querySelector('mjs-knm-page') as any)._shadow.querySelector('mjs-core-knob')._shadow.querySelector('.bar')).transitionDuration)
    assert.deepEqual(plantages, [])
    await ctx.close()
    return d
  }

  it('mouvement réduit : l\'arc de la valeur n\'a aucune transition', async () => {
    assert.equal(await duree('reduce'), '0s')
  })

  it('témoin, sans mouvement réduit : l\'arc garde sa transition d\'un dixième de seconde', async () => {
    assert.equal(await duree('no-preference'), '0.1s')
  })
})
