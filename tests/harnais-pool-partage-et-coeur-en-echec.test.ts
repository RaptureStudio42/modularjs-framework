// Le harnais de test d'une appli (`createHarness`) et le pool de threads du compilateur, partagé par tout le processus.
// 1. `destroy()` arrêtait ce pool sans tenir compte de ses autres utilisateurs : un Bundler qui compilait au même moment
//    (un second harnais, un Bundler du test) échouait sur tous ses fichiers. Le harnais ne libère plus que sa part.
// 2. Un cœur qui lève à son chargement laissait la fenêtre simulée ouverte et le compilateur vivant (le processus de
//    test pouvait ne plus sortir) : le harnais les ferme avant de rendre l'erreur.

import assert from 'node:assert/strict'
import fs, { mkdirSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { Bundler, isSharedWorkerPoolAlive, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(nom: string, n: number): string {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  for (let i = 0; i < n; i++) writeFileSync(join(root, 'src', `c-${i}.mjs`), `<script>\n$n = ${i}\n$l = [1, 2, 3]\n</script>\n<ul>{for x in $l}<li>{x} {$n}</li>{end}</ul>\n`)
  return root
}

describe('harnais de test : le pool de threads partagé', function () {
  this.timeout(180000)
  before(async () => { await terminateSharedWorkerPool() })
  after(async () => { await terminateSharedWorkerPool() })

  it('destroy() d\'un harnais laisse finir la compilation d\'un autre Bundler', async () => {
    const a    = await createHarness({ root: projet('harnais-pool-a', 2), sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' })
    const rootX = projet('harnais-pool-x', 40)
    const x    = new Bundler({ sourceDir: join(rootX, 'src'), outputDir: join(rootX, 'out'), manifestPath: join(rootX, 'out', 'bundle.js'), inlineTranspileLimit: 0 })
    try {
      // X passe par le pool (seuil de compilation sur place à zéro) ; le harnais A, petit, compile sur place
      const enCours = x.compile()
      // le Bundler X s'est inscrit au pool : sa compilation a commencé
      for (let i = 0; i < 5000 && !(x as any)._poolUserRegistered; i++) await new Promise(r => setTimeout(r, 1))
      assert.equal((x as any)._poolUserRegistered, true, 'X a commencé à compiler')
      await a.destroy()
      const stats = await enCours
      assert.deepEqual(stats.errors.map((e: any) => String(e.message).slice(0, 160)), [], 'X compile sans erreur')
      assert.equal(isSharedWorkerPoolAlive(), true, 'X utilise encore le pool')
    }
    finally {
      await x.close()
    }
    assert.equal(isSharedWorkerPoolAlive(), false, 'le dernier utilisateur parti, le pool est arrêté')
  })

  it('un cœur qui lève au chargement : le harnais ferme la fenêtre et le compilateur, puis rend l\'erreur', async () => {
    const HappyDOM: any = await import('happy-dom')
    const fermer        = HappyDOM.DetachedWindowAPI.prototype.close
    const lireVrai      = fs.readFileSync
    let fermetures      = 0
    HappyDOM.DetachedWindowAPI.prototype.close = function (this: any, ...args: any[]) { fermetures++; return fermer.apply(this, args) }
    // 41 composants : au-delà de 40, le harnais compile par le pool de threads. Le seul fichier du cœur, et seulement
    // quand le harnais le lit : un cœur cassé, comme une version incompatible
    ;(fs as any).readFileSync = function (this: any, chemin: any, ...reste: any[]) {
      if (/mjs_core-[0-9a-z]{5}\.js$/.test(String(chemin)) && /testing[\\/]index/.test(new Error().stack ?? '')) return 'throw new Error("cœur cassé pour le test")'
      return (lireVrai as any).call(this, chemin, ...reste)
    }
    syncBuiltinESMExports()
    try {
      await assert.rejects(createHarness({ root: projet('harnais-coeur-casse', 41), sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' }), /cœur cassé pour le test/)
    }
    finally {
      ;(fs as any).readFileSync = lireVrai
      syncBuiltinESMExports()
      HappyDOM.DetachedWindowAPI.prototype.close = fermer
    }
    assert.equal(isSharedWorkerPoolAlive(), false, 'le compilateur du harnais est fermé')
    assert.ok(fermetures >= 1, 'la fenêtre simulée est fermée')
  })
})
