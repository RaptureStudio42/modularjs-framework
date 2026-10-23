// Effets de l'appli modifiés pendant `mjs dev` — la même instance du bundler recompile à chaque
// sauvegarde : un effet changé dans un fichier `*.effects.mjs` doit recompiler les composants qui le
// posent (un effet réglé y est résolu, la définition d'un effet CSS y est compilée), et le watcher
// doit savoir que ces composants dépendent du fichier d'effets. Même chemin que la transpilation dans
// un thread : ce qu'elle rend au bundler passe par la même projection.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(etiquette: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('fx-modifie-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts })
  const sortie  = (stats: any, nom: string) => readFileSync(join(outDir, basename(stats.manifest[nom])), 'utf-8')
  return { srcDir, bundler, sortie }
}

const erreurs = (stats: any) => stats.errors.map((e: any) => e.message).join('\n')

describe('effets de l\'appli modifiés en développement : les composants qui les posent sont recompilés', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la transpilation rend au bundler le fait qu\'un composant pose un effet de l\'appli', async () => {
    const effectDefs = collectEffectDefs(['/x/app.effects.mjs'], () => '<effects>\n  *titre = *scramble(20)\n</effects>\n')
    const res = await transpileFromMsg({ type: 'transpile', id: 0, content: '<p *titre>A</p>\n', moduleName: 'c', preResolvedAssets: {}, effectDefs })
    assert.equal(res.data.usesProjectEffects, true)
  })

  it('un effet réglé changé : le composant qui le pose prend le nouveau réglage, sans redémarrer', async () => {
    const p = projet('regle', { 'app.effects.mjs': '<effects>\n  *titre = *scramble(20, on: click)\n</effects>\n', 'carte.mjs': '<p class="a" *titre>ABC</p>\n', 'autre.mjs': '<p>autre</p>\n' })
    let stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.sortie(stats, 'carte'), /"speed":20/)
    writeFileSync(join(p.srcDir, 'app.effects.mjs'), '<effects>\n  *titre = *scramble(80, on: click)\n</effects>\n')
    stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const carte = p.sortie(stats, 'carte')
    assert.match(carte, /"speed":80/, 'le nouveau réglage')
    assert.doesNotMatch(carte, /"speed":20/, 'plus l\'ancien')
    await p.bundler.close()
  })

  it('par les threads de transpilation (gros projet) : même chose', async () => {
    const p = projet('threads', { 'app.effects.mjs': '<effects>\n  *titre = *scramble(20, on: click)\n</effects>\n', 'carte.mjs': '<p class="a" *titre>ABC</p>\n' }, { inlineTranspileLimit: 0 })
    let stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    writeFileSync(join(p.srcDir, 'app.effects.mjs'), '<effects>\n  *titre = *scramble(80, on: click)\n</effects>\n')
    stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.sortie(stats, 'carte'), /"speed":80/)
    await p.bundler.close()
  })

  it('un effet CSS changé : sa nouvelle définition part avec le composant', async () => {
    const p = projet('css', { 'app.effects.mjs': '<effects>\n  *halo(color: #0ff) =\n    box-shadow: 0 0 8px $color\n</effects>\n', 'carte.mjs': '<p class="a" *halo>ABC</p>\n' })
    let stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.sortie(stats, 'carte'), /0 0 8px/)
    writeFileSync(join(p.srcDir, 'app.effects.mjs'), '<effects>\n  *halo(color: #0ff) =\n    box-shadow: 0 0 24px $color\n</effects>\n')
    stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    assert.match(p.sortie(stats, 'carte'), /0 0 24px/)
    await p.bundler.close()
  })

  it('le watcher sait que le composant dépend du fichier d\'effets ; un composant sans effet de l\'appli n\'en dépend pas', async () => {
    const p = projet('watcher', { 'app.effects.mjs': '<effects>\n  *titre = *scramble(20)\n</effects>\n', 'carte.mjs': '<p *titre>ABC</p>\n', 'autre.mjs': '<p *neon>autre</p>\n' })
    const stats = await p.bundler.compile()
    assert.equal(stats.errors.length, 0, erreurs(stats))
    const parents = [...(p.bundler.partialDependents.get(join(p.srcDir, 'app.effects.mjs')) ?? [])].map((f) => basename(f))
    assert.deepEqual(parents, ['carte.mjs'])
    await p.bundler.close()
  })
})
