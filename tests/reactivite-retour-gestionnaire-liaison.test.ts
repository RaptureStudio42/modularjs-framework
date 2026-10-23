// le retour implicite d'un gestionnaire en ligne garde la forme directe `µ._set(…)` : le routeur d'événements appelle la
// valeur renvoyée quand c'est une fonction, et une liaison n'a pas à la lui livrer
// le gestionnaire de l'auteur porte `(e, el)`, celui d'une liaison `(_mjs_e, _mjs_el)` : les deux sont reconnus, aucune
// enveloppe `((_v) => …)` n'alourdit une saisie
// une fonction ordinaire, hors du tableau des gestionnaires, garde la forme fidèle qui rend la valeur affectée

import assert from 'node:assert/strict'
import { transformReactiveWrites } from '../src/generator/transform-reactive.js'
import { transpile } from '../src/transpiler/index.js'

const ENVELOPPE = /\(\(_v\) => \(µ\._set/

const LIAISONS = `<script>
  $n = 0
  $ok = false
  $g = 'a'
  $t = ''
  $o = true
  $s = 0
</script>
<input aria-label="n" type="number" value=!{$n}>
<input aria-label="ok" type="checkbox" checked=!{$ok}>
<input aria-label="a" type="radio" value="a" @group=!{$g}>
<div contenteditable @text=!{$t}></div>
<details open=!{$o}><summary>s</summary>x</details>
<audio currentTime=!{$s}></audio>
`

describe('retour implicite d\'un gestionnaire en ligne — forme directe', function () {
  this.timeout(60000)

  for (const [genre, e, el] of [['de l\'auteur', 'e', 'el'], ['d\'une liaison', '_mjs_e', '_mjs_el']]) {
    it(`gestionnaire ${genre} (${e}, ${el}) : le retour garde la forme directe`, () => {
      const out = transformReactiveWrites(`this._mjs_inline = [(${e}, ${el}) => { return $.x = ${el}.value }]`)
      assert.equal(out, `this._mjs_inline = [(${e}, ${el}) => { return µ._set(_mjsThis, 'x', ${el}.value) }]`)
    })
  }

  it('une fonction ordinaire garde la forme fidèle, même avec les paramètres d\'un gestionnaire', () => {
    const out = transformReactiveWrites('const f = (_mjs_e, _mjs_el) => { return $.x = _mjs_el.value }')
    assert.match(out, ENVELOPPE)
  })

  for (const templateLang of ['civet', 'js'] as const) {
    it(`gabarit ${templateLang} : aucune liaison compilée n'enveloppe son écriture`, async () => {
      const { output } = await transpile(LIAISONS, { moduleName: 'liaisons', templateLang } as any)
      assert.doesNotMatch(output, ENVELOPPE)
      const debut = output.indexOf('_mjs_inline = [')
      assert.ok(debut > 0, 'aucun gestionnaire inline dans la sortie')
      const ecrites = new Set([...output.slice(debut).matchAll(/return µ\._set\(_mjsThis, '(\w+)'/g)].map((m) => m[1]))
      assert.deepEqual([...ecrites].sort(), ['g', 'n', 'o', 'ok', 's', 't'], 'chaque liaison écrit sa variable par la forme directe')
    })
  }
})
