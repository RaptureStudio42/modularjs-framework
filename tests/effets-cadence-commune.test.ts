// la variable de thème commune des effets qui se répètent, `$$mjs-fx-every`, posée dans un `<theme>` ou un `<style>` : la construction l'accepte
// sans un mot ; le code de la cadence (outil partagé) part avec les effets qui s'en servent, et avec eux seulement. L'avis d'une valeur que la
// règle de `every` refuse est du développement : la production n'en porte ni l'appel, ni la clé, ni le texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(nom: string, src: string, env: 'dev' | 'prod' = 'prod'): Promise<{ warnings: string[], code: string }> {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'p-a.mjs'), src)
  const outDir = join(root, 'out')
  const b      = new Bundler({ sourceDir: join(root, 'src'), outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats  = await b.compile()
  await b.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [], nom)
  const code = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { warnings: stats.warnings.map(String), code }
}

describe('effets — $$mjs-fx-every, la cadence commune : la construction', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('$$mjs-fx-every dans un <theme> : aucun avertissement, et l\'outil de la cadence part avec *shine', async () => {
    const r = await construire('cadence-theme', '<theme>\n  $$mjs-fx-every: 4s\n</theme>\n<button class="b" *shine(on: always)>x</button>\n')
    assert.deepEqual(r.warnings.filter((w) => w.includes('fx-every')), [])
    assert.ok(r.code.includes('µ._mjs_fxBeat = function'), 'l\'horloge commune est embarquée')
  })

  it('$$mjs-fx-every dans un <style> : aucun avertissement', async () => {
    const r = await construire('cadence-style', '<p class="b" *glitch>x</p>\n<style>\n.b\n  $$mjs-fx-every: 2s\n</style>\n')
    assert.deepEqual(r.warnings.filter((w) => w.includes('fx-every')), [])
  })

  it('l\'avis d\'une valeur refusée est du développement : la production n\'en porte ni l\'appel, ni la clé, ni le texte', async () => {
    const page = '<theme>\n  $$mjs-fx-every: 4s\n</theme>\n<button class="b" *shine(on: always)>x</button>\n'
    const prod = await construire('cadence-avis-prod', page)
    assert.ok(prod.code.includes('µ._mjs_fxBeat = function'), 'témoin : l\'horloge commune est embarquée')
    for (const t of ['fxEveryRefused', 'une valeur refusée', 'a refused value']) assert.equal(prod.code.includes(t), false, `« ${t} » est du développement`)
    const dev = await construire('cadence-avis-dev', page, 'dev')
    assert.ok(dev.code.includes('µ._mjs_msg(\'fxEveryRefused\''), 'le développement porte l\'avis')
    assert.ok(dev.code.includes('la variable de thème $$mjs-fx-every vaut'), 'l\'avis nomme $$mjs-fx-every')
  })

  it('la propriété que la construction pose est celle que le runtime lit : $$mjs-fx-every devient --mjs-mjs-fx-every, l\'ancien --mjs-fx-every n\'est plus lu', async () => {
    const r = await construire('cadence-nom', '<theme>\n  $$mjs-fx-every: 4s\n</theme>\n<button class="b" *shine(on: always)>x</button>\n')
    assert.ok(r.code.includes('--mjs-mjs-fx-every: 4s'), 'la construction pose --mjs-mjs-fx-every')
    assert.ok(r.code.includes('\'--mjs-mjs-fx-every\''), 'le runtime lit --mjs-mjs-fx-every')
    assert.equal(r.code.includes('\'--mjs-fx-every\''), false, 'le runtime ne lit plus l\'ancien --mjs-fx-every')
  })

  it('un effet qui ne se répète pas n\'embarque pas l\'outil de la cadence', async () => {
    const r = await construire('cadence-sans', '<p class="b" *neon>x</p>\n')
    assert.equal(r.code.includes('_mjs_fxBeat'), false)
  })
})
