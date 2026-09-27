// decodeHtmlEntities — une entité numérique hors plage Unicode (> U+10FFFF) fait planter
// String.fromCodePoint (RangeError), sans composant ni ligne dans le message : toute la
// compilation s'arrête net. Le HTML remplace ces entités par U+FFFD (caractère de
// remplacement) plutôt que de refuser le document — même comportement ici.

import assert from 'node:assert/strict'
import { decodeHtmlEntities } from '../src/generator/utils.js'

describe('decodeHtmlEntities — entités numériques dans la plage Unicode', () => {
  it('décimale : &#65; → A', () => {
    assert.equal(decodeHtmlEntities('&#65;'), 'A')
  })

  it('hexadécimale : &#x41; → A', () => {
    assert.equal(decodeHtmlEntities('&#x41;'), 'A')
  })

  it('entités nommées et texte autour, inchangés', () => {
    assert.equal(decodeHtmlEntities('a &amp; b'), 'a & b')
  })
})

describe('decodeHtmlEntities — entités numériques HORS plage Unicode (> U+10FFFF)', () => {
  it('décimale hors plage : ne lève pas, rend U+FFFD', () => {
    assert.doesNotThrow(() => decodeHtmlEntities('&#99999999;'))
    assert.equal(decodeHtmlEntities('&#99999999;'), '�')
  })

  it('hexadécimale hors plage : ne lève pas, rend U+FFFD', () => {
    assert.doesNotThrow(() => decodeHtmlEntities('&#xFFFFFFFF;'))
    assert.equal(decodeHtmlEntities('&#xFFFFFFFF;'), '�')
  })

  it('texte autour de l\'entité hors plage préservé', () => {
    assert.equal(decodeHtmlEntities('avant &#99999999; après'), 'avant � après')
  })
})
