// createSSRRenderer évaluait TOUS les .js du dossier de sortie, pas seulement le graphe émis par
// CETTE compilation (manifeste + imports) : un fichier .js étranger posé dans le même dossier
// (artefact d'un autre outil, d'un build antérieur partageant le dossier de sortie) qui lève à
// l'éval fait échouer le rendu de N'IMPORTE QUELLE page saine du même projet.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('SSR — un .js étranger du dossier de sortie ne fait plus échouer une page saine', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('renderToString(\'mjs-good\') réussit malgré un foreign.js qui lève, jamais importé par le graphe', async function () {
    const root = mjsTmp('ssr-foreign-js')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(srcDir, 'good.mjs'), '<p class="ok">JE-SUIS-SAIN</p>\n')
    // fichier étranger, jamais émis par CETTE compilation, jamais importé par good.mjs.
    writeFileSync(join(outDir, 'zzz-foreign.js'), "throw new Error('FOREIGN_BOOM');\n")

    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir })
    try {
      const res = await renderer.renderToString('mjs-good')
      assert.match(res.html, /JE-SUIS-SAIN/, `le rendu de la page saine doit réussir malgré le fichier étranger : ${JSON.stringify(res)}`)
    } finally {
      await renderer.close()
    }
  })
})
