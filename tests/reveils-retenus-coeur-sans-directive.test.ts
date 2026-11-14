// Construction : les réveils retenus des lignes (bloc balisé `<reveils-retenus>` de runtime/mjs_for.ts — `µ._mjs_waitRow`, la file des
// composants qui attendent la fin d'une réconciliation pour se réveiller) n'entrent au cœur que si une ligne les demande : une ligne qui
// porte une directive qui lit sa balise dans le document et qui livre des props à un composant enfant, ou un `{if}` de ligne dont une
// branche en livre (generator/compile.ts). Une appli sans directive, même avec une liste dans une liste, ne paie pas un octet de ce code,
// ni une appli dont les `{if}` de ligne ne portent aucun composant

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ENFANT    = '<script>\n  µawake -> $n += 1\n</script>\n<p>{$n}</p>\n'
const IMBRIQUEE = '<script>\n  $g = [{ id: \'g\', items: [{ id: \'i\', n: 2 }] }]\n</script>\n{for g in $g by id}<section>{for i in g.items by id}<b><@enfant n=!{i.n}></@enfant></b>{end}</section>{end}\n'
const PLATE     = '<script>\n  $l = [{ id: \'a\', n: 1 }]\n</script>\n{for p in $l by id}<div><@enfant n=!{p.n}></@enfant></div>{end}\n'
const DIRECTIVE = '<script>\n  $l = [{ id: \'a\', n: 1 }]\n</script>\n{for p in $l by id}<div :transition=*fade(duration: 60ms)><@enfant n=!{p.n}></@enfant></div>{end}\n'
const SI_ENFANT = '<script>\n  $l = [{ id: \'a\', n: 1, ok: true }]\n</script>\n{for p in $l by id}<div>{if p.ok}<@enfant n=!{p.n}></@enfant>{else}<i>{p.n}</i>{end}</div>{end}\n'
const SI_SANS   = '<script>\n  $l = [{ id: \'a\', n: 1, ok: true }]\n</script>\n{for p in $l by id}<div>{if p.ok}<b>{p.n}</b>{else}<i>{p.n}</i>{end}<@enfant n=!{p.n}></@enfant></div>{end}\n'

// le cœur construit (non minifié) d'une appli : un composant enfant et une liste qui lui livre ses props
async function coeur(nom: string, liste: string, env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('reveils-' + nom + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
  writeFileSync(join(srcDir, 'liste.mjs'), liste)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env, minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
  assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
  return readFileSync(join(outDir, fichier), 'utf-8')
}

describe('réveils retenus des lignes — seulement quand une ligne les demande', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('signal : seule une ligne à directive ou un {if} de ligne qui livre des props à un enfant le pose', async () => {
    const signal = (features as any).REVEILS_RETENUS
    assert.equal(typeof signal, 'string', 'le signal est publié par le module des signaux')
    const sortie = async (source: string) => (await transpile(source, { moduleName: 'mjs-liste' })).output
    assert.equal(features.scanCompiledFeatures(await sortie(DIRECTIVE)).has(signal), true, 'ligne à directive qui livre des props à un enfant')
    assert.equal(features.scanCompiledFeatures(await sortie(IMBRIQUEE)).has(signal), false, 'liste dans une liste, sans directive')
    assert.equal(features.scanCompiledFeatures(await sortie(PLATE)).has(signal), false, 'liste plate, sans directive')
    assert.equal(features.scanCompiledFeatures(await sortie(SI_ENFANT)).has(signal), true, '{if} de ligne dont une branche livre des props à un enfant')
    assert.equal(features.scanCompiledFeatures(await sortie(SI_SANS)).has(signal), false, '{if} de ligne sans composant, enfant hors du {if}')
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`cœur (${env === 'dev' ? 'développement' : 'production'}) : une liste dans une liste sans directive n'en porte rien`, async () => {
      const imbriquee = await coeur('imbriquee', IMBRIQUEE, env)
      assert.equal(imbriquee.includes('_mjs_waitRow'), false, 'liste dans une liste, sans directive : rien des réveils retenus')
      assert.equal(imbriquee.includes('_mjs_rowQ'), false, 'liste dans une liste, sans directive : ni leur file')
      assert.equal(imbriquee.includes('<reveils-retenus>'), false, 'le bloc balisé est retiré')
      assert.equal(imbriquee.includes('if (woke)'), false, 'liste dans une liste, sans directive : ni la passe rejouée après leur réveil')
      const plate = await coeur('plate', PLATE, env)
      assert.equal(plate.includes('_mjs_waitRow'), false, 'liste plate, sans directive : rien des réveils retenus')
      const directive = await coeur('directive', DIRECTIVE, env)
      assert.equal(directive.includes('µ._mjs_waitRow = function'), true, 'ligne à directive : les réveils retenus sont au cœur')
      assert.equal(directive.includes('µ._mjs_rowQ && rowGo()'), true, 'ligne à directive : leur relance en fin de réconciliation aussi')
      assert.equal(directive.includes('if (woke) this._mjs_renderStructDirty = true'), true, 'ligne à directive : et la passe rejouée quand l\'un d\'eux a écrit sa liaison à son réveil')
    })

    it(`cœur (${env === 'dev' ? 'développement' : 'production'}) : un {if} de ligne n'en porte que si une branche livre des props à un enfant`, async () => {
      const sans = await coeur('si-sans', SI_SANS, env)
      assert.equal(sans.includes('_mjs_waitRow'), false, '{if} de ligne sans composant : rien des réveils retenus')
      assert.equal(sans.includes('<reveils-retenus>'), false, '{if} de ligne sans composant : le bloc balisé est retiré')
      const enfant = await coeur('si-enfant', SI_ENFANT, env)
      assert.equal(enfant.includes('µ._mjs_waitRow = function'), true, '{if} de ligne à composant : les réveils retenus sont au cœur')
      assert.equal(enfant.includes('µ._mjs_rowQ && rowGo()'), true, '{if} de ligne à composant : leur relance en fin de réconciliation aussi')
      assert.equal(enfant.includes('if (woke) this._mjs_renderStructDirty = true'), true, '{if} de ligne à composant : et la passe rejouée quand l\'un d\'eux a écrit sa liaison à son réveil')
    })
  }
})
