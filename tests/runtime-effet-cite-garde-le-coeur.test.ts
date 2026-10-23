// `runtime: ['fx_neon']` garde le code d'un effet au cœur au lieu de son propre fichier : citer un
// effet dans la clé `runtime` l'AJOUTE au cœur, sans retirer les modules (routeur, liens, requêtes)
// qu'un projet sans clé `runtime` y trouve. Un tableau qui nomme des modules reste, lui, une
// sélection explicite ; un tableau vide, le cœur nu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(etiquette: string, runtime: unknown) {
  const root   = mjsTmp('runtime-fx-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'c.mjs'), '<p *neon>A</p>\n<a href="/x">lien</a>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files   = readdirSync(outDir)
  const coeur   = readFileSync(join(outDir, files.find((f) => /^mjs_core-.*\.js$/.test(f))!), 'utf-8')
  const modules = [...coeur.matchAll(/=== (mjs_[a-z_]+)\.ts ===/g)].map((m) => m[1].slice(4))
  return { modules, fichierNeon: files.some((f) => /^mjs_fx_neon-/.test(f)), warnings: stats.warnings }
}

describe('runtime : un effet cité s\'ajoute au cœur sans en retirer les autres modules', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sans clé runtime : routeur, liens et requêtes au cœur, l\'effet dans son propre fichier', async () => {
    const r = await construire('defaut', undefined)
    for (const m of ['router', 'ujs', 'ajax']) assert.ok(r.modules.includes(m), m)
    assert.equal(r.modules.includes('fx_neon'), false)
    assert.equal(r.fichierNeon, true)
  })

  it('runtime: [\'fx_neon\'] : l\'effet passe au cœur, les autres modules restent', async () => {
    const r = await construire('fx', ['fx_neon'])
    assert.ok(r.modules.includes('fx_neon'), 'l\'effet au cœur')
    assert.equal(r.fichierNeon, false, 'plus de fichier à part')
    for (const m of ['router', 'ujs', 'ajax']) assert.ok(r.modules.includes(m), `${m} garde sa place : ${r.modules.join(',')}`)
  })

  it('un tableau qui nomme des modules reste une sélection explicite ; l\'effet cité y passe au cœur', async () => {
    const r = await construire('choix', ['router', 'fx_neon'])
    assert.ok(r.modules.includes('router'))
    assert.equal(r.modules.includes('ujs'), false)
    assert.equal(r.modules.includes('ajax'), false)
    assert.ok(r.modules.includes('fx_neon'))
  })

  it('un tableau vide : le cœur nu, comme avant', async () => {
    const r = await construire('vide', [])
    assert.equal(r.modules.includes('router'), false)
    assert.equal(r.modules.includes('ajax'), false)
  })
})
