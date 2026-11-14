// <@include nom> par nom simple (partiel local, puis partiel de `shared/`) : un partiel qui est un lien vers un fichier hors du dossier
// des sources est refusé comme le chemin relatif qui sort des sources (include-import-confinement.test.ts) — faute nommée, rien du
// fichier dans la sortie. Avant ce correctif, le nom simple suivait le lien et versait le fichier du dehors dans la sortie. Un lien
// qui reste dans les sources est suivi.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// un composant qui inclut `secret` par son nom simple ; `place` pose le partiel avant la construction
async function buildWith(place: (src: string, outside: string) => void): Promise<{ errors: string[]; output: string }> {
  const root    = mjsTmp('include-lien')
  const src     = join(root, 'src')
  const out     = join(root, 'out')
  const outside = join(root, 'dehors')
  mkdirSync(join(src, 'shared'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(outside, '_secret.mjs'), '<b>SECRET-HORS</b>\n')
  writeFileSync(join(src, 'fiche.mjs'), '<div>\n  <@include secret>\n</div>\n')
  place(src, outside)
  const stats   = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js') }).compile()
  const written = existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.js')).map(f => join(out, f)) : []
  const output  = [...written, join(root, 'bundle.js')].filter(f => existsSync(f)).map(f => readFileSync(f, 'utf-8')).join('\n')
  return { errors: stats.errors.map(e => String(e.message)), output }
}

describe('<@include nom> — un lien vers un fichier hors des sources', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('partiel local lié dehors : refusé, faute nommée, rien du fichier dans la sortie', async () => {
    const r = await buildWith((src, outside) => symlinkSync(join(outside, '_secret.mjs'), join(src, '_secret.mjs')))
    assert.ok(!r.output.includes('SECRET-HORS'), 'le contenu du fichier hors des sources est dans la sortie')
    assert.equal(r.errors.length, 1, r.errors.join('\n'))
    assert.match(r.errors[0], /<@include secret> : ce chemin .* est HORS de sourceDir/)
  })

  it('partiel de shared/ lié dehors : refusé, faute nommée, rien du fichier dans la sortie', async () => {
    const r = await buildWith((src, outside) => symlinkSync(join(outside, '_secret.mjs'), join(src, 'shared', '_secret.mjs')))
    assert.ok(!r.output.includes('SECRET-HORS'), 'le contenu du fichier hors des sources est dans la sortie')
    assert.equal(r.errors.length, 1, r.errors.join('\n'))
    assert.match(r.errors[0], /<@include secret> : ce chemin .* est HORS de sourceDir/)
  })

  it('partiel local lié à un fichier DANS les sources : suivi', async () => {
    const r = await buildWith((src) => {
      writeFileSync(join(src, 'shared', '_vrai.mjs'), '<b>DEDANS</b>\n')
      symlinkSync(join(src, 'shared', '_vrai.mjs'), join(src, '_secret.mjs'))
    })
    assert.deepEqual(r.errors, [])
    assert.ok(r.output.includes('DEDANS'), 'le partiel lié dans les sources manque à la sortie')
  })
})
