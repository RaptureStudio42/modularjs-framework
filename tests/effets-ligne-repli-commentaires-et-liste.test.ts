// Quand la ligne d'une faute d'effet n'est pas sûre (le générateur ne l'a pas donnée, ou elle ne tombe sur aucune balise
// du fichier qui écrit l'effet), le message cherche l'effet dans le texte du fichier. Un effet cité dans un commentaire
// HTML n'est pas écrit : jamais une ligne tirée d'un commentaire. Une liste de lignes n'est citée que si elle est
// courte (trois au plus) : au-delà, aucune ligne vaut mieux qu'une liste que personne ne lit.

import assert from 'node:assert/strict'
import { withEffectLines } from '../src/bundler/transpile-msg.js'

const fault = (line?: number) => Object.assign(new Error('[ModularJS] *titre : effet inconnu — effets disponibles : *annotate, *attention.'), line ? { mjsLine: line } : {})
const said  = (content: string, line?: number) => withEffectLines(fault(line), content).message

describe('la ligne d\'une faute d\'effet, quand le repli cherche l\'effet dans le texte du fichier', () => {
  it('un effet cité dans un commentaire HTML ne compte pas : seule la balise qui l\'écrit donne sa ligne', () => {
    const m = said('<!-- *titre est un effet à écrire -->\n<p>a</p>\n<p *titre>x</p>\n')
    assert.match(m, /\*titre \(ligne 3\) : effet inconnu/)
    assert.doesNotMatch(m, /lignes/)
  })

  it('un commentaire sur plusieurs lignes : les numéros restent ceux du fichier', () => {
    assert.match(said('<!--\n  *titre\n-->\n<p *titre>x</p>\n'), /\*titre \(ligne 4\) : effet inconnu/)
  })

  it('un effet écrit seulement dans un commentaire : aucune ligne, le message reste tel quel', () => {
    const m = said('<!-- *titre -->\n<p>a</p>\n')
    assert.match(m, /\*titre : effet inconnu/)
    assert.doesNotMatch(m, /\(lignes? \d/)
  })

  it('une ligne donnée par le générateur qui tombe sur un commentaire n\'est pas écrite', () => {
    const m = said('<!-- *titre -->\n<p>a</p>\n<p *titre>x</p>\n', 1)
    assert.doesNotMatch(m, /\(ligne 1\)/)
    assert.match(m, /\*titre \(ligne 3\) : effet inconnu/)
  })

  it('trois lignes au plus sont citées', () => {
    assert.match(said('<p *titre>a</p>\n<p *titre>b</p>\n<p *titre>c</p>\n'), /\*titre \(lignes 1, 2, 3\) : effet inconnu/)
  })

  it('au-delà de trois lignes, aucune n\'est citée', () => {
    const m = said('<p *titre>a</p>\n<p *titre>b</p>\n<p *titre>c</p>\n<p *titre>d</p>\n')
    assert.match(m, /\*titre : effet inconnu/)
    assert.doesNotMatch(m, /\(lignes? \d/)
  })
})
