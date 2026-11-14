// Valeur dérivée à l'horloge montrée par l'écran, après une écriture faite par une autre variable : les cas de
// derive-horloge-ecran-ecriture-ailleurs.test.ts dans Chromium, Firefox et WebKit sans fenêtre, développement et production,
// enveloppe et réglage `proxy: false` ; puis les écritures (calcul refait qui lève, frappes sans rapport, écriture de champ servie
// champ par champ).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { PAGE, SCENARIO, MODES, ECRITURES, SCENARIO_ECRITURES, construire, ecarts, ecartsEcritures } from './helpers/horloge-ecran.js'

describe('valeur dérivée à l\'horloge : l\'écran suit la valeur relue après une écriture faite ailleurs (navigateurs)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })
  const codes: Record<string, string> = {}

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : écran = valeur relue après chaque écriture, cinq modes`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const vus: string[] = []
      try {
        for (const mode of MODES) {
          const code = codes[mode] ??= (await construire(mode, ECRITURES)).code
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${PAGE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          for (const e of ecarts(await page.evaluate(SCENARIO))) vus.push(mode + ' — ' + e)
          for (const e of ecartsEcritures(await page.evaluate(SCENARIO_ECRITURES), mode)) vus.push(mode + ' — ' + e)
          await page.close()
        }
      }
      finally {
        await browser.close()
      }
      assert.deepEqual(vus, [])
    })
  }
})
