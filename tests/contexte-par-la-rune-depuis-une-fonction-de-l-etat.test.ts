// `µsetContext` et `µ.getContext` écrits dans une fonction rangée dans l'état (`$go = -> µsetContext 'x', …`, appelée
// `$go()`) visaient l'état et pas le composant : l'appel émis passait par `this`, qui valait l'état. Comme `§`, ils
// désignent le composant dont le script les porte ; dans un `<script module>`, sans composant, `this` reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('µsetContext / µ.getContext depuis une fonction rangée dans l\'état', function () {
  this.timeout(90000)
  let app: any

  before(async () => {
    const root   = mjsTmp('contexte-rune-fonction-etat')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ctx-rune.mjs'), [
      '<script>',
      "µsetContext 'x', 'avant'",
      "$lu = ''",
      "$go = -> µsetContext 'x', 'apres'",
      "$lire = -> $lu = µ.getContext('x')",
      '</script>',
      '<p class="v">{$lu}</p>',
      '<button class="go" @click={$go()}>a</button>',
      '<button class="lire" @click={$lire()}>b</button>',
    ].join('\n'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  it('`$go()` écrit le contexte du composant, `$lire()` le relit', async () => {
    const c = await app.mount('ctx-rune')
    try {
      await c.click('.lire')
      assert.equal(c.text('.v'), 'avant')
      await c.click('.go')
      assert.equal(c.el._mjs_getContext('x'), 'apres')
      await c.click('.lire')
      assert.equal(c.text('.v'), 'apres')
    }
    finally { c.destroy() }
  })

  it('dans un `<script module>`, l\'appel reste sur `this`', async () => {
    const r = await transpile("<script module>\nexport f = -> µsetContext 'x', 1\n</script>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>", { moduleName: 'ctx-rune-module' })
    assert.match(r.output, /this\._mjs_setContext\('x', 1\)/)
  })
})
