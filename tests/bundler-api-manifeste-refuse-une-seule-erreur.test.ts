// Par l'API (`new Bundler()`), un `manifestPath` refusé parce qu'il remplacerait un fichier source (dans le dossier des sources
// quand les sorties vont ailleurs, extension `.civet`, le fichier de `manifestExternal`) et qui tombait sur un fichier existant
// était nommé deux fois : par ce refus, puis comme fichier de l'auteur que la construction remplacerait. Une seule erreur le
// nomme, celle du refus, et le fichier reste intact.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CAS = [
  { nom: 'manifeste dans les sources, sorties ailleurs', fichier: 'main.js', contenu: 'console.log("à moi")\n' },
  { nom: 'manifeste en .civet dans les sources', fichier: 'outil.civet', contenu: 'export x = 1\n' },
  { nom: 'manifeste = manifestExternal', fichier: 'manifest.civet', contenu: '# require x\n' },
]

describe('bundler — par l\'API, un manifeste refusé qui tombe sur un fichier existant : une seule erreur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const cas of CAS) {
    it(`${cas.nom} (${cas.fichier}) : nommé une fois, fichier intact`, async () => {
      const root      = mjsTmp(`api-manifeste-une-erreur-${cas.fichier.replace(/[^a-z]/g, '')}`)
      const src       = join(root, 'app', 'modularjs')
      const manifeste = join(src, cas.fichier)
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'carte.mjs'), '<p>carte</p>\n')
      writeFileSync(manifeste, cas.contenu)
      const b = new Bundler({ sourceDir: src, outputDir: join(root, 'public', 'modularjs'), manifestPath: manifeste, manifestExternal: join(src, 'manifest.civet') })
      try {
        const erreurs = (await b.compile()).errors.map(e => e.message)
        assert.equal(erreurs.length, 1, erreurs.join('\n'))
        assert.ok(erreurs[0].includes(manifeste), erreurs[0])
      }
      finally {
        await b.close()
      }
      assert.equal(readFileSync(manifeste, 'utf-8'), cas.contenu)
    })
  }
})
