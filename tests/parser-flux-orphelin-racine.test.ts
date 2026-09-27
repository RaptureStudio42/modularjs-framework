// Un {end} ou {else} EN TROP à la racine (sans {if}/{for}/{await}/{key} ouvrant) était
// silencieusement absorbé par parseFlow, qui remonte le statut 'end'/'else' à parse() — lequel
// ne vérifiait que 'close_tag' (garde jumelle, posée pour une fermante HTML orpheline, jamais
// étendue à ces jetons). Le contenu suivant le jeton en trop disparaissait du composant SANS
// aucune erreur, build vert compris.

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'

describe('parser — {end}/{else} en trop à la racine : erreur, plus de contenu perdu en silence', () => {
  it('{end} orphelin à la racine : lève, ne laisse plus disparaître ce qui suit', () => {
    assert.throws(() => parse('<p>avant</p>{end}<p>apres</p>'), /ORPHELIN/i)
  })

  it('{else} orphelin à la racine : lève, ne laisse plus disparaître ce qui suit', () => {
    assert.throws(() => parse('<p>avant</p>{else}<p>apres</p>'), /ORPHELIN/i)
  })

  it('le message nomme le jeton et la ligne', () => {
    assert.throws(() => parse('<p>avant</p>\n{end}\n<p>apres</p>'), /\{end\}/)
    assert.throws(() => parse('<p>avant</p>\n{end}\n<p>apres</p>'), /ligne 2/)
    assert.throws(() => parse('<p>avant</p>\n{else}\n<p>apres</p>'), /\{else\}/)
    assert.throws(() => parse('<p>avant</p>\n{else}\n<p>apres</p>'), /ligne 2/)
  })

  it('{end} correctement apparié à un {if} racine : ne lève pas, {if}/{end} restent valides', () => {
    assert.doesNotThrow(() => parse('{if $x}<p>a</p>{end}<p>apres</p>'))
  })

  it('{end} en toute fin de document (rien à perdre) : reste accepté, comme la fermante HTML orpheline symétrique', () => {
    assert.doesNotThrow(() => parse('<p>avant</p>{end}'))
  })

  it('{elsif …}, {success …} et {error …} orphelins à la racine : lèvent aussi, rien ne disparaît en silence', () => {
    assert.throws(() => parse('<p>avant</p>{elsif $x}<p>apres</p>'), /ORPHELIN/i)
    assert.throws(() => parse('<p>avant</p>{success res}<p>apres</p>'), /ORPHELIN/i)
    assert.throws(() => parse('<p>avant</p>{error err}<p>apres</p>'), /ORPHELIN/i)
    assert.throws(() => parse('<p>avant</p>\n{elsif $x}\n<p>apres</p>'), /\{elsif/)
  })

  it('jeton orphelin en toute fin de document : accepté mais signalé (bloc mal imbriqué, ex. {end}{end})', () => {
    const orig = console.warn
    const caught: string[] = []
    console.warn = (...a: unknown[]) => { caught.push(String(a[0])) }
    try { parse('{if $x}<p>a</p>{end}{end}') } finally { console.warn = orig }
    assert.equal(caught.length, 1, `avertissements capturés : ${JSON.stringify(caught)}`)
    assert.match(caught[0], /\{end\}/)
  })
})
