// Les réglages d'un effet écrits à la pose (`*nom(réglages)`), lus par le compilateur :
// - un réglage texte respecte ses bornes de longueur (`axis: string 4..4`) : `*weight(axis: abcdefgh)` passait, l'effet
//   ne faisait rien, alors que le message d'erreur annonçait déjà « permis : string 4..4 » ;
// - un réglage que l'effet n'a pas, même s'il porte le nom d'une méthode d'Object (`constructor`), est inconnu — il était
//   dit « écrit deux fois » ;
// - une adresse sans guillemets en réglage principal (`*behind(https://cdn.x.fr/a.png)`) est l'adresse, pas un réglage `https` ;
// - un antislash échappe le guillemet qui le suit, dans une valeur entre guillemets : `'a\'b'` vaut a'b ;
// - un effet donné à `fx` avec une variable dans ses réglages a son message à lui (des valeurs fixes seulement).

import assert from 'node:assert/strict'
import { parseEffect } from '../src/effects/catalog.js'

const fixe   = (nom: string, reglages: string) => parseEffect(nom, reglages).fixed
const refuse = (nom: string, reglages: string, motif: RegExp) => assert.throws(() => parseEffect(nom, reglages), motif, `*${nom}(${reglages})`)

describe('effets : les réglages écrits à la pose', () => {
  it('un réglage texte hors de ses bornes de longueur est refusé, dans ses bornes accepté', () => {
    refuse('weight', 'axis: abcde', /axis = abcde — permis : string 4\.\.4/)
    refuse('weight', 'axis: abc', /permis : string 4\.\.4/)
    refuse('weight', "axis: ''", /permis : string 4\.\.4/)
    assert.equal(fixe('weight', 'axis: wdth').axis, 'wdth')
    refuse('travel', "to: ''", /permis : string 1\.\.400/)
    assert.equal(fixe('travel', 'to: hero').to, 'hero')
    refuse('count', "separator: 'abcd'", /permis : string 0\.\.3/)
    assert.equal(fixe('count', "separator: ''").separator, '')
    // la longueur se compte en caractères : un émoji en vaut un
    assert.equal(fixe('count', "prefix: '😀😀😀😀😀😀😀😀'").prefix, '😀😀😀😀😀😀😀😀')
    refuse('count', "prefix: '😀😀😀😀😀😀😀😀😀'", /permis : string 0\.\.8/)
  })

  it('un réglage au nom d\'une méthode d\'Object est un réglage inconnu, pas un réglage écrit deux fois', () => {
    refuse('neon', 'constructor: red', /réglage « constructor » inconnu/)
    refuse('neon', 'toString: red', /réglage « toString » inconnu/)
  })

  it('une adresse sans guillemets en réglage principal est l\'adresse', () => {
    assert.equal(fixe('behind', 'https://cdn.x.fr/a.png').image, 'https://cdn.x.fr/a.png')
    assert.equal(fixe('behind', 'https://cdn.x.fr/a.png, depth: 0.5').image, 'https://cdn.x.fr/a.png')
    assert.equal(fixe('behind', 'image: https://cdn.x.fr/a.png').image, 'https://cdn.x.fr/a.png')
    // un vrai réglage suivi d'une adresse sans schéma reste ce réglage
    assert.equal(fixe('behind', 'image://cdn.x.fr/a.png').image, '//cdn.x.fr/a.png')
  })

  it('un antislash échappe le guillemet qui le suit dans une valeur entre guillemets', () => {
    assert.equal(fixe('scramble', "chars: 'a\\'b'").chars, "a'b")
    assert.equal(fixe('scramble', 'chars: "a\\"b"').chars, 'a"b')
    const r = fixe('scramble', "chars: 'a\\', b', speed: 40")
    assert.equal(r.chars, "a', b")
    assert.equal(r.speed, 40)
  })

  it('un effet donné à fx avec une variable dans ses réglages : le message dit d\'écrire des valeurs fixes', () => {
    refuse('delta', 'fx: *fade(duration: $d)', /l'effet donné à fx s'écrit en entier, en valeurs fixes/)
    refuse('delta', 'fx: *fade($$d)', /en valeurs fixes/)
  })
})
