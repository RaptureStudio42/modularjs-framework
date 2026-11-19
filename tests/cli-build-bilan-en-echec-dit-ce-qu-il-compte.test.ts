// Bilan d'une construction en échec : « ✗ N erreurs (listées plus bas) — M composants en échec ». N compte les erreurs listées
// sous le bilan (une faute dans un fichier importé n'y est dite qu'une fois, avec ses importeurs) ; M compte les lignes
// « compilation en échec », une par composant qui n'a pas pu être construit.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

describe('mjs build : le bilan en échec dit ce qu\'il compte', function () {
  this.timeout(120000)

  it('deux erreurs listées, trois composants en échec : le bilan donne les deux nombres, d\'accord avec les lignes', function () {
    const root = mjsTmp('bilan-en-echec')
    write(join(root, 'mjs.config.json'), JSON.stringify(CONFIG))
    // un module que Civet ne sait pas lire, importé par deux composants, et un composant refusé pour lui-même
    write(join(root, 'app/modularjs/lib.civet.mjs'), 'export prix := ((\n')
    write(join(root, 'app/modularjs/badge.mjs'), "@import prix 'lib.civet.mjs'\n<script>\n$p = prix\n</script>\n<p>{$p}</p>\n")
    write(join(root, 'app/modularjs/tarif.mjs'), "@import prix 'lib.civet.mjs'\n<script>\n$q = prix\n</script>\n<b>{$q}</b>\n")
    write(join(root, 'app/modularjs/icon-text.mjs'), '<script>\n$n = 1\nsetTimeout((-> $n = 2), 100)\n</script>\n<p>{$n}</p>\n')
    write(join(root, 'app/modularjs/libre.mjs'), '<p>libre</p>\n')
    const run = build(root, [])
    assert.notEqual(run.status, 0, run.out)
    const lignes   = run.out.split('\n')
    const erreurs  = lignes.filter(l => l.startsWith(`   [bundler] ${root}`))
    const enEchec  = lignes.filter(l => / : compilation en échec — /.test(l))
    assert.equal(erreurs.length, 2, run.out)
    assert.equal(enEchec.length, 3, run.out)
    assert.ok(lignes.includes('✗ 2 erreurs (listées plus bas) — 3 composants en échec'), run.out)
  })
})
