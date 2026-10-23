// Le harnais de test d'une appli (`createHarness`) pose les libellés du runtime comme la page : le bouton d'un `*spoiler` a son nom
// (`aria-label`), la commande d'une carte `*flipcard` son texte. Dans la langue de la page simulée : le français par défaut, l'anglais
// quand le test donne `lang="en"` au document avant de monter. Un projet lisible comme un projet minifié.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(etiquette: string, config: Record<string, unknown>) {
  const root = mjsTmp('harnais-libelles-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  writeFileSync(join(root, 'src', 'carte.mjs'), '<p><span id="s" *spoiler>secret</span></p>\n<div id="c" *flipcard(on: click)><div>recto</div><div>verso</div></div>\n')
  return root
}

// ce que le composant monté montre : le nom du bouton du spoiler, le texte de la commande de la carte
async function libelles(root: string, lang?: string) {
  const app = await createHarness({ root })
  try {
    if (lang) app.document.documentElement.lang = lang
    const c = await app.mount('carte')
    const s = c.find('#s')
    const b = c.find('#c > [mjs-fx-flipcard-turn]')
    return { role: s?.getAttribute('role') ?? null, spoiler: s?.getAttribute('aria-label') ?? null, commande: b ? String(b.textContent) : null }
  }
  finally {
    await app.destroy()
  }
}

describe('harnais de test : les libellés du runtime, comme dans la page', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [etiquette, config] of [['lisible', {}], ['minifie', { minify: true }]] as const) {
    it(`${etiquette} : en français par défaut, le spoiler a son nom et la commande de la carte son texte`, async () => {
      const vu = await libelles(projet(etiquette, config))
      assert.deepEqual(vu, { role: 'button', spoiler: 'Texte masqué, activer pour l\'afficher', commande: 'Retourner la carte' })
    })
  }

  it('la page simulée en anglais : les libellés anglais', async () => {
    const vu = await libelles(projet('anglais', {}), 'en')
    assert.deepEqual(vu, { role: 'button', spoiler: 'Hidden text, activate to show it', commande: 'Flip the card' })
  })
})
