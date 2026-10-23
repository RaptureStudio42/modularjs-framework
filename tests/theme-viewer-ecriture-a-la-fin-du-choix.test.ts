// Atelier de thème, « Enregistrer dans le source » allumé : chaque évènement `input` du
// sélecteur de couleur (des dizaines par seconde pendant un glisser) envoyait une écriture du
// fichier source, donc autant de recompilations, dans un ordre d'arrivée non garanti. L'aperçu
// suit toujours `input` ; l'écriture n'a lieu qu'à `change`, la fin du choix.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'server', 'theme-viewer.mjs')

const REGISTRE = {
  accent: {
    declarations: [{ value: '#3b82f6', declaredBy: 'app_theme', kind: 'theme', variant: '', file: 'src/app.theme.mjs', line: 4, doc: '' }],
    readBy: [],
  },
}

describe('theme-viewer.mjs — écriture dans le source à la fin du choix seulement', function () {
  this.timeout(60000)

  it('glisser (5 input) : 5 aperçus, aucune écriture ; change : une écriture', async () => {
    const root = mjsTmp('theme-viewer-ecriture')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-thec.mjs'), localizeViewerSource(readFileSync(SOURCE, 'utf-8')))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    const app = await createHarness({ root })
    const fetchOrigine = (globalThis as any).fetch
    const appels: Array<{ url: string, corps: any }> = []
    const faussaire = async (url: string, init?: any) => {
      appels.push({ url, corps: init?.body ? JSON.parse(init.body) : null })
      if (url === '/__mjs/theme.json') return { json: async () => REGISTRE }
      if (url === '/__mjs/theme/edit') return { json: async () => ({ live: true, clients: 1 }) }
      if (url === '/__mjs/theme/write') return { json: async () => ({ written: true, file: 'src/app.theme.mjs', line: 4 }) }
      throw new Error('URL inattendue : ' + url)
    }
    ;(globalThis as any).fetch = faussaire
    app.window.fetch = faussaire
    let c: any
    try {
      c = await app.mount('tst-thec')
      await c.tick()
      await c.tick()
      await c.click('.bascule input')
      await c.tick()
      for (const v of ['#110000', '#220000', '#330000', '#440000', '#550000']) await c.type('.groupes input.pastille', v)
      const apercus = appels.filter(a => a.url === '/__mjs/theme/edit' && a.corps)
      assert.equal(apercus.length, 5, "l'aperçu suit chaque input")
      assert.equal(appels.filter(a => a.url === '/__mjs/theme/write').length, 0, 'aucune écriture pendant le glisser')
      await c.fire('.groupes input.pastille', 'change')
      const ecritures = appels.filter(a => a.url === '/__mjs/theme/write')
      assert.equal(ecritures.length, 1, 'une écriture à la fin du choix')
      assert.equal(ecritures[0].corps.value, '#550000')
    } finally {
      (globalThis as any).fetch = fetchOrigine
      if (c) c.destroy()
      await app.destroy()
    }
  })
})
