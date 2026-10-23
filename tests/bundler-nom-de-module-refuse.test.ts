// Le nom de fichier d'un module `.civet`/`.coffee` devient son adresse publiée (`<prefix>/<nom>-<empreinte>.js`), sans
// aucun contrôle jusqu'ici :
// - `mjs_core.civet` (l'espace `mjs_…` des fichiers internes) prenait la place du cœur chez le composant qui l'importait
// - `outil#2.civet` : construction verte, mais le navigateur lit `/out/outil#2-….js` comme `/out/outil` + fragment (404)
// - `mon outil.civet` : erreurs « repère interne … bogue du bundler »
// Chacun donne désormais une erreur claire qui nomme le fichier ; les noms ordinaires, accents compris, passent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function construire(nom: string, js: 'split' | 'bundle') {
  const root = mjsTmp('module-nom')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, `${nom}.civet`), "export function outil() { return 'MARQUE_MODULE' }\n")
  writeFileSync(join(src, 'hote.mjs'), `@import outil '${nom}.civet'\n<script>\n  go = -> outil()\n</script>\n<p>x</p>\n`)
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js } as any)
  const s = await b.compile()
  await b.close()
  return s.errors.map((e: any) => e.message as string)
}

describe('nom de module : refusé quand il casserait l\'adresse ou prendrait un nom interne', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['mjs_core', 'mjs_external', 'outil#2', 'outil?x', 'mon outil']) {
    it(`module « ${nom}.civet » : erreur qui nomme le fichier`, async () => {
      const messages = await construire(nom, 'split')
      assert.ok(messages.some(m => m.includes(`${nom}.civet`) && m.includes('mjs_')), JSON.stringify(messages))
      assert.ok(!messages.some(m => m.includes('bogue du bundler')), JSON.stringify(messages))
    })
  }

  for (const nom of ['outil', 'outil-été', 'outil.module']) {
    for (const js of ['split', 'bundle'] as const) {
      it(`module « ${nom}.civet », js: ${js} : construit sans erreur`, async () => {
        assert.deepEqual(await construire(nom, js), [])
      })
    }
  }
})
