// Le harnais de test d'une appli (`createHarness`).
// 1. Un composant qui importe une valeur d'un module du projet (`@import µ$$hmCompte 'hm-partage.module.civet'`) se
//    monte : avant, chaque fichier compilé était chargé dans sa propre portée sans ses imports, et le montage tombait
//    sur « $hmCompte is not defined ».
// 2. `set({ count: 5 })` garde le type de la valeur passée : avant, un nombre passait par l'attribut et la prop d'une
//    variable sans type déclaré recevait le texte '5'.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'hm-singleton.mjs': "@import µ$$hmCompte 'hm-partage.module.civet'\n\n<p class=\"t\">{µ$$hmCompte.value}</p>\n",
  'hm-partage.module.civet': 'export µ$$hmCompte = { value: 3 }\n',
  'hm-compteur.mjs': '<script>\n$count ?= 0\n$label ?= \'\'\n</script>\n<p class="v">{$count}</p><p class="l">{$label}</p>\n',
  'hm-parent.mjs': '<script>\n$n = 7\n</script>\n<@hm-compteur count={$n} />\n',
}

describe('harnais de test : module importé au montage, set() qui garde le type', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  let app: any
  before(async () => {
    const root = mjsTmp('harnais-module-type')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, source] of Object.entries(FICHIERS)) writeFileSync(join(root, 'src', nom), source)
    app = await createHarness({ root, sourceDir: 'src', outputDir: 'out', manifestPath: 'bundle.js' })
  })
  after(async () => { await app?.destroy() })

  it('un composant qui importe la valeur d\'un module du projet se monte et l\'affiche', async () => {
    const c = await app.mount('hm-singleton')
    try {
      assert.equal(c.text('.t'), '3')
    }
    finally { c.destroy() }
  })

  it('set({ count: 5 }) donne le nombre 5, set({ label: \'x\' }) le texte', async () => {
    const c = await app.mount('hm-compteur', { count: 1 })
    try {
      assert.equal(c.state.count, 1)
      await c.set({ count: 5 })
      assert.equal(c.state.count, 5, 'après set : ' + JSON.stringify(c.state.count))
      assert.equal(c.text('.v'), '5')
      await c.set({ label: 'x' })
      assert.equal(c.state.label, 'x')
      assert.equal(c.text('.l'), 'x')
    }
    finally { c.destroy() }
  })

  it('même chose que dans une vraie page : un parent compilé passe le nombre tel quel, sans attribut', async () => {
    const p = await app.mount('hm-parent')
    try {
      const enfant = p.find('mjs-hm-compteur')
      assert.ok(enfant, 'enfant monté')
      assert.equal(enfant._state.count, 7)
      assert.equal(enfant.getAttribute('count'), null)
    }
    finally { p.destroy() }
  })
})
