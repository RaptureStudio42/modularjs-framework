// Un même objet atteint par deux variables d'état n'a qu'UNE enveloppe réactive dans un composant. Défaut
// garanti absent : l'enveloppe dépendait de la variable qui atteignait l'objet — après `$sel = it` (choix d'une
// ligne), `it === $sel` était faux dans la liste, `$items.indexOf($sel)` valait -1, `includes` rendait faux, et
// `$items.splice($items.indexOf($sel), 1)` retirait le DERNIER élément au lieu du choisi.
// Gardes : une écriture faite par l'enveloppe elle-même (hors du code compilé, comme une fonction extérieure
// qui reçoit l'objet), sur l'objet ou sur un de ses sous-objets, redessine les lecteurs des deux variables.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CHOIX = [
  '<script>',
  "$items = [{n: 'a', d: {t: 1}}, {n: 'b', d: {t: 1}}, {n: 'c', d: {t: 1}}]",
  '$sel = null',
  'pick = (x) ->',
  '  $sel = x',
  'retire = ->',
  '  $items.splice($items.indexOf($sel), 1)',
  '</script>',
  "<ul>{for it in $items}<li class={it === $sel ? 'on' : 'off'} @click={pick(it)}>{it.n}:{it.d.t}</li>{end}</ul>",
  '<p class="idx">{$items.indexOf($sel)}</p><p class="inc">{$items.includes($sel)}</p>',
  "<p class=\"t\">{$sel ? $sel.d.t : '-'}</p>",
  '<button class="r" @click={retire()}>retirer</button>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('enveloppe-unique')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'eu-choix.mjs'), CHOIX)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('état réactif — une seule enveloppe par objet, quelle que soit la variable qui l\'atteint', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  const lignes = (c: any) => c.findAll('li').map((l: any) => l.textContent)

  it('le choix d\'une ligne : `it === $sel` dans la liste, `indexOf` rend son rang, `includes` le trouve', async () => {
    const c = await app.mount('eu-choix')
    try {
      c.findAll('li')[1].click()
      await c.tick()
      assert.deepEqual(c.findAll('li').map((l: any) => l.className), ['off', 'on', 'off'], 'seule la ligne choisie est en surbrillance')
      assert.equal(c.text('.idx'), '1', '$items.indexOf($sel) rend le rang de la ligne choisie')
      assert.equal(c.text('.inc'), 'true', '$items.includes($sel) trouve la ligne choisie')
      assert.ok(c.state.sel === c.state.items[1], '$sel et $items[1] sont la même enveloppe')
    } finally {
      c.destroy()
    }
  })

  it('retirer le choix (`splice(indexOf($sel), 1)`) retire la ligne choisie, pas la dernière', async () => {
    const c = await app.mount('eu-choix')
    try {
      c.findAll('li')[0].click()
      await c.tick()
      await c.click('.r')
      assert.deepEqual(lignes(c), ['b:1', 'c:1'])
      assert.deepEqual(Array.from(c.state.items, (o: any) => o.n), ['b', 'c'])
    } finally {
      c.destroy()
    }
  })

  it('une écriture par l\'enveloppe de `$sel`, sur l\'objet puis sur un sous-objet, redessine la liste et les lecteurs de `$sel`', async () => {
    const c = await app.mount('eu-choix')
    try {
      c.findAll('li')[1].click()
      await c.tick()
      // écriture par l'enveloppe, comme une fonction extérieure au composant qui reçoit l'objet
      c.state.sel.n = 'Y'
      await c.tick()
      assert.deepEqual(lignes(c), ['a:1', 'Y:1', 'c:1'], 'la liste montre le nouveau nom')
      c.state.sel.d.t = 5
      await c.tick()
      assert.equal(c.text('.t'), '5', 'le lecteur de $sel montre le sous-objet modifié')
      assert.deepEqual(lignes(c), ['a:1', 'Y:5', 'c:1'], 'la liste aussi')
      c.state.items[1].d.t = 6
      await c.tick()
      assert.equal(c.text('.t'), '6', 'une écriture par la liste prévient aussi le lecteur de $sel')
      assert.deepEqual(lignes(c), ['a:1', 'Y:6', 'c:1'])
    } finally {
      c.destroy()
    }
  })
})
