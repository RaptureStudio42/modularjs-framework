// Un setter de contexte `§x = …` (ou `§§x = …`, ou une lecture `§x`) écrit dans une fonction rangée dans
// l'état (`$go = -> §x = 1`) n'atteignait pas le composant : appelée `$go()`, la fonction recevait l'état
// comme `this`, et l'appel émis `this._mjs_setContext(…)` visait l'état. `§` et `§§` désignent le contexte du
// composant dont le script les porte, quel que soit l'appelant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = [
  '<script>',
  "§x = 'avant'",
  "§§y = { v: 'avant' }",
  "$lu = ''",
  "$go = -> §x = 'apres'",
  "$goR = -> §§y = { v: 'apres' }",
  '$lire = -> $lu = §x',
  '</script>',
  '<p class="v">{$lu}</p>',
  '<button class="go" @click={$go()}>a</button>',
  '<button class="go-r" @click={$goR()}>b</button>',
  '<button class="lire" @click={$lire()}>c</button>',
]

function projetTemporaire(): string {
  const root   = mjsTmp('contexte-fonction-etat')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ctx-etat.mjs'), COMPOSANT.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('contexte écrit ou lu depuis une fonction rangée dans l\'état', function () {
  this.timeout(90000)
  let app: any

  before(async () => { app = await createHarness({ root: projetTemporaire() }) })
  after(async () => { if (app) await app.destroy() })

  it('`$go = -> §x = …` écrit le contexte du composant', async () => {
    const c = await app.mount('ctx-etat')
    try {
      await c.click('.go')
      assert.equal(c.el._mjs_getContext('x'), 'apres')
    }
    finally { c.destroy() }
  })

  it('`$goR = -> §§y = …` écrit le contexte réactif du composant', async () => {
    const c = await app.mount('ctx-etat')
    try {
      await c.click('.go-r')
      assert.equal(c.el._mjs_getRCtx('y').v, 'apres')
    }
    finally { c.destroy() }
  })

  it('`$lire = -> $lu = §x` lit le contexte du composant', async () => {
    const c = await app.mount('ctx-etat')
    try {
      await c.click('.lire')
      assert.equal(c.text('.v'), 'avant')
    }
    finally { c.destroy() }
  })
})
