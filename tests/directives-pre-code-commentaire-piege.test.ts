// transpiler/directives — masquage <pre>/<code>/commentaires HTML : la borne de fermeture était
// cherchée par une regex paresseuse sur le texte BRUT (contrairement à <script>/<style>, déjà
// corrigés). Un `</pre>`/`</code>` LITTÉRAL écrit comme DONNÉE dans une chaîne passée à une
// interpolation `{…}` (`<pre>{ f("</pre>") }` : le composant affiche le résultat de `f`, pas le
// texte `</pre>` lui-même) refermait la zone trop tôt — tout ce qui suit (une directive citée
// juste après) ressortait comme texte ACTIF, hors masque.

import assert from 'node:assert/strict'
import { extractDirectives } from '../src/transpiler/directives.js'

describe('maskDocBlock — un </pre>/</code> littéral DANS une interpolation {…} ne raccourcit pas le bloc masqué', () => {
  it('</pre> dans une chaîne passée à une interpolation, @persist cité juste après reste inerte', () => {
    const src = [
      '<pre>{ f("</pre>") }',
      '@persist $shouldStayInert',
      '</pre>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    assert.equal(cleaned, src)
  })

  it('</code> dans une chaîne passée à une interpolation, @preload cité juste après reste inerte', () => {
    const src = [
      '<code>{ f("</code>") }',
      '@preload hover',
      '</code>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, null, `modulePreload : ${JSON.stringify(modulePreload)}`)
    assert.equal(cleaned, src)
  })

  it('interpolation avec objet imbriqué `{ f({a: 1}, "</pre>") }` : la profondeur des accolades internes ne casse pas la recherche', () => {
    const src = [
      '<pre>{ f({a: 1}, "</pre>") }',
      '@persist $fromNested',
      '</pre>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
  })

  it('contre-cas : un </pre> RÉEL (hors interpolation) referme normalement, le reste du texte suit son cours', () => {
    const src = '<pre>vrai contenu</pre>\n@persist $afterRealPre\n<p>x</p>\n'
    const { persistLocalVars, cleaned } = extractDirectives(src)
    assert.deepEqual(persistLocalVars.map(v => v.var), ['$afterRealPre'])
    assert.doesNotMatch(cleaned, /@persist/)
    assert.match(cleaned, /<pre>vrai contenu<\/pre>/)
  })
})

// Limite ASSUMÉE, pas une régression restante : un commentaire HTML qui se referme VRAIMENT tôt
// (un `-->` littéral apparaît avant la fin voulue par l'auteur) suit le même contrat NATIF que
// partout ailleurs dans le compilateur (mask.ts, maskHtmlComments : motif LAZY, un `<!--` ferme au
// PREMIER `-->` rencontré, comme un navigateur). Un `{…}` d'interpolation protège son CONTENU (cf.
// describe ci-dessus, une DONNÉE de code n'est pas du balisage) ; un `-->` en TEXTE NU, sans
// interpolation autour, n'a pas cette protection — il ferme le commentaire, exactement comme dans
// un document HTML ordinaire. Étendre cette fermeture PLUS LOIN qu'un `-->` nu créerait un risque
// inverse et plus large : n'importe quelle prose contenant un jour un `-->` littéral (flèche dans
// un exemple, notation d'état) avalerait tout le texte jusqu'au `-->` SUIVANT, réel ou non.
describe('maskCommentBlocks — un </pre>/<code>/<!-- --> hors interpolation suit le contrat natif de maskHtmlComments', () => {
  it('un </pre> RÉEL DANS un commentaire (imbriqué) reste protégé : masqué avec son commentaire englobant', () => {
    const src = '<!-- exemple :\n<pre>@persist $x</pre>\n-->\n<p>ok</p>\n'
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.equal(cleaned, src)
    assert.deepEqual(persistLocalVars, [])
  })

  it('limite assumée : un `-->` nu AVANT la fin voulue ferme le commentaire au PREMIER trouvé (comme un navigateur)', () => {
    const src = [
      '<!-- exemple : --> puis texte',
      '@preload hover',
      '-->',
      '<p>x</p>',
      '',
    ].join('\n')
    const { modulePreload } = extractDirectives(src)
    // le commentaire `<!-- exemple : -->` se referme dès son PREMIER `-->` (motif natif, testé
    // dans mask-commun.test.ts) : `@preload hover` est du texte RACINE réel, pas un exemple caché.
    assert.equal(modulePreload, 'hover')
  })
})
