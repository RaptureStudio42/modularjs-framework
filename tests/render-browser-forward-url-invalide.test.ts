// renderPage (render-browser.ts) acquiert un emplacement du pool AVANT de valider forwardedUrl —
// `new URL(forwardedUrl)` levait alors AVANT le try/finally qui relâche l'emplacement (plus bas,
// `finally { release(slot) }`) : un forwardedUrl invalide (jamais validé avant d'arriver ici, cf.
// RenderOptions.forwardedUrl) faisait perdre l'emplacement de pool pour de bon, jamais relâché ni
// réutilisé — un pool de taille N s'épuisait après N requêtes mal formées.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel,
// tests skippés proprement si absent.
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

function project(): string {
  const root = mjsTmp('render-browser-forward-url')
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

describe('render-browser — un forwardedUrl invalide ne perd jamais l\'emplacement du pool', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log("  ℹ️  Chromium non installé, test render-browser-forward-url-invalide skippé.")
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('rendu avec forwardedUrl invalide puis rendu normal, pool de taille 1 : les deux aboutissent', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = project()
    writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="x">OK</p>\n')
    const renderer = await createBrowserRenderer(
      { sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } },
      { configDir: root },
    )
    try {
      // 1er rendu : forwardedUrl VOLONTAIREMENT invalide. AVANT le fix, `new URL(...)` levait
      // hors du try/finally qui relâche le slot — celui-ci restait acquis pour toujours.
      const first = await renderer.renderPage('mjs-simple', { forwardedUrl: 'not a url at all' })
      assert.match(first.html, /OK/, 'un forwardedUrl invalide doit être traité comme absent, pas planter le rendu')
      // BUG confirmé si absent : renderToString.ts (happy-dom) avertit déjà sur le MÊME scénario
      // (server.ssr-forward-url-invalide) — render-browser.ts, lui, avalait l'échec en silence
      // (catch vide), aucun signal nulle part qu'une URL de renvoi fournie a été ignorée.
      assert.ok(first.warnings.some(w => /forwardedUrl invalide/.test(w)), `avertissement attendu sur forwardedUrl invalide, warnings obtenus : ${JSON.stringify(first.warnings)}`)
      // 2e rendu, MÊME pool de taille 1, borné dans le temps : AVANT le fix, ce rendu ne se
      // terminait JAMAIS (le seul emplacement du pool restait perdu, la requête s'empilait en
      // file d'attente indéfiniment).
      const second = await Promise.race([
        renderer.renderPage('mjs-simple', {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT — le 2e rendu ne s'est jamais terminé, l'emplacement de pool est resté perdu")), 20000)),
      ]) as { html: string }
      assert.match(second.html, /OK/)
    } finally {
      await renderer.close()
    }
  })
})
