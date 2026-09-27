// Deux diagnostics manquants du parser, sur une entrée déjà invalide (qualité du diagnostic,
// pas de corruption d'une entrée valide) :
//
// 1. `<div><span></div>` — la fermante `</div>` ne correspond pas à `<span>`, ouvert le plus
//    récemment : `scanner.scan(...)` échouait en silence (aucune vérification de son retour),
//    `<span>` était quand même poussé dans l'arbre. AVERTISSEMENT désormais (jamais une erreur,
//    pour ne casser aucun site existant), sauf pour les balises dont le HTML5 rend la fermeture
//    OPTIONNELLE (p, li, td, tr, option…) : leur absence, comblée par la fermeture d'un ancêtre,
//    est un balisage HTML légitime, pas une faute.
//
// 2. `{{value}` — une seule accolade fermante pour une interpolation HTML brut, qui en exige
//    deux (`{{ expr }}`, docs/07-bindings.md). `scanner.scan(/\}/)` échouait, lui aussi, en
//    silence : le nœud partait quand même en HTML brut, sur un contenu tronqué. Ce n'est pas une
//    forme documentée : ERREUR claire, avec la ligne.

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'

// espionne console.warn le temps d'un parse()
function warningsFor(html: string): string[] {
  const orig = console.warn
  const caught: string[] = []
  console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
  try { parse(html) } finally { console.warn = orig }
  return caught
}

describe('parser — fermeture mal appariée : avertissement, plus de diagnostic muet', () => {
  it('<div><span> jamais refermé, </div> rencontrée à la place : 1 avertissement, les 2 lignes sont citées', () => {
    const warnings = warningsFor('<div>\n<span>x\n</div>')
    assert.equal(warnings.length, 1, `avertissements capturés : ${JSON.stringify(warnings)}`)
    assert.match(warnings[0], /span/)
    assert.match(warnings[0], /div/)
    assert.match(warnings[0], /ligne 2/, 'ligne d\'ouverture du <span>')
    assert.match(warnings[0], /ligne 3/, 'ligne de la </div> rencontrée à la place')
  })

  it('parse() ne lève pas pour autant : ne casse aucun site existant', () => {
    assert.doesNotThrow(() => parse('<div><span></div>'))
  })

  it('<ul><li>a</ul> — li jamais refermé explicitement, absorbé par la fin de son parent : fermeture implicite légitime, aucun avertissement', () => {
    assert.deepEqual(warningsFor('<ul><li>a</ul>'), [])
  })

  it('<table><tr><td>a</tr></table> — td/tr fermés implicitement : aucun avertissement', () => {
    assert.deepEqual(warningsFor('<table><tr><td>a</tr></table>'), [])
  })

  it('paire correctement appariée : aucun avertissement', () => {
    assert.deepEqual(warningsFor('<div><span>x</span></div>'), [])
  })

  it('<@slot> enveloppé sans fermante — forme documentée (fermante </@slot> facultative) : aucun avertissement', () => {
    assert.deepEqual(warningsFor('<div class="header"><@slot header></div>\n<div class="content"><@slot></div>'), [])
  })
})

describe('parser — {{…}} (HTML brut) : accolade fermante manquante', () => {
  it('{{value} (une seule accolade fermante) : erreur claire, la ligne est citée', () => {
    assert.throws(() => parse('<p>avant</p>\n{{value}\n<p>apres</p>'), /DOUBLE ACCOLADE/)
    assert.throws(() => parse('<p>avant</p>\n{{value}\n<p>apres</p>'), /ligne 2/)
  })

  it('{{ $brut }} (forme complète documentée, docs/07-bindings.md) : continue de compiler', () => {
    assert.equal(parse('<p>{{ $brut }}</p>').children[0].children[0].expr, '$brut')
  })

  it('{{$html}} (sans espace, forme testée par ailleurs) : continue de compiler', () => {
    const n = parse('{{$html}}').children[0]
    assert.equal(n.expr, '$html')
    assert.equal(n._is_raw, true)
  })
})
