// Construction : la file des boucles qui écrivent l'état (bloc balisé `<boucles>` du cœur, dans runtime/mjs_init.ts et dans
// `_mjs_invalidate` de runtime/mjs_element.ts) n'entre au cœur que si le compilateur a enveloppé une boucle
// (generator/loop-batch.ts) dans une unité du build ; sans boucle enveloppée, le cœur n'en porte pas un octet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ECRIT   = '<script>\n$n = 0\n@remplir = ->\n  for i of [1..3]\n    $n = i\n</script>\n<p>{$n}</p>\n'
const LIT     = '<script>\n$n = 0\n@somme = ->\n  t .= 0\n  for i of [1..3]\n    t += $n\n  t\n</script>\n<p>{$n}</p>\n'
const SANS    = '<script>\n$n = 0\n@un = -> $n = 1\n</script>\n<p>{$n}</p>\n'

// le cœur construit (développement, non minifié) d'une appli d'un seul composant
async function coeur(nom: string, source: string): Promise<string> {
  const root   = mjsTmp('boucles-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'boucle-' + nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
  assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
  return readFileSync(join(outDir, fichier), 'utf-8')
}

describe('rendus d\'une boucle regroupés — la construction', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('signal : seule une boucle qui écrit l\'état le pose', async () => {
    const sortie = async (nom: string, source: string) => (await transpile(source, { moduleName: 'mjs-boucle-' + nom })).output
    assert.equal(typeof features.BOUCLES, 'string', 'le signal est publié par le module des signaux')
    assert.equal(features.scanCompiledFeatures(await sortie('ecrit', ECRIT)).has(features.BOUCLES), true, 'une boucle qui écrit l\'état')
    assert.equal(features.scanCompiledFeatures(await sortie('lit', LIT)).has(features.BOUCLES), false, 'une boucle qui lit l\'état sans l\'écrire')
    assert.equal(features.scanCompiledFeatures(await sortie('sans', SANS)).has(features.BOUCLES), false, 'aucune boucle')
  })

  it('le cœur construit ne porte la file des boucles que si une boucle est enveloppée', async () => {
    const avec = await coeur('ecrit', ECRIT)
    const sans = await coeur('sans', SANS)
    assert.equal(avec.includes('µ._mjs_lqF = function'), true, 'une boucle enveloppée : la file est dans le cœur')
    assert.equal(avec.includes('if (µ._mjs_lq && '), true, 'une boucle enveloppée : son entrée dans `_mjs_invalidate` aussi')
    assert.equal(sans.includes('_mjs_lq'), false, 'aucune boucle enveloppée : rien de la file dans le cœur')
    assert.equal(sans.includes('<boucles>'), false, 'aucune boucle enveloppée : le bloc balisé est retiré')
  })
})
