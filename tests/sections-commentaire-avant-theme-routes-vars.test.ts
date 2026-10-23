// le texte du gabarit n'est plus lu comme du CSS pour trouver <theme>, <routes>, <vars>, <types> et <effects> : un `/*` ou un `url(` écrits
// dans le HTML AVANT eux (texte d'un paragraphe, démo de code), refermés plus loin, masquaient tout jusqu'à leur fin, balise comprise — la
// section restait dans le HTML, ou le composant était refusé (« un </theme> orphelin »). Même lecture que pour <style>

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('extractSections — `/*` et `url(` dans le HTML avant <theme>, <routes>, <vars>, <types>, <effects>', () => {
  it('`/*` avant le thème, refermé par un commentaire du thème', () => {
    const s = extractSections('<p>/* note</p>\n<theme>\n  /* clair */\n  $$fond: #fff\n</theme>')
    assert.equal(s.themes.length, 1)
    assert.ok(s.themes[0].raw.includes('/* clair */') && s.themes[0].raw.includes('$$fond: #fff'), s.themes[0].raw)
  })

  it('`/*` avant le thème, refermé après lui', () => {
    const s = extractSections('<p>/* note</p>\n<theme name="sombre">\n  $$fond: #000\n</theme>\n<p>*/</p>')
    assert.deepEqual(s.themes.map(th => [th.name, th.raw.trim()]), [['sombre', '$$fond: #000']])
    assert.ok(!s.html.includes('<theme'), s.html)
  })

  it('`url(` avant les routes, refermé après elles', () => {
    const s = extractSections('<p>voir url( ici</p>\n<routes target="app-view">\n/a  fx-a\n</routes>\n<p>)</p>')
    assert.deepEqual(s.routes.map(r => r.target), ['app-view'])
    assert.ok(!s.html.includes('<routes'), s.html)
  })

  it('`/*` avant <vars>, <types> et <effects>, refermé après eux', () => {
    const s = extractSections('<p>/* note</p>\n<vars>\n  $x int\n</vars>\n<types>\n  Age int 0..120\n</types>\n<effects>\n  pulse\n</effects>\n<p>*/</p>')
    assert.equal(s.vars?.raw.trim(), '$x int')
    assert.deepEqual(s.types.map(ty => ty.raw.trim()), ['Age int 0..120'])
    assert.deepEqual(s.effects.map(e => e.raw.trim()), ['pulse'])
  })

  it('un `<theme>` cité dans un commentaire du style reste du style', () => {
    const s = extractSections('<style>\n/*\n<theme>\n*/\n.a\n  color: red\n</style>')
    assert.deepEqual(s.themes, [])
    assert.equal(s.style.raw, '\n/*\n<theme>\n*/\n.a\n  color: red\n')
  })
})
