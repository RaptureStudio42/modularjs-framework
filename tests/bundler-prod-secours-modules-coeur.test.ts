// Production : le texte français de secours des messages de la console est retiré aussi du code des
// composants (modules cœur et composants du projet), pas seulement du cœur du framework. La clé du
// message reste, son texte vient du fichier de langue. Build de développement : le secours reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SECOURS_FIELD = 'aucun « name »'
const SECOURS_PROJET = 'secours français du projet'

async function construire(env: 'dev' | 'prod', js: 'split' | 'bundle'): Promise<string> {
  const root = mjsTmp('prod-secours-modules-coeur-' + env + '-' + js)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), '<@@field label="Email"><input name="email"></@@field>\n')
  writeFileSync(join(srcDir, 'perso.mjs'), `<p>x</p>\n<script>\nµ.warn(µ._mjs_msg('persoCle', null, '${SECOURS_PROJET}'))\n</script>\n`)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env, js } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

for (const js of ['split', 'bundle'] as const) {
  describe(`production : secours français retiré du code des composants (js ${js})`, function () {
    this.timeout(120000)
    after(async () => { await terminateSharedWorkerPool() })

    it('<@@field> construit en production : le texte français absent, la clé présente', async () => {
      const code = await construire('prod', js)
      assert.equal(/coreFieldNoName/.test(code), true, 'clé absente')
      assert.equal(code.includes(SECOURS_FIELD), false, 'secours du module cœur encore là')
    })

    it('un composant du projet : le secours retiré, la clé gardée', async () => {
      const code = await construire('prod', js)
      assert.equal(/persoCle/.test(code), true, 'clé absente')
      assert.equal(code.includes(SECOURS_PROJET), false, 'secours du composant encore là')
    })

    it('développement : le secours reste au site d\'appel', async () => {
      const code = await construire('dev', js)
      assert.equal(code.includes(SECOURS_FIELD), true, 'secours absent en développement')
      assert.equal(code.includes(SECOURS_PROJET), true, 'secours absent en développement')
    })
  })
}
