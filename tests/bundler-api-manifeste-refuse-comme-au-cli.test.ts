// `manifestPath` est écrit à chaque construction. mjs.config.json et la ligne de commande refusent déjà un manifeste qui remplacerait
// un fichier source (extension `.mjs`/`.civet`/`.coffee`, le fichier de `manifestExternal`, un chemin dans le dossier des sources
// quand les sorties vont ailleurs) ; `new Bundler()` appelé par l'API ne refusait rien et écrasait le fichier. La construction le
// refuse désormais elle aussi, avant toute écriture, par une erreur qui nomme le chemin.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), '<p>carte</p>\n')
  return { root, src, out: join(root, 'out') }
}

async function construire(opts: Record<string, unknown>): Promise<string[]> {
  const b = new Bundler(opts as any)
  try {
    return (await b.compile()).errors.map(e => e.message)
  }
  finally {
    await b.close()
  }
}

describe('bundler — par l\'API, les mêmes refus du manifeste qu\'au CLI', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('manifeste dans le dossier des sources, sorties ailleurs : refusé, rien écrit', async () => {
    const p = projet('api-manifeste-sources')
    const manifeste = join(p.src, 'bundle.js')
    const erreurs = await construire({ sourceDir: p.src, outputDir: p.out, manifestPath: manifeste })
    assert.equal(erreurs.length, 1, JSON.stringify(erreurs))
    assert.ok(erreurs[0].includes(manifeste), erreurs[0])
    assert.equal(existsSync(manifeste), false)
    assert.equal(existsSync(p.out), false)
  })

  it('manifeste en .civet : refusé, le fichier de l\'auteur reste intact', async () => {
    const p = projet('api-manifeste-extension')
    const manifeste = join(p.root, 'app.civet')
    writeFileSync(manifeste, 'AUTEUR\n')
    const erreurs = await construire({ sourceDir: p.src, outputDir: p.out, manifestPath: manifeste })
    assert.equal(erreurs.length, 1, JSON.stringify(erreurs))
    assert.ok(erreurs[0].includes(manifeste) && erreurs[0].includes('.civet'), erreurs[0])
    assert.equal(readFileSync(manifeste, 'utf-8'), 'AUTEUR\n')
  })

  it('manifeste = manifestExternal : refusé, le manifeste externe reste intact', async () => {
    const p = projet('api-manifeste-externe')
    const externe = join(p.root, 'vendor.js')
    writeFileSync(externe, '// AUTEUR\n')
    const erreurs = await construire({ sourceDir: p.src, outputDir: p.out, manifestPath: externe, manifestExternal: externe })
    assert.equal(erreurs.length, 1, JSON.stringify(erreurs))
    assert.ok(erreurs[0].includes(externe), erreurs[0])
    assert.equal(readFileSync(externe, 'utf-8'), '// AUTEUR\n')
  })

  it('témoin : sorties dans les sources, manifeste à côté — accepté', async () => {
    const p = projet('api-manifeste-temoin')
    const erreurs = await construire({ sourceDir: p.root, outputDir: join(p.root, 'out'), manifestPath: join(p.root, 'out', 'bundle.js') })
    assert.deepEqual(erreurs, [])
    assert.ok(existsSync(join(p.root, 'out', 'bundle.js')))
  })
})
