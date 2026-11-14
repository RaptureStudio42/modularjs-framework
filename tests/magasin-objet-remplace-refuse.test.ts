// fichier d'un magasin (`export µ$$c = …`) : `µ$c = …` y remplacerait l'objet du magasin, mais `µ$$c`, que lisent les composants,
// garderait l'ancien (et une ligne `µ$c = …` seule ne remplacerait rien) — refusé à la construction, avec sa ligne et ce qu'il faut
// écrire. Changer l'objet sur place (une clé, `Object.assign`) reste permis, comme une autre variable du fichier

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function construire(magasin: string): Promise<string[]> {
  const root   = mjsTmp('magasin-remplace')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'panier.module.civet.mjs'), magasin)
  writeFileSync(join(srcDir, 'vue.mjs'), "@import µ$$c 'panier.module.civet.mjs'\n<p>{µ$$c.p}</p>\n")
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => String(e.message))
}

describe('fichier d\'un magasin : µ$c = … et µ$$c = … refusés à la construction', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [cas, corps, ligne] of [
    ['dans une fonction, sur la ligne de la fonction', 'window.__f = -> µ$c = { p: 5 }', 2],
    ['seul sur sa ligne, dans une fonction', 'window.__f = ->\n  µ$c = { p: 5 }', 3],
    ['affectation logique', 'window.__f = -> µ$c ||= { p: 5 }', 2],
  ] as const) it(`${cas} : refusé, avec sa ligne et ce qu'il faut écrire`, async () => {
    const erreurs = await construire(`export µ$$c = { p: 1 }\n${corps}\n`)
    const avis    = erreurs.find((e) => e.includes('µ$c = …'))
    assert.ok(avis, JSON.stringify(erreurs))
    assert.ok(avis.includes(`ligne ${ligne} :`), avis)
    assert.ok(avis.includes('« µ$$c »') && avis.includes('µ$c.cle = valeur') && avis.includes('Object.assign(µ$c, { … })'), avis)
  })

  // `µ$$c = …` dans une fonction n'écrivait qu'une variable locale du même nom (`let $c`), qui cachait l'export : rien ne changeait
  for (const [cas, corps, ligne] of [
    ['µ$$c dans une fonction', 'window.__f = -> µ$$c = { p: 5 }', 2],
    ['µ$$c seul sur sa ligne, dans une fonction', 'window.__f = ->\n  µ$$c = { p: 5 }', 3],
    ['µ$$c après sa déclaration, hors de toute fonction', 'µ$$c = { p: 5 }', 2],
  ] as const) it(`${cas} : refusé, avec sa ligne et ce qu'il faut écrire`, async () => {
    const erreurs = await construire(`export µ$$c = { p: 1 }\n${corps}\n`)
    const avis    = erreurs.find((e) => e.includes('µ$$c = …'))
    assert.ok(avis, JSON.stringify(erreurs))
    assert.ok(avis.includes(`ligne ${ligne} :`), avis)
    assert.ok(avis.includes('µ$c.cle = valeur') && avis.includes('Object.assign(µ$c, { … })'), avis)
  })

  it('l\'objet changé sur place, une autre variable du fichier remplacée : aucune erreur', async () => {
    const erreurs = await construire("export µ$$c = { p: 1 }\nµ$autre = 1\nwindow.__f = -> µ$c.p = 13\nwindow.__g = -> Object.assign µ$c, { p: 9 }\nwindow.__h = -> µ$autre = 2\nwindow.__i = -> µ$c == null\nwindow.__j = -> µ$$c.p = 7\n")
    assert.deepEqual(erreurs, [])
  })
})
