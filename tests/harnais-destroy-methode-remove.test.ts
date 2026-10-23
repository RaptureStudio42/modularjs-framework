// Le harnais de test d'une appli (`createHarness`) : `destroy()` retire un composant de la page, même s'il a une
// méthode d'auteur du même nom que celle de sa balise (`@remove = (todo) -> …`, un nom naturel pour une liste).
// `el.remove()` appelait la méthode de l'auteur : le composant restait dans la page, et sa méthode recevait un appel
// que personne n'avait demandé. Le cadre retire désormais par la méthode de la balise, jamais celle du composant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('harnais de test : destroy() d\'un composant qui a une méthode @remove', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le composant quitte la page, et la méthode de l\'auteur n\'est pas appelée', async () => {
    const root = mjsTmp('harnais-remove')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'liste.mjs'), '<script>\n$todos = [\'a\']\n$retires = []\n@remove = (todo) -> $retires = [...$retires, todo]\n</script>\n<p class="n">{$todos.length}</p>\n')
    const app = await createHarness({ root, sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' })
    try {
      const c = await app.mount('liste')
      assert.equal(c.el.isConnected, true, 'monté')
      c.destroy()
      await c.tick()
      assert.equal(c.el.isConnected, false, 'retiré de la page')
      assert.equal(app.document.querySelectorAll('mjs-liste').length, 0, 'plus aucune balise dans le document')
      assert.equal(c.state.retires.length, 0, 'la méthode de l\'auteur n\'a pas été appelée : ' + JSON.stringify(c.state.retires))
    }
    finally {
      await app.destroy()
    }
  })

  // projet minifié : les propriétés internes du cœur (`µ._mjs_rm`…) y portent un nom raccourci, que le harnais ne
  // peut pas nommer — destroy() plantait (« _mjs_rm is not a function ») et le composant restait dans la page
  it('projet minifié : destroy() retire le composant, sans appeler la méthode de l\'auteur', async () => {
    const root = mjsTmp('harnais-remove-minifie')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', minify: true }))
    writeFileSync(join(root, 'src', 'liste.mjs'), '<script>\n$todos = [\'a\']\n$retires = []\n@remove = (todo) -> $retires = [...$retires, todo]\n</script>\n<p class="n">{$todos.length}</p>\n')
    const app = await createHarness({ root })
    try {
      const c = await app.mount('liste')
      assert.equal(c.el.isConnected, true, 'monté')
      c.destroy()
      await c.tick()
      assert.equal(c.el.isConnected, false, 'retiré de la page')
      assert.equal(app.document.querySelectorAll('mjs-liste').length, 0, 'plus aucune balise dans le document')
      assert.equal(c.state.retires.length, 0, 'la méthode de l\'auteur n\'a pas été appelée : ' + JSON.stringify(c.state.retires))
    }
    finally {
      await app.destroy()
    }
  })

  it('sans méthode du même nom, destroy() retire toujours le composant', async () => {
    const root = mjsTmp('harnais-remove-simple')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="n">simple</p>\n')
    const app = await createHarness({ root, sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' })
    try {
      const c = await app.mount('simple')
      c.destroy()
      assert.equal(c.el.isConnected, false)
    }
    finally {
      await app.destroy()
    }
  })
})
