// interpolateSigils (src/lexer/index.ts) — le compteur d'accolades qui délimite le contenu d'une
// interpolation `${…}`/`#{…}` ignorait les commentaires et les littéraux regex : un `}` À
// L'INTÉRIEUR d'un commentaire (`${ /* } */ $a }`) ou d'une regex (`${ /}/.test(x) ? $a : $b }`)
// refermait le compteur PRÉMATURÉMENT. Le vrai code de l'interpolation qui suivait ($a, $b…)
// retombait alors HORS de la zone tokenisée, restait littéral, et plantait au runtime
// (ReferenceError : `$a` n'existe pas en dehors de `$.a`). Remède : sauter commentaires/regex
// (et chaînes) comme le fait déjà scanInertAt, le lecteur de zones inertes du même fichier.

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'

describe('lexer — interpolateSigils : commentaire/regex dans une interpolation', () => {
  it('commentaire /* } */ avant le vrai code : le $ qui suit est bien réécrit ($.a)', () => {
    const out = tokenize('`avant ${ /* } */ $a } apres`')
    assert.match(out, /\$\.a\b/, 'le `}` du commentaire ne doit pas fermer l\'interpolation trop tôt')
  })

  it('littéral regex /}/  avant le vrai code : les $ qui suivent sont bien réécrits ($.a, $.b)', () => {
    const out = tokenize('`avant ${ /}/.test(x) ? $a : $b } apres`')
    assert.match(out, /\$\.a\b/)
    assert.match(out, /\$\.b\b/)
  })

  it('même bug via le marqueur # (chaîne Coffee interpolée)', () => {
    const out = tokenize('"texte #{/* } */ $a}"')
    assert.match(out, /\$\.a\b/)
  })

  it('témoin non-régression : gabarit imbriqué (sans regex/commentaire) toujours correct', () => {
    const out = tokenize('`avant ${ `inner${$a}inner` } apres`')
    assert.match(out, /\$\.a\b/)
  })

  it('témoin non-régression : chaîne portant un `}` dans l\'interpolation', () => {
    const out = tokenize("`a${ f('}') + $a }b`")
    assert.match(out, /\$\.a\b/)
  })

  it('un `#` dans une interpolation n\'est pas un commentaire : il ne ferme pas la zone jusqu\'à la fin de ligne', () => {
    const out = tokenize('`v: ${ a # commentaire } fin ${ $b }`')
    assert.match(out, /\$\.b\b/, 'la seconde interpolation doit être lue')
    assert.ok(out.includes('} fin'), `l'accolade fermante de la première interpolation doit rester à sa place : ${out}`)
  })

  it('un champ privé `o.#x` dans une interpolation reste intact', () => {
    const out = tokenize('`v: ${ o.#x + $a } fin`')
    assert.ok(out.includes('o.#x'), out)
    assert.match(out, /\$\.a\b/)
  })
})
