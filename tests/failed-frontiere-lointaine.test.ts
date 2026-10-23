// Un enfant qui plante sous une frontière `<@failed>` posée plus haut : la recherche de la frontière remonte
// l'arbre jusqu'à elle, quelle que soit la profondeur. Elle s'arrêtait après 50 nœuds remontés (chaque balise
// comptait) : à 60 niveaux de `<div>`, l'enfant affichait le panneau « Fatal Error » au lieu du repli prévu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const profond = (n: number, coeur: string) => '<div>'.repeat(n) + coeur + '</div>'.repeat(n)

const CASSE = [
  '<script>',
  '$boom = false',
  '</script>',
  '{if $boom}<i>{$boom.nope.crash}</i>{end}',
  '<button class="boom" @click={$boom = true}>boom</button>',
].join('\n')

const garde = (n: number) => profond(n, '<mjs-tst-ffl-casse></mjs-tst-ffl-casse>') + '\n<@failed err reset>\n  <p class="repli">repli</p>\n</@failed>\n'

function projetTemporaire(): string {
  const root   = mjsTmp('failed-frontiere-lointaine')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-ffl-casse.mjs'), CASSE)
  writeFileSync(join(srcDir, 'tst-ffl-court.mjs'), garde(10))
  writeFileSync(join(srcDir, 'tst-ffl-long.mjs'), garde(60))
  writeFileSync(join(srcDir, 'tst-ffl-tres-long.mjs'), garde(300))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('<@failed> — la frontière est trouvée quelle que soit la profondeur', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    app.window.console.error = () => {}
  })

  after(async () => {
    if (app) await app.destroy()
  })

  for (const [nom, niveaux] of [['tst-ffl-court', 10], ['tst-ffl-long', 60], ['tst-ffl-tres-long', 300]] as const) {
    it(`enfant à ${niveaux} niveaux de balises sous la frontière : le repli du parent s'affiche`, async () => {
      const g = await app.mount(nom)
      await pause(30)
      const k = g.find('mjs-tst-ffl-casse')
      k._shadow.querySelector('.boom').click()
      await pause(30)
      assert.equal(g.find('.repli') !== null, true, 'repli de la frontière affiché')
      assertAbsent(k._shadow.querySelector('.mjs-fatal-error'), 'pas de panneau fatal chez l\'enfant')
      g.destroy()
    })
  }
})
