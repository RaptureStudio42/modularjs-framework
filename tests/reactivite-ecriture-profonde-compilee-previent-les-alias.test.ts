// Une écriture profonde compilée (`$sel.n = 'Z'`, `$sel.tags.push(x)`, `delete $sel.n` : `µ._mjs_deepSet`,
// `µ._mjs_deepCall`, `µ._mjs_deepDelete`) prévient toutes les variables qui affichent le même objet. Défaut
// garanti absent : seule la variable écrite était prévenue — après `$sel = it`, la liste `$items` qui affiche
// le MÊME objet gardait l'ancienne valeur jusqu'à son prochain rendu.
// Garde : les trois écritures passent bien par le chemin compilé (appels relevés), pas par l'enveloppe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<script>',
  "$items = [{n: 'a', tags: []}, {n: 'b', tags: []}, {n: 'c', tags: []}]",
  '$sel = null',
  'pick = (x) ->',
  '  $sel = x',
  'renomme = ->',
  "  $sel.n = 'Z'",
  'etiquette = ->',
  "  $sel.tags.push('t')",
  'efface = ->',
  '  delete $sel.n',
  '</script>',
  '<ul>{for it in $items}<li @click={pick(it)}>{it.n}:{it.tags.length}</li>{end}</ul>',
  '<p class="nom">{$sel ? $sel.n : \'-\'}</p>',
  '<button class="z" @click={renomme()}>z</button><button class="t" @click={etiquette()}>t</button><button class="d" @click={efface()}>d</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('ecriture-profonde-alias')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ep-liste.mjs'), LISTE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('écriture profonde compilée — les autres variables qui affichent le même objet sont prévenues', function () {
  this.timeout(60000)

  let app: any
  const appels: string[] = []
  const origines: Record<string, any> = {}

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    for (const nom of ['_mjs_deepSet', '_mjs_deepCall', '_mjs_deepDelete']) {
      origines[nom] = app.µ[nom]
      app.µ[nom] = function (...a: any[]) { appels.push(nom); return origines[nom].apply(this, a) }
    }
  })

  after(async () => {
    if (app) {
      for (const nom of Object.keys(origines)) app.µ[nom] = origines[nom]
      await app.destroy()
    }
  })

  const lignes = (c: any) => c.findAll('li').map((l: any) => l.textContent)

  it('`$sel.n = \'Z\'` puis `$sel.tags.push(\'t\')` puis `delete $sel.n` : la liste suit, sans autre rendu', async () => {
    const c = await app.mount('ep-liste')
    try {
      c.findAll('li')[0].click()
      await c.tick()
      appels.length = 0
      await c.click('.z')
      assert.deepEqual(appels, ['_mjs_deepSet'], 'écriture par le chemin compilé')
      assert.equal(c.text('.nom'), 'Z')
      assert.deepEqual(lignes(c), ['Z:0', 'b:0', 'c:0'], 'la liste affiche le nouveau nom')
      await c.click('.t')
      assert.deepEqual(appels, ['_mjs_deepSet', '_mjs_deepCall'], 'méthode appelée par le chemin compilé')
      assert.deepEqual(lignes(c), ['Z:1', 'b:0', 'c:0'], 'la liste affiche la nouvelle étiquette')
      await c.click('.d')
      assert.deepEqual(appels, ['_mjs_deepSet', '_mjs_deepCall', '_mjs_deepDelete'], 'suppression par le chemin compilé')
      assert.deepEqual(lignes(c), [':1', 'b:0', 'c:0'], 'la liste affiche la suppression')
    } finally {
      c.destroy()
    }
  })
})
