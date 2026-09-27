// Test de régression : sur une instance de Bundler réutilisée pour PLUSIEURS compile()
// (`mjs dev`/`watch()` — une seule instance vit toute la session, contrairement à `mjs build`
// qui repart d'un cache froid à chaque process), `cache` et `partialDependents` ne purgeaient
// JAMAIS l'entrée d'un fichier renommé ou supprimé : elle restait en mémoire pour toujours,
// une fuite qui grossit à chaque renommage/suppression sur une session longue.
//
// Fix : chaque `compile()` retire des deux registres toute entrée dont le fichier n'existe
// plus sur disque.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('Bundler — purge du cache et de partialDependents pour un fichier supprimé/renommé', function () {
  this.timeout(20000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant supprimé entre deux compile() : son entrée de cache disparaît', async () => {
    const root   = mjsTmp('cache-purge-composant')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const ephemere = join(srcDir, 'ephemere.mjs')
    writeFileSync(ephemere, '<p>je vais disparaître</p>')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') }) as any
    await bundler.compile()
    assert.ok(bundler.cache.has(ephemere), 'témoin : le cache doit connaître le fichier avant sa suppression')

    unlinkSync(ephemere)
    writeFileSync(join(srcDir, 'autre.mjs'), '<p>autre composant</p>')
    await bundler.compile()

    assert.equal(bundler.cache.has(ephemere), false,
      'AVANT le fix : l\'entrée du fichier supprimé restait dans this.cache pour toujours (fuite mémoire sur une session longue)')

    await bundler.close()
  })

  it('partial supprimé entre deux compile() : plus aucune entrée de partialDependents ne le mentionne', async () => {
    const root   = mjsTmp('cache-purge-partial')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const partiel = join(srcDir, '_bloc.mjs')
    writeFileSync(partiel, '<p>bloc partagé</p>')
    const hote = join(srcDir, 'page.mjs')
    writeFileSync(hote, '<div><@include bloc></div>')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') }) as any
    await bundler.compile()
    assert.ok(bundler.partialDependents.has(partiel), 'témoin : le reverse-map doit connaître le partial avant sa suppression')

    unlinkSync(partiel)
    unlinkSync(hote)   // sans hôte, plus rien ne référence le partial
    writeFileSync(join(srcDir, 'autre.mjs'), '<p>autre composant</p>')
    await bundler.compile()

    assert.equal(bundler.partialDependents.has(partiel), false,
      'AVANT le fix : l\'entrée du partial supprimé restait dans this.partialDependents pour toujours')

    await bundler.close()
  })
})
