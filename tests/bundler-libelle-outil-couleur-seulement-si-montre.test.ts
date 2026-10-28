// le texte du bouton `color` de la barre de l'éditeur riche (`toolColor`) ne part dans le manifeste que si une barre de l'application peut montrer
// l'outil `color` (Bundler.coreToolShown) : une <@@toolbar> posée seule, sans éditeur, ne le montre jamais (la barre ne le montre qu'à un éditeur qui a une
// palette), qu'elle dise sa liste ou non ; un éditeur qui a une palette mais dont la liste `toolbar` ne nomme pas `color` non plus. Les autres textes de
// la barre partent comme avant ; un éditeur avec palette dont la liste nomme `color` garde le texte. Build RÉEL (Bundler), en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuBuild } from './helpers/libelles-par-module.js'

type Env = 'dev' | 'prod'
type Js  = 'split' | 'bundle'

// les textes de la barre, sans celui du bouton `color`
const BARRE = ['toolbarLabel', 'toolH2', 'toolH3', 'toolQuote', 'toolBold', 'toolItalic', 'toolUnderline', 'toolStrike', 'toolUl', 'toolOl', 'toolCheck', 'toolLink', 'toolUndo', 'toolRedo', 'toolClear', 'toolbarShift']

const PAGES: Record<string, { source: string, couleur: boolean }> = {
  'barre seule, sans liste':                    { source: '<@@toolbar for="zone"></@@toolbar>\n<div id="zone"></div>', couleur: false },
  'barre seule dont la liste nomme color':      { source: '<@@toolbar for="zone" tools="bold color"></@@toolbar>\n<div id="zone"></div>', couleur: false },
  'éditeur à palette, liste sans color':        { source: '<@@editor name="t" colors="red green" toolbar="bold italic"></@@editor>', couleur: false },
  'éditeur à palette, liste qui nomme color':   { source: '<@@editor name="t" colors="red green" toolbar="bold color"></@@editor>', couleur: true },
}

async function construire(nom: string, source: string, env: Env, js: Js): Promise<Record<string, any>> {
  const root   = mjsTmp(`libelle-outil-couleur-${nom.replace(/[^a-z]+/g, '-')}-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const manifestPath = env === 'prod' ? join(outDir, 'bundle.js') : join(root, 'bundle.js')
  const bundler      = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath, js, ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats        = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return libellesDuBuild(manifestPath, outDir)
}

describe('libellé du bouton `color` de la barre : seulement si une barre de l\'application peut le montrer', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [env, js] of [['dev', 'split'], ['prod', 'bundle']] as Array<[Env, Js]>) {
    describe(`${env}, js: '${js}'`, () => {
      for (const [nom, { source, couleur }] of Object.entries(PAGES)) {
        it(`${nom} : toolColor ${couleur ? 'part' : 'ne part pas'}, les autres textes de la barre partent`, async () => {
          const t = await construire(nom, source, env, js)
          for (const lang of ['fr', 'en']) {
            assert.equal('toolColor' in (t[lang]?.core ?? {}), couleur, `toolColor (${lang}) ${couleur ? 'attendu' : 'ne doit pas partir'}`)
            assert.deepEqual(BARRE.filter((k) => !(k in (t[lang]?.core ?? {}))), [], `textes de la barre manquants (${lang})`)
          }
          if (couleur) assert.equal(t.en.core.toolColor, RUNTIME_LABELS.en.core.toolColor)
        })
      }
    })
  }
})
