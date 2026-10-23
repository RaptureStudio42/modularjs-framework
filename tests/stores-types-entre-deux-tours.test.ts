// Les stores typés du projet (un `$$volume` déclaré dans le <vars> d'un composant) donnent *guard
// d'office à un champ lié à eux, même dans un autre composant. En `mjs dev`, la même instance du
// bundler recompile à chaque sauvegarde sans relire les sources inchangées : un store typé ajouté, puis
// retiré, doit être suivi au tour suivant par le champ d'un composant qu'on n'a pas touché.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SANS = '<script>\n$$volume = 50\n</script>\n<p>{$$volume}</p>\n'
const AVEC = '<vars>\n  $$volume  int 0..100\n</vars>\n<script>\n$$volume = 50\n</script>\n<p>{$$volume}</p>\n'

describe('stores typés : suivis d\'un tour de mjs dev à l\'autre', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un store typé ajouté puis retiré : le champ lié d\'un autre composant prend puis perd son garde', async () => {
    const root   = mjsTmp('stores-types-tours')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'reglage.mjs'), SANS)
    writeFileSync(join(srcDir, 'champ.mjs'), '<input type="number" value=!{$$volume}>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const garde   = async () => {
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return /µ\._mjs_fx\([^)]*"guard"/.test(readFileSync(join(outDir, basename(stats.manifest['champ'])), 'utf-8'))
    }
    assert.equal(await garde(), false, 'aucun store typé')
    writeFileSync(join(srcDir, 'reglage.mjs'), AVEC)
    assert.equal(await garde(), true, 'le store vient d\'être typé ailleurs')
    writeFileSync(join(srcDir, 'reglage.mjs'), SANS)
    assert.equal(await garde(), false, 'il ne l\'est plus')
    await bundler.close()
  })
})
