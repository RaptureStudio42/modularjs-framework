// Un effet de l'appli qui en règle un autre (`*vague = *delta(fx: *halo)`) trouve cet autre effet même
// déclaré PLUS BAS dans le fichier, ou dans un fichier d'effets qui suit : l'ordre d'écriture ne compte pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const VAGUE = '<effects>\n  *vague = *delta(fx: *halo)\n</effects>\n'
const HALO  = '<effects>\n  *halo(color: #0ff) =\n    box-shadow: 0 0 8px $color\n</effects>\n'

async function construire(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => e.message)
  const code    = erreurs.length === 0 ? readFileSync(join(outDir, basename(stats.manifest['carte'])), 'utf-8') : ''
  return { erreurs, code }
}

describe('effets de l\'appli — celui qu\'un autre règle peut être déclaré plus bas', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('déclaré plus bas dans le même fichier', async () => {
    const { erreurs, code } = await construire('effets-plus-bas', { 'app.effects.mjs': VAGUE.replace('</effects>\n', '') + HALO.replace('<effects>\n', ''), 'carte.mjs': '<p *vague>x</p>\n' })
    assert.deepEqual(erreurs, [])
    assert.match(code, /µ\._mjs_fxCustom\("halo"/, 'la définition de *halo part avec le composant qui pose *vague')
  })

  it('déclaré dans un fichier d\'effets qui suit', async () => {
    const { erreurs, code } = await construire('effets-fichier-suivant', { 'a.effects.mjs': VAGUE, 'b.effects.mjs': HALO, 'carte.mjs': '<p *vague>x</p>\n' })
    assert.deepEqual(erreurs, [])
    assert.match(code, /µ\._mjs_fxCustom\("halo"/)
  })

  it('l\'ordre inverse (déclaré avant) donne le même résultat', async () => {
    const { erreurs, code } = await construire('effets-avant', { 'a.effects.mjs': HALO, 'b.effects.mjs': VAGUE, 'carte.mjs': '<p *vague>x</p>\n' })
    assert.deepEqual(erreurs, [])
    assert.match(code, /µ\._mjs_fxCustom\("halo"/)
  })
})
