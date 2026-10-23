// Fichiers d'effets (`mjs_fx_<nom>-<empreinte>.js`) d'une même instance (`mjs dev`) : chacun importe le cœur par son
// chemin. Le tour suivant reprenait le fichier d'effet du tour d'avant dès que l'effet n'avait pas bougé, même quand le
// cœur avait changé d'empreinte (un composant qui se met à utiliser `µ.Store`) : le fichier importait l'ancien cœur, que
// le ménage du même tour retire — import 404 dans le navigateur, effets morts, construction verte

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('fichier d\'effet : il importe toujours le cœur du tour', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le cœur change d\'empreinte, l\'effet non : le fichier d\'effet importe le nouveau cœur, présent sur disque', async () => {
    const root = mjsTmp('fx-suit-le-coeur')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'carte.mjs'), '<div *neon>x</div>\n')
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') })
    const verifie = (tour: string): string => {
      const coeur = basename(b.coreHashedPath)
      const fx    = b.unitPath('mjs_fx_neon')
      assert.ok(fx, `${tour} : fichier d'effet au manifeste`)
      const importe = readFileSync(join(out, basename(fx)), 'utf-8').match(/mjs_core-[0-9a-z]{5}\.js/)?.[0]
      assert.equal(importe, coeur, `${tour} : le fichier d'effet importe le cœur du manifeste`)
      assert.ok(existsSync(join(out, coeur)), `${tour} : le cœur importé est sur disque`)
      return coeur
    }
    try {
      const s1 = await b.compile()
      assert.equal(s1.errors.length, 0, s1.errors.map(e => e.message).join('\n'))
      const coeur1 = verifie('tour 1')
      writeFileSync(join(src, 'compteur.mjs'), '<script>\n  st = new µ.Store({ n: 1 })\n</script>\n<p>{st.n}</p>\n')
      const s2 = await b.compile()
      assert.equal(s2.errors.length, 0, s2.errors.map(e => e.message).join('\n'))
      const coeur2 = verifie('tour 2')
      assert.notEqual(coeur2, coeur1, 'décor du test : le cœur doit changer d\'empreinte au tour 2')
    }
    finally {
      await b.close()
    }
  })
})
