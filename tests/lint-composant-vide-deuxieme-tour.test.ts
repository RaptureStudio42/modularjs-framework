// Un composant sans HTML — `"lint": { "emptyComponent": "error" }` fait échouer le build, et
// l'avertissement par défaut se dit à chaque build. En `mjs dev`, la même instance du bundler
// recompile à chaque sauvegarde et garde en cache les composants inchangés : la faute d'un composant
// qu'on n'a pas retouché doit rester dite au tour suivant, jamais disparaître parce qu'il vient du cache.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(etiquette: string, lint?: Record<string, unknown>) {
  const root   = mjsTmp('lint-vide-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'vide.mjs'), '<script>\n$a = 1\n</script>\n')
  writeFileSync(join(srcDir, 'autre.mjs'), '<p>autre</p>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...(lint ? { lint } : {}) } as any)
  return { srcDir, bundler }
}

const vides = (lignes: string[]) => lignes.filter((l) => /emptyComponent/.test(l)).length

describe('lint : un composant sans HTML, au deuxième tour de mjs dev', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('emptyComponent: "error" — l\'erreur reste quand on touche un autre fichier', async () => {
    const p = projet('erreur', { emptyComponent: 'error' })
    const s1 = await p.bundler.compile()
    assert.equal(vides(s1.errors.map((e: any) => e.message)), 1)
    writeFileSync(join(p.srcDir, 'autre.mjs'), '<p>autre modifié</p>\n')
    const s2 = await p.bundler.compile()
    assert.equal(vides(s2.errors.map((e: any) => e.message)), 1, 'toujours une erreur')
    await p.bundler.close()
  })

  it('par défaut, l\'avertissement se redit au tour suivant, une fois', async () => {
    const p = projet('avertissement')
    const s1 = await p.bundler.compile()
    assert.equal(vides(s1.warnings), 1)
    writeFileSync(join(p.srcDir, 'autre.mjs'), '<p>autre modifié</p>\n')
    const s2 = await p.bundler.compile()
    assert.equal(vides(s2.warnings), 1)
    await p.bundler.close()
  })
})
