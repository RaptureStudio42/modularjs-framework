// Un module `.civet` importé par `@import` et compilé par le constructeur passait son texte au lexeur sans nom de
// fichier ni ligne : une erreur du lexeur n'y disait pas où elle était. Elle cite désormais le fichier et sa ligne,
// les lignes d'import ajoutées devant le texte (`@import` du module) décomptées.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('module externe : erreur du lexeur située', function () {
  this.timeout(90000)

  it('`§` seul à la ligne 4 de `outils.civet` : `outils.civet:4:22`', async () => {
    const root   = mjsTmp('module-externe-lexeur')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'outils.civet'), '@import a "./a.js"\n@import b "./b.js"\nexport double = (x) -> x * 2\nexport faux = -> y = § + 1\n')
    writeFileSync(join(srcDir, 'a.js'), 'export const a = 1\n')
    writeFileSync(join(srcDir, 'b.js'), 'export const b = 1\n')
    writeFileSync(join(srcDir, 'carte-module.mjs'), '@import double "./outils.civet"\n<script>\n$n = double(2)\n</script>\n<p>{$n}</p>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    await assert.rejects(createHarness({ root }), /outils\.civet:4:22 .*« § » seul/)
  })
})
