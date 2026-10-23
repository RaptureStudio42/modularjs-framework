// Un module de script (.civet) cite un .js par `µasset(…)`, ce .js importe un voisin, et ce voisin importe un fichier
// absent. Le manque est dit au module qui cite le .js (il le rapporte lui-même), jamais à l'importeur du module : un
// voisin de voisin atteint par un module reste « via le module » à toute profondeur, sinon le composant qui importe le
// module recevrait un avertissement pour un fichier qu'il ne cite pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const fichiers: Record<string, string> = {
  'util.civet': 'export lib = µasset(\'lib/main.js\')\n',
  'a.mjs'     : '@import lib \'util.civet\'\n<script>\n  go = -> lib\n</script>\n<p>a</p>\n',
  'lib/main.js': 'import { b } from \'./b.js\'\nexport const d = b\n',
  'lib/b.js'  : 'import { c } from \'./c-absent.js\'\nexport const b = c\n',
}

const concernes = (avertissements: string[]) => avertissements.filter(w => /c-absent\.js/.test(w))

describe('bundler — voisin absent d\'un voisin, atteint par un module', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le module est averti, son importeur ne l\'est pas', async () => {
    const root   = mjsTmp('voisin-absent-via-module')
    const srcDir = join(root, 'src')
    for (const [chemin, contenu] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
      writeFileSync(join(srcDir, chemin), contenu)
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    try {
      const stats = await bundler.compile()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      const dits = concernes(stats.warnings)
      assert.ok(dits.some(w => /util\.civet/.test(w)), `le module doit être averti, reçu : ${JSON.stringify(stats.warnings)}`)
      assert.ok(!dits.some(w => /a\.mjs/.test(w)), `l'importeur ne doit pas être averti, reçu : ${JSON.stringify(dits)}`)
    }
    finally {
      await bundler.close()
    }
  })
})
