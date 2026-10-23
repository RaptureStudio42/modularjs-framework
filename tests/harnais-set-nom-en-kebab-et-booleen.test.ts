// Le harnais de test d'une appli (`createHarness`) : `set()` change une prop après le montage.
// `set({ startValue: 5 })` posait l'attribut `startValue`, que le DOM abaisse en `startvalue`, alors que le composant
// observe `start-value` : rien ne changeait, sans un mot. Et un booléen passait par un attribut vide ou retiré :
// `set({ on: true })` donnait la chaîne vide, `set({ on: false })` la laissait. Le nom de l'attribut est désormais
// celui que le composant observe, et un booléen arrive tel quel dans l'état. Le nom de l'attribut se vérifie avec un
// texte : un nombre passe désormais par l'écriture d'état, comme un booléen, pour garder son type.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('harnais de test : set() d\'une prop au nom composé, et d\'un booléen', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  let app: any
  before(async () => {
    const root = mjsTmp('harnais-set-kebab')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-p.mjs'), '<script>\n$startValue ?= 0\n$on ?= false\n</script>\n<p class="v">{$startValue}</p><p class="o">{$on}</p>\n')
    app = await createHarness({ root, sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' })
  })
  after(async () => { await app?.destroy() })

  it('set({ startValue: \'5\' }) change la prop que le composant observe sous le nom start-value', async () => {
    const c = await app.mount('tst-p', { startValue: 3 })
    assert.equal(c.text('.v'), '3', 'montée à 3')
    await c.set({ startValue: '5' })
    assert.equal(c.text('.v'), '5', 'attributs posés : ' + JSON.stringify(c.el.getAttributeNames()))
    c.destroy()
  })

  it('set({ on: true }) puis set({ on: false }) donnent de vrais booléens', async () => {
    const c = await app.mount('tst-p')
    await c.set({ on: true })
    assert.equal(c.state.on, true, 'après true : ' + JSON.stringify(c.state.on))
    assert.equal(c.text('.o'), 'true')
    await c.set({ on: false })
    assert.equal(c.state.on, false, 'après false : ' + JSON.stringify(c.state.on))
    assert.equal(c.text('.o'), 'false')
    c.destroy()
  })
})
