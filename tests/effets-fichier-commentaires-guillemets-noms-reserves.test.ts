// Le fichier d'effets d'une appli (`*.effects.mjs`), lu par le compilateur :
// - un commentaire `//` sur sa ligne, ou après la déclaration, est retiré (comme le fait SASS) ; dans les réglages, il
//   reste refusé avec son message — il recevait le message générique « attendu : *nom = *effet(réglages) » ;
// - un guillemet ou une parenthèse restés ouverts dans le défaut d'un effet CSS, une déclaration ou un réglage changé
//   sont une erreur : dans la feuille de l'effet, la chaîne ouverte avalait la suite, jusqu'à la règle du mouvement réduit ;
//   un défaut ne lit pas `$réglage` (refusé comme quand on change ce réglage plus loin) ;
// - un réglage faux dans un effet réglé est dit dans la langue choisie, sous le nom écrit (`*titre`, pas `*scramble`) ;
// - un nom que JavaScript prend déjà (`constructor`, `toString`…) est refusé, pour un effet comme pour un réglage :
//   l'effet disparaissait sans un mot, le réglage faisait échouer chaque pose ;
// - un antislash échappe le guillemet qui le suit : `chars: "a\"b"` se lit.

import assert from 'node:assert/strict'
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.js'
import { setMessagesLang } from '../src/messages/index.js'

function lire(source: string): { effets: Record<string, any>, fautes: string[] } {
  const problems: Error[] = []
  const effets = resolveProjectEffects([parseEffectsBlock(source, 1, '/x/app.effects.mjs', problems)], undefined, problems)
  return { effets, fautes: problems.map(p => p.message) }
}

describe('fichier d\'effets : commentaires, guillemets, langue, noms pris', () => {
  afterEach(() => setMessagesLang('fr'))

  it('un commentaire sur sa ligne ou en fin de déclaration est retiré', () => {
    let r = lire('// mes effets\n*titre = *scramble(40)')
    assert.deepEqual(r.fautes, [])
    assert.equal(r.effets.titre.fixed.speed, 40)
    r = lire('*titre = *scramble(40) // lent')
    assert.deepEqual(r.fautes, [])
    assert.equal(r.effets.titre.fixed.speed, 40)
    r = lire('*halo(c: red) = // mon halo\n  color: $c\n// entre deux\n*titre = *scramble(40)')
    assert.deepEqual(r.fautes, [])
    assert.deepEqual(r.effets.halo.decls, [['color', '$c']])
    assert.equal(r.effets.titre.fixed.speed, 40)
    // une adresse dans les réglages n'est pas un commentaire
    r = lire('*fond = *behind(https://cdn.x.fr/a.png)')
    assert.deepEqual(r.fautes, [])
    assert.equal(r.effets.fond.fixed.image, 'https://cdn.x.fr/a.png')
  })

  it('un commentaire dans les réglages reste refusé, avec son message', () => {
    const r = lire('*titre = *scramble(40 // lent)')
    assert.equal(r.fautes.length, 1)
    assert.match(r.fautes[0], /un commentaire ne s'écrit pas dans les réglages d'un effet/)
  })

  it('un guillemet ou une parenthèse restés ouverts sont une erreur de construction', () => {
    for (const source of [
      '*h(c: \'red"\', w: 2px) =\n  color: $c\n  outline: $w solid',
      '*h(c: red) =\n  color: $c\n  content: \'abc',
      '*h(c: red) =\n  color: calc(1px + $c',
      '*h(c: red) =\n  color: $c\n*h2 = *h(c: \'x"\')',
      '*h(c: red\\) =\n  color: $c',
      '*h(c: red) =\n  color: $c /* jamais refermé',
    ]) {
      const r = lire(source)
      assert.equal(r.fautes.length, 1, source + ' → ' + JSON.stringify(r.fautes))
      assert.match(r.fautes[0], /reste ouvert/, source)
    }
    // appariés, ils passent
    const ok = lire('*h(f: \'Inter, sans-serif\', u: url("a.png")) =\n  font-family: $f\n  background: $u\n  content: "a\\"b"\n  box-shadow: 0 0 2px /* l\'épaisseur */ $f')
    assert.deepEqual(ok.fautes, [])
  })

  it('un défaut ne lit pas $réglage', () => {
    const r = lire('*h(c: $z) =\n  color: $c')
    assert.equal(r.fautes.length, 1)
    assert.match(r.fautes[0], /réglage « c: \$z »/)
  })

  it('un réglage faux dans un effet réglé : dit en anglais en entier, sous le nom écrit', () => {
    setMessagesLang('en')
    // `*b` règle `*ok`, qui règle `*scramble` : sa faute est dite sous `*b`
    const r = lire('*titre = *scramble(speed: 9999)\n*ok = *scramble(40)\n*b = *ok(speed: 1)')
    assert.equal(r.fautes.length, 2, JSON.stringify(r.fautes))
    for (const f of r.fautes) {
      assert.doesNotMatch(f, /ligne/, f)
      assert.equal(f.split('[ModularJS]').length, 2, 'un seul préfixe : ' + f)
    }
    assert.match(r.fautes[0], /^\[ModularJS\] app\.effects\.mjs \(line 1\): \*titre: speed = 9999/)
    assert.match(r.fautes[1], /^\[ModularJS\] app\.effects\.mjs \(line 3\): \*b: speed = 1/)
    setMessagesLang('fr')
    assert.match(lire('*titre = *scramble(speed: 9999)').fautes[0], /^\[ModularJS\] app\.effects\.mjs \(ligne 1\) : \*titre : speed = 9999/)
  })

  it('un nom que JavaScript prend déjà est refusé, pour un effet comme pour un réglage', () => {
    for (const [source, nom] of [['*constructor = *scramble(40)', 'constructor'], ['*toString(c: red) =\n  color: $c', 'toString'], ['*h(constructor: red) =\n  color: $constructor', 'constructor'], ['*h(valueOf: red) =\n  color: $valueOf', 'valueOf']]) {
      const r = lire(source)
      assert.equal(r.fautes.length, 1, source + ' → ' + JSON.stringify(r.fautes))
      assert.match(r.fautes[0], new RegExp(`« ${nom} » — ce nom est déjà pris par JavaScript`), source)
    }
    // un alias garde ses noms : `*neon.constructor` ne heurte rien
    assert.deepEqual(lire('*neon.constructor = *neon(red)').fautes, [])
  })

  it('un antislash échappe le guillemet qui le suit', () => {
    const r = lire('*t = *scramble(chars: "a\\"b")')
    assert.deepEqual(r.fautes, [])
    assert.equal(r.effets.t.fixed.chars, 'a"b')
  })
})
