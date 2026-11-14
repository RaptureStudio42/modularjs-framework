// Classes globales `Nom.class.mjs` en navigateur réel : `µApp.NAME`, `µApp.fullName()`, `µ.App` et une classe qui en lit une autre se
// lisent dans le gabarit, le script et un module importé, en développement, en production (un fichier, fichiers séparés) et au rendu
// du serveur, dans Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { SOURCES, ATTENDU } from './helpers/classes-globales.js'

const LIRE = `(() => { const sh = document.querySelector('mjs-p-home')?._shadow; return sh ? [...sh.querySelectorAll('p')].map((p) => p.className + '=' + p.textContent) : [] })()`
const PRET = `document.querySelector('mjs-p-home')?._shadow?.querySelector('.e')?.textContent === 'Carte Heartwork'`

describe('classes globales en navigateur : µApp partout, sans import', function () {
  this.timeout(180000)
  const cibles: Partial<Record<Mode, Cible>> = {}

  before(async () => {
    for (const mode of MODES) cibles[mode] = await construire(mode, SOURCES, ['mjs-p-home'])
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('rendu du serveur : le gabarit lit les classes', () => {
    const html = cibles.ssr!.document('mjs-p-home', 'markers')
    for (const texte of ['Heartwork — Love, Deeper.', 'Carte Heartwork', 'Marque Heartwork']) assert.ok(html.includes(texte), `${texte} dans le rendu du serveur`)
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) it(`${nom} : développement, production, rendu du serveur`, async function () {
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    try {
      for (const [mode, variante] of [['dev-parents-avant', ''], ['bundle', ''], ['split', ''], ['ssr', 'markers']] as Array<[Mode, string]>) {
        const o = await charger(browser, cibles[mode]!, 'mjs-p-home', variante)
        try {
          await o.page.waitForFunction(PRET, null, { timeout: 15000 }).catch(() => undefined)
          const vu = await o.page.evaluate(LIRE)
          if (JSON.stringify(vu) !== JSON.stringify(ATTENDU)) ecarts.push(`${mode} ${JSON.stringify(vu)} ${o.erreurs.join(' | ')}`)
        }
        finally {
          await o.fermer()
        }
      }
    }
    finally {
      await browser.close()
    }
    assert.deepEqual(ecarts, [])
  })
})
