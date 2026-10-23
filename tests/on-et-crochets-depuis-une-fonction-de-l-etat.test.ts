// `µon` et les crochets de cycle de vie (`µmount`, `µdestroy`…) écrits dans une fonction rangée dans l'état
// (`$brancher = -> µon 'click', '.item', …`, appelée `$brancher()`) visaient l'état et pas le composant : l'appel
// émis passait par `this`, qui valait l'état. Rien n'était posé, sans un mot. Comme `µsetContext` et `§`, ils
// désignent le composant dont le script les porte ; dans un `<script module>`, sans composant, `this` reste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('µon et crochets depuis une fonction rangée dans l\'état', function () {
  this.timeout(90000)
  let app: any

  before(async () => {
    const root   = mjsTmp('on-crochets-fonction-etat')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'on-etat.mjs'), [
      '<script>',
      '$n = 0',
      "$brancher = -> µon 'click', '.item', (e, el) -> $n += 1",
      "$armer = -> µdestroy -> @@dataset.etat = String($n + 100)",
      "µmount -> @@dataset.haut = '1'",
      '</script>',
      '<p class="v">{$n}</p>',
      '<button class="brancher" @click={$brancher()}>b</button>',
      '<button class="armer" @click={$armer()}>a</button>',
      '<span class="item">i</span>',
    ].join('\n'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  it('`$brancher()` pose la délégation sur le composant', async () => {
    const c = await app.mount('on-etat')
    try {
      await c.click('.item')
      assert.equal(c.text('.v'), '0')
      await c.click('.brancher')
      await c.click('.item')
      assert.equal(c.text('.v'), '1')
    }
    finally { c.destroy() }
  })

  it('`$armer()` range le crochet `µdestroy` du composant, joué à sa destruction', async () => {
    const c = await app.mount('on-etat')
    await c.click('.armer')
    const el = c.el
    c.destroy()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(el.dataset.haut, '1')
    assert.equal(el.dataset.etat, '100')
  })

  it('dans un `<script module>`, `µon` reste sur `this`', async () => {
    const r = await transpile("<script module>\nexport f = -> µon 'click', -> 1\n</script>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>", { moduleName: 'on-etat-module' })
    assert.match(r.output, /this\._mjs_on\('click'/)
  })
})
