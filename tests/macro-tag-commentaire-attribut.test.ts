// findMacroTagEnd — un commentaire `//`/`/* … */` DANS l'expression d'un attribut
// (`{ … }`) n'était jamais reconnu comme tel : ses `{`/`}`/`>` internes comptaient dans la
// profondeur de la balise. `/* } > */` refermait donc l'accolade PUIS la balise elle-même
// au mauvais endroit — un résidu de texte fuyait dans le HTML rendu, et <@img> y perdait
// carrément son `src` (le vrai `src="…"`, situé APRÈS le commentaire, tombait hors de la
// balise tronquée).

import assert from 'node:assert/strict'
import { findMacroTagEnd } from '../src/transpiler/macro-tag.js'
import { scanImgTags } from '../src/transpiler/img-tag.js'

describe('findMacroTagEnd — commentaire de bloc `/* … */` dans une expression d\'attribut', () => {
  it('/* } > */ ne referme ni l\'accolade ni la balise : le VRAI > est retrouvé', () => {
    const html = '<@x attr={ /* } > */ vraiSuite }>reste'
    const from = '<@x'.length
    const end  = findMacroTagEnd(html, from)
    assert.notEqual(end, -1, 'la balise doit être reconnue comme fermée')
    assert.equal(html[end], '>', 'le caractère trouvé doit être le VRAI > final')
    assert.equal(html.slice(end + 1), 'reste', 'AVANT le fix : le scan retombait sur le > du commentaire, laissant fuir du texte')
  })

  it('commentaire de bloc jamais refermé : signalé comme balise non fermée (-1), pas d\'emballement', () => {
    const html = '<@x attr={ /* jamais fermé vraiSuite }>reste'
    const from = '<@x'.length
    assert.equal(findMacroTagEnd(html, from), -1)
  })
})

describe('findMacroTagEnd — commentaire de ligne `//` dans une expression d\'attribut', () => {
  it('// … jusqu\'à la fin de ligne, la suite du commentaire reprend normalement', () => {
    const html = '<@x attr={ // } > commentaire\n vraiSuite }>reste'
    const from = '<@x'.length
    const end  = findMacroTagEnd(html, from)
    assert.notEqual(end, -1)
    assert.equal(html[end], '>')
    assert.equal(html.slice(end + 1), 'reste')
  })
})

describe('findMacroTagEnd — témoin, sans commentaire : comportement inchangé', () => {
  it('même structure sans commentaire compile déjà correctement', () => {
    const html = '<@x attr={ vraiSuite }>reste'
    const from = '<@x'.length
    const end  = findMacroTagEnd(html, from)
    assert.equal(html.slice(end + 1), 'reste')
  })
})

describe('scanImgTags — <@img> avec un commentaire } > dans un attribut AVANT src', () => {
  it('le src RÉEL, situé après le commentaire, est retrouvé (plus null)', () => {
    const html = '<@img alt={ /* } > */ "photo" } src="hero.png"> texte après'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `tag.text: ${JSON.stringify(tags[0].text)}`)
  })

  // AVANT : parseAttrs (sans conscience des commentaires) cassait `alt` au `}` du commentaire,
  // puis « resynchronisait » sur `src=` un peu plus loin en traversant plusieurs attributs
  // fantômes (`>`, `*`, `"photo"`, `}`) — le test ci-dessus passait par CHANCE (seul `src`
  // vérifié). Ici la liste COMPLÈTE des attributs lus est vérifiée : exactement `alt` et `src`,
  // aucun résidu du commentaire ne doit apparaître comme un attribut à part.
  it('exactement 2 attributs lus (alt, src) — aucun résidu du commentaire comme attribut fantôme', () => {
    const html = '<@img alt={ /* } > */ "photo" } src="hero.png"> texte après'
    const tags = scanImgTags(html)
    assert.deepEqual(tags[0].attrs, [
      { name: 'alt', raw: 'alt={ /* } > */ "photo" }' },
      { name: 'src', raw: 'src="hero.png"' },
    ], `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })

  it('aucun résidu de balise ne fuit dans le HTML qui suit', () => {
    const html = '<@img alt={ /* } > */ "photo" } src="hero.png"> texte après'
    const tags = scanImgTags(html)
    assert.equal(html.slice(tags[0].end), ' texte après')
  })
})

describe('scanImgTags — parseAttrs (accolade d\'attribut) ignore aussi les commentaires, comme findMacroTagEnd', () => {
  // RÉGRESSION du même correctif : parseAttrs dupliquait le suivi de profondeur `{}` de
  // findMacroTagEnd SANS jamais avoir reçu sa conscience des commentaires. Un commentaire
  // contenant une accolade OUVRANTE non appariée (`/* { */`, par opposition à `/* } > */`
  // ci-dessus) ne se refermait JAMAIS : le test existant ne le couvrait pas, et passait par
  // chance sur un cas différent.
  it('/* { */ (accolade OUVRANTE non appariée) : src n\'est plus perdu', () => {
    const html = '<@img title={/* { */ "x"} src="hero.png">'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `attrs: ${JSON.stringify(tags[0].attrs)}`)
    assert.deepEqual(tags[0].attrs, [
      { name: 'title', raw: 'title={/* { */ "x"}' },
      { name: 'src', raw: 'src="hero.png"' },
    ], `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })

  it('commentaire de ligne `//` contenant une accolade et un guillemet : src retrouvé', () => {
    const html = '<@img title={ // { "\n  "x"} src="hero.png">'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })

  it('gabarit (backtick) contenant une accolade FERMANTE non appariée : lue comme une chaîne, src retrouvé', () => {
    // accolade DÉSÉQUILIBRÉE exprès (un seul `}`, sans `{` partenaire) : sans lecture du
    // gabarit comme une chaîne, la profondeur retombe à 0 ICI, bien avant la vraie fin de balise
    const html = '<@img title={`x}y`} src="hero.png">'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `attrs: ${JSON.stringify(tags[0].attrs)}`)
    assert.deepEqual(tags[0].attrs, [
      { name: 'title', raw: 'title={`x}y`}' },
      { name: 'src', raw: 'src="hero.png"' },
    ], `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })

  it('gabarit avec interpolation imbriquée `${ {a:1} }` : src retrouvé', () => {
    const html = '<@img title={`x${ {a:1} }y`} src="hero.png">'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })
})
