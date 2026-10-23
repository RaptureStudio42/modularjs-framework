// Un composant sans HTML ne rend rien : avertissement du build `[lint.emptyComponent]`, coupable
// par `"lint": { "emptyComponent": false }`, ou changé en ERREUR de build par
// `"lint": { "emptyComponent": "error" }` — la seule clé `lint` qui accepte cette valeur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { findConfig } from '../src/bundler/config.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const avertissements = async (source: string, lint?: Record<string, unknown>) =>
  (await transpile(source, { moduleName: 'essai-vide', lint: lint as any })).data.sectionWarnings as string[]

describe('lint.emptyComponent — un composant sans HTML', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('script seul : avertissement étiqueté [lint.emptyComponent], qui dit quoi faire', async () => {
    const w = await avertissements('<script>\n$x = 1\n</script>\n<style>\n  p\n    color: red\n</style>')
    const ligne = w.find(l => l.endsWith('[lint.emptyComponent]'))
    assert.ok(ligne, JSON.stringify(w))
    assert.match(ligne!, /essai-vide : ce composant n'a pas de HTML — il ne rend rien/)
  })

  it('un commentaire HTML seul ne compte pas comme du HTML', async () => {
    assert.ok((await avertissements('<script>\n$x = 1\n</script>\n<!-- rien -->')).some(l => l.endsWith('[lint.emptyComponent]')))
  })

  it('du HTML, ou une balise du langage (<@window>, <@head>) : aucun avertissement', async () => {
    for (const src of ['<p>x</p>', '<script>\n$x = 1\n</script>\n<@window @keydown={x()}></@window>', '<@head><title>t</title></@head>']) {
      assert.ok(!(await avertissements(src)).some(l => l.includes('emptyComponent')), src)
    }
  })

  it('lint.emptyComponent: false le coupe', async () => {
    assert.ok(!(await avertissements('<script>\n$x = 1\n</script>', { emptyComponent: false })).some(l => l.includes('emptyComponent')))
  })

  it('au build : un avertissement par défaut ; une ERREUR avec "error" (le build échoue)', async () => {
    const compile = async (lint?: Record<string, unknown>) => {
      const root   = mjsTmp('lint-vide')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'vide.mjs'), '<script>\n$x = 1\n</script>')
      writeFileSync(join(srcDir, 'plein.mjs'), '<p>x</p>')
      const b = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), lint: lint as any })
      const stats = await b.compile()
      await b.close()
      return stats
    }
    const par_defaut = await compile()
    assert.equal(par_defaut.errors.length, 0)
    assert.ok(par_defaut.warnings.some((w: string) => /vide\.mjs[\s\S]*\[lint\.emptyComponent\]$/.test(w)), JSON.stringify(par_defaut.warnings))
    const erreur = await compile({ emptyComponent: 'error' })
    assert.ok(erreur.errors.some((e: any) => /vide\.mjs[\s\S]*ce composant n'a pas de HTML/.test(String(e.message ?? e))), JSON.stringify(erreur.errors.map((e: any) => e.message)))
    assert.ok(!erreur.warnings.some((w: string) => w.includes('emptyComponent')), 'plus dans les avertissements')
  })

  it('mjs.config.json : "error" accepté pour emptyComponent seulement, message clair sinon', () => {
    const ok = mjsTmp('lint-vide-cfg')
    writeFileSync(join(ok, 'mjs.config.json'), JSON.stringify({ lint: { emptyComponent: 'error' } }))
    assert.equal(findConfig(ok)!.config.lint!.emptyComponent, 'error')
    const faux = mjsTmp('lint-vide-cfg')
    writeFileSync(join(faux, 'mjs.config.json'), JSON.stringify({ lint: { emptyComponent: 'erreur' } }))
    assert.throws(() => findConfig(faux), /lint\.emptyComponent doit valoir true, false ou "error"/)
    const autre = mjsTmp('lint-vide-cfg')
    writeFileSync(join(autre, 'mjs.config.json'), JSON.stringify({ lint: { a11y: 'error' } }))
    assert.throws(() => findConfig(autre), /lint\.a11y doit être un booléen/)
  })
})
