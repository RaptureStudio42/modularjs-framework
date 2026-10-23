// Les alias que ModularJS livre (près de deux cents, ~23 ko) partaient clonés vers le pool de threads avec CHAQUE fichier
// compilé. Chaque thread les résout désormais une fois lui-même : le message ne porte que l'ordre des noms et les effets
// qui en diffèrent (ceux de l'appli). La sortie reste la même que compilée sur place, sans thread.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { WorkerPool } from '../src/bundler/worker-pool.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(nom: string): string {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.effects.mjs'), '<effects>\n  *titre = *scramble(40)\n  *halo(c: red) =\n    color: $c\n</effects>\n')
  writeFileSync(join(root, 'src', 'carte.mjs'), '<h1 *titre>Bonjour</h1>\n<p *halo(on: hover)>halo</p>\n<span *neon.pink_frame>néon</span>\n')
  writeFileSync(join(root, 'src', 'liste.mjs'), '<script>\n$l = [1, 2]\n</script>\n<ul>{for x in $l}<li *fade>{x}</li>{end}</ul>\n')
  return root
}

async function construire(root: string, parLePool: boolean): Promise<Record<string, string>> {
  const b = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js'), ...(parLePool ? { inlineTranspileLimit: 0 } : {}) })
  try {
    const stats = await b.compile()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message).slice(0, 200)), [])
  }
  finally {
    await b.close()
  }
  const sortie: Record<string, string> = {}
  // deux racines, deux constructions : la racine et les empreintes des noms de fichiers mises à part
  const sansEmpreinte = (x: string) => x.replace(/-[0-9a-z]{5}\.js/g, '.js')
  for (const f of readdirSync(join(root, 'out')).filter(f => f.endsWith('.js')).sort()) sortie[sansEmpreinte(f)] = sansEmpreinte(readFileSync(join(root, 'out', f), 'utf-8').split(root).join('<racine>'))
  return sortie
}

describe('bundler : les alias livrés ne partent plus avec chaque fichier vers le pool', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le message ne porte que les effets de l\'appli, et la sortie est celle de la compilation sur place', async () => {
    const soumettre = WorkerPool.prototype.submit
    const messages: any[] = []
    WorkerPool.prototype.submit = function (this: any, msg: any) { messages.push(msg); return soumettre.call(this, msg) } as any
    let parLePool: Record<string, string>
    try {
      parLePool = await construire(projet('alias-livres-pool'), true)
    }
    finally {
      WorkerPool.prototype.submit = soumettre
    }
    const transpilations = messages.filter(m => m.type === 'transpile')
    assert.ok(transpilations.length >= 2, 'des fichiers passés par le pool : ' + transpilations.length)
    for (const m of transpilations) {
      assert.equal(m.effectDefs, undefined, 'plus de table complète dans le message')
      assert.ok(m.effectDefsWire.order.length > 150, 'tous les noms, alias livrés compris : ' + m.effectDefsWire.order.length)
      assert.deepEqual(Object.keys(m.effectDefsWire.diff).sort(), ['halo', 'titre'], 'seuls les effets de l\'appli partent en entier')
      assert.ok(JSON.stringify(m.effectDefsWire).length < 8000, 'message allégé : ' + JSON.stringify(m.effectDefsWire).length + ' o')
    }
    const surPlace = await construire(projet('alias-livres-sur-place'), false)
    assert.deepEqual(Object.keys(parLePool!), Object.keys(surPlace))
    for (const f of Object.keys(surPlace)) assert.equal(parLePool![f], surPlace[f], f)
  })
})
