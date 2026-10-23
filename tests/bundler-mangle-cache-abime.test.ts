// `.mangle-cache.json` est fait pour être versionné : une fusion git peut y laisser deux propriétés vers le même nom court,
// ou une valeur qui n'est pas un texte. À la relecture, seules les entrées textuelles (ou `false`) portées par une seule
// clé sont gardées ; le reste est écarté avec un avertissement, jamais transmis tel quel au minifieur.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../src/bundler/index.js'
import { minifyJs } from '../src/bundler/minify.js'
import { mjsTmp } from './helpers/tmp.js'

function capterAvertissements<T>(f: () => T): { valeur: T; messages: string[] } {
  const messages: string[] = []
  const origine = { warn: console.warn, error: console.error, log: console.log }
  console.warn = (...a: any[]) => { messages.push(a.join(' ')) }
  console.error = (...a: any[]) => { messages.push(a.join(' ')) }
  try {
    return { valeur: f(), messages }
  }
  finally {
    console.warn = origine.warn
    console.error = origine.error
  }
}

describe('.mangle-cache.json abîmé', function () {
  this.timeout(30000)

  it('deux propriétés vers le même nom court restent distinctes après minification', async () => {
    const out = mjsTmp('mangle-abime-double')
    writeFileSync(join(out, '.mangle-cache.json'), JSON.stringify({ _mjs_alpha: 'Qx', _mjs_beta: 'Qx', _mjs_gamma: 'Qy' }))
    const { valeur: b, messages } = capterAvertissements(() => new Bundler({ sourceDir: mjsTmp('mangle-abime-src'), outputDir: out, env: 'prod' }) as any)
    assert.equal(b.mangleCache._mjs_alpha, undefined)
    assert.equal(b.mangleCache._mjs_beta, undefined)
    assert.equal(b.mangleCache._mjs_gamma, 'Qy')
    assert.ok(messages.some(m => /mangle-cache/.test(m)), `avertissement attendu, reçu : ${messages.join(' | ')}`)
    const code = 'const o = {}; o._mjs_alpha = 1; o._mjs_beta = 2; globalThis.__mangleAbime = o._mjs_alpha + o._mjs_beta;'
    const r = await minifyJs(code, { force: true, filename: 'x.js', mangleCache: b.mangleCache })
    ;(0, eval)(r.code)
    assert.equal((globalThis as any).__mangleAbime, 3)
  })

  it('une valeur non textuelle est écartée : la minification ne tombe pas', async () => {
    const out = mjsTmp('mangle-abime-nombre')
    writeFileSync(join(out, '.mangle-cache.json'), JSON.stringify({ _mjs_alpha: 7, _mjs_beta: 'Qb', _mjs_delta: false }))
    const { valeur: b, messages } = capterAvertissements(() => new Bundler({ sourceDir: mjsTmp('mangle-abime-src2'), outputDir: out, env: 'prod' }) as any)
    assert.equal(b.mangleCache._mjs_alpha, undefined)
    assert.equal(b.mangleCache._mjs_beta, 'Qb')
    assert.equal(b.mangleCache._mjs_delta, false)
    assert.ok(messages.some(m => /mangle-cache/.test(m)), `avertissement attendu, reçu : ${messages.join(' | ')}`)
    const code = 'const o = {}; o._mjs_alpha = 1; globalThis.__mangleNombre = o._mjs_alpha;'
    await minifyJs(code, { force: true, filename: 'x.js', mangleCache: b.mangleCache })
  })

  it('un cache sain est relu sans avertissement', () => {
    const out = mjsTmp('mangle-sain')
    writeFileSync(join(out, '.mangle-cache.json'), JSON.stringify({ _mjs_alpha: 'Qa', _mjs_beta: 'Qw' }))
    const { valeur: b, messages } = capterAvertissements(() => new Bundler({ sourceDir: mjsTmp('mangle-sain-src'), outputDir: out, env: 'prod' }) as any)
    assert.equal(b.mangleCache._mjs_alpha, 'Qa')
    assert.equal(b.mangleCache._mjs_beta, 'Qw')
    assert.ok(!messages.some(m => /mangle-cache/.test(m)), messages.join(' | '))
  })
})
