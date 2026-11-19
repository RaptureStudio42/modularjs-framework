// une méthode `@plus = function() { … }` d'un `<script lang="ts">` se construit, avec ou sans `µ$x`, en développement et en production :
// le `this` du premier niveau du script désigne le composant et reste tel quel ; esbuild, sous `format: 'esm'`, lisait le script comme
// un module CommonJS (`exports.plus = …`) et posait un `export default require_…()` au milieu du composant (« 'import' and 'export'
// may only appear at the top level »)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'sans µ$x': '<script lang="ts">\n$n = 0;\n@plus = function(): void { $n++; };\n</script>\n<p>{$n}</p>\n<button @click={@plus()}>+</button>\n',
  'avec µ$x': '<script lang="ts">\nµ$x = 0;\nµeffect(() => { $n = µ$x; });\n@plus = function(): void { µ$x++; };\n@ajoute = (): void => { µ$x += 2; };\n</script>\n<p>{$n}</p>\n<button @click={@plus()}>+</button>\n'
}

describe('<script lang="ts"> : une méthode du composant se construit', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [nom, source] of Object.entries(SOURCES)) {
    it(`${nom} : this.plus gardé, aucun module CommonJS`, async () => {
      const { output } = await transpile(source, { moduleName: 'ts-methode' })
      assert.match(output, /this\.plus = function\(\)/)
      assert.doesNotMatch(output, /exports\.plus|require_|__commonJS/)
    })

    for (const prod of [false, true]) {
      it(`${nom} : construit en ${prod ? 'production' : 'développement'}`, async () => {
        const root = mjsTmp('ts-methode')
        const src  = join(root, 'src')
        const out  = join(root, 'out')
        mkdirSync(src, { recursive: true })
        writeFileSync(join(src, 'ts-methode.mjs'), source)
        const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: prod ? 'bundle' : 'split', env: prod ? 'prod' : 'dev' } as any)
        const stats   = await bundler.compile()
        await bundler.close()
        assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
      })
    }
  }
})
