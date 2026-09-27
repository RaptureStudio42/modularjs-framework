// transpiler/img-tag — <@img src="…"> : repérage, attributs, largeurs.

import assert from 'node:assert/strict'
import { scanImgTags, parseWidths, isResolvableSrc } from '../src/transpiler/img-tag.js'

describe('scanImgTags — parseAttrs lit les chaînes consciemment (accolades comptées à tort)', () => {
  // parseAttrs comptait les {}/{} d'une valeur accolade SANS tenir compte des guillemets : une
  // accolade LITTÉRALE dans une chaîne d'attribut (title={"{"}) décrémentait/incrémentait la
  // profondeur à tort — ici elle ne referme JAMAIS, et tout le reste de la balise (dont src) est
  // avalé dans la valeur de `title`.
  it('title={"{"} src="hero.png" : src n\'est plus perdu', () => {
    const html = '<@img title={"{"} src="hero.png" alt="x"> reste'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png', `attrs: ${JSON.stringify(tags[0].attrs)}`)
  })

  it('title={"}"} : une accolade fermante littérale ne coupe pas l\'attribut en deux', () => {
    const html = '<@img title={"}"} src="hero.png"> reste'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].attrs.length, 2, `attrs: ${JSON.stringify(tags[0].attrs)}`)
    assert.equal(tags[0].src, 'hero.png')
  })

  it('aucun résidu de balise ne fuit dans le HTML qui suit', () => {
    const html = '<@img title={"{"} src="hero.png" alt="x"> reste'
    const tags = scanImgTags(html)
    assert.equal(html.slice(tags[0].end), ' reste')
  })

  it('témoin — accolade { } SANS guillemets à l\'intérieur reste inchangé (non-régression)', () => {
    const html = '<@img title={ f({a:1}) } src="hero.png"> reste'
    const tags = scanImgTags(html)
    assert.equal(tags.length, 1)
    assert.equal(tags[0].src, 'hero.png')
  })
})

describe('parseWidths — un nombre NON FINI (trop de chiffres) est refusé, comme "texte" ou "0"', () => {
  it('400 chiffres → null (même verdict que du texte)', () => {
    assert.equal(parseWidths('4'.repeat(400)), null)
  })

  it('largeur normale mêlée à un nombre non fini → null (toute la liste est refusée)', () => {
    assert.equal(parseWidths(`320 ${'9'.repeat(400)}`), null)
  })

  it('témoin — texte non numérique → null (comportement existant)', () => {
    assert.equal(parseWidths('texte'), null)
  })

  it('témoin — 0 → null (comportement existant)', () => {
    assert.equal(parseWidths('0'), null)
  })

  it('témoin — largeurs normales, séparées par espaces ou virgules → tableau', () => {
    assert.deepEqual(parseWidths('320 640'), [320, 640])
    assert.deepEqual(parseWidths('320, 640'), [320, 640])
  })

  it('témoin — chaîne vide → null', () => {
    assert.equal(parseWidths(''), null)
  })
})

describe('isResolvableSrc — témoin, non touché par ce lot', () => {
  it('chemin relatif résolvable, absolu/ancre/URL à schéma non résolus', () => {
    assert.equal(isResolvableSrc('hero.png'), true)
    assert.equal(isResolvableSrc('/hero.png'), false)
    assert.equal(isResolvableSrc('#x'), false)
    assert.equal(isResolvableSrc('http://x/hero.png'), false)
    assert.equal(isResolvableSrc(null), false)
  })
})
