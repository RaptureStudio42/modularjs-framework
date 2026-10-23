// la sonde d'attente du <mjs-core-select> (waitForFunction rejoué toutes les 100 ms) est lue AVANT le montage de l'hôte : balise absente,
// ou balise là sans ombre. Elle ne doit rien lever : une exception de la sonde remonte comme erreur de page et ressemble à un plantage du module.
// Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { SELECT_DE_HOTE } from './helpers/sonde-select.js'

const CAS: Record<string, string> = {
  'balise absente':       '<body></body>',
  'balise sans ombre':    '<body><mjs-p-select></mjs-p-select></body>'
}

describe('sonde d\'attente du select avant montage — Chromium réel', function () {
  this.timeout(60000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => { if (browser) await browser.close() })

  for (const [nom, corps] of Object.entries(CAS)) {
    it(`${nom} : la sonde rend « pas encore » sans lever`, async function () {
      if (!present) { this.skip(); return }
      const page = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      try {
        await page.setContent(corps)
        await page.waitForFunction(`(() => { const s = ${SELECT_DE_HOTE}; return !!s })()`, null, { timeout: 600 }).catch(() => {})
        assert.deepEqual(erreurs, [], 'aucune exception levée par la sonde')
        assert.equal(await page.evaluate(`${SELECT_DE_HOTE} === undefined`), true, 'lue seule, la sonde rend undefined')
      } finally {
        await page.close()
      }
    })
  }
})
