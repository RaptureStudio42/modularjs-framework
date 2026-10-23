// La lecture rapide des sources (les stores typés d'un projet) est mémoïsée d'un tour de `mjs dev` à
// l'autre par (date, taille). Un fichier daté à partir du début du tour (ici : une date dans le futur,
// donc jamais antérieure à lui) n'est JAMAIS resservi depuis le mémo : réécrit à taille et date
// identiques, il est relu, et le champ lié d'un autre composant suit le changement.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const AVEC_STORE = '<vars>\n  $$volume  int 0..100\n</vars>\n<p>r</p>\n'
const AUTRE_NOM  = '<vars>\n  $$volumi  int 0..100\n</vars>\n<p>r</p>\n'
const FUTUR      = 4102444800   // 1er janvier 2100

describe('mémo de lecture rapide des sources — la fraîcheur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une source datée du futur, réécrite à taille et date identiques, est relue', async () => {
    assert.equal(AVEC_STORE.length, AUTRE_NOM.length)
    const root   = mjsTmp('memo-fraicheur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    const reglage = join(srcDir, 'reglage.mjs')
    const poser   = (texte: string) => { writeFileSync(reglage, texte); utimesSync(reglage, FUTUR, FUTUR) }
    poser(AVEC_STORE)
    writeFileSync(join(srcDir, 'champ.mjs'), '<input type="number" value=!{$$volume}>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const garde   = async () => {
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return /µ\._mjs_fx\([^)]*"guard"/.test(readFileSync(join(outDir, basename(stats.manifest['champ'])), 'utf-8'))
    }
    try {
      assert.equal(await garde(), true, 'le store est typé dans reglage.mjs')
      poser(AUTRE_NOM)
      assert.equal(await garde(), false, 'le store typé a changé de nom : le champ perd son garde')
    }
    finally {
      await bundler.close()
    }
  })
})
