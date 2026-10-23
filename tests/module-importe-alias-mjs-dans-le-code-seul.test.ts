// Projet en symbole ASCII (`sigil: 'mjs'`) : dans un module .civet importé, l'alias `mjs.` devient `µ.` dans le
// code seulement, comme dans le script d'un composant — une chaîne (`'voir mjs.dev'`) ou un commentaire gardent
// leur texte. Avant, l'alias était appliqué au texte entier du module, chaînes comprises.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('module .civet importé — alias mjs dans le code seul', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('`mjs.log(…)` devient `µ.log(…)`, la chaîne « voir mjs.dev » reste telle quelle', async () => {
    const root   = mjsTmp('module-alias-code-seul')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'aide.module.civet'), "# lien : mjs.dev\nexport saluer = ->\n  mjs.log('voir mjs.dev')\n")
    writeFileSync(join(srcDir, 'app.mjs'), "@import saluer 'aide.module.civet'\n<script>\nval = 1\n</script>\n<p>{val}</p>")
    const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), sigil: 'mjs' } as any).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const aide = readdirSync(outDir).find((f) => /^aide\.module-.*\.js$/.test(f))
    assert.ok(aide, `module absent de la sortie : ${readdirSync(outDir).join(', ')}`)
    const code = readFileSync(join(outDir, aide!), 'utf-8')
    assert.match(code, /µ\.log\(/)
    assert.match(code, /voir mjs\.dev/)
    assert.doesNotMatch(code, /µ\.dev/)
  })
})
