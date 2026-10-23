// Un passage d'effets lancé PENDANT un autre (passage imbriqué : un effet qui fait tourner, de façon synchrone, les
// effets d'un autre composant) rend la main sans oublier l'effet extérieur encore en cours. Défaut garanti absent :
// la fin du passage imbriqué remettait « aucun effet en cours » ; la suite de l'effet extérieur passait alors pour
// une écriture faite hors de tout effet, et relançait les effets qui écrivent eux-mêmes la même clé du store —
// alors qu'entre effets, la dernière écriture gagne.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'ei-exterieur': [
    '<script>',
    'µeffect ->',
    '  if $$go',
    '    globalThis.__imbriquer()',
    "    $$k = 'A'",
    '  return',
    '</script>',
    '<p class="k">{$$k}</p>',
  ].join('\n'),
  'ei-interieur': [
    '<script>',
    '$x = 1',
    'µeffect ->',
    '  globalThis.__interieur = (globalThis.__interieur ?? 0) + 1',
    '  return',
    '</script>',
    '<p>{$x}</p>',
  ].join('\n'),
  // écrit la clé qu'il lit : relancé par une écriture faite hors de tout effet, jamais par celle d'un autre effet
  'ei-gardien': [
    '<script>',
    'µeffect ->',
    '  globalThis.__gardien = (globalThis.__gardien ?? 0) + 1',
    "  $$k = 'B' if $$k == 'A'",
    '  return',
    '</script>',
    '<p class="g">{$$k}</p>',
  ].join('\n'),
}

function projet(): string {
  const root = mjsTmp('effets-imbriques')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

const pause = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('µeffect — un passage d\'effets imbriqué garde l\'effet extérieur en cours', function () {
  this.timeout(60000)
  let app: any
  before(async () => { app = await createHarness({ root: projet() }) })
  after(async () => { if (app) await app.destroy() })

  it('l\'écriture faite par l\'effet extérieur après le passage imbriqué ne relance pas l\'effet qui écrit la même clé', async () => {
    const w = app.window
    const interieur = await app.mount('ei-interieur')
    const exterieur = await app.mount('ei-exterieur')
    const gardien = await app.mount('ei-gardien')
    try {
      // passage imbriqué : les effets d'un autre composant tournent pendant l'effet extérieur
      w.__imbriquer = () => interieur.el._mjs_runEffectsV2(undefined, true)
      await pause()
      const passages = w.__gardien
      const avant = w.__interieur
      w.µ.store.go = true
      await pause(150)
      assert.equal(w.__interieur, avant + 1, 'le passage imbriqué a bien eu lieu')
      assert.equal(w.µ.store.k, 'A', 'la dernière écriture, celle de l\'effet extérieur, gagne')
      assert.equal(w.__gardien, passages, 'l\'effet qui écrit la même clé n\'est pas relancé par un autre effet')
      assert.ok(!w.µ._mjs_effRun, 'plus aucun effet en cours une fois le passage fini')
    }
    finally {
      gardien.destroy()
      exterieur.destroy()
      interieur.destroy()
    }
  })
})
