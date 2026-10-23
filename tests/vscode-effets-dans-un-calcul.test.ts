// L'extension VS Code : les effets ne sont jamais proposés au milieu d'un calcul. `{$a*` ne proposait rien, mais
// `{$a *` — la même multiplication, avec une espace — déroulait toute la liste des effets. Un `{` resté ouvert avant
// l'étoile est un calcul ; hors d'un calcul (une accolade refermée, une balise, un attribut), les effets restent proposés.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const help    = require('../editors/vscode/effects-help.js')
const labels  = (l: any[]) => l.map((s: any) => s.label)

describe('extension VS Code — les effets, jamais dans un calcul', () => {
  it('une étoile dans une accolade ouverte est une multiplication : rien à proposer, avec ou sans espace avant elle', () => {
    for (const ligne of ['{$a*', '{$a *', '{$a *ne', '<p>Total : {$prix *', '<b title={$a *', '{$a * $b *', '{ $a +  2 * $b *']) {
      assert.equal(help.suggest(ligne).length, 0, ligne)
    }
  })

  it('hors d\'un calcul, les effets restent proposés après l\'étoile : balise, attribut d\'effet, accolade refermée', () => {
    for (const ligne of ['<h1 *', '<h1 *ne', '<p>{$n}</p> <b *', '<b class={$a ? \'x\' : \'y\'} *', '<b @click={$n++} *', '{if $a}<b *', '<div @in=*']) {
      assert.ok(labels(help.suggest(ligne)).includes('neon'), ligne)
    }
  })
})
