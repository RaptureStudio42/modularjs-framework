// dans <@head>, la balise ouvrante d'un <script>/<style> se lit comme les autres : `<script src={$cdn}>`
// partait dans la page avec le texte littéral `{$cdn}` (adresse cassée, aucun message), alors que la même
// écriture sur un <link> était servie. Le CONTENU, lui, reste injecté tel quel (accolades CSS ou JS)

import assert from 'node:assert/strict'
import { processGlobalMacros } from '../src/transpiler/macros.js'

describe('<@head> — balise ouvrante de <script>/<style> interpolée, contenu intact', () => {
  it('<script src={$cdn}> reçoit l\'adresse, échappée et entre guillemets', () => {
    const r = processGlobalMacros('<@head><script src={$cdn}></script></@head>')
    assert.deepEqual(r.errors, [])
    assert.ok(r.setup.includes(`µ._setHead(@, '<script src="' + µ._esc($cdn) + '"></script>')`), r.setup)
  })

  it('<style media={$m}> : la balise est interpolée, les accolades de la règle restent du CSS', () => {
    const r = processGlobalMacros('<@head><style media={$m}>.a { color: red }</style></@head>')
    assert.deepEqual(r.errors, [])
    assert.ok(r.setup.includes(`µ._setHead(@, '<style media="' + µ._esc($m) + '">.a { color: red }</style>')`), r.setup)
  })

  it('témoin : un <style> sans interpolation part tel quel', () => {
    const r = processGlobalMacros('<@head><style>@font-face { font-family: x }</style><script>a = {b: 1}</script></@head>')
    assert.deepEqual(r.errors, [])
    assert.ok(r.setup.includes(`µ._setHead(@, '<style>@font-face { font-family: x }</style><script>a = {b: 1}</script>')`), r.setup)
  })
})
