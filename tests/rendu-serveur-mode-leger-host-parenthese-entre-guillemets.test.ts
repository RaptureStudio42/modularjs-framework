// Composant léger : la règle `:host(…)` est réécrite sur le nom de la balise, au navigateur (cœur) comme au rendu serveur. Le
// cœur saute déjà une parenthèse écrite dans une chaîne (`:host([title=")"])`) ; la version du rendu serveur la comptait, et la
// page rendue recevait un sélecteur cassé (`mjs-x[title=""]) .a`), donc une règle perdue jusqu'au réveil du composant.

import assert from 'node:assert/strict'
import { lightHostCss } from '../src/server/light-host-css.js'

describe('rendu serveur — :host d\'un composant léger, parenthèse entre guillemets', () => {
  it(':host([title=")"]) : même réécriture qu\'au navigateur', () => {
    assert.equal(lightHostCss(':host([title=")"]) .a{color:red}', 'mjs-x'), 'mjs-x[title=")"] .a{color:red}')
  })

  it(':host-context([data-x=\'(\']) : contexte entier', () => {
    assert.equal(lightHostCss(":host-context([data-x='(']) .a{color:red}", 'mjs-x'), ":where([data-x='('] mjs-x,mjs-x[data-x='('])" + ' .a{color:red}')
  })

  it('sans guillemets : inchangé', () => {
    assert.equal(lightHostCss(':host(:not(.a)) .b{color:red}', 'mjs-x'), 'mjs-x:not(.a) .b{color:red}')
  })
})
