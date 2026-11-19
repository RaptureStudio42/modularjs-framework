// Deux défauts de la construction par l'API. (1) Une minification qui échoue ne fait dire que ses propres erreurs, une par fichier
// en échec, avec et sans le cache sur disque : la file est vidée avant d'être jouée, et les composants sains qui venaient après
// n'avaient jamais leur code, dits cassés à leur tour ; une seconde erreur n'était jamais dite ; le fichier fautif recevait en plus
// « repère interne jamais résolu … bogue du bundler ». L'échec est provoqué en remplaçant la tâche d'un composant, faute d'une source
// qui fasse échouer esbuild après une transpilation réussie. (2) Un dossier de sortie écrit `./dist` donne le préfixe `/dist`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, deriveUrlPrefix, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(env: 'dev' | 'prod', cache: boolean, enEchec: string[]): Promise<{ erreurs: string[], suivie: boolean }> {
  const root = mjsTmp('minification-en-echec')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  // le cache sur disque vit sous le dossier des dépendances du projet
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"name":"essai","private":true}\n')
  for (const f of ['a', 'b', 'c']) writeFileSync(join(src, f + '.mjs'), `<p>${f}</p>\n`)
  const ici = process.cwd()
  process.chdir(root)
  try {
    let suivie = false
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, ...(cache ? { cache: true } : {}) } as any)
    const flush = b.flushPendingMinifyTasks
    b.flushPendingMinifyTasks = async function (withCached: boolean): Promise<void> {
      if (withCached && this.mangleTrailOn()) suivie = true
      for (const task of this.pendingMinifyTasks) if (enEchec.includes(task.stem)) task.run = async () => { throw new Error(`minification de ${task.stem} en échec`) }
      return flush.call(this, withCached)
    }
    const s = await b.compile()
    await b.close()
    return { erreurs: s.errors.map((e: Error) => e.message).sort(), suivie }
  }
  finally {
    process.chdir(ici)
  }
}

describe('construction par l\'API : minifications en échec, dossier de sortie relatif', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const cas: Array<[string, 'dev' | 'prod', boolean, string[]]> = [
    ['dev : a échoue', 'dev', false, ['a']],
    ['dev : a et b échouent', 'dev', false, ['a', 'b']],
    ['prod : a échoue', 'prod', false, ['a']],
    ['prod : a et b échouent', 'prod', false, ['a', 'b']],
    ['prod avec le cache sur disque : a échoue', 'prod', true, ['a']],
    ['prod avec le cache sur disque : a et b échouent', 'prod', true, ['a', 'b']],
  ]
  for (const [nom, env, cache, enEchec] of cas) {
    it(`${nom} — une erreur par fichier en échec, rien d'autre`, async () => {
      const r = await construire(env, cache, enEchec)
      if (cache) assert.ok(r.suivie, 'la suite des minifications sous le cache doit être celle qui tourne')
      assert.deepEqual(r.erreurs, enEchec.map(f => `minification de ${f} en échec`))
    })
  }

  it('outputDir ./dist donne le préfixe /dist', () => {
    assert.equal(deriveUrlPrefix('./dist'), '/dist')
    assert.equal(deriveUrlPrefix('dist'), '/dist')
    assert.equal(deriveUrlPrefix('./public/m'), '/m')
    assert.equal(deriveUrlPrefix('public/modularjs'), '/modularjs')
  })
})
