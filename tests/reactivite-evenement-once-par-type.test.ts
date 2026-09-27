// `.once` par NŒUD (sémantique `{ once: true }` native) : la clé « déjà déclenché »
// de `_mjs_bindEvents` ne portait que l'identifiant de routage du nœud, jamais le TYPE
// d'événement — deux directives `.once` distinctes sur le MÊME élément (`@click.once`
// et `@keydown.once`) partagent ce même identifiant, donc le premier événement déclenché
// (quel que soit son type) désarme aussi l'autre : un clic empêchait la touche de jouer
// son propre handler `.once`, alors que les deux types d'événement sont indépendants.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ONCE_DEUX_TYPES = [
  '<script>',
  '$a = 0',
  '$b = 0',
  '</script>',
  '<button @click.once={$a += 1} @keydown.once={$b += 1}>test</button>',
  '<p>{$a}:{$b}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('once-par-type')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'once-deux-types.mjs'), ONCE_DEUX_TYPES)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('.once par type d\'événement — deux directives sur le même nœud', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = projetTemporaire()
    app  = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('un clic .once et une touche .once sur le même bouton se déclenchent chacun une fois', async () => {
    const c = await app.mount('once-deux-types')
    try {
      await c.click('button')
      await c.fire('button', 'keydown')
      assert.equal(c.text('p'), '1:1', 'les deux handlers .once doivent avoir joué, un par type d\'événement')
    } finally {
      c.destroy()
    }
  })

  it('chaque handler .once ne joue bien qu\'une seule fois (répétition du même type)', async () => {
    const c = await app.mount('once-deux-types')
    try {
      await c.click('button')
      await c.click('button')
      await c.fire('button', 'keydown')
      await c.fire('button', 'keydown')
      assert.equal(c.text('p'), '1:1', 'un second clic ou une seconde touche ne doit rien changer')
    } finally {
      c.destroy()
    }
  })
})
