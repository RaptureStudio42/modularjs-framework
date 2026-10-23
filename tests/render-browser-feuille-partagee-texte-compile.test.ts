// Moteur navigateur — le texte d'une feuille partagée (remise à zéro, thème, `@css`) écrit dans la
// page prérendue se relisait par les règles que Chromium AFFICHE (`cssText`). Or Chromium réécrit
// `transition: opacity 0s linear 1s` en `opacity linear 1s` : relu, le seul temps devient la DURÉE,
// l'attente disparaît, la transition change de sens. La page porte désormais le texte compilé tel
// que la feuille l'a reçu, comme le rendu happy-dom.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('render-browser — feuille partagée prérendue : le texte compilé, pas la réécriture du navigateur', function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('`transition: opacity 0s linear 1s` garde son `0s` (durée nulle, attente d\'une seconde)', async function () {
    if (!(await isChromiumAvailable())) { this.skip(); return }
    this.timeout(60000)
    const root = mjsTmp('render-browser-feuille-texte')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'styles'), { recursive: true })
    writeFileSync(join(root, 'styles', 'volet.css'), '.volet { transition: opacity 0s linear 1s }\n')
    writeFileSync(join(root, 'src', 'panneau.mjs'), '<aside class="volet">A</aside>\n<style @css="volet"></style>\n')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', stylesheetsDir: 'styles', render: { browserPool: { size: 1 } } } as any, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-panneau')
      const regle = (res.html.match(/\.volet\s*\{[^}]*\}/) || [])[0] ?? ''
      assert.ok(regle, 'la feuille partagée doit être dans la page — HTML : ' + res.html.slice(0, 400))
      assert.match(regle, /opacity\s+0s\s+linear\s+1s/, 'règle prérendue : ' + regle)
    } finally {
      await renderer.close()
    }
  })
})
